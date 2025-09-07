-- Armas iniciais
INSERT INTO items_master(key, name, slot, weapon_type, atk, def, sprite)
VALUES
  ('bronze_sword', 'Bronze Sword', 'WEAPON', 'SWORD',    1, 0, 'items/bronze_sword.png')
ON CONFLICT (key) DO NOTHING;

INSERT INTO items_master(key, name, slot, weapon_type, atk, def, sprite)
VALUES
  ('short_bow', 'Short Bow', 'WEAPON', 'DISTANCE', 1, 0, 'items/short_bow.png')
ON CONFLICT (key) DO NOTHING;

INSERT INTO items_master(key, name, slot, weapon_type, atk, def, sprite)
VALUES
  ('oak_staff', 'Oak Staff', 'WEAPON', 'MAGIC',    1, 0, 'items/oak_staff.png')
ON CONFLICT (key) DO NOTHING;
