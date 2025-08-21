// server/balance/config.js
// Todos os knobs ficam aqui. Troque números aqui e o jogo inteiro acompanha.

const envNum = (name, def) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : def;
};

module.exports = {
  // === PROGRESSÃO POR HIT (Tibia-like) ===
  // Ganho de skill NÃO depende do dano. Cada acerto rende a mesma fração.
  TRIES_PER_HIT: envNum('TRIES_PER_HIT', 1),     // quantos "tries" por acerto (base)

  // Intervalo entre swings na arena de treino (dummy). Em combate real, use o ritmo real.
  TRAIN_SWING_SECONDS: envNum('TRAIN_SWING_SECONDS', 2),

  // === ENERGIA / STAMINA ===
  // Quanto de energia consome por minuto enquanto treinando (dummy).
  ENERGY_PER_MIN_WHEN_TRAINING: envNum('ENERGY_PER_MIN_WHEN_TRAINING', 6), // 6/min => 10 min = 60
  // Limite de duração por sessão (hard cap)
  MAX_SESSION_SECONDS: envNum('MAX_SESSION_SECONDS', 12 * 3600),
  // Limite diário (hard cap)
  DAILY_TRAIN_CAP_SECONDS: envNum('DAILY_TRAIN_CAP_SECONDS', 8 * 3600),

  // === DEFAULTS / FALLBACKS ===
  DEFAULT_START_LEVEL: envNum('DEFAULT_START_LEVEL', 1),

  // Quando não existir rate na tabela class_skill_rates, usa 1.0
  CLASS_RATE_FALLBACK: 1.0,
};
