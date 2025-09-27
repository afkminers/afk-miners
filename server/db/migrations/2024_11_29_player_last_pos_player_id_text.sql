-- Migration: change player_last_pos.player_id to TEXT to support UUID identifiers

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_name = 'player_last_pos'
       AND column_name = 'player_id'
       AND data_type <> 'text'
  ) THEN
    ALTER TABLE player_last_pos
      ALTER COLUMN player_id TYPE TEXT USING player_id::text;
  END IF;
END$$;
