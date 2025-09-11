// scripts/show-heroes-schema.js
const { pool } = require('../models/db');

(async () => {
  try {
    const p = pool();

    const table = 'player_heroes';
    console.log('> Columns in', table);
    const cols = await p.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1
      ORDER BY ordinal_position
    `, [table]);
    console.table(cols.rows);

    const sample = await p.query(`SELECT * FROM ${table} ORDER BY created_at DESC LIMIT 1`);
    console.log('> Sample row:');
    console.dir(sample.rows[0], { depth: 5 });

  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    process.exit(0);
  }
})();