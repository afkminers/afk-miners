// server/combat/seed.js
async function seedIfEmpty({ all, get, run }) {
  const row = await get(`SELECT COUNT(*)::int AS n FROM monster_instances`);
  const count = row ? row.n : 0;
  if (count > 0) {
    console.log(`[seed] monster_instances já tem ${count} registro(s) — ok`);
    return;
  }

  console.log('[seed] monster_instances vazio — semeando a partir de spawns…');

  const inserted = await all(`
    INSERT INTO monster_instances (spawn_id, map_key, state, hp, max_hp, respawn_at, x, y)
    SELECT
      s.id,
      s."mapKey",
      'DEAD',
      COALESCE(mm."healthMax", 1),
      COALESCE(mm."healthMax", 1),
      now(),
      (s.x + floor(random() * GREATEST(1, COALESCE(s.w, 32)))),
      (s.y + floor(random() * GREATEST(1, COALESCE(s.h, 32))))
    FROM spawns s
    LEFT JOIN monsters_master mm ON mm.key = s."monsterKey"
    CROSS JOIN generate_series(1, GREATEST(1, s.count)) g
    RETURNING id
  `);

  console.log(`[seed] inseridas ${inserted.length} instância(s) — respawn começará já`);
}

module.exports = { seedIfEmpty };
