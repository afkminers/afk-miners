-- Inventory do player (agrupado por item)
CREATE TABLE IF NOT EXISTS player_inventories (
  player_id   TEXT NOT NULL,
  item_key    TEXT NOT NULL REFERENCES items_master(key) ON UPDATE CASCADE,
  qty         INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (player_id, item_key)
);
