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
  WEAPON_SPEED_MS: {
    SWORD:    envNum('SWORD_SPEED_MS', 900),   // 0.9s
    AXE:      envNum('AXE_SPEED_MS', 1100),
    CLUB:     envNum('CLUB_SPEED_MS', 1100),
    BOW:      envNum('BOW_SPEED_MS', 700),
    CROSSBOW: envNum('CROSSBOW_SPEED_MS', 700),
    SPEAR:    envNum('SPEAR_SPEED_MS', 800),
    // Aliases:
    DISTANCE: envNum('DISTANCE_SPEED_MS', envNum('BOW_SPEED_MS', 700)),
    MAGIC:    envNum('MAGIC_SPEED_MS', 1200),
    STAFF:    envNum('STAFF_SPEED_MS', 1200),
    WAND:     envNum('WAND_SPEED_MS', 1000),
    ROD:      envNum('ROD_SPEED_MS', 1000),
  },
  
  // === ✅ ALCANCE POR ARMA (em TILES 32x32, estilo Tibia/OT) ===
  // Esta é a tabela que define o alcance real de cada tipo de arma.
  // 1 tile = corpo a corpo (precisa estar ao lado)
  // 4+ tiles = ataque à distância
  WEAPON_RANGE_TILES: {
    // ===== CORPO A CORPO (MELEE) - 1 TILE =====
    SWORD:    envNum('SWORD_RANGE_TILES', 1),
    AXE:      envNum('AXE_RANGE_TILES', 1),
    CLUB:     envNum('CLUB_RANGE_TILES', 1),
    DAGGER:   envNum('DAGGER_RANGE_TILES', 1),
    FIST:     envNum('FIST_RANGE_TILES', 1),
    
    // ===== DISTÂNCIA (DISTANCE) - 4-5 TILES =====
    BOW:      envNum('BOW_RANGE_TILES', 5),        // ✅ 5 tiles = 160px (padrão Tibia)
    CROSSBOW: envNum('CROSSBOW_RANGE_TILES', 5),   // ✅ 5 tiles
    DISTANCE: envNum('DISTANCE_RANGE_TILES', 5),   // ✅ Alias genérico para armas de distância
    
    // Armas arremessáveis (menor alcance)
    SPEAR:          envNum('SPEAR_RANGE_TILES', 3),
    JAVELIN:        envNum('JAVELIN_RANGE_TILES', 3),
    THROWING_KNIFE: envNum('THROWING_KNIFE_RANGE_TILES', 3),
    
    // ===== MAGIA (MAGIC) - 4 TILES =====
    MAGIC:    envNum('MAGIC_RANGE_TILES', 4),      // ✅ Alias genérico para magia
    WAND:     envNum('WAND_RANGE_TILES', 4),
    ROD:      envNum('ROD_RANGE_TILES', 4),
    STAFF:    envNum('STAFF_RANGE_TILES', 4),
    TOME:     envNum('TOME_RANGE_TILES', 4),
    
    // ===== MONSTROS =====
    MONSTER:  envNum('MONSTER_RANGE_TILES', 1),    // Monstros atacam corpo a corpo por padrão
  },
  
  // === Combat Targeting & Attack Flags ===
  
  // ✅ MODO DE VALIDAÇÃO ESTRITO
  // true = bloqueia /attack/start se estiver fora de alcance/sem LoS
  // false = permite iniciar ataque, valida apenas no /hit (permissivo/legacy)
  ATTACK_STRICT_MODE: envBool('ATTACK_STRICT_MODE', true), // ✅ MUDADO PARA TRUE
  
  // Mouse/keyboard UX
  ATTACK_USE_RMB: envBool('ATTACK_USE_RMB', true), // Use right mouse button for attacks
  
  // Targeting behavior
  CLICK_REQUIRE_INTERSECT: envBool('CLICK_REQUIRE_INTERSECT', true), // Only accept clicks that intersect monster rect
  CLICK_PICK_RADIUS_PX: envNum('CLICK_PICK_RADIUS_PX', 96),          // Fallback radius when no intersection (3 tiles)
  CLICK_MAX_DIST_PX: envNum('CLICK_MAX_DIST_PX', 280),               // Max click distance from player
  
  // === Loot no chão ===
  LOOT_EXPIRE_SECONDS: envNum('LOOT_EXPIRE_SECONDS', 600),          // 600s = 10 min
  LOOT_CLEANUP_EVERY_SECONDS: envNum('LOOT_CLEANUP_EVERY_SECONDS', 60), // varredura a cada 60s
};
