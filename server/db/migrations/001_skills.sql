-- 001_skills.pg.sql  — Skills & Training (PostgreSQL)

-- 1) Curvas de dificuldade
CREATE TABLE IF NOT EXISTS skill_curves (
  skill_type     VARCHAR(24) NOT NULL,   -- 'SWORD','AXE','CLUB','DISTANCE','SHIELD','MAGIC'
  level          INT NOT NULL,           -- nível alvo (ex.: 14->15)
  tries_needed   INT NOT NULL,           -- tentativas necessárias
  PRIMARY KEY (skill_type, level)
);

-- 2) Multiplicadores por classe
CREATE TABLE IF NOT EXISTS class_skill_rates (
  class       VARCHAR(32) NOT NULL,      -- 'WARRIOR','RANGER','MAGE','GUARDIAN', etc (use uppercase no seed)
  skill_type  VARCHAR(24) NOT NULL,
  rate        DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  PRIMARY KEY (class, skill_type)
);

-- 3) Mapa arma -> tipo de skill (case-insensitive)
-- Se quiser citext: weapon_type CITEXT UNIQUE
CREATE TABLE IF NOT EXISTS weapon_skill_map (
  weapon_type   TEXT NOT NULL,
  skill_type    VARCHAR(24) NOT NULL,
  PRIMARY KEY (weapon_type)
);
-- Acesso eficiente por lower(weapon_type)
CREATE UNIQUE INDEX IF NOT EXISTS uq_weapon_skill_map_lower
  ON weapon_skill_map (LOWER(weapon_type));

-- 4) Skills do herói por jogador
-- hero_id e player_id vêm do app (UUID) — sem DEFAULT
CREATE TABLE IF NOT EXISTS player_hero_skills (
  player_id       UUID NOT NULL,
  hero_id         UUID NOT NULL,
  skill_type      VARCHAR(24) NOT NULL,
  level           INT NOT NULL DEFAULT 1,
  tries_progress  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, hero_id, skill_type)
);
CREATE INDEX IF NOT EXISTS idx_phs_player ON player_hero_skills (player_id);
CREATE INDEX IF NOT EXISTS idx_phs_hero   ON player_hero_skills (hero_id);

-- 5) Sessões de treino / stamina (usado pelo worker + rotas /training)
-- Este schema casa com server/index.js e routes de treinamento
CREATE TABLE IF NOT EXISTS hero_training (
  hero_id         UUID PRIMARY KEY,
  skill_type      VARCHAR(24),                       -- última/atual
  status          TEXT,                              -- RUNNING | STOPPED | IDLE
  started_at      TIMESTAMP,                         -- início da sessão atual
  last_tick_at    TIMESTAMP,                         -- último processamento
  energy_current  DOUBLE PRECISION DEFAULT 0,
  energy_max      DOUBLE PRECISION DEFAULT 100,
  energy_spent    DOUBLE PRECISION DEFAULT 0,
  session_seconds INT DEFAULT 0,                     -- acumulado na sessão atual
  daily_seconds   INT DEFAULT 0,                     -- acumulado no dia
  daily_reset_at  TIMESTAMP,                         -- quando reseta daily_seconds
  notes           TEXT                               -- JSON textual (ex.: {"heroClass":"KNIGHT"})
);
CREATE INDEX IF NOT EXISTS idx_ht_status ON hero_training (status);
