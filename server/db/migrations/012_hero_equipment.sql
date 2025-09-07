-- Equipamentos por herói
CREATE TABLE IF NOT EXISTS hero_equipment (
  hero_id     TEXT NOT NULL,
  slot        TEXT NOT NULL,             -- AMULET|HELMET|BACKPACK|WEAPON|ARMOR|SHIELD|RING|LEGS|BOOTS
  item_key    TEXT REFERENCES items_master(key) ON UPDATE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (hero_id, slot)
);

-- Garante que (hero_id, slot) é único
CREATE UNIQUE INDEX IF NOT EXISTS uq_hero_equipment ON hero_equipment(hero_id, slot);
