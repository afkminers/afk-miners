-- server/db/seeds/002_skill_curves.sql  (PostgreSQL)

BEGIN;

-- Tabela (idempotente)
CREATE TABLE IF NOT EXISTS skill_curves (
  skill_type TEXT NOT NULL,
  level      INTEGER NOT NULL,
  tries_needed INTEGER NOT NULL,
  PRIMARY KEY (skill_type, level)
);

-- Seed idempotente (gera níveis 1..120 para cada skill)
WITH skills(skill_type) AS (
  VALUES ('SWORD'), ('AXE'), ('CLUB'), ('DISTANCE'), ('SHIELD'), ('MAGIC')
),
lv(level) AS (
  SELECT generate_series(1, 120)
)
INSERT INTO skill_curves (skill_type, level, tries_needed)
SELECT
  s.skill_type,
  lv.level,
  ROUND(50 * lv.level + (lv.level * lv.level * 2.2))::int AS tries_needed
FROM skills s
CROSS JOIN lv
ON CONFLICT (skill_type, level)
DO UPDATE SET tries_needed = EXCLUDED.tries_needed;

COMMIT;
