-- 003_fix_columns_pg.sql
-- Corrige colunas camelCase/JSON para compatibilidade no Postgres (Neon)
-- Executa apenas se necessário; evita erro de "already exists"

DO $$
BEGIN
  -- monsters_master: healthMax
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='monsters_master' AND column_name='healthmax'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='monsters_master' AND column_name='healthMax'
  ) THEN
    ALTER TABLE monsters_master RENAME COLUMN healthmax TO "healthMax";
  END IF;

  -- items_master: dataJSON
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='items_master' AND column_name='datajson'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='items_master' AND column_name='dataJSON'
  ) THEN
    ALTER TABLE items_master RENAME COLUMN datajson TO "dataJSON";
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='items_master' AND column_name='dataJSON'
  ) THEN
    ALTER TABLE items_master ADD COLUMN "dataJSON" JSONB;
  END IF;

  -- sprites_master: dataJSON
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='sprites_master' AND column_name='datajson'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='sprites_master' AND column_name='dataJSON'
  ) THEN
    ALTER TABLE sprites_master RENAME COLUMN datajson TO "dataJSON";
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='sprites_master' AND column_name='dataJSON'
  ) THEN
    ALTER TABLE sprites_master ADD COLUMN "dataJSON" JSONB;
  END IF;

  -- maps: dataJSON
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='maps' AND column_name='datajson'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='maps' AND column_name='dataJSON'
  ) THEN
    ALTER TABLE maps RENAME COLUMN datajson TO "dataJSON";
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='maps' AND column_name='dataJSON'
  ) THEN
    ALTER TABLE maps ADD COLUMN "dataJSON" JSONB;
  END IF;

  -- map_objects: propsJSON
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='map_objects' AND column_name='propsjson'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='map_objects' AND column_name='propsJSON'
  ) THEN
    ALTER TABLE map_objects RENAME COLUMN propsjson TO "propsJSON";
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='map_objects' AND column_name='propsJSON'
  ) THEN
    ALTER TABLE map_objects ADD COLUMN "propsJSON" JSONB;
  END IF;

  -- content_files: checksum
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='content_files' AND column_name='checksum'
  ) THEN
    ALTER TABLE content_files ADD COLUMN checksum TEXT;
  END IF;
END $$;
