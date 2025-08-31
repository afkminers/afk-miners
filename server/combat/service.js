// server/combat/service.js
const { get, run } = require('../models/db');
const K = require('../balance/config');
const { applyTries, getClassRate } = require('../skills/engine');

async function resolveSkillFromWeapon(weaponType) {
  if (!weaponType) return null;
  const row = await get(
    `SELECT skill_type FROM weapon_skill_map WHERE lower(weapon_type) = lower($1)`,
    [String(weaponType)]
  );
  return row?.skill_type || null;
}

function computeDamage(baseAtk, defFallback = K.MONSTER_DEF_FALLBACK, variance = K.DAMAGE_VARIANCE) {
  // dano simples com variação
  const raw = Math.max(0, baseAtk - defFallback / 2);
  const roll = raw * (1 - variance + Math.random() * (2 * variance));
  return Math.max(0, Math.floor(roll));
}

async function getHeroStats(heroId) {
  return await get(
    `SELECT ph.id AS hero_id,
            COALESCE(ph.attack,10)  AS attack,
            COALESCE(ph.defense,10) AS defense,
            hm.class
       FROM player_heroes ph
  LEFT JOIN heroes_master hm ON hm."heroKey" = ph."heroKey"
      WHERE ph.id = $1`,
    [heroId]
  );
}

async function getInstance(instanceId) {
  return await get(
    `SELECT mi.id, mi.hp, mi.max_hp, mi.state,
            m.id AS monster_id, COALESCE(m.xp,25) AS xp_reward
       FROM monster_instances mi
       JOIN monsters_master m ON m.id = mi.monster_id
      WHERE mi.id = $1`,
    [instanceId]
  );
}

async function applyHit({ attackerHeroId, targetInstanceId, weaponType }) {
  const hero = await getHeroStats(attackerHeroId);
  const inst = await getInstance(targetInstanceId);
  if (!hero || !inst) return { ok:false, message:'attacker or target not found' };
  if (inst.state !== 'ALIVE') return { ok:false, message:'target not alive' };

  const dmg = computeDamage(hero.attack);
  const newHp = Math.max(0, inst.hp - dmg);
  const dead = newHp === 0;

  await run(
    `UPDATE monster_instances
        SET hp = $2,
            state = CASE WHEN $2=0 THEN 'DEAD' ELSE state END,
            updated_at = now()
      WHERE id = $1`,
    [inst.id, newHp]
  );

  // sobe skill (Tibia-like)
  const skillType = await resolveSkillFromWeapon(weaponType);
  if (skillType) {
    const rate = await getClassRate(hero.class || null, skillType);
    await applyTries(attackerHeroId, skillType, 1 * rate);
  }

  return { ok:true, damage:dmg, hpAfter:newHp, dead, instanceId:inst.id };
}

module.exports = { applyHit };
