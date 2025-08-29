// server/models/migrate.js
const { run } = require('./db');
const { ensureHeroesSchema, seedHeroesIfEmpty } = require('./heroes');

async function migrate() {
  // players
  await run(`
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      password_hash TEXT DEFAULT '',
      coins INTEGER NOT NULL DEFAULT 500,
      gems  INTEGER NOT NULL DEFAULT 0,
      createdAt BIGINT NOT NULL
    )
  `);

  // índice único case-insensitive (equivalente ao COLLATE NOCASE do SQLite)
  await run(`
    CREATE UNIQUE INDEX IF NOT EXISTS players_name_uq
      ON players (LOWER(name))
  `);

  // garante coluna (PG suporta IF NOT EXISTS)
  await run(`ALTER TABLE players ADD COLUMN IF NOT EXISTS password_hash TEXT DEFAULT ''`);

  // catálogo de heróis (tabela mestre)
  await ensureHeroesSchema();

  // heróis do jogador (é o que o app usa em todas as rotas)
  await run(`
    CREATE TABLE IF NOT EXISTS player_heroes (
      id TEXT PRIMARY KEY,
      playerId TEXT NOT NULL,
      heroKey TEXT NOT NULL,
      name TEXT NOT NULL,
      rarity TEXT NOT NULL,
      attack INTEGER NOT NULL,
      defense INTEGER NOT NULL,
      speed INTEGER NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      createdAt BIGINT NOT NULL,
      isStarter BOOLEAN NOT NULL DEFAULT FALSE,
      FOREIGN KEY (playerId) REFERENCES players(id)
    )
  `);

  // posições por mapa (usada em /api/player/pos)
  await run(`
    CREATE TABLE IF NOT EXISTS player_positions (
      playerId TEXT NOT NULL,
      mapKey   TEXT NOT NULL,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      PRIMARY KEY (playerId, mapKey),
      FOREIGN KEY (playerId) REFERENCES players(id)
    )
  `);

  // ---- (opcional) crie aqui outras tabelas que seu app já usa: ----
  // skills básicas do herói
  await run(`
    CREATE TABLE IF NOT EXISTS player_hero_skills (
      hero_id TEXT NOT NULL,
      skill_type TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      tries_progress REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (hero_id, skill_type)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS skill_curves (
      skill_type TEXT NOT NULL,
      level INTEGER NOT NULL,
      tries_needed REAL NOT NULL,
      PRIMARY KEY (skill_type, level)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS class_skill_rates (
      class TEXT NOT NULL,
      skill_type TEXT NOT NULL,
      rate REAL NOT NULL,
      PRIMARY KEY (class, skill_type)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS weapon_skill_map (
      weapon_type TEXT PRIMARY KEY,
      skill_type  TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS hero_training (
      hero_id TEXT PRIMARY KEY,
      skill_type TEXT,
      status TEXT, -- 'RUNNING' | 'STOPPED'
      started_at   TIMESTAMP WITH TIME ZONE,
      last_tick_at TIMESTAMP WITH TIME ZONE,
      energy_current REAL,
      energy_max REAL,
      energy_spent REAL,
      session_seconds INTEGER,
      daily_seconds INTEGER,
      daily_reset_at TIMESTAMP WITH TIME ZONE,
      notes TEXT
    )
  `);

  // pipeline de conteúdo (monstros/itens/sprites/mapas)
  await run(`
    CREATE TABLE IF NOT EXISTS content_files (
      path TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS monsters_master (
      id SERIAL PRIMARY KEY,
      key TEXT UNIQUE,
      name TEXT,
      xp INTEGER,
      healthMax INTEGER,
      speed INTEGER,
      flagsJSON   TEXT,
      elementsJSON TEXT,
      attacksJSON  TEXT,
      defensesJSON TEXT,
      lootJSON     TEXT,
      lookJSON     TEXT,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS items_master (
      id SERIAL PRIMARY KEY,
      key TEXT UNIQUE,
      dataJSON TEXT,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS sprites_master (
      id SERIAL PRIMARY KEY,
      key TEXT UNIQUE,
      kind TEXT,
      dataJSON TEXT,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS maps (
      key TEXT PRIMARY KEY,
      dataJSON TEXT,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS map_objects (
      id SERIAL PRIMARY KEY,
      mapKey TEXT,
      type TEXT,
      x INTEGER, y INTEGER, w INTEGER, h INTEGER,
      propsJSON TEXT,
      FOREIGN KEY (mapKey) REFERENCES maps(key)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS spawns (
      id SERIAL PRIMARY KEY,
      mapKey TEXT,
      monsterKey TEXT,
      x INTEGER, y INTEGER, w INTEGER, h INTEGER,
      count INTEGER, respawnSec INTEGER,
      levelMin INTEGER, levelMax INTEGER,
      FOREIGN KEY (mapKey) REFERENCES maps(key)
    )
  `);

  // chat (usado pelo WS)
  await run(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id BIGSERIAL PRIMARY KEY,
      scope TEXT NOT NULL,
      fromId TEXT,
      fromName TEXT,
      text TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  // AFK (workers/boxes/inventário)
  await run(`
    CREATE TABLE IF NOT EXISTS afk_workers (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL,
      name TEXT NOT NULL,
      produce_type TEXT NOT NULL,
      produce_amount INTEGER NOT NULL DEFAULT 1,
      rate_sec INTEGER NOT NULL DEFAULT 10,
      assigned_box TEXT,
      last_collected TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS afk_boxes (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      capacity INTEGER NOT NULL DEFAULT 100,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS afk_inventories (
      player_id TEXT NOT NULL,
      item_type TEXT NOT NULL,
      amount INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (player_id, item_type),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  // Farm (plots)
  await run(`
    CREATE TABLE IF NOT EXISTS farm_plots (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      crop_key TEXT,
      stage INTEGER NOT NULL DEFAULT 0,
      planted_at TIMESTAMP WITH TIME ZONE,
      next_at    TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  // popula heróis base se vazio
  await seedHeroesIfEmpty();
}

module.exports = { migrate };