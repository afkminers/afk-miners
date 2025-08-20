DROP TABLE IF EXISTS hero_training;

CREATE TABLE hero_training (
  hero_id         INTEGER     PRIMARY KEY,               -- id do herói (player_heroes.id se quiser)
  skill_type      VARCHAR(24) NOT NULL,                  -- SWORD / AXE / ...
  status          TEXT        NOT NULL DEFAULT 'STOPPED',-- RUNNING|STOPPED
  started_at      TEXT,                                  -- ISO
  last_tick_at    TEXT,                                  -- ISO
  energy_spent    REAL        NOT NULL DEFAULT 0,
  session_seconds INTEGER     NOT NULL DEFAULT 0,
  notes           TEXT                                       -- JSON { heroClass: "MAGE" }
);
