-- 002_content.pg.sql  — Pipeline de conteúdo (YAML/Tiled)

-- Arquivos e checksum
CREATE TABLE IF NOT EXISTS content_files (
  path        TEXT PRIMARY KEY,
  checksum    TEXT NOT NULL,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Catálogo de monstros
CREATE TABLE IF NOT EXISTS monsters_master (
  id          BIGSERIAL PRIMARY KEY,
  key         TEXT UNIQUE,
  name        TEXT,
  xp          INT,
  healthMax   INT,
  speed       INT,
  flagsJSON   TEXT,
  elementsJSON TEXT,
  attacksJSON  TEXT,
  defensesJSON TEXT,
  lootJSON     TEXT,
  lookJSON     TEXT,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Itens
CREATE TABLE IF NOT EXISTS items_master (
  id          BIGSERIAL PRIMARY KEY,
  key         TEXT UNIQUE,
  dataJSON    TEXT,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Sprites
CREATE TABLE IF NOT EXISTS sprites_master (
  id          BIGSERIAL PRIMARY KEY,
  key         TEXT UNIQUE,
  kind        TEXT,
  dataJSON    TEXT,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Mapas & objetos/spawns
CREATE TABLE IF NOT EXISTS maps (
  key         TEXT PRIMARY KEY,
  dataJSON    TEXT,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS map_objects (
  id        BIGSERIAL PRIMARY KEY,
  mapKey    TEXT REFERENCES maps(key) ON DELETE CASCADE,
  type      TEXT,
  x         INT,
  y         INT,
  w         INT,
  h         INT,
  propsJSON TEXT
);

CREATE TABLE IF NOT EXISTS spawns (
  id          BIGSERIAL PRIMARY KEY,
  mapKey      TEXT REFERENCES maps(key) ON DELETE CASCADE,
  monsterKey  TEXT,
  x           INT,
  y           INT,
  w           INT,
  h           INT,
  count       INT,
  respawnSec  INT,
  levelMin    INT,
  levelMax    INT
);
