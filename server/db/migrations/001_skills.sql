-- Tabelas-base para o pacote de skills
-- 1) Curvas de dificuldade por skill (fonte: CSV; mas ter a tabela facilita consultas)
CREATE TABLE IF NOT EXISTS skill_curves (
  skill_type VARCHAR(24) NOT NULL,
  -- 'SWORD','AXE','CLUB','DISTANCE','SHIELD','MAGIC'
  level INTEGER NOT NULL,
  -- nível alvo (ex.: precisa de X tries para ir do 14→15)
  tries_needed INTEGER NOT NULL,
  -- número de tries requeridos
  PRIMARY KEY (skill_type, level)
);

-- 2) Multiplicadores por CLASSE (define o "quem treina o quê" melhor/pior)
CREATE TABLE IF NOT EXISTS class_skill_rates (
  class VARCHAR(32) NOT NULL,
  -- ex.: 'warrior','ranger','mage','guardian',...
  skill_type VARCHAR(24) NOT NULL,
  rate REAL NOT NULL DEFAULT 1.0,
  -- >1 facilita treinar; <1 dificulta
  PRIMARY KEY (class, skill_type)
);

-- 3) Mapa de tipo de ARMA → skill treinada
CREATE TABLE IF NOT EXISTS weapon_skill_map (
  weapon_type VARCHAR(32) PRIMARY KEY,
  -- ex.: 'sword','axe','daggers','bow','mace_shield',...
  skill_type VARCHAR(24) NOT NULL -- SWORD/AXE/CLUB/DISTANCE/MAGIC
);

-- 4) Progresso de skill por JOGADOR+HERÓI
CREATE TABLE IF NOT EXISTS player_hero_skills (
  player_id INTEGER NOT NULL,
  hero_id INTEGER NOT NULL,
  skill_type VARCHAR(24) NOT NULL,
  level INTEGER NOT NULL DEFAULT 10,
  -- ponto de partida (ajustável)
  tries INTEGER NOT NULL DEFAULT 0,
  -- tries acumulados no nível atual
  need INTEGER NOT NULL,
  -- tries_needed do nível atual (cacheado p/ performance)
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (player_id, hero_id, skill_type)
);

-- 5) Energia/stamina de treino do herói (sem energia, não progride)
CREATE TABLE IF NOT EXISTS hero_training (
  hero_id INTEGER PRIMARY KEY,
  energy_current REAL NOT NULL DEFAULT 0,
  energy_max REAL NOT NULL DEFAULT 100,
  last_refill_ts TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Índices úteis
CREATE INDEX IF NOT EXISTS idx_phs_player ON player_hero_skills (player_id);

CREATE INDEX IF NOT EXISTS idx_phs_hero ON player_hero_skills (hero_id);