-- Gera níveis 1..120 e o número de "tries" necessários por nível/skill
WITH RECURSIVE lv(level) AS (
  SELECT 1
  UNION ALL
  SELECT level + 1 FROM lv WHERE level < 120
),
skills(skill_type) AS (
  SELECT 'SWORD'
  UNION ALL SELECT 'AXE'
  UNION ALL SELECT 'CLUB'
  UNION ALL SELECT 'DISTANCE'
  UNION ALL SELECT 'SHIELD'
  UNION ALL SELECT 'MAGIC'
)
INSERT INTO skill_curves (skill_type, level, tries_needed)
SELECT
  skills.skill_type,
  lv.level,
  CAST(ROUND(50 * lv.level + (lv.level * lv.level * 2.2)) AS INTEGER) AS tries_needed
FROM skills
CROSS JOIN lv;
