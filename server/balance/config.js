// server/balance/config.js
// Todos os knobs ficam aqui. Troque números aqui e o jogo inteiro acompanha.

const envNum = (name, def) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : def;
};

module.exports = {
  // === PROGRESSÃO POR HIT (Tibia-like) ===
  // Ganho de skill NÃO depende do dano. Cada acerto rende a mesma fração.
  TRIES_PER_HIT: envNum('TRIES_PER_HIT', 5), // base de tries por evento

  // Intervalo entre swings na arena de treino (dummy). Em combate real, use o ritmo real.
  TRAIN_SWING_SECONDS: envNum('TRAIN_SWING_SECONDS', 2),

  // === ENERGIA / STAMINA ===
  ENERGY_PER_MIN_WHEN_TRAINING: envNum('ENERGY_PER_MIN_WHEN_TRAINING', 6),
  MAX_SESSION_SECONDS: envNum('MAX_SESSION_SECONDS', 12 * 3600),
  DAILY_TRAIN_CAP_SECONDS: envNum('DAILY_TRAIN_CAP_SECONDS', 8 * 3600),

  // === DEFAULTS / FALLBACKS ===
  DEFAULT_START_LEVEL: envNum('DEFAULT_START_LEVEL', 1),

  // Quando não existir rate na tabela class_skill_rates, usa 1.0
  CLASS_RATE_FALLBACK: 1.0,

  // === Combate (para dano simples) ===
  DAMAGE_VARIANCE: envNum('DAMAGE_VARIANCE', 0.20), // 20%
  MONSTER_DEF_FALLBACK: envNum('MONSTER_DEF_FALLBACK', 6),

  WEAPON_SPEED_MS: {
    SWORD: 900,   // 0.9s
    AXE: 1100,
    CLUB: 1100,
    BOW: 700
  }
};
