-- 002_chat_mutes.pg.sql  — Players.role + Chat mutes

-- Adiciona coluna role em players (idempotente)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
      WHERE table_name='players' AND column_name='role'
  ) THEN
    ALTER TABLE players ADD COLUMN role TEXT DEFAULT 'player';
  END IF;
END$$;

-- Tabela de mutes
CREATE TABLE IF NOT EXISTS chat_mutes (
  id         BIGSERIAL PRIMARY KEY,
  targetId   UUID NOT NULL,                    -- jogador alvo
  byId       UUID NOT NULL,                    -- quem mutou
  until      BIGINT NOT NULL,                  -- epoch ms
  reason     TEXT,
  created_at BIGINT NOT NULL DEFAULT ((EXTRACT(EPOCH FROM NOW())*1000)::BIGINT)
);

-- Índices úteis
CREATE INDEX IF NOT EXISTS idx_chat_mutes_target ON chat_mutes (targetId);
CREATE INDEX IF NOT EXISTS idx_chat_mutes_until  ON chat_mutes (until);
