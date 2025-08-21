// server/skills/engine.js
const { get, run } = require('../models/db');
const K = require('../balance/config'); // usa seus knobs em server/balance/config.js

async function ensureSkillRow(heroId, skillType) {
  const row = await get(
    `SELECT 1 FROM player_hero_skills WHERE hero_id=? AND skill_type=?`,
    [heroId, skillType]
  );
  if (!row) {
    await run(
      `INSERT INTO player_hero_skills (hero_id, skill_type, level, tries_progress) VALUES (?,?,1,0)`,
      [heroId, skillType]
    );
  }
}

async function triesNeeded(skillType, level) {
  const r = await get(
    `SELECT tries_needed FROM skill_curves WHERE skill_type=? AND level=?`,
    [skillType, level]
  );
  return r ? r.tries_needed : null; // null = cap
}

async function getClassRate(heroClass, skillType) {
  if (!heroClass) return K.CLASS_RATE_FALLBACK || 1.0;
  const r = await get(
    `SELECT rate FROM class_skill_rates WHERE class=? AND skill_type=?`,
    [String(heroClass).toUpperCase(), skillType]
  );
  return r?.rate ?? (K.CLASS_RATE_FALLBACK || 1.0);
}

async function applyTries(heroId, skillType, triesToApply) {
  if (!triesToApply || triesToApply <= 0) return { leveled: 0 };

  await ensureSkillRow(heroId, skillType);

  let row = await get(
    `SELECT level, tries_progress FROM player_hero_skills WHERE hero_id=? AND skill_type=?`,
    [heroId, skillType]
  );
  let level = row?.level ?? 1;
  let tries = row?.tries_progress ?? 0;

  let rem = triesToApply, leveled = 0;
  while (rem > 0) {
    const need = await triesNeeded(skillType, level);
    if (need == null) break; // cap
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
    `UPDATE player_hero_skills SET level=?, tries_progress=? WHERE hero_id=? AND skill_type=?`,
    [level, tries, heroId, skillType]
  );
  return { leveled, level, tries_progress: tries };
}

/** ---- PER-HIT (Tibia-like) ---- */
function _tryFrom(kind) {
  if (kind === 'BLOCK') return K.TRIES_PER_HIT;         // pode ajustar por tipo se quiser
  if (kind === 'CAST')  return K.TRIES_PER_HIT;
  return K.TRIES_PER_HIT; // MELEE / DISTANCE
}
function _ctxMul(context) {
  const c = String(context || 'COMBAT').toUpperCase();
  return c === 'TRAINING' ? 1.0 : 0.6; // se quiser knobs separados, adicione em K
}

/** Gate: só conta tries em TRAINING se existir sessão ativa com energia */
async function _trainingGate(heroId, context) {
  if (String(context).toUpperCase() !== 'TRAINING') return true;
  const t = await get(`SELECT status, energy_current FROM hero_training WHERE hero_id=?`, [heroId]);
  return !!(t && t.status === 'RUNNING' && (t.energy_current || 0) > 0);
}

/** Eventos que o combate deve chamar */
async function gainFromHit({ heroId, skillType, heroClass, context='COMBAT' }) {
  if (!(await _trainingGate(heroId, context))) return { gated: true };
  const rate  = await getClassRate(heroClass, skillType);
  const tries = _tryFrom('MELEE') * rate * _ctxMul(context);
  return applyTries(heroId, skillType, tries);
}

async function gainFromShot({ heroId, heroClass, context='COMBAT' }) {
  if (!(await _trainingGate(heroId, context))) return { gated: true };
  const rate  = await getClassRate(heroClass, 'DISTANCE');
  const tries = _tryFrom('DISTANCE') * rate * _ctxMul(context);
  return applyTries(heroId, 'DISTANCE', tries);
}

async function gainFromCast({ heroId, heroClass, context='COMBAT' }) {
  if (!(await _trainingGate(heroId, context))) return { gated: true };
  const rate  = await getClassRate(heroClass, 'MAGIC');
  const tries = _tryFrom('CAST') * rate * _ctxMul(context);
  return applyTries(heroId, 'MAGIC', tries);
}

async function gainFromBlock({ heroId, heroClass, context='COMBAT' }) {
  if (!(await _trainingGate(heroId, context))) return { gated: true };
  const rate  = await getClassRate(heroClass, 'SHIELD');
  const tries = _tryFrom('BLOCK') * rate * _ctxMul(context);
  return applyTries(heroId, 'SHIELD', tries);
}

module.exports = {
  applyTries,
  getClassRate,
  gainFromHit, gainFromShot, gainFromCast, gainFromBlock
};
