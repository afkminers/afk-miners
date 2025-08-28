-- 002_afk.pg.sql  — AFK (workers/boxes/inventory)

-- O app gera id como string custom para workers/boxes;
-- mantenho TEXT para compat. player_id é UUID (players.id).
CREATE TABLE IF NOT EXISTS afk_boxes (
  id          TEXT PRIMARY KEY,
  player_id   UUID NOT NULL,
  kind        TEXT,
  level       INT DEFAULT 1,
  capacity    INT DEFAULT 9999,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS afk_workers (
  id             TEXT PRIMARY KEY,
  player_id      UUID NOT NULL,
  name           TEXT,
  produce_type   TEXT NOT NULL,
  produce_amount INT  DEFAULT 1,
  rate_sec       INT  DEFAULT 10,
  assigned_box   TEXT,
  last_collected TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS afk_inventories (
  player_id  UUID NOT NULL,
  item_type  TEXT NOT NULL,
  amount     INT  DEFAULT 0,
  PRIMARY KEY (player_id, item_type)
);
