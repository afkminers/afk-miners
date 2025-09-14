-- /server/db/migrations/014_add_hp_columns.sql
-- Idempotente: adiciona hp e max_hp se não existirem e faz backfill.

ALTER TABLE player_heroes ADD COLUMN IF NOT EXISTS hp INT;
ALTER TABLE player_heroes ADD COLUMN IF NOT EXISTS max_hp INT;

-- LEGADO: Antes usava cálculo fixo; agora campos são populados dinamicamente via backend (classes/class_level_gains)
-- Se quiser garantir que não haja null, pode fazer um backfill mínimo:
UPDATE player_heroes
SET max_hp = COALESCE(max_hp, 1),
    hp = COALESCE(hp, 1)
WHERE max_hp IS NULL OR hp IS NULL;

-- (Depois de validar que todos registros têm valores)
-- ALTER TABLE player_heroes ALTER COLUMN hp SET NOT NULL;
-- ALTER TABLE player_heroes ALTER COLUMN max_hp SET NOT NULL;
-- ALTER TABLE player_heroes ADD CONSTRAINT player_heroes_hp_check
--   CHECK (hp >= 0 AND max_hp >= 1 AND hp <= max_hp);
-- CREATE INDEX IF NOT EXISTS idx_player_heroes_playerId ON player_heroes("playerId");