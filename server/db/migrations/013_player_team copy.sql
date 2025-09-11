-- Time do player (3 slots)
CREATE TABLE IF NOT EXISTS player_team (
  player_id   TEXT NOT NULL,
  slot        INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 3),
  hero_id     TEXT,                       -- pode ser NULL para "vazio"
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (player_id, slot)
);

-- Evita repetir o mesmo herói em 2 slots do mesmo player
CREATE UNIQUE INDEX IF NOT EXISTS uq_player_team_unique_hero
  ON player_team(player_id, hero_id) WHERE hero_id IS NOT NULL;
