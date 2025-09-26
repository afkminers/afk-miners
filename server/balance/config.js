// server/balance/config.js
// Todos os knobs ficam aqui. Troque números aqui e o jogo inteiro acompanha.

const envNum = (name, def) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : def;
};

const envBool = (name, def) => {
  const v = String(process.env[name] || '').toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return def;
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
    BOW:      envNum('BOW_RANGE_TILES', 4),
    DISTANCE: envNum('DISTANCE_RANGE_TILES', envNum('BOW_RANGE_TILES', 4)),
    MAGIC:    envNum('MAGIC_RANGE_TILES', 4),
    MONSTER:  envNum('MONSTER_RANGE_TILES', 1), // << claro e tunável
  },


  // === Combat target selection ===
  CLICK_MAX_DIST_PX: envNum('CLICK_MAX_DIST_PX', 280),      // max click distance
  CLICK_PICK_RADIUS_PX: envNum('CLICK_PICK_RADIUS_PX', 192), // 6 tiles for pickup radius

  // === Loot no chão ===
  LOOT_EXPIRE_SECONDS: envNum('LOOT_EXPIRE_SECONDS', 600),          // 600s = 10 min
  LOOT_CLEANUP_EVERY_SECONDS: envNum('LOOT_CLEANUP_EVERY_SECONDS', 60), // varredura a cada 60s

  // === Combat Targeting & Attack Flags ===
  // Mouse/keyboard UX
  ATTACK_USE_RMB: envBool('ATTACK_USE_RMB', true),                   // Use right mouse button for attacks
  
  // Server validation strictness  
  ATTACK_STRICT_MODE: envBool('ATTACK_STRICT_MODE', true),           // Enforce range/LOS validations
  
  // Targeting behavior
  CLICK_REQUIRE_INTERSECT: envBool('CLICK_REQUIRE_INTERSECT', true), // Only accept clicks that intersect monster rect
  CLICK_PICK_RADIUS_PX: envNum('CLICK_PICK_RADIUS_PX', 96),          // Fallback radius when no intersection (3 tiles)
  CLICK_MAX_DIST_PX: envNum('CLICK_MAX_DIST_PX', 160),               // Max click distance from player (5 tiles)
};
