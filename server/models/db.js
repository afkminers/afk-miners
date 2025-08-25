require('dotenv').config();
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const dbDir = path.join(__dirname, '..', 'db');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
const dbPath = path.join(dbDir, 'database.sqlite');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('Erro ao abrir banco:', err.message);
  else console.log('> DB em:', dbPath);
});
db.run('PRAGMA busy_timeout = 5000');
db.run('PRAGMA foreign_keys = ON');

const all = (q, p = []) => new Promise((res, rej) => db.all(q, p, (e, r) => e ? rej(e) : res(r)));
const get = (q, p = []) => new Promise((res, rej) => db.get(q, p, (e, r) => e ? rej(e) : res(r)));
const run = (q, p = []) => new Promise((res, rej) => db.run(q, p, function (e) { e ? rej(e) : res(this); }));

module.exports = { db, all, get, run };
