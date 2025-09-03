// Gera instâncias que estiverem faltando para cada spawn
// Requisitos de schema usados aqui: monster_instances(id uuid, spawn_id int, monster_id int NOT NULL,
//   map_key text NOT NULL, state text, hp int, max_hp int, created_at timestamptz, updated_at timestamptz)

const { run } = require('../models/db');

async function syncSpawns() {
  // Cria as faltantes, não mexe nas que já existem
  const sql = `
    WITH t AS (
      SELECT
        s.id                       AS spawn_id,
        s."mapKey"                 AS map_key,
        s."monsterKey"             AS monster_key,
        s.count                    AS want,
        COALESCE(mi.n, 0)          AS have,
        (s.count - COALESCE(mi.n,0)) AS missing,
        mm.id                      AS monster_id,
        COALESCE(mm."healthMax", mm.healthmax, 50) AS max_hp
      FROM spawns s
      LEFT JOIN (
        SELECT spawn_id, COUNT(*) AS n
        FROM monster_instances
        GROUP BY spawn_id
      ) mi ON mi.spawn_id = s.id
      LEFT JOIN monsters_master mm ON mm.key = s."monsterKey"
    )
    INSERT INTO monster_instances
      (id, spawn_id, monster_id, map_key, state, hp, max_hp, created_at, updated_at)
    SELECT
      gen_random_uuid(),
      t.spawn_id,
      t.monster_id,
      t.map_key,
      'ALIVE',
      t.max_hp,
      t.max_hp,
      now(), now()
    FROM t
    JOIN generate_series(1, GREATEST(t.missing,0)) g(n) ON true
    WHERE t.missing > 0;
  `;
  // se quiser saber quantas foram criadas, use RETURNING id e conte aqui
  await run(sql, []);
  console.log('[sync_spawns] ok (instâncias faltantes criadas se havia)');
}

module.exports = { syncSpawns };
