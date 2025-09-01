// server/ws/initial_monsters.js
const { all } = require('../models/db');

/**
 * Retorna duas coisas:
 * - msgs: array de mensagens {type:'monster_respawned', id, mapKey, monsterKey, hp, maxHp, x, y}
 * - seeds: array de seeds p/ IA { id, x, y, mapKey, spawnRect:{x,y,w,h} }
 */
async function listAliveMonsters() {
  const rows = await all(`
    SELECT
      mi.id::text            AS id,
      mi.map_key             AS "mapKey",
      mi.hp,
      COALESCE(mi.max_hp, mm."healthMax", 1) AS "maxHp",
      s."monsterKey"         AS "monsterKey",
      -- usamos a área de spawn como posição inicial
      s.x, s.y, s.w, s.h
    FROM monster_instances mi
    JOIN spawns s          ON s.id = mi.spawn_id
    LEFT JOIN monsters_master mm ON mm.key = s."monsterKey"
    WHERE mi.state = 'ALIVE'
    ORDER BY mi.id
  `);

  const msgs = [];
  const seeds = [];

  for (const r of rows) {
    const hp   = Number(r.hp || 1);
    const maxH = Number(r.maxHp || hp || 1);
    const x = Number(r.x || 0), y = Number(r.y || 0);
    const w = Number(r.w || 32), h = Number(r.h || 32);

    msgs.push({
      type: 'monster_respawned',
      id: r.id,
      mapKey: r.mapKey,
      monsterKey: r.monsterKey,
      hp,
      maxHp: maxH,
      x, y
    });

    seeds.push({
      id: r.id,
      x, y,
      mapKey: r.mapKey,
      spawnRect: { x, y, w, h }
    });
  }

  return { msgs, seeds };
}

module.exports = { listAliveMonsters };
