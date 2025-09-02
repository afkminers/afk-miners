// server/combat/seed.js
// Ensures monster_instances has at least a couple of rows.

let db = null;
try { db = require('../models/db'); } catch {}

async function exists(table) {
  if (!db || !db.get) return false;
  try {
    const pg = await db.get?.(`SELECT to_regclass($1)::text AS t`, [table]);
    if (pg && pg.t) return true;
  } catch {}
  try {
    const row = await db.get?.(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [table]);
    return !!row;
  } catch {}
  return false;
}

async function seedIfEmpty() {
  if (!db || !db.get || !db.run) {
    console.warn('[seed] db helpers missing; skipping');
    return;
  }

  // Create table if not exists (works in SQLite; for PG assume migrations already created)
  try {
    await db.run(`
      CREATE TABLE IF NOT EXISTS monster_instances(
        id TEXT PRIMARY KEY,
        monster_key TEXT,
        x INTEGER, y INTEGER,
        hp INTEGER DEFAULT 100,
        hp_max INTEGER DEFAULT 100,
        alive BOOLEAN DEFAULT TRUE
      )
    `, []);
  } catch {}

  let count = 0;
  try {
    const row = await db.get(`SELECT COUNT(*) AS c FROM monster_instances`, []);
    count = +row?.c || 0;
  } catch (e) {
    console.warn('[seed] count failed', e.message);
  }

  if (count > 0) {
    console.log('[seed] monster_instances already populated:', count);
    return;
  }

  const demo = [
    { id: 'demo-1', key: 'goblin', x: 8*32,  y: 6*32,  hp: 100, hp_max: 100 },
    { id: 'demo-2', key: 'skeleton', x: 12*32, y: 10*32, hp: 80,  hp_max: 80 },
  ];

  for (const m of demo) {
    try {
      await db.run(
        `INSERT INTO monster_instances(id, monster_key, x, y, hp, hp_max, alive)
         VALUES ($1,$2,$3,$4,$5,$6,TRUE)`,
        [m.id, m.key, m.x, m.y, m.hp, m.hp_max]
      );
    } catch (e) {
      console.warn('[seed] insert failed', e.message);
    }
  }
  console.log('[seed] seeded demo monsters:', demo.length);
}

module.exports = { seedIfEmpty };
