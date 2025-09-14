-- Migration: Adiciona campos de vida, mana, xp, level e controle de morte aos heróis

ALTER TABLE player_heroes
  ADD COLUMN IF NOT EXISTS hp INTEGER DEFAULT 100,
  ADD COLUMN IF NOT EXISTS max_hp INTEGER DEFAULT 100,
  ADD COLUMN IF NOT EXISTS mana INTEGER DEFAULT 50,
  ADD COLUMN IF NOT EXISTS max_mana INTEGER DEFAULT 50,
  ADD COLUMN IF NOT EXISTS xp INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS level INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS alive BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS last_respawn_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS death_count INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS player_hero_skills (
  id SERIAL PRIMARY KEY,
  hero_id UUID NOT NULL,
  skill_type TEXT NOT NULL,
  level INT DEFAULT 10,
  tries_progress INT DEFAULT 0,
  UNIQUE(hero_id, skill_type)
);

CREATE TABLE IF NOT EXISTS xp_table (
  level INT PRIMARY KEY,
  xp_required BIGINT NOT NULL
);

INSERT INTO xp_table (level, xp_required) VALUES
  (1, 0),
  (2, 100),
  (3, 300),
  (4, 600),
  (5, 1000)
ON CONFLICT (level) DO NOTHING;