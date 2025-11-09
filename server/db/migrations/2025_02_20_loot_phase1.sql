-- 2025_02_20_loot_phase1.sql
-- Adds persistent monster corpses and ground items for loot system phase 1.

CREATE TABLE IF NOT EXISTS monster_corpses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  monster_instance_id UUID,
  monster_key TEXT,
  monster_name TEXT,
  map_key TEXT NOT NULL,
  tile_x INTEGER NOT NULL,
  tile_y INTEGER NOT NULL,
  pos_x INTEGER,
  pos_y INTEGER,
  owner_player_id TEXT,
  owner_hero_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  is_open BOOLEAN NOT NULL DEFAULT FALSE,
  is_fully_looted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_monster_corpses_map ON monster_corpses(map_key);
CREATE INDEX IF NOT EXISTS idx_monster_corpses_owner ON monster_corpses(owner_player_id);
CREATE INDEX IF NOT EXISTS idx_monster_corpses_expires_at ON monster_corpses(expires_at);

CREATE TABLE IF NOT EXISTS monster_corpse_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  corpse_id UUID NOT NULL REFERENCES monster_corpses(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL REFERENCES items_master(key) ON UPDATE CASCADE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_corpse_items_corpse ON monster_corpse_items(corpse_id);

CREATE TABLE IF NOT EXISTS ground_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  map_key TEXT NOT NULL,
  tile_x INTEGER NOT NULL,
  tile_y INTEGER NOT NULL,
  item_key TEXT NOT NULL REFERENCES items_master(key) ON UPDATE CASCADE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  dropped_by_player_id TEXT,
  dropped_by_hero_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ground_items_map ON ground_items(map_key);
CREATE INDEX IF NOT EXISTS idx_ground_items_expires ON ground_items(expires_at);
