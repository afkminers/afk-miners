-- 001_skill_maps.sql  (PostgreSQL)

BEGIN;

-- ======================================================
-- Tabelas (criadas se não existirem)
-- ======================================================

-- Taxas por classe x skill
CREATE TABLE IF NOT EXISTS class_skill_rates (
  class       TEXT NOT NULL,
  skill_type  TEXT NOT NULL,
  rate        NUMERIC NOT NULL DEFAULT 1.0,
  PRIMARY KEY (class, skill_type)
);

-- Mapa: tipo de arma -> skill treinada
CREATE TABLE IF NOT EXISTS weapon_skill_map (
  weapon_type TEXT PRIMARY KEY,
  skill_type  TEXT NOT NULL
);

-- ======================================================
-- Seed: CLASS → SKILL (idempotente)
-- (classes em UPPERCASE para casar com o código que usa .toUpperCase())
-- ======================================================
INSERT INTO class_skill_rates (class, skill_type, rate) VALUES
-- melee
('WARRIOR',   'SWORD',1.20), ('WARRIOR','AXE',1.10), ('WARRIOR','CLUB',1.00), ('WARRIOR','DISTANCE',0.40), ('WARRIOR','MAGIC',0.15), ('WARRIOR','SHIELD',1.20),
('GUARDIAN',  'SWORD',0.90), ('GUARDIAN','AXE',1.00), ('GUARDIAN','CLUB',1.00), ('GUARDIAN','DISTANCE',0.40), ('GUARDIAN','MAGIC',0.20), ('GUARDIAN','SHIELD',1.40),
('BARBARIAN', 'SWORD',0.90), ('BARBARIAN','AXE',1.30), ('BARBARIAN','CLUB',1.20), ('BARBARIAN','DISTANCE',0.40), ('BARBARIAN','MAGIC',0.10), ('BARBARIAN','SHIELD',0.80),
('ROGUE',     'SWORD',0.90), ('ROGUE','AXE',0.80),   ('ROGUE','CLUB',0.80),   ('ROGUE','DISTANCE',0.60),   ('ROGUE','MAGIC',0.30),   ('ROGUE','SHIELD',0.60),
-- distance/ranged
('RANGER',    'SWORD',0.60), ('RANGER','AXE',0.60),  ('RANGER','CLUB',0.60),  ('RANGER','DISTANCE',1.20),  ('RANGER','MAGIC',0.40),  ('RANGER','SHIELD',0.70),
-- magic users
('MAGE',      'SWORD',0.20), ('MAGE','AXE',0.20),    ('MAGE','CLUB',0.20),    ('MAGE','DISTANCE',0.30),    ('MAGE','MAGIC',1.20),    ('MAGE','SHIELD',0.50),
('ARCHMAGE',  'SWORD',0.15), ('ARCHMAGE','AXE',0.15),('ARCHMAGE','CLUB',0.15),('ARCHMAGE','DISTANCE',0.30),('ARCHMAGE','MAGIC',1.30),('ARCHMAGE','SHIELD',0.50),
('CLERIC',    'SWORD',0.50), ('CLERIC','AXE',0.50),  ('CLERIC','CLUB',0.60),  ('CLERIC','DISTANCE',0.40),  ('CLERIC','MAGIC',1.00),  ('CLERIC','SHIELD',0.80),
('DRUID',     'SWORD',0.40), ('DRUID','AXE',0.40),   ('DRUID','CLUB',0.40),   ('DRUID','DISTANCE',0.50),   ('DRUID','MAGIC',1.10),   ('DRUID','SHIELD',0.70),
('NECROMANCER','SWORD',0.20),('NECROMANCER','AXE',0.20),('NECROMANCER','CLUB',0.20),('NECROMANCER','DISTANCE',0.30),('NECROMANCER','MAGIC',1.20),('NECROMANCER','SHIELD',0.50),
('ANGEL',     'SWORD',0.70), ('ANGEL','AXE',0.70),   ('ANGEL','CLUB',0.70),   ('ANGEL','DISTANCE',0.60),   ('ANGEL','MAGIC',1.00),   ('ANGEL','SHIELD',0.90),
('SUMMONER',  'SWORD',0.20), ('SUMMONER','AXE',0.20),('SUMMONER','CLUB',0.20),('SUMMONER','DISTANCE',0.30),('SUMMONER','MAGIC',1.10),('SUMMONER','SHIELD',0.50)
ON CONFLICT (class, skill_type)
DO UPDATE SET rate = EXCLUDED.rate;

-- ======================================================
-- Seed: WEAPON → SKILL (idempotente)
-- (arma em lowercase; seu código consulta com LOWER(...)=LOWER(?), então ok)
-- ======================================================
INSERT INTO weapon_skill_map (weapon_type, skill_type) VALUES
('sword','SWORD'), ('greatsword','SWORD'), ('daggers','SWORD'),
('axe','AXE'),
('mace','CLUB'), ('hammer','CLUB'),
('mace_shield','CLUB'), ('hammer_shield','CLUB'),   -- escudo treina SHIELD nos eventos de block
('bow','DISTANCE'), ('crossbow','DISTANCE'), ('spear','DISTANCE'), ('spear_shield','DISTANCE'),
('staff','MAGIC'), ('tome','MAGIC'), ('wand','MAGIC')
ON CONFLICT (weapon_type)
DO UPDATE SET skill_type = EXCLUDED.skill_type;

COMMIT;
