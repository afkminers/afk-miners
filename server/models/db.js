// server/models/db.js
require('dotenv').config();
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('[DB] Faltou a variável de ambiente DATABASE_URL (Neon).');
  process.exit(1);
}

// Pool PG (Neon requer SSL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Helpers unificados (mantêm a mesma “cara” usada no projeto)
async function all(q, params = []) {
  const { rows } = await pool.query(q, params);
  return rows;
}

async function get(q, params = []) {
  const { rows } = await pool.query(q, params);
  return rows[0] || null;
}

/**
 * run: para INSERT/UPDATE/DELETE (ou DDL).
 * Se precisar do ID recém-criado, use "RETURNING id" no SQL
 * e leia de res.rows[0].id.
 */
async function run(q, params = []) {
  const res = await pool.query(q, params);
  return res; // { rowCount, rows, ... }
}

// Logs bonitinhos
try {
  const u = new URL(process.env.DATABASE_URL);
  console.log(`[DB] PG conectado → ${u.hostname}/${u.pathname.replace('/', '')}`);
} catch {
  console.log('[DB] PG conectado (DATABASE_URL detectada)');
}

// Encerramento gracioso
const shutdown = async () => {
  try { await pool.end(); } catch {}
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = { pool, all, get, run };
