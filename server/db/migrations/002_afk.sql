CREATE TABLE IF NOT EXISTS afk_boxes (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  kind TEXT,
  level INTEGER DEFAULT 1,
  capacity INTEGER DEFAULT 9999,
  created_at DATETIME DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS afk_workers (
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

CREATE TABLE IF NOT EXISTS afk_inventories (
  player_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  amount INTEGER DEFAULT 0,
  PRIMARY KEY (player_id, item_type)
);
