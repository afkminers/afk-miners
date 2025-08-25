require('dotenv').config();
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// usa DB_PATH da env ou fallback para ./data/database.sqlite
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'database.sqlite');
console.log('[db] using DB_PATH =', DB_PATH);

// garante que a pasta existe (opcional, útil localmente)
try {
  const fs = require('fs');
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
} catch (e) {
  console.warn('[db] failed to ensure DB dir', e && e.message);
}

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) { console.error('DB open err', err); throw err; }
  // melhorar concorrência e evitar SQLITE_BUSY
  try { db.run('PRAGMA journal_mode = WAL;'); } catch(e){ console.warn('PRAGMA WAL failed', e); }
  try { db.run('PRAGMA busy_timeout = 5000;'); } catch(e){ console.warn('PRAGMA busy_timeout failed', e); }

  // garantir tabela player_positions
  const createSql = `
    CREATE TABLE IF NOT EXISTS player_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playerId TEXT NOT NULL,
      mapKey TEXT NOT NULL,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      updated_at TEXT DEFAULT (CURRENT_TIMESTAMP),
      UNIQUE(playerId, mapKey)
    );
  `;
  db.run(createSql, (err2) => {
    if (err2) console.error('Failed to ensure player_positions table', err2);
    else console.log('player_positions table ready');
  });
});

const all = (q, p = []) => new Promise((res, rej) => db.all(q, p, (e, r) => e ? rej(e) : res(r)));
const get = (q, p = []) => new Promise((res, rej) => db.get(q, p, (e, r) => e ? rej(e) : res(r)));
const run = (q, p = []) => new Promise((res, rej) => db.run(q, p, function (e) { e ? rej(e) : res(this); }));

module.exports = { db, all, get, run };
