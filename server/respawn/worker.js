// server/respawn/worker.js
let TIMER = null;
const TICK_MS = 5000; // roda a cada 5s

/**
 * Um passo do respawn:
 * - Pega instâncias MORTAS cujo prazo já venceu (now() >= respawn_at)
 * - Marca como ALIVE e limpa o respawn_at
 * Obs: o HP atual é mantido no mínimo 1; se quiser restaurar pro máximo,
 *      traga esse valor do seu pipeline/monsters_master e use aqui.
 */
async function respawnTick({ all, run }) {
  const due = await all(`
    SELECT mi.id, mi.spawn_id, mi.map_key, s."monsterKey",
           s.x, s.y
      FROM monster_instances mi
      JOIN spawns s ON s.id = mi.spawn_id
     WHERE mi.state = 'DEAD'
       AND mi.respawn_at IS NOT NULL
       AND now() >= mi.respawn_at
     ORDER BY mi.respawn_at ASC
     LIMIT 50
  `);

  for (const r of due) {
    // Sobe o bicho: volta a viver e limpa o agendamento
    await run(
      `UPDATE monster_instances
          SET state='ALIVE',
              hp = GREATEST(hp, 1),
              updated_at = now(),
              respawn_at = NULL
        WHERE id = $1`,
      [r.id]
    );
  }
  if (due.length) {
    console.log(`[respawn] revived ${due.length} instance(s)`);
  }
}

function startRespawnLoop(db) {
  if (TIMER) return TIMER;
  TIMER = setInterval(() => {
    respawnTick(db).catch(e => console.error('[respawn]', e));
  }, TICK_MS);
  console.log(`[respawn] loop started (${TICK_MS}ms)`);
  return TIMER;
}

function stopRespawnLoop() {
  if (TIMER) {
    clearInterval(TIMER);
    TIMER = null;
    console.log('[respawn] loop stopped');
  }
}

module.exports = { startRespawnLoop, stopRespawnLoop, respawnTick };
