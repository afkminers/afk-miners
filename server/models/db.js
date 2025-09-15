// server/models/db.js
require('dotenv').config();
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('[DB] Missing DATABASE_URL. Set your Neon connection string (use -pooler).');
  process.exit(1);
}

/** Utils de env com fallback e default */
function envInt(keys, def) {
  for (const k of Array.isArray(keys) ? keys : [keys]) {
    const v = process.env[k];
    if (v != null && v !== '' && !Number.isNaN(Number(v))) return Number(v);
  }
  return def;
}
function envBool(keys, def) {
  for (const k of Array.isArray(keys) ? keys : [keys]) {
    const v = process.env[k];
    if (v != null) return v === '1' || v === 'true';
  }
  return def;
}

let pool = null;

function buildPool() {
  // Compat com várias chaves de env que aparecem em projetos diferentes
  const max = envInt(['PG_POOL_MAX', 'PGPOOL_MAX'], 8);
  const connTimeout = envInt(
    ['PG_CONNECT_TIMEOUT_MS', 'PG_CONNECTION_TIMEOUT', 'PG_CONNECT_TIMEOUT', 'PG_CONNECTION_TIMEOUT_MS'],
    15000
  );
  const idleTimeout = envInt(['PG_IDLE_TIMEOUT_MS', 'PG_IDLE', 'PG_IDLE_MS'], 30000);

  // SSL: se PGSSLMODE=disable, desliga; caso contrário, mantém SSL.
  // Para Neon, o cert é válido; se tiver firewall/proxy em dev, troque rejectUnauthorized para false.
  const useSsl =
    process.env.PGSSLMODE && process.env.PGSSLMODE.toLowerCase() === 'disable'
      ? false
      : { rejectUnauthorized: true };

  const cfg = {
    connectionString: process.env.DATABASE_URL,
    ssl: useSsl,
    max,
    connectionTimeoutMillis: connTimeout,
    idleTimeoutMillis: idleTimeout,
    allowExitOnIdle: false,
    keepAlive: true, // ajuda em ambientes com NAT/idle
  };

  const p = new Pool(cfg);

  p.on('connect', (client) => {
    client
      .query(`
        SET statement_timeout = '15s';
        SET idle_in_transaction_session_timeout = '10s';
      `)
      .catch((e) => {
        console.warn('[DB] failed to set session timeouts:', e.message);
      });
  });

  p.on('error', (err) => {
    console.error('[DB] idle client error:', err?.message || err);
  });

  try {
    const u = new URL(process.env.DATABASE_URL);
    console.log(
      `[DB] pool ready -> host=${u.hostname} db=${(u.pathname || '').replace('/', '')} max=${cfg.max}`
    );
  } catch {
    console.log('[DB] pool ready.');
  }

  return p;
}

function getPool() {
  if (!pool) pool = buildPool();
  return pool;
}

/** Log do estado do pool (útil quando ocorrer timeout) */
function logPoolState(where) {
  const p = getPool();
  // totalCount: clientes ativos + idle
  // idleCount: clientes ociosos no pool
  // waitingCount: pedidos aguardando conexão
  console.warn(
    `[DB] ${where} -> total=${p.totalCount} idle=${p.idleCount} waiting=${p.waitingCount}`
  );
}

// Query helpers (API compatível)
async function all(q, params = []) {
  try {
    const { rows } = await getPool().query(q, params);
    return rows;
  } catch (e) {
    if ((e && /timeout/i.test(e.message)) || e?.code === 'ETIMEDOUT') {
      logPoolState('all() timeout');
    }
    throw e;
  }
}

async function get(q, params = []) {
  try {
    const { rows } = await getPool().query(q, params);
    return rows[0] || null;
  } catch (e) {
    if ((e && /timeout/i.test(e.message)) || e?.code === 'ETIMEDOUT') {
      logPoolState('get() timeout');
    }
    throw e;
  }
}

/**
 * run: for INSERT/UPDATE/DELETE/DDL.
 * Use "RETURNING id" if you need the created id from res.rows[0].id.
 */
async function run(q, params = []) {
  try {
    return await getPool().query(q, params);
  } catch (e) {
    if ((e && /timeout/i.test(e.message)) || e?.code === 'ETIMEDOUT') {
      logPoolState('run() timeout');
    }
    throw e;
  }
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
  try {
    await closePool();
  } catch {}
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Keep backward compatibility
module.exports = { pool: getPool, getPool, all, get, run, closePool };
