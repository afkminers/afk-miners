-- Items catalog
CREATE TABLE IF NOT EXISTS items_master (
  key         TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slot        TEXT NOT NULL,          -- AMULET|HELMET|BACKPACK|WEAPON|ARMOR|SHIELD|RING|LEGS|BOOTS
  weapon_type TEXT,                   -- SWORD|AXE|CLUB|DISTANCE|MAGIC (só para slot=WEAPON)
  atk         INTEGER DEFAULT 0,
  def         INTEGER DEFAULT 0,
  sprite      TEXT,                   -- caminho/sprite key (opcional)
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Índice para buscar armas por tipo
CREATE INDEX IF NOT EXISTS idx_items_master_slot ON items_master(slot);
