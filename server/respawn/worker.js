// server/respawn/worker.js
let TIMER = null;

// Frequência do worker (ms). Pode ajustar por ENV: RESPAWN_TICK_MS=2000
const TICK_MS = Number(process.env.RESPAWN_TICK_MS || 5000);

// Se quiser ver logs de cada tick (mesmo quando não revive), ligue: RESPAWN_DEBUG=1
const DEBUG = String(process.env.RESPAWN_DEBUG || '').trim() === '1';

// WS bus (para avisar clientes)
const { broadcast } = require('../ws/bus');

// Mundo em pixels (o cliente usa 32px por tile)
const TILE = 32;

function pickPosInSpawnRect(spawn) {
  // x,y do Tiled já vêm em pixels (top-left). w,h podem ser 0/NULL → usar TILE como fallback.
  const x0 = Number(spawn.x) || 0;
  const y0 = Number(spawn.y) || 0;
  const w  = Number(spawn.w) || TILE;
  const h  = Number(spawn.h) || TILE;

  return {
    x: x0 + Math.random() * w,
    y: y0 + Math.random() * h,
  };
}

/**
 * Um passo do respawn:
 * - Pega instâncias MORTAS cujo prazo já venceu (now() >= respawn_at)
 * - Marca como ALIVE, zera respawn_at e restaura o HP
 *
 * HP preferências (na ordem):
 *  1) monster_instances.max_hp (se existir)
 *  2) monsters_master."healthMax" (join via spawns -> "monsterKey")
 *  3) 1 (fallback para não ficar 0)
 */
async function respawnTick({ all, run }) {
  if (DEBUG) console.log('[respawn] tick...');

  const due = await all(`
    SELECT
      mi.id,
      mi.max_hp                   AS mi_max_hp,
      mi.spawn_id,
      mi.map_key,
      s."monsterKey",
      s.x, s.y,                   -- top-left do retângulo do spawn (px)
      COALESCE(s.w, 0) AS w,
      COALESCE(s.h, 0) AS h,
      COALESCE(mm."healthMax", 0) AS health_max
    FROM monster_instances mi
    JOIN spawns s
      ON s.id = mi.spawn_id
    LEFT JOIN monsters_master mm
      ON mm.key = s."monsterKey"
    WHERE mi.state = 'DEAD'
      AND mi.respawn_at IS NOT NULL
      AND now() >= mi.respawn_at
    ORDER BY mi.respawn_at ASC
    LIMIT 50
  `);

  if (DEBUG) console.log('[respawn] due count =', due.length);

  for (const r of due) {
    // HP que vamos usar pra voltar:
    const hpFull =
      (r.mi_max_hp && Number(r.mi_max_hp) > 0) ? Number(r.mi_max_hp)
      : (r.health_max && Number(r.health_max) > 0) ? Number(r.health_max)
      : 1;

    // Escolhe uma posição dentro da área do spawn (em pixels)
    const pos = pickPosInSpawnRect(r);

    await run(
      `UPDATE monster_instances
          SET state            = 'ALIVE',
              hp               = $2,
              respawn_at       = NULL,
              last_hit_hero_id = NULL,
              last_hit_at      = NULL,
              updated_at       = now()
        WHERE id = $1`,
      [r.id, hpFull]
    );

    // Notifica frontend que a instância renasceu, COM x,y em pixels
    try {
      const payload = {
        type: 'monster_respawned',
        id: r.id,
        mapKey: r.map_key,
        monsterKey: r.monsterKey,
        spawnId: r.spawn_id,      // <-- opcional
        hp: hpFull,
        maxHp: hpFull,
        x: pos.x,
        y: pos.y,
      };
      if (DEBUG) console.log('[respawn] broadcast', payload);
      broadcast(payload);
    } catch (e) {
      if (DEBUG) console.warn('[respawn] broadcast failed:', e?.message);
    }
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
