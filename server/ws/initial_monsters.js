// server/ws/initial_monsters.js
// Gera snapshot inicial de monstros vivos para o handshake do WS.

let db = null;
try { db = require('../models/db'); } catch {}

async function tableExists(name) {
  if (!db || !db.get) return false;
  // Postgres
  try {
    const row = await db.get(`SELECT to_regclass($1)::text AS t`, [name]);
    if (row && row.t) return true;
  } catch {}
  // SQLite
  try {
    const row = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [name]);
    return !!row;
  } catch {}
  return false;
}

async function tryAll(selects) {
  for (const s of selects) {
    try { const rows = await db.all(s.sql, s.params || []); return rows; } catch {}
  }
  return [];
}

/**
 * Retorna um array de mensagens WS do tipo "monster_respawned"
 * Ex.: { type:'monster_respawned', id, mapKey, monsterKey, x, y, hp, hpMax }
 */
async function listAliveMonsters({ mapKey = 'house' } = {}) {
  if (!db || !await tableExists('monster_instances')) return [];

  const selects = [
    { sql: `SELECT id, x, y, hp, COALESCE(hp_max, 100)    AS "hpMax" FROM monster_instances WHERE alive IS TRUE OR alive IS NULL LIMIT 200` },
    { sql: `SELECT id, x, y, hp, COALESCE("hpMax", 100)   AS "hpMax" FROM monster_instances LIMIT 200` },
    { sql: `SELECT id, x, y, hp, COALESCE(hpmax, 100)     AS "hpMax" FROM monster_instances LIMIT 200` },
    { sql: `SELECT id, x, y, hp, 100                      AS "hpMax" FROM monster_instances LIMIT 200` },
  ];

  const rows = await tryAll(selects);

  return rows.map(r => ({
    type: 'monster_respawned',
    id: String(r.id),
    mapKey,
    monsterKey: null,  // se tiver coluna pra isso, pode preencher
    x: r.x | 0,
    y: r.y | 0,
    hp: r.hp ?? r.hpMax ?? 100,
    hpMax: r.hpMax ?? 100,
  }));
}

module.exports = { listAliveMonsters };
