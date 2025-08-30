-- 010_skills_seed.pg.sql
CREATE TABLE IF NOT EXISTS skill_curves (
  skill_type TEXT NOT NULL,
  level INTEGER NOT NULL,
  tries_needed INTEGER NOT NULL,
  PRIMARY KEY (skill_type, level)
);

CREATE TABLE IF NOT EXISTS class_skill_rates (
  class TEXT NOT NULL,
  skill_type TEXT NOT NULL,
  rate NUMERIC(6,3) NOT NULL DEFAULT 1.0,
  PRIMARY KEY (class, skill_type)
);

CREATE TABLE IF NOT EXISTS weapon_skill_map (
  weapon_type TEXT PRIMARY KEY,
  skill_type  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_skill_curves_skill ON skill_curves (skill_type, level);
CREATE INDEX IF NOT EXISTS idx_class_skill_rates_class ON class_skill_rates (class, skill_type);

WITH levels AS (SELECT generate_series(1,120) AS lvl)
INSERT INTO skill_curves (skill_type, level, tries_needed)
SELECT s.skill_type, l.lvl, CEIL(8 * POWER(1.175, l.lvl - 1))::int
FROM (VALUES ('SWORD'),('AXE'),('CLUB'),('DISTANCE'),('SHIELD'),('MAGIC')) s(skill_type)
CROSS JOIN levels l
ON CONFLICT (skill_type, level) DO UPDATE
SET tries_needed = EXCLUDED.tries_needed
WHERE skill_curves.tries_needed IS DISTINCT FROM EXCLUDED.tries_needed;

DELETE FROM class_skill_rates WHERE class IN ('KNIGHT','RANGER','MAGE','GUARDIAN');

INSERT INTO class_skill_rates (class, skill_type, rate) VALUES
 ('KNIGHT','SWORD',1.200), ('KNIGHT','AXE',1.200), ('KNIGHT','CLUB',1.150), ('KNIGHT','DISTANCE',0.500), ('KNIGHT','SHIELD',1.300), ('KNIGHT','MAGIC',0.200),
 ('RANGER','SWORD',0.600), ('RANGER','AXE',0.600), ('RANGER','CLUB',0.600), ('RANGER','DISTANCE',1.300), ('RANGER','SHIELD',0.800), ('RANGER','MAGIC',0.600),
 ('MAGE','SWORD',0.300),   ('MAGE','AXE',0.300),   ('MAGE','CLUB',0.500),   ('MAGE','DISTANCE',0.700),   ('MAGE','SHIELD',0.500),   ('MAGE','MAGIC',1.400),
 ('GUARDIAN','SWORD',1.000),('GUARDIAN','AXE',0.900),('GUARDIAN','CLUB',0.900),('GUARDIAN','DISTANCE',0.500),('GUARDIAN','SHIELD',1.500),('GUARDIAN','MAGIC',0.400)
ON CONFLICT (class, skill_type) DO UPDATE SET rate=EXCLUDED.rate;

DELETE FROM weapon_skill_map WHERE weapon_type IN (
 'sword','longsword','rapier','sabre','dagger',
 'axe','battleaxe','hatchet',
 'club','mace','hammer','staff',
 'bow','crossbow','spear','javelin','throwing_knife',
 'wand','rod','tome','shield'
);

INSERT INTO weapon_skill_map (weapon_type, skill_type) VALUES
 ('sword','SWORD'), ('longsword','SWORD'), ('rapier','SWORD'), ('sabre','SWORD'), ('dagger','SWORD'),
 ('axe','AXE'), ('battleaxe','AXE'), ('hatchet','AXE'),
 ('club','CLUB'), ('mace','CLUB'), ('hammer','CLUB'), ('staff','CLUB'),
 ('bow','DISTANCE'), ('crossbow','DISTANCE'), ('spear','DISTANCE'), ('javelin','DISTANCE'), ('throwing_knife','DISTANCE'),
 ('wand','MAGIC'), ('rod','MAGIC'), ('tome','MAGIC'),
 ('shield','SHIELD')
ON CONFLICT (weapon_type) DO UPDATE SET skill_type = EXCLUDED.skill_type;
