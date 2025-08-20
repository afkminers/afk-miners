-- players (compatível com seu /auth/routes.js)
CREATE TABLE IF NOT EXISTS players (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  coins         INTEGER NOT NULL DEFAULT 0,
  gems          INTEGER NOT NULL DEFAULT 0,
  createdAt     INTEGER NOT NULL
);

-- catálogo mínimo para o starter
CREATE TABLE IF NOT EXISTS heroes_master (
  heroKey      TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  rarity       TEXT NOT NULL,       -- COMMON / RARE / ...
  base_attack  INTEGER NOT NULL,
  base_defense INTEGER NOT NULL,
  base_speed   INTEGER NOT NULL
);

-- pelo menos 1 COMMON para o registro funcionar
INSERT OR IGNORE INTO heroes_master
  (heroKey, name, rarity, base_attack, base_defense, base_speed)
VALUES
  ('starter_knight','Knight Recruit','COMMON',10,10,10);

-- heróis do jogador (usado no /register)
CREATE TABLE IF NOT EXISTS player_heroes (
  id        TEXT PRIMARY KEY,
  playerId  TEXT NOT NULL,
  heroKey   TEXT NOT NULL,
  name      TEXT NOT NULL,
  rarity    TEXT NOT NULL,
  attack    INTEGER NOT NULL,
  defense   INTEGER NOT NULL,
  speed     INTEGER NOT NULL,
  createdAt INTEGER NOT NULL
);
