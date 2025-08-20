-- Multiplicadores por CLASSE (ajuste livre)
-- 1.0 = padrão; >1 treina mais rápido; <1 mais lento
INSERT OR REPLACE INTO class_skill_rates (class, skill_type, rate) VALUES
-- melee
('warrior',   'SWORD',1.20),('warrior','AXE',1.10),('warrior','CLUB',1.00),('warrior','DISTANCE',0.40),('warrior','MAGIC',0.15),('warrior','SHIELD',1.20),
('guardian',  'SWORD',0.90),('guardian','AXE',1.00),('guardian','CLUB',1.00),('guardian','DISTANCE',0.40),('guardian','MAGIC',0.20),('guardian','SHIELD',1.40),
('barbarian', 'SWORD',0.90),('barbarian','AXE',1.30),('barbarian','CLUB',1.20),('barbarian','DISTANCE',0.40),('barbarian','MAGIC',0.10),('barbarian','SHIELD',0.80),
('rogue',     'SWORD',0.90),('rogue','AXE',0.80),('rogue','CLUB',0.80),('rogue','DISTANCE',0.60),('rogue','MAGIC',0.30),('rogue','SHIELD',0.60),
-- distance/ranged
('ranger',    'SWORD',0.60),('ranger','AXE',0.60),('ranger','CLUB',0.60),('ranger','DISTANCE',1.20),('ranger','MAGIC',0.40),('ranger','SHIELD',0.70),
-- magic users (vão MUITO mal em melee)
('mage',      'SWORD',0.20),('mage','AXE',0.20),('mage','CLUB',0.20),('mage','DISTANCE',0.30),('mage','MAGIC',1.20),('mage','SHIELD',0.50),
('archmage',  'SWORD',0.15),('archmage','AXE',0.15),('archmage','CLUB',0.15),('archmage','DISTANCE',0.30),('archmage','MAGIC',1.30),('archmage','SHIELD',0.50),
('cleric',    'SWORD',0.50),('cleric','AXE',0.50),('cleric','CLUB',0.60),('cleric','DISTANCE',0.40),('cleric','MAGIC',1.00),('cleric','SHIELD',0.80),
('druid',     'SWORD',0.40),('druid','AXE',0.40),('druid','CLUB',0.40),('druid','DISTANCE',0.50),('druid','MAGIC',1.10),('druid','SHIELD',0.70),
('necromancer','SWORD',0.20),('necromancer','AXE',0.20),('necromancer','CLUB',0.20),('necromancer','DISTANCE',0.30),('necromancer','MAGIC',1.20),('necromancer','SHIELD',0.50),
('angel',     'SWORD',0.70),('angel','AXE',0.70),('angel','CLUB',0.70),('angel','DISTANCE',0.60),('angel','MAGIC',1.00),('angel','SHIELD',0.90),
('summoner',  'SWORD',0.20),('summoner','AXE',0.20),('summoner','CLUB',0.20),('summoner','DISTANCE',0.30),('summoner','MAGIC',1.10),('summoner','SHIELD',0.50);

-- Mapa arma → skill treinada (pode crescer à vontade)
INSERT OR REPLACE INTO weapon_skill_map (weapon_type, skill_type) VALUES
('sword','SWORD'), ('greatsword','SWORD'), ('daggers','SWORD'),
('axe','AXE'),
('mace','CLUB'), ('hammer','CLUB'),
('mace_shield','CLUB'), ('hammer_shield','CLUB'),    -- arma treina CLUB; escudo treina SHIELD ao bloquear/levar hit
('bow','DISTANCE'), ('crossbow','DISTANCE'), ('spear','DISTANCE'), ('spear_shield','DISTANCE'),
('staff','MAGIC'), ('tome','MAGIC'), ('wand','MAGIC');
