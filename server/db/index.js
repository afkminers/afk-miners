// server/db/index.js
// Helpers simples de acesso ao Postgres: get/all/run
// Usa DATABASE_URL ou variáveis PG* do ambiente.

const { Pool } = require('pg');

function buildConfig() {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
      max: Number(process.env.PGPOOL_MAX || 10),
      idleTimeoutMillis: Number(process.env.PG_IDLE || 30000),
    };
  }
  return {
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    database: process.env.PGDATABASE || 'postgres',
    ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
    max: Number(process.env.PGPOOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.PG_IDLE || 30000),
  };
}

const pool = new Pool(buildConfig());

async function all(sql, params) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

async function get(sql, params) {
  const rows = await all(sql, params);
  return rows[0] || null;
}

async function run(sql, params) {
  await pool.query(sql, params);
  return true;
}

module.exports = { pool, all, get, run };