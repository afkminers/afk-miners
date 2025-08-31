async function respawnTick({ all, run }) {
  const due = await all(`
    SELECT id, spawn_id, map_key
    FROM monster_instances
    WHERE state='DEAD' AND now() >= respawn_at
    ORDER BY respawn_at ASC
    LIMIT 50
  `);

  for (const m of due) {
    // TODO: pegar spawn info original (monsterKey, hp, etc)
    await run(
      `UPDATE monster_instances
         SET state='ALIVE', hp=max_hp, respawn_at=NULL, updated_at=now()
       WHERE id=$1`,
      [m.id]
    );
  }
}
