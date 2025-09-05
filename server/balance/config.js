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

  // === Combate (dano simples) ===
  DAMAGE_VARIANCE: envNum('DAMAGE_VARIANCE', 0.20), // 20%
  MONSTER_DEF_FALLBACK: envNum('MONSTER_DEF_FALLBACK', 6),

  // === Velocidade por arma (ms entre golpes) ===
  // Mantém seus valores atuais e adiciona aliases para compat (DISTANCE = BOW).
  WEAPON_SPEED_MS: {
    SWORD:   envNum('SWORD_SPEED_MS', 900),   // 0.9s
    AXE:     envNum('AXE_SPEED_MS', 1100),
    CLUB:    envNum('CLUB_SPEED_MS', 1100),
    BOW:     envNum('BOW_SPEED_MS', 700),
    // Aliases:
    DISTANCE: envNum('DISTANCE_SPEED_MS', envNum('BOW_SPEED_MS', 700)),
    MAGIC:    envNum('MAGIC_SPEED_MS', 1200),
  },

  // === Alcance por arma (em TILES 32x32, estilo OT/Chebyshev) ===
  // Usado pelo inReachPx(). Mantém BOW e adiciona DISTANCE como alias.
  WEAPON_RANGE_TILES: {
    SWORD:    envNum('SWORD_RANGE_TILES', 1),
    AXE:      envNum('AXE_RANGE_TILES', 1),
    CLUB:     envNum('CLUB_RANGE_TILES', 1),
    BOW:      envNum('BOW_RANGE_TILES', 5),
    DISTANCE: envNum('DISTANCE_RANGE_TILES', envNum('BOW_RANGE_TILES', 5)),
    MAGIC:    envNum('MAGIC_RANGE_TILES', 8),
  },
};
