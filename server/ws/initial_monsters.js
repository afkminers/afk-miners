// server/ws/initial_monsters.js
const { all } = require('../models/db');

/**
 * Retorna uma lista de mensagens prontas para enviar via WS,
 * descrevendo todos os monstros VIVOS atualmente.
 */
async function listAliveMonsters() {
  const rows = await all(`
    SELECT
      mi.id,
      mi.hp,
      mi.max_hp,
      mi.map_key,
      mi.spawn_id,
      s."monsterKey",
      s.x, s.y
    FROM monster_instances mi
    JOIN spawns s
      ON s.id = mi.spawn_id
    WHERE mi.state = 'ALIVE'
    ORDER BY mi.created_at ASC
    LIMIT 500
  `);

  return rows.map(r => ({
    type: 'monster_respawned',   // mesmo shape que o worker usa
    id: r.id,
    mapKey: r.map_key,
    monsterKey: r.monsterKey,
    hp: typeof r.hp === 'number' ? r.hp : (r.max_hp ?? 1),
    maxHp: typeof r.max_hp === 'number' ? r.max_hp : (r.hp ?? 1),
    x: r.x ?? null,
    y: r.y ?? null
  }));
}

module.exports = { listAliveMonsters };
