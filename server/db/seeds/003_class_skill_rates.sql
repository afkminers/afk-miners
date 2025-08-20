INSERT INTO class_skill_rates (class, skill_type, rate) VALUES
  -- Knight-like
  ('KNIGHT','SWORD',    1.00),
  ('KNIGHT','AXE',      1.00),
  ('KNIGHT','CLUB',     1.00),
  ('KNIGHT','DISTANCE', 0.40),
  ('KNIGHT','SHIELD',   1.20),
  ('KNIGHT','MAGIC',    0.20),

  -- Paladin-like
  ('PALADIN','SWORD',    0.60),
  ('PALADIN','AXE',      0.60),
  ('PALADIN','CLUB',     0.60),
  ('PALADIN','DISTANCE', 1.10),
  ('PALADIN','SHIELD',   1.00),
  ('PALADIN','MAGIC',    0.50),

  -- Mage-like
  ('MAGE','SWORD',    0.30),
  ('MAGE','AXE',      0.30),
  ('MAGE','CLUB',     0.30),
  ('MAGE','DISTANCE', 0.50),
  ('MAGE','SHIELD',   0.50),
  ('MAGE','MAGIC',    1.20);
