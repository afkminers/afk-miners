require('dotenv').config();
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) { console.error('DB open err', err); throw err; }
  // melhorar concorrência e evitar SQLITE_BUSY
  try { db.run('PRAGMA journal_mode = WAL;'); } catch(e){ console.warn('PRAGMA WAL failed', e); }
  try { db.run('PRAGMA busy_timeout = 5000;'); } catch(e){ console.warn('PRAGMA busy_timeout failed', e); }
});

const dbDir = path.join(__dirname, '..', 'db');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
const dbPath = path.join(dbDir, 'database.sqlite');

const all = (q, p = []) => new Promise((res, rej) => db.all(q, p, (e, r) => e ? rej(e) : res(r)));
const get = (q, p = []) => new Promise((res, rej) => db.get(q, p, (e, r) => e ? rej(e) : res(r)));
const run = (q, p = []) => new Promise((res, rej) => db.run(q, p, function (e) { e ? rej(e) : res(this); }));

module.exports = { db, all, get, run };
