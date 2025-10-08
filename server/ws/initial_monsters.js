// server/ws/initial_monsters.js
// Gera snapshot inicial de monstros vivos para o handshake do WS.

let db = null;
try { db = require('../models/db'); } catch {}

async function tableExists(name) {
  if (!db || !db.get) return false;
  try {
    const row = await db.get(`SELECT to_regclass($1)::text AS t`, [name]); // Postgres
    if (row && row.t) return true;
  } catch {}
  try {
    const row = await db.get( // SQLite
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [name]
    );
    return !!row;
  } catch {}
  return false;
}

async function tryAll(selects) {
  for (const s of selects) {
    try { return await db.all(s.sql, s.params || []); } catch {}
  }
  return [];
}

/**
 * Retorna um array de mensagens WS do tipo "monster_respawned"
 * Ex.: { type:'monster_respawned', id, mapKey, monsterKey, spawnId, hp, maxHp }
 */
async function listAliveMonsters({ mapKey: fallbackMapKey = 'house' } = {}) {
  if (!db || !await tableExists('monster_instances')) return [];

  // Caminho principal (Postgres) — com fallback de HP vindo do monsters_master
  const primary = {
    sql: `
      SELECT
        mi.id::text                                AS id,
        COALESCE(mi.map_key, s."mapKey")::text    AS "mapKey",
        mi.spawn_id                                AS "spawnId",
        s."monsterKey"::text                       AS "monsterKey",
        COALESCE(mi.x, 0)                          AS x,
        COALESCE(mi.y, 0)                          AS y,
        /* hp atual, caindo para max calculado */
        COALESCE(mi.hp, mi.max_hp, mm."healthMax", 1)        AS hp,
        /* max hp preferindo mi.max_hp, senão mm.healthMax, senão 1 */
        COALESCE(mi.max_hp, mm."healthMax", 1)               AS "maxHp"
      FROM monster_instances mi
      JOIN spawns s              ON s.id = mi.spawn_id
      LEFT JOIN monsters_master mm ON mm.key = s."monsterKey"
      WHERE mi.state = 'ALIVE'
      LIMIT 500
    `
  };

  // Fallbacks antigos (para ambientes alternativos)
  const fallbacks = [
    { sql: `SELECT id, x, y, hp, COALESCE(hp_max, 100)  AS "hpMax" FROM monster_instances WHERE alive IS TRUE OR alive IS NULL LIMIT 200` },
    { sql: `SELECT id, x, y, hp, COALESCE("hpMax", 100) AS "hpMax" FROM monster_instances LIMIT 200` },
    { sql: `SELECT id, x, y, hp, COALESCE(hpmax, 100)   AS "hpMax" FROM monster_instances LIMIT 200` },
    { sql: `SELECT id, x, y, hp, 100                    AS "hpMax" FROM monster_instances LIMIT 200` },
  ];

  const rows = await tryAll([primary, ...fallbacks]);

  return rows.map(r => ({
    type: 'monster_respawned',
    id: String(r.id),
    mapKey: String(r.mapKey ?? fallbackMapKey),
    monsterKey: r.monsterKey ?? null,
    spawnId: (r.spawnId != null ? Number(r.spawnId) : undefined),
    // x/y não são usados pelo overlay, mas manter não faz mal:
    x: Number(r.x) || 0,
    y: Number(r.y) || 0,
    hp: Number(r.hp ?? r.hpMax ?? 1),
    maxHp: Number(r.maxHp ?? r.hpMax ?? 1),
  }));
}

module.exports = { listAliveMonsters };
