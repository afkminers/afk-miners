-- 004_fix_spawns_mapobjects_pg.sql
-- Corrige nomes das colunas em spawns e map_objects para camelCase,
-- compatível com o código JS/Node.

-- ======================
-- Ajustes na tabela spawns
-- ======================
DO $$
BEGIN
    -- mapkey -> mapKey
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'spawns' AND column_name = 'mapkey'
    ) THEN
        EXECUTE 'ALTER TABLE spawns RENAME COLUMN mapkey TO "mapKey"';
    END IF;

    -- monsterkey -> monsterKey
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'spawns' AND column_name = 'monsterkey'
    ) THEN
        EXECUTE 'ALTER TABLE spawns RENAME COLUMN monsterkey TO "monsterKey"';
    END IF;
END $$;

-- ======================
-- Ajustes na tabela map_objects
-- ======================
DO $$
BEGIN
    -- mapkey -> mapKey
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'map_objects' AND column_name = 'mapkey'
    ) THEN
        EXECUTE 'ALTER TABLE map_objects RENAME COLUMN mapkey TO "mapKey"';
    END IF;
END $$;
