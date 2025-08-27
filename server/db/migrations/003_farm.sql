CREATE TABLE IF NOT EXISTS farm_plots (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  -- posição opcional (se quiser desenhar no mapa/ilha)
  x INTEGER DEFAULT 0,
  y INTEGER DEFAULT 0,

  crop_key TEXT,                -- null = vazio
  stage INTEGER DEFAULT 0,      -- 0 = vazio, 1..N = estágios
  planted_at TEXT,              -- ISO utc "YYYY-MM-DD HH:MM:SS"
  next_at TEXT,                 -- quando vira pro próximo estágio

  created_at TEXT DEFAULT (datetime('now'))
);
