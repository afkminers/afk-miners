-- 003_farm.pg.sql  — Farming (plots)

-- App gera id string custom -> TEXT; player_id é UUID
CREATE TABLE IF NOT EXISTS farm_plots (
  id          TEXT PRIMARY KEY,
  player_id   UUID NOT NULL,
  x           INT DEFAULT 0,
  y           INT DEFAULT 0,

  crop_key    TEXT,                  -- null = vazio
  stage       INT  DEFAULT 0,        -- 0 = vazio; 1..N = estágios
  planted_at  TIMESTAMP,             -- quando plantou
  next_at     TIMESTAMP,             -- próximo estágio

  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_farm_plots_player ON farm_plots (player_id);
