-- 020_progression.pg.sql
CREATE TABLE IF NOT EXISTS xp_curves (
  level INTEGER PRIMARY KEY,
  xp_to_next INTEGER NOT NULL
);
WITH levels AS (SELECT generate_series(1,200) AS lvl)
INSERT INTO xp_curves (level, xp_to_next)
SELECT lvl, (25 * (lvl * lvl))::int FROM levels
ON CONFLICT (level) DO UPDATE
SET xp_to_next = EXCLUDED.xp_to_next
WHERE xp_curves.xp_to_next IS DISTINCT FROM EXCLUDED.xp_to_next;

CREATE TABLE IF NOT EXISTS class_level_gains (
  class TEXT NOT NULL,
  level INTEGER NOT NULL,
  hp_gain INTEGER NOT NULL,
  mana_gain INTEGER NOT NULL,
  PRIMARY KEY (class, level)
);

WITH lvls AS (SELECT generate_series(2,200) AS lvl)
INSERT INTO class_level_gains (class, level, hp_gain, mana_gain)
SELECT 'KNIGHT', lvl, 20, 3 FROM lvls
ON CONFLICT (class, level) DO UPDATE SET hp_gain=EXCLUDED.hp_gain, mana_gain=EXCLUDED.mana_gain;

WITH lvls AS (SELECT generate_series(2,200) AS lvl)
INSERT INTO class_level_gains (class, level, hp_gain, mana_gain)
SELECT 'RANGER', lvl, 13, 7 FROM lvls
ON CONFLICT (class, level) DO UPDATE SET hp_gain=EXCLUDED.hp_gain, mana_gain=EXCLUDED.mana_gain;

WITH lvls AS (SELECT generate_series(2,200) AS lvl)
INSERT INTO class_level_gains (class, level, hp_gain, mana_gain)
SELECT 'MAGE', lvl, 8, 12 FROM lvls
ON CONFLICT (class, level) DO UPDATE SET hp_gain=EXCLUDED.hp_gain, mana_gain=EXCLUDED.mana_gain;

WITH lvls AS (SELECT generate_series(2,200) AS lvl)
INSERT INTO class_level_gains (class, level, hp_gain, mana_gain)
SELECT 'GUARDIAN', lvl, 24, 2 FROM lvls
ON CONFLICT (class, level) DO UPDATE SET hp_gain=EXCLUDED.hp_gain, mana_gain=EXCLUDED.mana_gain;

CREATE TABLE IF NOT EXISTS hero_progress (
  hero_id TEXT PRIMARY KEY,
  level INTEGER NOT NULL DEFAULT 1,
  xp INTEGER NOT NULL DEFAULT 0,
  hp_max INTEGER NOT NULL DEFAULT 150,
  mana_max INTEGER NOT NULL DEFAULT 30,
  hp INTEGER NOT NULL DEFAULT 150,
  mana INTEGER NOT NULL DEFAULT 30,
  class TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_hero_progress_class ON hero_progress (class);
