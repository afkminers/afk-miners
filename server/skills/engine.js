// server/skills/engine.js
const { get, run } = require('../models/db');
const K = require('../balance/config'); // knobs em server/balance/config.js

async function ensureSkillRow(heroId, skillType) {
  const row = await get(
    `SELECT 1 FROM player_hero_skills WHERE hero_id = $1 AND skill_type = $2`,
    [heroId, skillType]
  );
  if (!row) {
    await run(
      `INSERT INTO player_hero_skills (hero_id, skill_type, level, tries_progress)
       VALUES ($1, $2, 1, 0)`,
      [heroId, skillType]
    );
  }
}

async function triesNeeded(skillType, level) {
  const r = await get(
    `SELECT tries_needed
       FROM skill_curves
      WHERE skill_type = $1 AND level = $2`,
    [skillType, level]
  );
  return r ? Number(r.tries_needed) : null; // null = cap
}

async function getClassRate(heroClass, skillType) {
  if (!heroClass) return K.CLASS_RATE_FALLBACK || 1.0;
  const r = await get(
    `SELECT rate
       FROM class_skill_rates
      WHERE class = $1 AND skill_type = $2`,
    [String(heroClass).toUpperCase(), skillType]
  );
  return r?.rate != null ? Number(r.rate) : (K.CLASS_RATE_FALLBACK || 1.0);
}

async function applyTries(heroId, skillType, triesToApply) {
  if (!triesToApply || triesToApply <= 0) return { leveled: 0 };

  await ensureSkillRow(heroId, skillType);

  let row = await get(
    `SELECT level, tries_progress
       FROM player_hero_skills
      WHERE hero_id = $1 AND skill_type = $2`,
    [heroId, skillType]
  );
  let level = row?.level ? Number(row.level) : 1;
  let tries = row?.tries_progress ? Number(row.tries_progress) : 0;

  let rem = triesToApply;
  let leveled = 0;

  while (rem > 0) {
    const need = await triesNeeded(skillType, level);
    if (need == null) break; // chegou no cap
    const missing = need - tries;

    if (rem >= missing) {
      level += 1;
      tries = 0;
      rem -= missing;
      leveled += 1;
    } else {
      tries += rem;
      rem = 0;
    }
  }

  await run(
    `UPDATE player_hero_skills
        SET level = $1,
            tries_progress = $2
      WHERE hero_id = $3 AND skill_type = $4`,
    [level, tries, heroId, skillType]
  );

  return { leveled, level, tries_progress: tries };
}

/** ---- PER-HIT (Tibia-like), sem gate/treino ---- */
function triesBase(kind) {
  // Se quiser diferenciar, crie knobs por tipo: K.TRIES_PER_HIT_MELEE etc.
  if (kind === 'BLOCK') return K.TRIES_PER_HIT;
  if (kind === 'CAST')  return K.TRIES_PER_HIT;
  return K.TRIES_PER_HIT; // MELEE / DISTANCE
}

function contextMul(context) {
  // Ajuste à vontade: TRAINING pode dar bônus, COMBAT levemente menor, etc.
  const c = String(context || 'COMBAT').toUpperCase();
  if (c === 'TRAINING') return 1.0;
  return 0.8;
}

/** Eventos que o combate deve chamar (sem depender de hero_training) */
async function gainFromHit({ heroId, skillType, heroClass, context = 'COMBAT' }) {
  const rate  = await getClassRate(heroClass, skillType);
  const tries = triesBase('MELEE') * rate * contextMul(context);
  return applyTries(heroId, skillType, tries);
}

async function gainFromShot({ heroId, heroClass, context = 'COMBAT' }) {
  const rate  = await getClassRate(heroClass, 'DISTANCE');
  const tries = triesBase('DISTANCE') * rate * contextMul(context);
  return applyTries(heroId, 'DISTANCE', tries);
}

async function gainFromCast({ heroId, heroClass, context = 'COMBAT' }) {
  const rate  = await getClassRate(heroClass, 'MAGIC');
  const tries = triesBase('CAST') * rate * contextMul(context);
  return applyTries(heroId, 'MAGIC', tries);
}

async function gainFromBlock({ heroId, heroClass, context = 'COMBAT' }) {
  const rate  = await getClassRate(heroClass, 'SHIELD');
  const tries = triesBase('BLOCK') * rate * contextMul(context);
  return applyTries(heroId, 'SHIELD', tries);
}

module.exports = {
  applyTries,
  getClassRate,
  gainFromHit,
  gainFromShot,
  gainFromCast,
  gainFromBlock,
};
