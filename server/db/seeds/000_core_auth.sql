-- =======================================================
-- 000_core_auth.pg.sql — base para auth/players/heróis
-- =======================================================

-- players (compatível com server/auth/routes.js)
CREATE TABLE IF NOT EXISTS players (
  id            UUID PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  coins         INTEGER NOT NULL DEFAULT 0,
  gems          INTEGER NOT NULL DEFAULT 0,
  createdAt     BIGINT NOT NULL
);

-- catálogo mínimo de heróis
CREATE TABLE IF NOT EXISTS heroes_master (
  heroKey      TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  rarity       TEXT NOT NULL,       -- COMMON / RARE / ...
  base_attack  INTEGER NOT NULL,
  base_defense INTEGER NOT NULL,
  base_speed   INTEGER NOT NULL
);

-- pelo menos 1 COMMON para o registro funcionar
INSERT INTO heroes_master (heroKey, name, rarity, base_attack, base_defense, base_speed)
VALUES ('starter_knight','Knight Recruit','COMMON',10,10,10)
ON CONFLICT (heroKey) DO NOTHING;

-- heróis do jogador (usado no /register)
CREATE TABLE IF NOT EXISTS player_heroes (
  id        UUID PRIMARY KEY,
  playerId  UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  heroKey   TEXT NOT NULL REFERENCES heroes_master(heroKey),
  name      TEXT NOT NULL,
  rarity    TEXT NOT NULL,
  attack    INTEGER NOT NULL,
  defense   INTEGER NOT NULL,
  speed     INTEGER NOT NULL,
  createdAt BIGINT NOT NULL
);
