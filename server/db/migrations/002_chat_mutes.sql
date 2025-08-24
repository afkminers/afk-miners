-- adiciona role na tabela players e tabela de mutes do chat
PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

-- adiciona coluna role se não existir (SQLite não tem IF NOT EXISTS para ALTER TABLE)
-- a forma segura: cria tabela temporária, copia, recria. Aqui vamos tentar um ALTER simples (se falhar, execute manualmente).
ALTER TABLE players ADD COLUMN role TEXT DEFAULT 'player';

CREATE TABLE IF NOT EXISTS chat_mutes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  targetId TEXT NOT NULL,
  byId TEXT NOT NULL,
  until INTEGER NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000)
);

COMMIT;