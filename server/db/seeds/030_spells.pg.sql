-- 030_spells.pg.sql
CREATE TABLE IF NOT EXISTS spells_master (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  min_magic_level INTEGER NOT NULL DEFAULT 1,
  mana_cost INTEGER NOT NULL DEFAULT 5,
  base_power INTEGER NOT NULL DEFAULT 12,
  scaling NUMERIC(6,3) NOT NULL DEFAULT 1.20,
  element TEXT NOT NULL DEFAULT 'ARCANE'
);

INSERT INTO spells_master (id, name, min_magic_level, mana_cost, base_power, scaling, element) VALUES
 ('spark','Spark',1,5,12,1.20,'ARCANE'),
 ('ice_shard','Ice Shard',5,12,24,1.15,'ICE'),
 ('fire_bolt','Fire Bolt',10,18,34,1.18,'FIRE')
ON CONFLICT (id) DO UPDATE
SET name=EXCLUDED.name,
    min_magic_level=EXCLUDED.min_magic_level,
    mana_cost=EXCLUDED.mana_cost,
    base_power=EXCLUDED.base_power,
    scaling=EXCLUDED.scaling,
    element=EXCLUDED.element;

CREATE TABLE IF NOT EXISTS class_spells (
  class TEXT NOT NULL,
  spell_id TEXT NOT NULL,
  PRIMARY KEY (class, spell_id)
);

INSERT INTO class_spells (class, spell_id) VALUES
 ('MAGE','spark'),('MAGE','ice_shard'),('MAGE','fire_bolt'),
 ('RANGER','spark'),
 ('KNIGHT','spark'),
 ('GUARDIAN','spark')
ON CONFLICT (class, spell_id) DO NOTHING;
