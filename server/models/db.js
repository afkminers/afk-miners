// server/models/db.js
require('dotenv').config();
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('[DB] Missing DATABASE_URL. Set your Neon connection string (use -pooler).');
  process.exit(1);
}

let pool = null;

function getPool() {
  if (!pool) {
    const max = Number(process.env.PG_POOL_MAX ?? process.env.PGPOOL_MAX ?? 8);
    const connTimeout = Number(process.env.PG_CONNECTION_TIMEOUT ?? 5000);
    const idleTimeout = Number(process.env.PG_IDLE ?? 30000);

    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: true }, // Neon has a valid cert; strict SSL
      max,
      connectionTimeoutMillis: connTimeout,
      idleTimeoutMillis: idleTimeout,
      allowExitOnIdle: false,
    });

    pool.on('connect', (client) => {
      client.query(`
        SET statement_timeout = '15s';
        SET idle_in_transaction_session_timeout = '10s';
      `).catch((e) => {
        console.warn('[DB] failed to set session timeouts:', e.message);
      });
    });

    try {
      const u = new URL(process.env.DATABASE_URL);
      console.log(`[DB] pool ready -> host=${u.hostname} db=${u.pathname.replace('/', '')} max=${max}`);
      
      // Warn if not using Neon pooler endpoint for cost optimization
      if (u.hostname.includes('neon') && !u.hostname.includes('-pooler')) {
        console.warn('[DB] ⚠️  Consider using Neon pooler endpoint (add "-pooler" to hostname) for better connection management and cost optimization');
        console.warn('[DB] Example: ep-xxx-pooler.region.aws.neon.tech instead of ep-xxx.region.aws.neon.tech');
      }
    } catch {
      console.log('[DB] pool ready.');
    }
  }
  return pool;
}

// Query helpers (keep existing API)
async function all(q, params = []) {
  const { rows } = await getPool().query(q, params);
  return rows;
}

async function get(q, params = []) {
  const { rows } = await getPool().query(q, params);
  return rows[0] || null;
}

/**
 * run: for INSERT/UPDATE/DELETE/DDL.
 * Use "RETURNING id" if you need the created id from res.rows[0].id.
 */
async function run(q, params = []) {
  return await getPool().query(q, params);
}

async function closePool() {
  if (pool) {
    console.log('[DB] closing pool (idle management)');
    try {
      await pool.end();
    } catch (e) {
      console.warn('[DB] error closing pool:', e.message);
    } finally {
      pool = null;
    }
  }
}

const shutdown = async () => {
  try { await closePool(); } catch {}
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Keep backward compatibility
module.exports = { pool: getPool, getPool, all, get, run, closePool };