-- 999_drop_hero_training.pg.sql (opcional)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables 
             WHERE table_name = 'hero_training') THEN
    DROP TABLE hero_training;
  END IF;
END $$;
