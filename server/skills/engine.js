// server/skills/engine.js
// Motor único: mesmas funções servem para Treasure Hunt/PvP (eventos reais)
// e para a Arena de Treino (simulação de acertos).
const K = require('../balance/config');
const { get: dbGet, all: dbAll, run: dbRun } = require('../models/db');

const SKILLS = new Set(['SWORD','AXE','CLUB','DISTANCE','SHIELD','MAGIC']);

// ----------------- util DB -----------------
async function ensureSkillRow(heroId, skillType) {
  const row = await dbGet(
    `SELECT 1 FROM player_hero_skills WHERE hero_id=? AND skill_type=?`,
    [heroId, skillType]
  );
  if (!row) {
    await dbRun(
      `INSERT INTO player_hero_skills (hero_id, skill_type, level, tries_progress)
       VALUES (?, ?, ?, 0)`,
      [heroId, skillType, K.DEFAULT_START_LEVEL]
    );
  }
}
async function getSkillState(heroId, skillType) {
  return dbGet(
    `SELECT level, tries_progress FROM player_hero_skills WHERE hero_id=? AND skill_type=?`,
    [heroId, skillType]
  );
}
async function setSkillState(heroId, skillType, level, tries) {
  await dbRun(
    `UPDATE player_hero_skills SET level=?, tries_progress=? WHERE hero_id=? AND skill_type=?`,
    [level, tries, heroId, skillType]
  );
}
async function triesNeeded(skillType, level) {
  const r = await dbGet(
    `SELECT tries_needed FROM skill_curves WHERE skill_type=? AND level=?`,
    [skillType, level]
  );
  return r ? r.tries_needed : null;
}

// ----------------- API pública -----------------
async function resolveSkillType(weaponOrSkill) {
  if (!weaponOrSkill) return null;
  const raw = String(weaponOrSkill);
  const up  = raw.toUpperCase();
  if (SKILLS.has(up)) return up;

  // seu schema usa coluna "weapon" na tabela weapon_skill_map
  const row = await dbGet(
    `SELECT skill_type FROM weapon_skill_map WHERE LOWER(weapon) = LOWER(?)`,
    [raw]
  );
  return row?.skill_type || null;
}

async function getClassRate(heroClass, skillType) {
  if (!heroClass) return K.CLASS_RATE_FALLBACK;
  const r = await dbGet(
    `SELECT rate FROM class_skill_rates WHERE class=? AND skill_type=?`,
    [String(heroClass).toUpperCase(), skillType]
  );
  return r?.rate ?? K.CLASS_RATE_FALLBACK;
}

// Ganho por evento de combate: cada ACERTO rende TRIES_PER_HIT * classRate (independente do dano).
async function applyHitTry({ heroId, skillType, classRate = 1 }) {
  if (!heroId || !skillType) return { leveled: 0, triesApplied: 0 };

  await ensureSkillRow(heroId, skillType);
  let { level, tries_progress } = await getSkillState(heroId, skillType);
  let pool = K.TRIES_PER_HIT * (classRate || 1);
  let leveled = 0;

  while (pool > 0) {
    const need = await triesNeeded(skillType, level);
    if (need == null) break; // CAP

    const missing = need - tries_progress;
    if (pool >= missing) {
      pool -= missing;
      level += 1;
      tries_progress = 0;
      leveled += 1;
    } else {
      tries_progress += pool;
      pool = 0;
    }
  }
  await setSkillState(heroId, skillType, level, tries_progress);
  return { leveled, triesApplied: K.TRIES_PER_HIT * (classRate || 1) };
}

// API para TH/PvP: chame quando um golpe acertar.
async function onCombatHit({ heroId, weaponOrSkill, heroClass }) {
  const skillType = await resolveSkillType(weaponOrSkill);
  if (!skillType) return { leveled: 0, triesApplied: 0, skillType: null };

  const rate = await getClassRate(heroClass, skillType);
  const r = await applyHitTry({ heroId, skillType, classRate: rate });
  return { ...r, skillType };
}

// ----------------- Simulação da arena (dummy/monk) -----------------
// Converte um intervalo de tempo em "número de acertos" e aplica applyHitTry()
// com o rate da classe. Consome energia e respeita caps.
async function simulateTrainingBatch({ heroTrainingRow: t, heroClass, nowMs }) {
  const lastMs = Date.parse(t.last_tick_at || t.started_at) || nowMs;
  let deltaSec = Math.max(0, Math.floor((nowMs - lastMs) / 1000));
  if (deltaSec <= 0) return { processed: 0 };

  // caps de sessão e dia (o index.js também confere depois de aplicar)
  const sessLeft  = Math.max(0, K.MAX_SESSION_SECONDS       - Number(t.session_seconds || 0));
  const dailyLeft = Math.max(0, K.DAILY_TRAIN_CAP_SECONDS    - Number(t.daily_seconds   || 0));
  let allowed = Math.min(deltaSec, sessLeft, dailyLeft);
  if (allowed <= 0) return { processed: 0 };

  // energia limita o tempo processável
  const energy = Number(t.energy_current ?? 0);
  const energyPerSec = K.ENERGY_PER_MIN_WHEN_TRAINING / 60;
  const energyTimeCap = energyPerSec > 0 ? Math.floor(energy / energyPerSec) : allowed;
  allowed = Math.max(0, Math.min(allowed, energyTimeCap));
  if (allowed <= 0) return { processed: 0 };

  // quantos swings nesse período
  const swings = Math.floor(allowed / K.TRAIN_SWING_SECONDS);
  if (swings <= 0) return { processed: 0 };

  const rate = await getClassRate(heroClass, t.skill_type);
  let leveled = 0;
  let triesAppliedTotal = 0;

  // Aplica por swing (mantém granularidade p/ up múltiplo)
  for (let i = 0; i < swings; i++) {
    const r = await applyHitTry({
      heroId: t.hero_id,
      skillType: t.skill_type,
      classRate: rate
    });
    leveled += r.leveled;
    triesAppliedTotal += r.triesApplied;
  }

  const processed = swings * K.TRAIN_SWING_SECONDS;
  const energyConsumed = processed * energyPerSec;

  return { processed, hits: swings, leveled, triesApplied: triesAppliedTotal, energyConsumed };
}

module.exports = {
  resolveSkillType,
  getClassRate,
  onCombatHit,           // para TH/PvP: chame quando um acerto ocorrer
  simulateTrainingBatch  // para a arena (dummy)
};
