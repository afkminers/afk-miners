// server/models/db.js
require('dotenv').config();
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('[DB] Faltou a variável de ambiente DATABASE_URL (Neon).');
  process.exit(1);
}

// Lazy pool initialization to support reconnection after idle close
let pool = null;

function getPool() {
  if (!pool) {
    console.log('[DB] initializing new pool connection');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
    try {
      const u = new URL(process.env.DATABASE_URL);
      console.log(`[DB] pool ready → host=${u.hostname} db=${u.pathname.replace('/', '')}`);
    } catch {
      console.log('[DB] pool ready (DATABASE_URL parse)');
    }
  }
  return pool;
}

// Helpers unificados
async function all(q, params = []) {
  const { rows } = await getPool().query(q, params);
  return rows;
}

async function get(q, params = []) {
  const { rows } = await getPool().query(q, params);
  return rows[0] || null;
}

/**
 * run: para INSERT/UPDATE/DELETE (ou DDL).
 * Se precisar do ID recém-criado, use "RETURNING id" no SQL
 * e leia de res.rows[0].id.
 */
async function run(q, params = []) {
  const res = await getPool().query(q, params);
  return res;
}

async function closePool() {
  if (pool) {
    console.log('[DB] closing pool for idle management');
    try {
      await pool.end();
      pool = null;
    } catch (error) {
      console.warn('[DB] error closing pool:', error.message);
    }
  }
}

// Encerramento gracioso
const shutdown = async () => {
  if (pool) {
    try { await pool.end(); } catch {}
  }
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = { pool: getPool, getPool, all, get, run, closePool };