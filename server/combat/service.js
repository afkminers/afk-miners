// server/combat/service.js

const { get, run } = require('../models/db');
const K = require('../balance/config');
const { applyTries, getClassRate } = require('../skills/engine');
const { broadcast } = require('../ws/bus');
// Se você usa este serviço central de XP:
const { giveXp } = require('../services/heroProgress');

/** Dano estilo Tibia (sem dano mínimo garantido) */
function computeDamageTibiaLike(weaponAtk, skillLevel, monsterArmor, variance = K.DAMAGE_VARIANCE) {
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
}

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

/** Hit do herói em monstro */
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

/**
 * Hit do monstro no herói (ataque ativo do mob).
 * Usa player_heroes.hp / max_hp e atualiza "updatedAt" (camelCase).
 */
async function applyMobHit({ attackerInstanceId, targetHeroId, attackInfo }) {
  const hero = await getHeroStats(targetHeroId);
  if (!hero) return { ok: false, message: 'target hero not found' };

  const inst = await getInstanceWithMonster(attackerInstanceId);
  if (!inst || inst.state !== 'ALIVE') return { ok: false, message: 'attacker not alive' };

  const min = Number(attackInfo?.min ?? 1);
  const max = Number(attackInfo?.max ?? 2);
  let dmg = min + Math.floor(Math.random() * (max - min + 1));
  const heroDefense = Number(hero.defense || 0);
  dmg = Math.max(0, dmg - Math.floor(Math.random() * (heroDefense + 1)));

  // lê HP atual
  const row = await get(`SELECT hp, max_hp FROM player_heroes WHERE id=$1`, [targetHeroId]);
  if (!row) return { ok: false, message: 'hero stats not found' };

  const newHp = Math.max(0, Number(row.hp) - dmg);
  const dead  = newHp === 0;

  // >>>>>>>>>>>>>>>>>>>>>>>>> CORREÇÃO AQUI: "updatedAt" (camelCase)
  await run(
    `UPDATE player_heroes
        SET hp = $2, "updatedAt" = now()
      WHERE id = $1`,
    [targetHeroId, newHp]
  );

  // Evento principal: barra de HP
  broadcast({
    type: 'hero_hp',
    heroId: targetHeroId,
    hp: newHp,
    maxHp: row.max_hp,
    byMob: inst.monster_key,
    instanceId: inst.id,
    dmg
  });

  // (Opcional) evento de “dano” para flutuante/sangue, caso seu front use
  broadcast({
    type: 'hero_dmg',
    heroId: targetHeroId,
    amount: dmg,
    byMob: inst.monster_key,
    instanceId: inst.id
  });

  if (dead) {
    broadcast({
      type: 'hero_dead',
      heroId: targetHeroId,
      byMob: inst.monster_key,
      instanceId: inst.id
    });
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
}

module.exports = { applyHit, applyMobHit };
