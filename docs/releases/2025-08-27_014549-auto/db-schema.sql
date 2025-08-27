CREATE TABLE players (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, password_hash TEXT, coins INTEGER NOT NULL DEFAULT 0, gems INTEGER NOT NULL DEFAULT 0, createdAt INTEGER NOT NULL);
CREATE TABLE heroes_master (heroKey TEXT PRIMARY KEY, name TEXT NOT NULL, rarity TEXT NOT NULL, base_attack INTEGER DEFAULT 0, base_defense INTEGER DEFAULT 0, base_speed INTEGER DEFAULT 0, class TEXT, role TEXT, type TEXT, element TEXT, weapon TEXT, attack_type TEXT DEFAULT '', weapon_pref TEXT DEFAULT '', spriteKey TEXT);
CREATE TABLE inventory (id TEXT PRIMARY KEY, playerId TEXT NOT NULL, itemKey TEXT NOT NULL, qty INTEGER NOT NULL DEFAULT 0, createdAt INTEGER NOT NULL);
CREATE INDEX idx_inventory_player ON inventory(playerId);
CREATE TABLE player_heroes (id TEXT PRIMARY KEY, playerId TEXT NOT NULL, heroKey TEXT NOT NULL, name TEXT NOT NULL, rarity TEXT NOT NULL, attack INTEGER DEFAULT 0, defense INTEGER DEFAULT 0, speed INTEGER DEFAULT 0, createdAt INTEGER NOT NULL, level INTEGER DEFAULT 1, isStarter INTEGER NOT NULL DEFAULT 0);
CREATE INDEX idx_player_heroes_player ON player_heroes(playerId);
CREATE TABLE weapon_skill_map (weapon TEXT PRIMARY KEY, skill_type TEXT NOT NULL);
CREATE TABLE skill_curves (skill_type TEXT NOT NULL, level INTEGER NOT NULL, tries_needed INTEGER NOT NULL, PRIMARY KEY(skill_type, level));
CREATE TABLE class_skill_rates (class TEXT NOT NULL, skill_type TEXT NOT NULL, rate REAL NOT NULL DEFAULT 1.0, PRIMARY KEY(class, skill_type));
CREATE TABLE player_hero_skills (hero_id TEXT NOT NULL, skill_type TEXT NOT NULL, level INTEGER NOT NULL DEFAULT 1, tries_progress REAL NOT NULL DEFAULT 0, PRIMARY KEY (hero_id, skill_type));
CREATE TABLE hero_training (hero_id TEXT PRIMARY KEY, skill_type TEXT NOT NULL DEFAULT 'SWORD', status TEXT NOT NULL DEFAULT 'STOPPED', started_at TEXT, last_tick_at TEXT, energy_current REAL NOT NULL DEFAULT 0, energy_max REAL NOT NULL DEFAULT 100, energy_spent REAL NOT NULL DEFAULT 0, session_seconds INTEGER NOT NULL DEFAULT 0, notes TEXT, daily_seconds INTEGER NOT NULL DEFAULT 0, daily_reset_at TEXT);
CREATE UNIQUE INDEX players_name_uq ON players(name COLLATE NOCASE);
CREATE TABLE content_files (
  path TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE monsters_master (
  id INTEGER PRIMARY KEY,
  key TEXT UNIQUE,
  name TEXT,
  xp INTEGER,
  healthMax INTEGER,
  speed INTEGER,
  flagsJSON TEXT,
  elementsJSON TEXT,
  attacksJSON TEXT,
  defensesJSON TEXT,
  lootJSON TEXT,
  lookJSON TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE items_master (
  id INTEGER PRIMARY KEY,
  key TEXT UNIQUE,
  dataJSON TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE sprites_master (
  id INTEGER PRIMARY KEY,
  key TEXT UNIQUE,
  kind TEXT,
  dataJSON TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE maps (
  key TEXT PRIMARY KEY,
  dataJSON TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE map_objects (
  id INTEGER PRIMARY KEY,
  mapKey TEXT,
  type TEXT,
  x INTEGER, y INTEGER, w INTEGER, h INTEGER,
  propsJSON TEXT,
  FOREIGN KEY(mapKey) REFERENCES maps(key)
);
CREATE TABLE spawns (
  id INTEGER PRIMARY KEY,
  mapKey TEXT,
  monsterKey TEXT,
  x INTEGER, y INTEGER, w INTEGER, h INTEGER,
  count INTEGER, respawnSec INTEGER,
  levelMin INTEGER, levelMax INTEGER,
  FOREIGN KEY(mapKey) REFERENCES maps(key)
);
CREATE UNIQUE INDEX ux_one_starter_per_player

ON player_heroes(playerId)

WHERE isStarter = 1;
CREATE TABLE starters_pool (
      heroKey TEXT PRIMARY KEY
    );
CREATE TABLE player_positions (

  playerId   TEXT NOT NULL,

  mapKey     TEXT NOT NULL,

  x          INTEGER NOT NULL DEFAULT 0,

  y          INTEGER NOT NULL DEFAULT 0,

  updated_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (playerId, mapKey)

);
CREATE TABLE chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  fromId TEXT,
  fromName TEXT,
  text TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE sqlite_sequence(name,seq);
CREATE TABLE afk_boxes (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  kind TEXT,
  level INTEGER DEFAULT 1,
  capacity INTEGER DEFAULT 9999,
  created_at DATETIME DEFAULT (datetime('now'))
);
CREATE TABLE afk_workers (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  name TEXT,
  produce_type TEXT NOT NULL,
  produce_amount INTEGER DEFAULT 1,
  rate_sec INTEGER DEFAULT 10,
  assigned_box TEXT,
  last_collected DATETIME DEFAULT (datetime('now')),
  created_at DATETIME DEFAULT (datetime('now'))
);
CREATE TABLE afk_inventories (
  player_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  amount INTEGER DEFAULT 0,
  PRIMARY KEY (player_id, item_type)
);
CREATE TABLE farm_plots (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  -- posi├º├úo opcional (se quiser desenhar no mapa/ilha)
  x INTEGER DEFAULT 0,
  y INTEGER DEFAULT 0,

  crop_key TEXT,                -- null = vazio
  stage INTEGER DEFAULT 0,      -- 0 = vazio, 1..N = est├ígios
  planted_at TEXT,              -- ISO utc "YYYY-MM-DD HH:MM:SS"
  next_at TEXT,                 -- quando vira pro pr├│ximo est├ígio

  created_at TEXT DEFAULT (datetime('now'))
);
