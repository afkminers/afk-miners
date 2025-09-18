// server/combat/service.js

const { get, run } = require('../models/db');
const K = require('../balance/config');
const { applyTries, getClassRate } = require('../skills/engine');
const { broadcast } = require('../ws/bus');
// Se você usa este serviço central de XP:
const { giveXp } = require('../services/heroProgress');

const { getMapSpawns } = require('../maps/grid'); // adiciona função para pegar pontos de spawn

// Tempo padrão de respawn de herói (ms). Pode ser substituído por variável de ambiente.
const HERO_RESPAWN_MS = Number(process.env.HERO_RESPAWN_MS || 7000);

// Verbose logging control:
// - set COMBAT_DEBUG=1 para ativar logs detalhados (recomendado em dev).
// - por padrão logs de eventos principais (hero_hp/hero_dead/respawn) aparecem como info.
const DBG = String(process.env.COMBAT_DEBUG || '').trim() === '1';

/** utilitário de logging, preserva stack quando presente */
function logDebug(...args) {
  if (!DBG) return;
  try { console.debug('[combat-debug]', ...args); } catch (e) {}
}
function logInfo(...args) {
  try { console.info('[combat]', ...args); } catch (e) {}
}
function logWarn(...args) {
  try { console.warn('[combat]', ...args); } catch (e) {}
}
function logError(...args) {
  try { console.error('[combat]', ...args); } catch (e) {}
}

function safeType(v) {
  try { return typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v; } catch { return String(v); }
}

/** Dano estilo Tibia (sem dano mínimo garantido) */
function computeDamageTibiaLike(weaponAtk, skillLevel, monsterArmor, variance = K.DAMAGE_VARIANCE) {
  const base = weaponAtk * (1 + skillLevel / 50);
  const minDmg = Math.floor(base * (1 - variance));
  const maxDmg = Math.ceil(base * (1 + variance));
  const raw = Math.floor(Math.random() * (maxDmg - minDmg + 1)) + minDmg;
  const defenseReduction = Math.floor(Math.random() * (monsterArmor + 1));
  const res = Math.max(0, raw - defenseReduction);
  logDebug('computeDamageTibiaLike', { weaponAtk, skillLevel, monsterArmor, variance, base, minDmg, maxDmg, raw, defenseReduction, res });
  return res;
}

/** Mapeia tipo de arma -> tipo de skill */
async function resolveSkillFromWeapon(weaponType) {
  if (!weaponType) return null;
  const row = await get(
    `SELECT skill_type FROM weapon_skill_map WHERE lower(weapon_type) = lower($1)`,
    [String(weaponType)]
  );
  logDebug('resolveSkillFromWeapon', { weaponType, skill_type: row?.skill_type });
  return row?.skill_type || null;
}

/** Nível do skill do herói */
async function getHeroSkillLevel(heroId, skillType) {
  if (!heroId || !skillType) return 10;
  const row = await get(
    `SELECT level FROM player_hero_skills WHERE hero_id = $1 AND skill_type = $2`,
    [heroId, skillType]
  );
  const lvl = row?.level ? Number(row.level) : 10;
  logDebug('getHeroSkillLevel', { heroId, skillType, level: lvl });
  return lvl;
}

/** Stats básicos do herói */
async function getHeroStats(heroId) {
  const res = await get(
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
  logDebug('getHeroStats', { heroId, res });
  return res;
}

/** Instância do monstro + dados do monstro (xp/loot/armor) */
async function getInstanceWithMonster(instanceId) {
  const res = await get(
    `SELECT mi.id, mi.hp, mi.max_hp, mi.state, mi.spawn_id, mi.map_key,
            m.id AS monster_id, m.key AS monster_key,
            COALESCE(m.xp,25)            AS xp_reward,
            COALESCE(m."lootJSON",'[]'::jsonb)     AS loot_json,
            COALESCE(m."defensesJSON",'{}'::jsonb) AS defenses_json
       FROM monster_instances mi
       JOIN monsters_master m ON m.id = mi.monster_id
      WHERE mi.id = $1`,
    [instanceId]
  );
  logDebug('getInstanceWithMonster', { instanceId, res });
  return res;
}

async function getRespawnSeconds(spawnId) {
  if (!spawnId) return 30;
  const row = await get(
    `SELECT COALESCE("respawnSec",30) AS sec FROM spawns WHERE id=$1`,
    [spawnId]
  );
  logDebug('getRespawnSeconds', { spawnId, sec: row?.sec });
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
  logDebug('rollLoot', { lootJson, drops });
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
  logInfo('persistDrops', { heroId, instanceId, dropsCount: drops.length });
  return drops.length;
}

/** Hit do herói em monstro */
async function applyHit({ attackerHeroId, targetInstanceId, weaponType }) {
  logInfo('applyHit start', safeType({ attackerHeroId, targetInstanceId, weaponType }));
  try {
    const hero = await getHeroStats(attackerHeroId);
    const inst = await getInstanceWithMonster(targetInstanceId);
    if (!hero || !inst) {
      logWarn('applyHit aborted: attacker or target not found', { attackerHeroId, targetInstanceId });
      return { ok: false, message: 'attacker or target not found' };
    }
    if (inst.state !== 'ALIVE') {
      logWarn('applyHit aborted: target not alive', { instanceState: inst.state });
      return { ok: false, message: 'target not alive' };
    }

    const resolvedWeaponType = weaponType || hero.weapon_type || null;
    const skillType   = await resolveSkillFromWeapon(resolvedWeaponType);
    const skillLevel  = await getHeroSkillLevel(attackerHeroId, skillType);
    const weaponAtk   = hero.weapon_atk || 1;

    let monsterArmor = 0;
    try {
      const defenses = typeof inst.defenses_json === 'object' ? inst.defenses_json
                       : JSON.parse(inst.defenses_json || '{}');
      monsterArmor = Number(defenses.armor || 0);
    } catch (ex) { monsterArmor = 0; }

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

    logInfo('monster hit applied', { instanceId: inst.id, dmg, hpBefore: inst.hp, hpAfter: newHp, dead });

    const monsterHpPayload = {
      type: 'monster_hp',
      id: inst.id,
      hp: newHp,
      maxHp: inst.max_hp,
      byHero: hero.hero_id,
      dmg
    };
    const sentMon = broadcast(monsterHpPayload);
    logDebug('broadcast monster_hp', { payload: monsterHpPayload, sent: sentMon });

    if (skillType && dmg > 0) {
      try {
        const rate = await getClassRate(hero.class || null, skillType);
        await applyTries(attackerHeroId, skillType, 1 * rate);
        logDebug('applyTries done', { attackerHeroId, skillType, rate });
      } catch (e) {
        logWarn('applyTries failed', e?.message || e);
      }
    }

    let xpGained = 0;
    let drops = [];
    if (dead) {
      xpGained = Number(inst.xp_reward || 0);
      try { await giveXp(attackerHeroId, xpGained); logInfo('gave XP', { attackerHeroId, xpGained }); } catch (e) { logWarn('giveXp failed', e?.message || e); }

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
      logInfo('monster scheduled respawn', { instanceId: inst.id, respawnSec: sec });

      const deadPayload = { type: 'monster_dead', id: inst.id, xp: xpGained, drops };
      const sentDead = broadcast(deadPayload);
      logInfo('broadcast monster_dead', { payload: deadPayload, sent: sentDead });
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
  } catch (e) {
    logError('applyHit error', e?.message || e, e?.stack);
    return { ok: false, message: 'internal error', error: String(e?.message || e) };
  }
}

/**
 * Respawn helper for heroes.
 * - finds player for the hero
 * - chooses a spawn point on the map (getMapSpawns)
 * - updates player_heroes.hp = max_hp and updates player_last_pos
 * - broadcasts hero_respawn and hero_hp
 */
async function respawnHeroAtMapPosition(targetHeroId, preferredMapKey = null) {
  logInfo('respawnHeroAtMapPosition start', safeType({ targetHeroId, preferredMapKey }));
  try {
    // fetch hero + player
    const hr = await get(`SELECT id, "playerId", max_hp FROM player_heroes WHERE id=$1`, [targetHeroId]);
    if (!hr) {
      logWarn('respawn aborted: hero row not found', { targetHeroId });
      return;
    }
    const playerId = hr.playerId;
    const heroMaxHp = Number(hr.max_hp || 100);
    logDebug('respawn fetched hero', { hr });

    // try last known map from player_last_pos
    let posRow = await get(`SELECT map_key, x, y FROM player_last_pos WHERE player_id = $1 LIMIT 1`, [playerId]);
    if (!posRow) {
      // try player_online
      posRow = await get(`SELECT map_key FROM player_online WHERE player_id = $1 LIMIT 1`, [playerId]);
    }
    const mapKey = preferredMapKey || (posRow && posRow.map_key) || 'house';
    logDebug('respawn choose map', { playerId, posRow, mapKey });

    // try to find spawn points for this map
    let targetX = posRow?.x ?? 400;
    let targetY = posRow?.y ?? 300;
    try {
      const spawns = await getMapSpawns(mapKey);
      logDebug('respawn getMapSpawns', { mapKey, spawnsCount: Array.isArray(spawns) ? spawns.length : 0 });
      if (Array.isArray(spawns) && spawns.length) {
        // prefer 'start' typed spawn, otherwise first
        let s = spawns.find(s => ((s.type || '')?.toString().toLowerCase() === 'start') || ((s.name || '')?.toString().toLowerCase() === 'start'));
        if (!s) s = spawns[0];
        if (s) {
          targetX = Math.round(Number(s.x || targetX));
          targetY = Math.round(Number(s.y || targetY));
        }
      }
    } catch (e) {
      logWarn('respawn getMapSpawns failed, falling back to last pos', e?.message || e);
    }

    // revive hero: set hp = max_hp
    await run(
      `UPDATE player_heroes
          SET hp = $2, "updatedAt" = now()
        WHERE id = $1`,
      [targetHeroId, heroMaxHp]
    );
    logInfo('player revived in DB', { targetHeroId, heroMaxHp });

    // upsert last pos for player to ensure server and client align
    await run(
      `INSERT INTO player_last_pos (player_id, map_key, x, y, updated_at)
         VALUES ($1,$2,$3,$4, now())
        ON CONFLICT (player_id, map_key) DO UPDATE
          SET x = EXCLUDED.x, y = EXCLUDED.y, updated_at = EXCLUDED.updated_at`,
      [playerId, mapKey, targetX, targetY]
    );
    logInfo('player_last_pos upserted', { playerId, mapKey, x: targetX, y: targetY });

    // broadcast respawn + hp for immediate client sync
    const respawnPayload = {
      type: 'hero_respawn',
      heroId: targetHeroId,
      playerId,
      mapKey,
      x: targetX,
      y: targetY,
      hp: heroMaxHp,
      maxHp: heroMaxHp
    };
    const sentRespawn = broadcast(respawnPayload);
    logInfo('broadcast hero_respawn', { payload: safeType(respawnPayload), sent: sentRespawn });

    const hpPayload = {
      type: 'hero_hp',
      heroId: targetHeroId,
      hp: heroMaxHp,
      maxHp: heroMaxHp
    };
    const sentHp = broadcast(hpPayload);
    logInfo('broadcast hero_hp after respawn', { payload: safeType(hpPayload), sent: sentHp });
  } catch (e) {
    logError('[respawnHero] error:', e?.message || e, e?.stack);
  }
}

/**
 * Hit do monstro no herói (ataque ativo do mob).
 * Usa player_heroes.hp / max_hp e atualiza "updatedAt" (camelCase).
 */
async function applyMobHit({ attackerInstanceId, targetHeroId, attackInfo }) {
  logInfo('applyMobHit start', safeType({ attackerInstanceId, targetHeroId, attackInfo }));
  try {
    const hero = await getHeroStats(targetHeroId);
    if (!hero) {
      logWarn('applyMobHit aborted: target hero stats not found', { targetHeroId });
      return { ok: false, message: 'target hero not found' };
    }
    const inst = await getInstanceWithMonster(attackerInstanceId);
    if (!inst || inst.state !== 'ALIVE') {
      logWarn('applyMobHit aborted: attacker not alive or instance missing', { attackerInstanceId, instState: inst?.state });
      return { ok: false, message: 'attacker not alive' };
    }

    const min = Number(attackInfo?.min ?? 1);
    const max = Number(attackInfo?.max ?? 2);
    let dmg = min + Math.floor(Math.random() * (max - min + 1));
    const heroDefense = Number(hero.defense || 0);
    dmg = Math.max(0, dmg - Math.floor(Math.random() * (heroDefense + 1)));
    logDebug('applyMobHit computed damage', { min, max, heroDefense, dmg });

    // lê HP atual
    const row = await get(`SELECT hp, max_hp FROM player_heroes WHERE id=$1`, [targetHeroId]);
    if (!row) {
      logWarn('applyMobHit aborted: hero row not found in DB', { targetHeroId });
      return { ok: false, message: 'hero stats not found' };
    }
    logDebug('applyMobHit hero row', row);

    const newHp = Math.max(0, Number(row.hp) - dmg);
    const dead  = newHp === 0;

    // atualizado updatedAt em camelCase
    await run(
      `UPDATE player_heroes
          SET hp = $2, "updatedAt" = now()
        WHERE id = $1`,
      [targetHeroId, newHp]
    );
    logInfo('player_heroes updated', { targetHeroId, oldHp: row.hp, newHp });

    // Evento principal: barra de HP
    const heroHpPayload = {
      type: 'hero_hp',
      heroId: targetHeroId,
      hp: newHp,
      maxHp: row.max_hp,
      byMob: inst.monster_key,
      instanceId: inst.id,
      dmg
    };
    const sentHp = broadcast(heroHpPayload);
    logInfo('broadcast hero_hp', { payload: safeType(heroHpPayload), sent: sentHp });

    // (Opcional) evento de “dano” para flutuante/sangue, caso seu front use
    const heroDmgPayload = {
      type: 'hero_dmg',
      heroId: targetHeroId,
      amount: dmg,
      byMob: inst.monster_key,
      instanceId: inst.id
    };
    const sentDmg = broadcast(heroDmgPayload);
    logDebug('broadcast hero_dmg', { payload: heroDmgPayload, sent: sentDmg });

    if (dead) {
      const deadPayload = {
        type: 'hero_dead',
        heroId: targetHeroId,
        byMob: inst.monster_key,
        instanceId: inst.id
      };
      const sentDead = broadcast(deadPayload);
      logInfo('broadcast hero_dead', { payload: deadPayload, sent: sentDead });

      // Agendar respawn do herói após HERO_RESPAWN_MS
      try {
        setTimeout(() => {
          logInfo('scheduling respawn execution', { targetHeroId });
          respawnHeroAtMapPosition(targetHeroId).catch(err => {
            logError('[respawnHero][timeout] failed:', err?.message || err, err?.stack);
          });
        }, HERO_RESPAWN_MS);
        logInfo('respawn scheduled', { targetHeroId, delayMs: HERO_RESPAWN_MS });
      } catch (e) {
        logError('[applyMobHit] failed scheduling respawn', e?.message || e, e?.stack);
      }
    }

    return {
      ok: true,
      damage: dmg,
      hpAfter: newHp,
      maxHp: row.max_hp,
      dead,
      targetHeroId,
      attackerInstanceId
    };
  } catch (e) {
    logError('applyMobHit error', e?.message || e, e?.stack);
    return { ok: false, message: 'internal error', error: String(e?.message || e) };
  }
}

module.exports = { applyHit, applyMobHit, respawnHeroAtMapPosition };