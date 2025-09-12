// server/models/db.js
// Módulo canônico de acesso ao Postgres (Neon-friendly)

const { Pool } = require('pg');

const {
  DATABASE_URL,
  PG_POOL_MAX,              // novo recomendado
  PG_CONNECTION_TIMEOUT,    // novo recomendado
  PG_IDLE,                  // novo recomendado
} = process.env;

if (!DATABASE_URL) {
  console.error('[DB] Faltou DATABASE_URL');
  process.exit(1);
}

// Lazy init para permitir recriar após idle close
let pool = null;

function createPool() {
  const cfg = {
    connectionString: DATABASE_URL,                         // use -pooler + sslmode=require + application_name no .env
    max: Number(PG_POOL_MAX ?? process.env.PGPOOL_MAX ?? 8),
    connectionTimeoutMillis: Number(PG_CONNECTION_TIMEOUT ?? 5000),
    idleTimeoutMillis: Number(PG_IDLE ?? process.env.PG_IDLE ?? 30000),
    allowExitOnIdle: false,
    ssl: { rejectUnauthorized: true },                      // Neon com SSL válido
  };

  const p = new Pool(cfg);

  // Proteções no servidor
  p.on('connect', (client) => {
    client.query(`
      SET statement_timeout = '15s';
      SET idle_in_transaction_session_timeout = '10s';
    `).catch(() => {});
  });

  p.on('error', (err) => {
    console.error('[DB] Pool error:', err?.message || err);
  });

  try {
    const u = new URL(DATABASE_URL);
    console.log(`[DB] pool ready → host=${u.hostname} db=${u.pathname.replace('/', '')}`);
  } catch {
    console.log('[DB] pool ready (DATABASE_URL parse falhou)');
  }

  return p;
}

function getPool() {
  if (!pool) pool = createPool();
  return pool;
}

// Helpers
async function all(sql, params = []) {
  const { rows } = await getPool().query(sql, params);
  return rows;
}

async function get(sql, params = []) {
  const { rows } = await getPool().query(sql, params);
  return rows[0] || null;
}

async function run(sql, params = []) {
  return await getPool().query(sql, params);
}

// Fechamento por inatividade (idlePoolCloser)
async function closePool() {
  if (!pool) return;
  const p = pool;
  pool = null;
  try {
    await p.end();
    console.log('[DB] pool closed');
  } catch (e) {
    console.warn('[DB] erro ao fechar pool:', e?.message || e);
  }
}

// Encerramento gracioso
const shutdown = async () => {
  try { await closePool(); } catch {}
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = {
  getPool,
  // Compat: permite usar pool.query(...) sem expor a instância diretamente
  pool: new Proxy({}, {
    get(_t, prop) {
      const p = getPool();
      return typeof p[prop] === 'function' ? p[prop].bind(p) : p[prop];
    }
  }),
  all,
  get,
  run,
  closePool,
};