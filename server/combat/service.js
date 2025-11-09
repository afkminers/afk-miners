// server/combat/service.js

const { get, run } = require('../models/db');
const K = require('../balance/config');
const { applyTries, getClassRate } = require('../skills/engine');
const wsBus = require('../ws/bus');
const { broadcast, sendToPlayer, broadcastToMap } = wsBus;
const { TILE } = require('./geom');
const { toTileCoords, chebyshevTiles, isValidTile } = require('../utils/tile-coords');
const lootService = require('../services/loot');
const { resolveMonsterAttackProfile } = require('./monster_attack_profile');
const { hasLineOfSightTiles } = require('./los');
const { getGrid } = require('../maps/grid');
const {
  getHeroRespawnPoint,
  setHeroRespawnPoint,
  upsertPlayerLastPos,
  DEFAULT_START,
} = require('../services/spawnPoint');
// Se você usa este serviço central de XP:
const { giveXp } = require('../services/heroProgress');
const { setLivePlayerPosition, markHeroAlive } = require('../player/live_positions');
const battleState = require('./battle-state');

const HERO_LAST_HIT_AT = new Map();
const DEFAULT_RANGED_MIN = 2;

// posição do herói (para validar mapa/alvo)
let _pos = null;
function posMod() {
  if (!_pos) {
    try { _pos = require('./pos'); } catch { _pos = null; }
  }
  return _pos;
}

// lazy require p/ evitar ciclo (ai-mobs -> service -> ai-mobs)
let _aiMobs = null;
function ai() {
  if (!_aiMobs) {
    try { _aiMobs = require('./ai-mobs'); } catch { _aiMobs = null; }
  }
  return _aiMobs;
}

/** =======================
 *  Config de Respawn
 *  ======================= */
const RESPAWN_MS = 10000; // 5s de espera na tela de morte
const RESPAWN_FALLBACK = { ...DEFAULT_START };
const RESPAWN_HP_FRACTION = 1.0; // 100% da vida ao reviver (mín. 1)

/** Dano estilo Tibia (sem dano mínimo garantido) */
function computeDamageTibiaLike(weaponAtk, skillLevel, monsterArmor, variance = K.DAMAGE_VARIANCE || 0.15) {
  const base = weaponAtk * (1 + skillLevel / 50);
  const minDmg = Math.floor(base * (1 - variance));
  const maxDmg = Math.ceil(base * (1 + variance));
  const raw = Math.floor(Math.random() * (maxDmg - minDmg + 1)) + minDmg;
  const defenseReduction = Math.floor(Math.random() * (monsterArmor + 1));
  return Math.max(0, raw - defenseReduction);
}

function resolveWeaponSpeedMs(weaponType) {
  const table = K.WEAPON_SPEED_MS || {};
  const key = String(weaponType || '').toUpperCase();
  const candidates = [key];

  if (/BOW|CROSSBOW|SPEAR|JAVELIN|THROWING|DISTANCE/.test(key)) {
    candidates.push('DISTANCE', 'BOW');
  }

  if (/STAFF|WAND|ROD|MAGIC|TOME/.test(key)) {
    candidates.push('MAGIC', 'STAFF');
  }

  candidates.push('SWORD');

  for (const candidate of candidates) {
    const raw = table?.[candidate];
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return 900;
}

/** Mapeia tipo de arma -> tipo de skill */
async function resolveSkillFromWeapon(weaponType) {
  if (!weaponType) return null;
  const row = await get(
    `SELECT skill_type FROM weapon_skill_map WHERE lower(weapon_type) = lower($1)`,
    [String(weaponType)]
  );
  return row?.skill_type || null;
}

/** Nível do skill do herói */
async function getHeroSkillLevel(heroId, skillType) {
  if (!heroId || !skillType) return 10;
  const row = await get(
    `SELECT level FROM player_hero_skills WHERE hero_id = $1 AND skill_type = $2`,
    [heroId, skillType]
  );
  return row?.level ? Number(row.level) : 10;
}

/** Stats básicos do herói */
async function getHeroStats(heroId) {
  return await get(
    `SELECT
        ph.id AS hero_id,
        ph."playerId"::text AS player_id,
        COALESCE(ph.attack,10) + COALESCE(i.atk,0) AS attack,
        COALESCE(ph.defense,10) AS defense,
        COALESCE(gear.total_def, 0) AS gear_defense,
        hm.class,
        eq.item_key    AS weapon_key,
        i.atk          AS weapon_atk,
        i.weapon_type  AS weapon_type
     FROM player_heroes ph
LEFT JOIN heroes_master   hm ON hm."heroKey" = ph."heroKey"
LEFT JOIN hero_equipment  eq ON eq.hero_id = ph.id::uuid AND eq.slot = 'WEAPON'
LEFT JOIN items_master     i ON i.key = eq.item_key
LEFT JOIN LATERAL (
       SELECT COALESCE(SUM(im.def), 0) AS total_def
         FROM hero_equipment he
         JOIN items_master im ON im.key = he.item_key
        WHERE he.hero_id = ph.id::uuid
     ) gear ON TRUE
    WHERE ph.id = $1`,
    [heroId]
  );
}

/** Instância do monstro + dados do monstro (xp/loot/armor) */
async function getInstanceWithMonster(instanceId) {
  return await get(
    `SELECT mi.id, mi.hp, mi.max_hp, mi.state, mi.spawn_id,
            COALESCE(mi.map_key, s."mapKey") AS map_key,
            mi.x, mi.y,
            m.id AS monster_id, m.key AS monster_key, m.name AS monster_name,
            COALESCE(m.xp,25)                      AS xp_reward,
            COALESCE(m."lootJSON",'[]'::jsonb)     AS loot_json,
            COALESCE(m."defensesJSON",'{}'::jsonb) AS defenses_json,
            COALESCE(m."attacksJSON",'[]'::jsonb)  AS attacks_json,

            /* alcance em tiles: aiJSON.reach -> attack_range -> 1 */
            COALESCE(
              NULLIF((m."aiJSON"->>'reach')::int, 0),
              NULLIF(m.attack_range, 0),
              1
            ) AS reach_tiles,

            /* alcance em pixels para a IA/combate */
            COALESCE(
              NULLIF((m."aiJSON"->>'reach')::int, 0),
              NULLIF(m.attack_range, 0),
              1
            ) * ${TILE} AS reach_px
       FROM monster_instances mi
       JOIN monsters_master m ON m.id = mi.monster_id
  LEFT JOIN spawns s ON s.id = mi.spawn_id
      WHERE mi.id = $1`,
    [instanceId]
  );
}


// fallback se quiser usar separado em outros pontos
function getDefaultReachPx() { return 48; } // ~1.5 tiles

async function getRespawnSeconds(spawnId) {
  if (!spawnId) return 30;
  const row = await get(
    `SELECT COALESCE("respawnSec",30) AS sec FROM spawns WHERE id=$1`,
    [spawnId]
  );
  return row?.sec ?? 30;
}

/** =======================
 *  Respawn de herói
 *  ======================= */
async function respawnHero(targetHeroId) {
  // lê max_hp e playerId
  const row = await get(
    `SELECT max_hp, "playerId"::text AS player_id FROM player_heroes WHERE id=$1`,
    [targetHeroId]
  );
  const maxHp = Number(row?.max_hp || 100);
  const playerId = row?.player_id;

  const spawn = await getHeroRespawnPoint(targetHeroId, {
    mapKey: RESPAWN_FALLBACK.mapKey,
    forceStart: true,
  });

  const mapKey = spawn.mapKey || RESPAWN_FALLBACK.mapKey;
  const x = Number.isFinite(spawn.x) ? spawn.x | 0 : RESPAWN_FALLBACK.x | 0;
  const y = Number.isFinite(spawn.y) ? spawn.y | 0 : RESPAWN_FALLBACK.y | 0;

  const hpOnRevive = Math.max(1, Math.floor(maxHp * RESPAWN_HP_FRACTION));
  const nowTs = Date.now();

  // revive: hp + alive=true
  await run(`
    UPDATE player_heroes
       SET hp = $2,
           alive = true,
           "updatedAt" = now()
     WHERE id = $1
  `, [targetHeroId, hpOnRevive]);

  await setHeroRespawnPoint(targetHeroId, mapKey, x, y);
  if (playerId) {
    try { markHeroAlive(playerId, true, targetHeroId); } catch {}
    try {
      setLivePlayerPosition(playerId, {
        x,
        y,
        mapKey,
        heroId: targetHeroId,
        heroAlive: true,
        ts: nowTs,
      });
    } catch {}
    await upsertPlayerLastPos(playerId, mapKey, x, y);
    try { wsBus.movePlayerToMap?.(playerId, mapKey, { x, y, ts: nowTs }); } catch {}
    try {
      wsBus.sendToPlayer?.(playerId, {
        type: 'pos_snap',
        heroId: targetHeroId,
        mapKey,
        x,
        y,
      });
    } catch {}
  }

  // notifica cliente (snap + respawn) — **apenas para o dono**
  if (playerId) {
    sendToPlayer(playerId, { type: 'pos_snap_hero', heroId: targetHeroId, mapKey, x, y });
    sendToPlayer(playerId, { type: 'hero_respawn',  heroId: targetHeroId, hp: hpOnRevive, mapKey, x, y });
  }

  // limpa ameaças para não nascer "em combate"
  try {
    const mod = ai();
    if (mod?.removeHeroThreat) mod.removeHeroThreat(targetHeroId);
  } catch {}
  try {
    battleState.forceLeave(targetHeroId, { reason: 'respawn' });
  } catch {}
}

/** =======================
 *  Hit do herói em monstro
 *  ======================= */
async function applyHit({ attackerHeroId, targetInstanceId, weaponType }) {
  const hero = await getHeroStats(attackerHeroId);
  const inst = await getInstanceWithMonster(targetInstanceId);
  if (!hero || !inst) return { ok: false, message: 'attacker or target not found' };
  if (inst.state !== 'ALIVE') return { ok: false, message: 'target not alive' };

  try {
    await battleState.touchHero(hero.hero_id, { reason: 'hero-attack', playerId: hero.player_id });
  } catch {}

  const resolvedWeaponType = weaponType || hero.weapon_type || null;
  const skillType   = await resolveSkillFromWeapon(resolvedWeaponType);
  const skillLevel  = await getHeroSkillLevel(attackerHeroId, skillType);
  const weaponAtk   = hero.weapon_atk || 1;

  const now = Date.now();
  const swingMs = Math.max(400, resolveWeaponSpeedMs(resolvedWeaponType));
  const heroKey = String(hero.hero_id);
  const lastHeroHit = HERO_LAST_HIT_AT.get(heroKey);
  if (Number.isFinite(lastHeroHit) && now - lastHeroHit < swingMs) {
    const remaining = Math.max(0, swingMs - (now - lastHeroHit));
    const message = 'Aguarde o tempo de recarga do ataque.';
    return {
      ok: false,
      error: 'attack-cooldown',
      message,
      cooldownMs: swingMs,
      remainingMs: remaining,
      warnings: [{ code: 'attack-cooldown', message }],
    };
  }

  let monsterArmor = 0;
  try {
    const defenses = typeof inst.defenses_json === 'object' ? inst.defenses_json
                     : JSON.parse(inst.defenses_json || '{}');
    monsterArmor = Number(defenses.armor || 0);
  } catch { monsterArmor = 0; }

  const dmg  = computeDamageTibiaLike(weaponAtk, skillLevel, monsterArmor);
  const newHp = Math.max(0, inst.hp - dmg);
  const dead  = newHp === 0;

  await run(
    `UPDATE monster_instances
        SET hp=$2,
            last_hit_hero_id=$3,
            last_hit_at=now(),
            state = CASE WHEN $2=0 THEN 'DEAD' ELSE state END,
            updated_at=now()
      WHERE id=$1`,
    [inst.id, newHp, hero.hero_id]
  );

  HERO_LAST_HIT_AT.set(heroKey, now);

  broadcast({
    type: 'monster_hp',
    id: inst.id,
    hp: newHp,
    maxHp: inst.max_hp,
    byHero: hero.hero_id,
    dmg
  });

  // Log estruturado
  broadcast({
    type: 'combat_log',
    fromHeroId: hero.hero_id,
    to: inst.monster_key,
    instanceId: inst.id,
    amount: dmg,
    hpAfter: newHp
  });

  // >>> AGGRO: informar ai-mobs que ESTE herói bateu nesse monstro
  if (dmg > 0) {
    try {
      const mod = ai();
      if (mod && typeof mod.addThreatFromHeroHit === 'function') {
        mod.addThreatFromHeroHit(inst.id, hero.hero_id, 5);
      }
    } catch {}
  }

  if (skillType && dmg > 0) {
    const rate = await getClassRate(hero.class || null, skillType);
    await applyTries(attackerHeroId, skillType, 1 * rate);
  }

  let xpGained = 0;
  let drops = [];
  let corpseRow = null;
  if (dead) {
    xpGained = Number(inst.xp_reward || 0);
    try { await giveXp(attackerHeroId, xpGained); } catch {}

    try {
      const lootArray = Array.isArray(inst.loot_json) ? inst.loot_json : [];
      drops = lootService.rollMonsterLoot(lootArray);
      corpseRow = await lootService.createCorpse({
        monsterInstanceId: inst.id,
        monsterKey: inst.monster_key,
        monsterName: inst.monster_name || null,
        mapKey: inst.map_key,
        x: inst.x,
        y: inst.y,
        ownerPlayerId: hero.player_id || null,
        ownerHeroId: hero.hero_id || null,
        lootItems: drops,
      });
    } catch (e) {
      console.warn('[combat] loot/corpse error:', e?.message);
    }

    const sec = await getRespawnSeconds(inst.spawn_id);
    await run(
      `UPDATE monster_instances
          SET respawn_at = now() + ($2 || ' seconds')::interval
        WHERE id = $1`,
      [inst.id, String(sec)]
    );

    broadcast({
      type: 'monster_dead',
      id: inst.id,
      xp: xpGained,
      drops,
      corpseId: corpseRow?.id || null,
    });

    try {
      const simpleAi = require('./monster_atk_simple');
      if (simpleAi && typeof simpleAi.resetInstanceState === 'function') {
        simpleAi.resetInstanceState(inst.id);
      }
    } catch {}
  }

  return {
    ok: true,
    damage: dmg,
    hpAfter: newHp,
    maxHp: inst.max_hp,
    dead,
    instanceId: inst.id,
    xpGained,
    drops
  };
}

/** =======================
 *  Hit do monstro no herói
 *  (tela de morte + countdown + respawn)
 *  ======================= */
// server/combat/service.js
// server/combat/service.js - TRECHO applyMobHit CORRIGIDO

function normalizeCombatPosition(rawPos, fallback = {}) {
  const pos = rawPos || {};
  const fb = fallback || {};

  const mapKey =
    pos.mapKey ?? pos.map_key ?? pos.map ?? 
    fb.mapKey ?? fb.map_key ?? fb.map ?? 
    null;

  const face = pos.face ?? fb.face ?? null;

  const unit = typeof pos.unit === 'string' ? pos.unit.toLowerCase() : null;
  const explicitTiles = pos.inTiles === true || pos.tiles === true || unit === 'tile' || unit === 'tiles';
  const explicitPx = pos.inPixels === true || pos.pixels === true || unit === 'px' || unit === 'pixel' || unit === 'pixels';
  const assumeTiles = pos.assumeTiles;
  const assumePx = pos.assumePx;

  let x = Number(pos.x);
  let y = Number(pos.y);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    x = Number(fb.x);
    y = Number(fb.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { x: null, y: null, mapKey, face };
    }

    const fbUnit = typeof fb.unit === 'string' ? fb.unit.toLowerCase() : null;
    const fbTiles = fb.inTiles === true || fb.tiles === true || fbUnit === 'tile' || fbUnit === 'tiles';
    const fbPx = fb.inPixels === true || fb.pixels === true || fbUnit === 'px' || fbUnit === 'pixel' || fbUnit === 'pixels';

    if (fbTiles || (!fbPx && Math.abs(x) < 1000 && Math.abs(y) < 1000)) {
      x = (x * TILE) + (TILE / 2);
      y = (y * TILE) + (TILE / 2);
    }

    return { x, y, mapKey, face };
  }

  if (explicitTiles) {
    x = (x * TILE) + (TILE / 2);
    y = (y * TILE) + (TILE / 2);
  } else if (!explicitPx) {
    const shouldAssumeTiles = assumeTiles === true
      || (assumeTiles !== false && !assumePx && Math.abs(x) < 1000 && Math.abs(y) < 1000);
    if (shouldAssumeTiles) {
      x = (x * TILE) + (TILE / 2);
      y = (y * TILE) + (TILE / 2);
    }
  }

  return { x, y, mapKey, face };
}

async function applyMobHit({ attackerInstanceId, targetHeroId, attackInfo, attackerPos = null, heroPos = null }) {
  const DEBUG_COMBAT = String(process.env.COMBAT_DEBUG || '').trim() === '1';

  const hero = await getHeroStats(targetHeroId);
  if (!hero) return { ok: false, message: 'target hero not found' };

  const inst = await getInstanceWithMonster(attackerInstanceId);
  if (!inst || inst.state !== 'ALIVE') return { ok: false, message: 'attacker not alive' };

  try {
    await battleState.touchHero(hero.hero_id, { reason: 'mob-attack', playerId: hero.player_id });
  } catch {}

  const fallbackAttackerPos = {
    x: inst.x,
    y: inst.y,
    mapKey: inst.map_key,
    unit: (Math.abs(Number(inst.x) || 0) < 1000 && Math.abs(Number(inst.y) || 0) < 1000) ? 'tile' : 'px',
  };

  const attacker = normalizeCombatPosition(attackerPos, fallbackAttackerPos);
  const effectiveMapKey = attacker.mapKey ?? inst.map_key;
  let mx = Number(attacker.x);
  let my = Number(attacker.y);
  const attackerFace = attacker.face ?? null;

  if (!Number.isFinite(mx) || !Number.isFinite(my)) {
    mx = Number(inst.x || 0);
    my = Number(inst.y || 0);
    if (mx < 1000 && my < 1000) {
      mx = (mx * TILE) + (TILE / 2);
      my = (my * TILE) + (TILE / 2);
    }
  }

  // --- POSIÇÃO DO HERÓI (SEMPRE EM PIXELS) ---
  let hpos = null;
  let heroPosFresh = false;

  if (heroPos) {
    const heroOverride = normalizeCombatPosition(heroPos, { mapKey: effectiveMapKey });
    if (Number.isFinite(heroOverride.x) && Number.isFinite(heroOverride.y)) {
      hpos = {
        x: heroOverride.x,
        y: heroOverride.y,
        map_key: heroOverride.mapKey ?? effectiveMapKey,
        source: heroPos.source ?? 'override',
        stale: heroPos.stale ?? false,
        fresh: heroPos.fresh ?? true,
      };
      heroPosFresh = hpos.fresh === true;
    }
  }

  if (!hpos) {
    try {
      const mod = posMod();
      if (mod && typeof mod.getHeroPos === 'function') {
        hpos = await mod.getHeroPos(hero.hero_id, effectiveMapKey);
        if (hpos && typeof mod.isHeroPosFresh === 'function') {
          heroPosFresh = mod.isHeroPosFresh(hpos);
        } else if (hpos) {
          heroPosFresh = hpos.fresh === true || (hpos.source === 'live' && hpos.stale === false);
        }
      }
    } catch {}
  }

  if (hpos && hpos.map_key == null && effectiveMapKey != null) {
    hpos.map_key = effectiveMapKey;
  }

  if (!hpos || String(hpos.map_key) !== String(effectiveMapKey)) {
    return { ok: false, message: 'target not in same map' };
  }

  const heroNormInput = {
    x: hpos.x,
    y: hpos.y,
    mapKey: hpos.map_key,
  };
  if (hpos.source === 'live' || hpos.source === 'live_stale') {
    heroNormInput.assumeTiles = false;
    heroNormInput.assumePx = true;
  }

  const heroNorm = normalizeCombatPosition(heroNormInput, { x: hpos.x, y: hpos.y, mapKey: hpos.map_key });
  let hx = Number(heroNorm.x || 0);
  let hy = Number(heroNorm.y || 0);

  if (!Number.isFinite(hx) || !Number.isFinite(hy)) {
    hx = Number(hpos.x || 0);
    hy = Number(hpos.y || 0);
    if (hx < 1000 && hy < 1000) {
      hx = (hx * TILE) + (TILE / 2);
      hy = (hy * TILE) + (TILE / 2);
    }
  }

  const attackerTile = toTileCoords({ x: mx, y: my });
  const heroTile = toTileCoords({ x: hx, y: hy });
  if (!isValidTile(attackerTile) || !isValidTile(heroTile)) {
    return { ok: false, message: 'invalid-coords' };
  }

  const attackProfile = await resolveMonsterAttackProfile(inst, attackInfo || {});
  console.log('[PROFILE]', inst.monster_key, inst.id, attackProfile);
  const distTiles = chebyshevTiles(attackerTile, heroTile);
  const rangeTiles = Number.isFinite(attackProfile.rangeTiles) ? attackProfile.rangeTiles : 1;
  const minRangeTilesRaw = Number(attackProfile.minRangeTiles);
  const minRangeTiles = Math.max(
    1,
    Number.isFinite(minRangeTilesRaw)
      ? Math.min(rangeTiles, minRangeTilesRaw)
      : (attackProfile.type === 'ranged' ? Math.min(rangeTiles, DEFAULT_RANGED_MIN) : 1)
  );
  const inRangeTiles = Number.isFinite(distTiles) && distTiles >= minRangeTiles && distTiles <= rangeTiles;

  const mapKeyForLos = effectiveMapKey ?? inst.map_key;
  let hasLOS = true;
  let losGrid = null;
  if (attackProfile.requiresLos && mapKeyForLos != null) {
    try {
      const data = await getGrid(mapKeyForLos);
      losGrid = data ? { data: data.grid, cols: data.cols } : null;
      if (losGrid) {
        hasLOS = hasLineOfSightTiles(losGrid, attackerTile.tx, attackerTile.ty, heroTile.tx, heroTile.ty);
      }
    } catch {
      hasLOS = true;
    }
  }

  if (DEBUG_COMBAT) {
    console.log('[MOB-HIT-DEBUG]', {
      inst: inst.id,
      hero: targetHeroId,
      heroPos: { x: hx, y: hy, source: hpos.source, mapKey: hpos.map_key },
      mobPos: { x: mx, y: my, mapKey: mapKeyForLos, face: attackerFace },
      tiles: {
        mob: attackerTile,
        hero: heroTile,
        dist: distTiles,
        range: { min: minRangeTiles, max: rangeTiles },
      },
      inRangeTiles,
      hasLOS,
      heroPosFresh,
      requiresLos: attackProfile.requiresLos,
    });
  }

  // Flags vindas da IA para dizer "já validei alcance/LOS"
  const skipInternalRangeCheck = attackInfo && attackInfo.skipInternalRangeCheck === true;
  const skipInternalLosCheck   = attackInfo && attackInfo.skipInternalLosCheck === true;

  // Se estiver no MESMO tile e for melee, considera em alcance
  let effectiveInRange = inRangeTiles;
  if (!effectiveInRange &&
      attackProfile &&
      attackProfile.type === 'melee' &&
      Number.isFinite(distTiles) &&
      distTiles === 0) {
    effectiveInRange = true;
  }

  // Se a posição veio de DB/snapshot, não vamos derrubar o ataque por range
  const heroPosSource = hpos && hpos.source;
  const ignoreRangeGuardForDbSource =
    heroPosSource === 'db' || heroPosSource === 'snapshot';

  const failingRange =
    !effectiveInRange &&
    !skipInternalRangeCheck &&
    !ignoreRangeGuardForDbSource;

  const failingLos =
    !hasLOS &&
    !skipInternalLosCheck;

  if (failingRange || failingLos) {
    if (DEBUG_COMBAT) {
      console.log(
        `[HARD-GUARD] BLOCK inst=${inst.id} hero=${targetHeroId}`,
        {
          inRangeTiles,
          effectiveInRange,
          hasLOS,
          heroPosSource,
          skipInternalRangeCheck,
          skipInternalLosCheck,
        }
      );
    }
    return { ok: false, message: 'out of reach or no los' };
  }


  // --- DANO (resto do código mantido) ---
  const profileMin = Number.isFinite(attackProfile.min) ? Math.max(0, Math.floor(attackProfile.min)) : 0;
  const profileMaxRaw = Number.isFinite(attackProfile.max) ? Math.floor(attackProfile.max) : profileMin;
  const max = Math.max(profileMin, profileMaxRaw);
  const min = Math.min(profileMin, max);

  let dmg = min + Math.floor(Math.random() * (max - min + 1));

  const gearDefense = Math.max(0, Number(hero.gear_defense ?? 0));
  if (gearDefense > 0 && dmg > 0) {
    const armorMitigation = Math.floor(Math.random() * (gearDefense + 1));
    dmg = Math.max(0, dmg - armorMitigation);
  }

  const defenseSkill = Math.max(0, Number(hero.defense ?? 0));
  if (defenseSkill > 0 && dmg > 0) {
    const mitigationPercent = Math.min(defenseSkill * 1.5, 70);
    const mitigated = Math.round(dmg * (1 - mitigationPercent / 100));
    dmg = Math.max(0, mitigated);
  }

  if (dmg <= 0 && max > 0) {
    dmg = Math.max(1, Math.round(max * 0.25));
  }

  dmg = Math.max(0, Math.round(dmg));
  if (dmg === 0 && max > 0) {
    dmg = 1;
  }

  const row = await get(`SELECT hp, max_hp, alive FROM player_heroes WHERE id=$1`, [targetHeroId]);
  if (!row || row.alive === false) {
    return { ok: false, message: 'target already dead' };
  }

  const curHp = Number(row.hp);
  const newHp = Math.max(0, curHp - dmg);
  const dead = newHp === 0;

  if (!dead) {
    await run(
      `UPDATE player_heroes SET hp = $2, "updatedAt" = now() WHERE id = $1`,
      [targetHeroId, newHp]
    );
  } else {
    await run(`
      UPDATE player_heroes
         SET hp = 0, alive = false, death_count = COALESCE(death_count,0)+1,
             last_respawn_at = NOW(), "updatedAt" = now()
       WHERE id = $1
    `, [targetHeroId]);

    try {
      const mod = ai();
      if (mod?.removeHeroThreat) mod.removeHeroThreat(targetHeroId);
    } catch {}
    try {
      battleState.forceLeave(targetHeroId, { reason: 'death' });
    } catch {}
  }

  // ===== AQUI muda: unicast para o dono do herói =====
  sendToPlayer(hero.player_id, {
    type: 'hero_hp',
    heroId: targetHeroId,
    hp: newHp,
    maxHp: row.max_hp,
    byMob: inst.monster_key,
    instanceId: inst.id,
    dmg
  });

  sendToPlayer(hero.player_id, {
    type: 'hero_dmg',
    heroId: targetHeroId,
    amount: dmg,
    byMob: inst.monster_key,
    instanceId: inst.id
  });

  if (dead) {
    sendToPlayer(hero.player_id, {
      type: 'hero_dead',
      heroId: targetHeroId,
      byMob: inst.monster_key,
      instanceId: inst.id,
      autoRespawn: false
    });
  }
  // ===== fim das mudanças de unicast =====

  const nextInterval = Number.isFinite(attackProfile.intervalMs) ? attackProfile.intervalMs : Number(inst.attack_ms) || 0;
  const mobLabel = inst.monster_key || inst.monster_id || 'unknown';
  console.log(`[MOB_HIT] {mob: ${mobLabel}, id: ${inst.id}} -> {heroId: ${targetHeroId}} dmg=${dmg} dist=${distTiles} tiles=(${attackerTile.tx},${attackerTile.ty})→(${heroTile.tx},${heroTile.ty}) next=+${nextInterval}`);

  return {
    ok: true,
    damage: dmg,
    hpAfter: newHp,
    maxHp: row.max_hp,
    dead,
    targetHeroId,
    attackerInstanceId,
    heroPos: { x: hx, y: hy, mapKey: hpos.map_key, fresh: heroPosFresh },
    attackerPos: { x: mx, y: my, mapKey: mapKeyForLos, face: attackerFace },
  };
}


module.exports = { applyHit, applyMobHit, respawnHero };
