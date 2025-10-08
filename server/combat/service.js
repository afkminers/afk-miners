// server/combat/service.js

const { get, run } = require('../models/db');
const K = require('../balance/config');
const { applyTries, getClassRate } = require('../skills/engine');
const { broadcast } = require('../ws/bus');
const { resolveHitboxDimension, TILE } = require('./geom');
// Se você usa este serviço central de XP:
const { giveXp } = require('../services/heroProgress');

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
const RESPAWN_FALLBACK = { mapKey: 'house', x: 912, y: 880 }; // ajuste conforme seu mapa
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
        COALESCE(ph.attack,10) + COALESCE(i.atk,0) AS attack,
        COALESCE(ph.defense,10) AS defense,
        hm.class,
        eq.item_key    AS weapon_key,
        i.atk          AS weapon_atk,
        i.weapon_type  AS weapon_type
     FROM player_heroes ph
LEFT JOIN heroes_master   hm ON hm."heroKey" = ph."heroKey"
LEFT JOIN hero_equipment  eq ON eq.hero_id = ph.id::uuid AND eq.slot = 'WEAPON'
LEFT JOIN items_master     i ON i.key = eq.item_key
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
            m.id AS monster_id, m.key AS monster_key,
            COALESCE(m.xp,25)                      AS xp_reward,
            COALESCE(m."lootJSON",'[]'::jsonb)     AS loot_json,
            COALESCE(m."defensesJSON",'{}'::jsonb) AS defenses_json,

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

/** Rola loot de acordo com lootJSON */
function rollLoot(lootJson) {
  const drops = [];
  const arr = Array.isArray(lootJson) ? lootJson : [];
  for (const e of arr) {
    const item   = e?.item;
    const min    = Number(e?.min ?? 1);
    const max    = Number(e?.max ?? 1);
    const chance = Number(e?.chance ?? 0); // %
    if (!item || chance <= 0) continue;
    const roll = Math.random() * 100;
    if (roll <= chance) {
      const amount = min >= max ? min : (min + Math.floor(Math.random() * (max - min + 1)));
      if (amount > 0) drops.push({ item_key: String(item), amount });
    }
  }
  return drops;
}

/** Persiste drops em hero_loot_drops */
async function persistDrops(heroId, instanceId, drops) {
  if (!drops || !drops.length) return 0;
  const values = [];
  const params = [];
  let i = 1;
  for (const d of drops) {
    values.push(`($${i++}, $${i++}, $${i++}, $${i++})`);
    params.push(heroId, instanceId, d.item_key, d.amount);
  }
  await run(
    `INSERT INTO hero_loot_drops (hero_id, monster_instance_id, item_key, amount)
     VALUES ${values.join(',')}`,
    params
  );
  return drops.length;
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

  const mapKey = RESPAWN_FALLBACK.mapKey;
  const x = RESPAWN_FALLBACK.x | 0;
  const y = RESPAWN_FALLBACK.y | 0;

  const hpOnRevive = Math.max(1, Math.floor(maxHp * RESPAWN_HP_FRACTION));

  // revive: hp + alive=true
  await run(`
    UPDATE player_heroes
       SET hp = $2,
           alive = true,
           "updatedAt" = now()
     WHERE id = $1
  `, [targetHeroId, hpOnRevive]);

  // persiste posição de respawn
  if (playerId) {
    await run(`
      INSERT INTO player_last_pos (player_id, map_key, x, y, last_seq, updated_at)
      VALUES ($1, $2, $3, $4, 0, now())
      ON CONFLICT (player_id, map_key)
        DO UPDATE SET x = EXCLUDED.x, y = EXCLUDED.y, updated_at = now()
    `, [playerId, mapKey, x, y]);
  }

  // notifica cliente (snap + respawn)
  broadcast({ type: 'pos_snap_hero', heroId: targetHeroId, mapKey, x, y });
  broadcast({ type: 'hero_respawn', heroId: targetHeroId, hp: hpOnRevive, mapKey, x, y });

  // limpa ameaças para não nascer "em combate"
  try {
    const mod = ai();
    if (mod?.removeHeroThreat) mod.removeHeroThreat(targetHeroId);
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

  const resolvedWeaponType = weaponType || hero.weapon_type || null;
  const skillType   = await resolveSkillFromWeapon(resolvedWeaponType);
  const skillLevel  = await getHeroSkillLevel(attackerHeroId, skillType);
  const weaponAtk   = hero.weapon_atk || 1;

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
  if (dead) {
    xpGained = Number(inst.xp_reward || 0);
    try { await giveXp(attackerHeroId, xpGained); } catch {}

    try {
      const lootArray = Array.isArray(inst.loot_json) ? inst.loot_json : [];
      drops = rollLoot(lootArray);
      if (drops.length) await persistDrops(attackerHeroId, inst.id, drops);
    } catch (e) {
      console.warn('[combat] loot roll error:', e?.message);
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
      drops
    });
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

  // --- HITBOX DO MONSTRO (considera tamanho da sprite) ---
  if (mx < 1000 && my < 1000) {
    mx = (mx * TILE) + (TILE / 2);
    my = (my * TILE) + (TILE / 2);
  }

  const frameW = resolveHitboxDimension(inst, 'w');
  const frameH = resolveHitboxDimension(inst, 'h');
  
  // Hitbox retangular centralizada no monstro
  const mobLeft = mx - (frameW / 2);
  const mobRight = mx + (frameW / 2);
  const mobTop = my - (frameH / 2);
  const mobBottom = my + (frameH / 2);

  // Ponto mais próximo do herói dentro da hitbox
  const closestX = Math.max(mobLeft, Math.min(hx, mobRight));
  const closestY = Math.max(mobTop, Math.min(hy, mobBottom));
  
  // Distância Chebyshev do herói ao ponto mais próximo
  const dx = Math.abs(hx - closestX);
  const dy = Math.abs(hy - closestY);
  const distPx = Math.max(dx, dy);

  // Alcance do monstro em pixels
  const atkPx = Math.max(Number(inst.reach_px || TILE), TILE);
  const inRangePx = distPx <= atkPx;

  // Linha de visão
  let hasLOS = true;
  const mapKeyForLos = effectiveMapKey ?? inst.map_key;
  if (mapKeyForLos != null) {
    try {
      const { getGrid } = require('../maps/grid');
      const { hasLineOfSight } = require('./los');
      const { grid, cols } = await getGrid(mapKeyForLos);
      hasLOS = hasLineOfSight({ data: grid, cols }, mx, my, hx, hy);
    } catch {}
  }

  // DEBUG
  if (DEBUG_COMBAT) {
    console.log('[MOB-HIT-DEBUG]', {
      inst: inst.id,
      hero: targetHeroId,
      heroPos: { x: hx, y: hy, source: hpos.source, mapKey: hpos.map_key },
      mobPos: { x: mx, y: my, mapKey: mapKeyForLos, face: attackerFace },
      mobHitbox: { left: mobLeft, right: mobRight, top: mobTop, bottom: mobBottom },
      closest: { x: closestX, y: closestY },
      distPx,
      atkPx,
      inRange: inRangePx,
      hasLOS,
      heroPosFresh
    });
  }

  // HARD-GUARD: só permite hit se estiver no alcance E com LoS
  if (!(inRangePx && hasLOS)) {
    if (DEBUG_COMBAT) {
      console.log(`[HARD-GUARD] BLOCK inst=${inst.id} hero=${targetHeroId}`);
    }
    return { ok: false, message: 'out of reach or no los' };
  }

  // --- DANO (resto do código mantido) ---
  const min = Number(attackInfo?.min ?? 1);
  const max = Number(attackInfo?.max ?? 2);
  let dmg = min + Math.floor(Math.random() * (max - min + 1));
  const heroDefense = Number(hero.defense || 0);
  dmg = Math.max(0, dmg - Math.floor(Math.random() * (heroDefense + 1)));

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
  }

  broadcast({
    type: 'hero_hp',
    heroId: targetHeroId,
    hp: newHp,
    maxHp: row.max_hp,
    byMob: inst.monster_key,
    instanceId: inst.id,
    dmg
  });

  broadcast({
    type: 'hero_dmg',
    heroId: targetHeroId,
    amount: dmg,
    byMob: inst.monster_key,
    instanceId: inst.id
  });

  if (dead) {
    const respawnAt = Date.now() + 10000;
    broadcast({
      type: 'hero_dead',
      heroId: targetHeroId,
      byMob: inst.monster_key,
      instanceId: inst.id,
      respawnAt,
      respawnMs: 10000
    });

    setTimeout(() => {
      respawnHero(targetHeroId).catch(() => {});
    }, 10000);
  }

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
