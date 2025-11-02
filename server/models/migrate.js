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

  // garante colunas base (PG suporta IF NOT EXISTS)
  await run(`ALTER TABLE players ADD COLUMN IF NOT EXISTS name TEXT`);
  await run(`ALTER TABLE players ADD COLUMN IF NOT EXISTS createdAt BIGINT`);
  await run(`ALTER TABLE players ADD COLUMN IF NOT EXISTS password_hash TEXT DEFAULT ''`);

  // índice único case-insensitive (equivalente ao COLLATE NOCASE do SQLite)
  await run(`
    CREATE UNIQUE INDEX IF NOT EXISTS players_name_uq
      ON players (LOWER(name))
      WHERE name IS NOT NULL
  `);

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

  await run(`
    ALTER TABLE player_heroes
      ADD COLUMN IF NOT EXISTS heroKey TEXT,
      ADD COLUMN IF NOT EXISTS name TEXT,
      ADD COLUMN IF NOT EXISTS rarity TEXT DEFAULT 'COMMON',
      ADD COLUMN IF NOT EXISTS attack INTEGER DEFAULT 1,
      ADD COLUMN IF NOT EXISTS defense INTEGER DEFAULT 1,
      ADD COLUMN IF NOT EXISTS speed INTEGER DEFAULT 1,
      ADD COLUMN IF NOT EXISTS level INTEGER DEFAULT 1,
      ADD COLUMN IF NOT EXISTS createdAt BIGINT,
      ADD COLUMN IF NOT EXISTS isStarter BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS xp BIGINT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS hp INTEGER DEFAULT 100,
      ADD COLUMN IF NOT EXISTS max_hp INTEGER DEFAULT 100,
      ADD COLUMN IF NOT EXISTS mana INTEGER DEFAULT 50,
      ADD COLUMN IF NOT EXISTS max_mana INTEGER DEFAULT 50,
      ADD COLUMN IF NOT EXISTS alive BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS last_respawn_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS death_count INTEGER DEFAULT 0;
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_player_heroes_player_level
      ON player_heroes ("playerId", level DESC, "createdAt")
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_player_heroes_level
      ON player_heroes (level DESC, "createdAt")
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS hero_progress (
      hero_id TEXT PRIMARY KEY,
      level INTEGER NOT NULL DEFAULT 1,
      xp BIGINT NOT NULL DEFAULT 0,
      hp_max INTEGER NOT NULL DEFAULT 100,
      mana_max INTEGER NOT NULL DEFAULT 50,
      hp INTEGER NOT NULL DEFAULT 100,
      mana INTEGER NOT NULL DEFAULT 50,
      class TEXT DEFAULT '',
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  await run(`ALTER TABLE hero_progress ADD COLUMN IF NOT EXISTS level INTEGER NOT NULL DEFAULT 1`);
  await run(`ALTER TABLE hero_progress ADD COLUMN IF NOT EXISTS xp BIGINT NOT NULL DEFAULT 0`);
  await run(`ALTER TABLE hero_progress ADD COLUMN IF NOT EXISTS hp_max INTEGER NOT NULL DEFAULT 100`);
  await run(`ALTER TABLE hero_progress ADD COLUMN IF NOT EXISTS mana_max INTEGER NOT NULL DEFAULT 50`);
  await run(`ALTER TABLE hero_progress ADD COLUMN IF NOT EXISTS hp INTEGER NOT NULL DEFAULT 100`);
  await run(`ALTER TABLE hero_progress ADD COLUMN IF NOT EXISTS mana INTEGER NOT NULL DEFAULT 50`);
  await run(`ALTER TABLE hero_progress ADD COLUMN IF NOT EXISTS class TEXT DEFAULT ''`);
  await run(`ALTER TABLE hero_progress ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now()`);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_hero_progress_level
      ON hero_progress (level DESC, updated_at DESC)
  `);

  // posições por mapa (usada em /api/player/pos)
  await run(`
    CREATE TABLE IF NOT EXISTS player_positions (
      "playerId" TEXT NOT NULL,
      mapKey   TEXT NOT NULL,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      PRIMARY KEY ("playerId", mapKey),
      FOREIGN KEY ("playerId") REFERENCES players(id)
    )
  `);

  // ---- Skills (básico) ----
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
    CREATE INDEX IF NOT EXISTS idx_player_hero_skills_type_level
      ON player_hero_skills (skill_type, level DESC)
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

  await run(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id UUID PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open'
    )
  `);

  await run(`ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`);
  await run(`ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open'`);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_support_tickets_status
      ON support_tickets (status, created_at DESC)
  `);

  // ---------- Social (amizades e DMs) ----------
  await run(`CREATE TYPE IF NOT EXISTS friend_status AS ENUM ('PENDING','ACCEPTED','BLOCKED')`);

  await run(`
    CREATE TABLE IF NOT EXISTS friendships (
      id BIGSERIAL PRIMARY KEY,
      user_a_id TEXT NOT NULL,
      user_b_id TEXT NOT NULL,
      status friend_status NOT NULL DEFAULT 'PENDING',
      pair_key TEXT GENERATED ALWAYS AS (
        CASE
          WHEN user_a_id < user_b_id THEN user_a_id || ':' || user_b_id
          ELSE user_b_id || ':' || user_a_id
        END
      ) STORED NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (user_a_id <> user_b_id),
      FOREIGN KEY (user_a_id) REFERENCES players(id) ON DELETE CASCADE,
      FOREIGN KEY (user_b_id) REFERENCES players(id) ON DELETE CASCADE,
      UNIQUE (pair_key)
    )
  `);

  await run(`CREATE INDEX IF NOT EXISTS idx_friendships_user_a ON friendships (user_a_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_friendships_user_b ON friendships (user_b_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_friendships_status ON friendships (status)`);

  await run(`
    CREATE TABLE IF NOT EXISTS direct_messages (
      id BIGSERIAL PRIMARY KEY,
      sender_id TEXT NOT NULL,
      recipient_id TEXT NOT NULL,
      conversation_id TEXT GENERATED ALWAYS AS (
        CASE
          WHEN sender_id < recipient_id THEN sender_id || ':' || recipient_id
          ELSE recipient_id || ':' || sender_id
        END
      ) STORED NOT NULL,
      body_original TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      delivered_at TIMESTAMPTZ,
      read_at TIMESTAMPTZ,
      blocked_at TIMESTAMPTZ,
      CHECK (sender_id <> recipient_id),
      FOREIGN KEY (sender_id) REFERENCES players(id) ON DELETE CASCADE,
      FOREIGN KEY (recipient_id) REFERENCES players(id) ON DELETE CASCADE
    )
  `);

  await run(`CREATE INDEX IF NOT EXISTS idx_dm_conversation_created_at ON direct_messages (conversation_id, created_at DESC)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_dm_sender_created_at ON direct_messages (sender_id, created_at DESC)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_dm_recipient_created_at ON direct_messages (recipient_id, created_at DESC)`);

  // ---------- Conteúdo (pipeline) ----------
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
      attack_range INTEGER,
      aggro_range INTEGER,
      attack_ms INTEGER,
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
    ALTER TABLE monsters_master
      ADD COLUMN IF NOT EXISTS attack_range INTEGER,
      ADD COLUMN IF NOT EXISTS aggro_range INTEGER,
      ADD COLUMN IF NOT EXISTS attack_ms INTEGER
  `);

  // === items_master: preparado para YAML ===
  await run(`
    CREATE TABLE IF NOT EXISTS items_master (
      id SERIAL PRIMARY KEY,
      key TEXT UNIQUE,
      -- jsonb para metadados (ex.: { icon, slots, stackable, ... })
      "dataJSON" JSONB DEFAULT '{}'::jsonb,
      -- colunas planas úteis para consultas/UI
      name TEXT,
      kind TEXT,
      slot TEXT,
      sprite TEXT,
      weapon_type TEXT,
      atk INTEGER,
      def INTEGER,
      slots INTEGER,
      stackable BOOLEAN,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  // Caso exista como TEXT em algum ambiente, converte pra JSONB
  await run(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_name='items_master'
           AND column_name='dataJSON'
           AND data_type <> 'jsonb'
      ) THEN
        ALTER TABLE items_master
        ALTER COLUMN "dataJSON" TYPE jsonb USING "dataJSON"::jsonb;
      END IF;
    END$$;
  `);

  // Trigger: sempre que dataJSON tiver "icon", espelha em sprite (ajuda a UI)
  await run(`
    CREATE OR REPLACE FUNCTION items_master_sync_sprite()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW."dataJSON" ? 'icon' THEN
        NEW.sprite := COALESCE(NEW.sprite, NEW."dataJSON"->>'icon');
      END IF;
      RETURN NEW;
    END$$;
  `);

  await run(`
    DROP TRIGGER IF EXISTS trg_items_master_sync_sprite ON items_master;
    CREATE TRIGGER trg_items_master_sync_sprite
      BEFORE INSERT OR UPDATE OF "dataJSON"
      ON items_master
      FOR EACH ROW
      EXECUTE FUNCTION items_master_sync_sprite();
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
      "leashPx" INTEGER,
      FOREIGN KEY (mapKey) REFERENCES maps(key)
    )
  `);

  await run(`ALTER TABLE spawns ADD COLUMN IF NOT EXISTS "leashPx" INTEGER`);

  await run(`
    CREATE TABLE IF NOT EXISTS hero_last_pos (
      hero_id TEXT PRIMARY KEY,
      map_key TEXT NOT NULL,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  await run(`CREATE INDEX IF NOT EXISTS idx_hero_last_pos_map ON hero_last_pos(map_key)`);

    // ---------- Loot (map_loot) ----------
  await run(`
    CREATE TABLE IF NOT EXISTS map_loot (
      id TEXT PRIMARY KEY,
      "mapKey" TEXT NOT NULL,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      "itemsJSON" JSONB NOT NULL DEFAULT '[]'::jsonb,
      expires_at TIMESTAMPTZ DEFAULT (now() + interval '2 minutes'),
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);


  // ---------- Chat ----------
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

  // ---------- AFK ----------
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

  // ---------- (Opcional) Infra de equipamento/inventário do jogo ----------
  await run(`
    CREATE TABLE IF NOT EXISTS hero_equipment (
      hero_id TEXT NOT NULL,
      slot TEXT NOT NULL,
      item_key TEXT,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      PRIMARY KEY (hero_id, slot)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS player_inventories (
      player_id TEXT NOT NULL,
      item_key TEXT NOT NULL,
      qty INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (player_id, item_key)
    )
  `);

  // ---------- Farm ----------
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
