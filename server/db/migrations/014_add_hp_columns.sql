-- 014_add_hp_columns.sql
-- Idempotente: adiciona hp e max_hp se não existirem e faz backfill.

ALTER TABLE player_heroes ADD COLUMN IF NOT EXISTS hp INT;
ALTER TABLE player_heroes ADD COLUMN IF NOT EXISTS max_hp INT;

UPDATE player_heroes
SET max_hp = 100 + GREATEST(level-1,0)*5 + defense*2,
    hp = COALESCE(hp, 100 + GREATEST(level-1,0)*5 + defense*2)
WHERE max_hp IS NULL;

-- (Depois de validar que todos registros têm valores)
-- ALTER TABLE player_heroes ALTER COLUMN hp SET NOT NULL;
-- ALTER TABLE player_heroes ALTER COLUMN max_hp SET NOT NULL;
-- ALTER TABLE player_heroes ADD CONSTRAINT player_heroes_hp_check
--   CHECK (hp >= 0 AND max_hp >= 1 AND hp <= max_hp);
-- CREATE INDEX IF NOT EXISTS idx_player_heroes_playerId ON player_heroes("playerId");