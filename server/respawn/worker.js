// server/respawn/worker.js
let TIMER = null;

// Frequência do worker (ms). Pode ajustar por ENV: RESPAWN_TICK_MS=2000
const TICK_MS = Number(process.env.RESPAWN_TICK_MS || 5000);

// Se quiser ver logs de cada tick (mesmo quando não revive), ligue: RESPAWN_DEBUG=1
const DEBUG = String(process.env.RESPAWN_DEBUG || '').trim() === '1';

// WS bus (para avisar clientes)
const { broadcast } = require('../ws/bus');

// Integração com o loop de AI (para ele conhecer a posição inicial)
let seedAI = null;
try {
  // importa de forma “tolerante” (não quebra se ainda não existir)
  seedAI = require('../combat/ai-mobs').seedPosition;
} catch { /* noop */ }

/**
 * Um passo do respawn:
 * - Pega instâncias MORTAS cujo prazo já venceu (now() >= respawn_at)
 * - Sorteia x/y dentro do retângulo do spawn
 * - Marca como ALIVE, zera respawn_at, restaura HP e salva x/y
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
      s.x, s.y, COALESCE(s.w,32) AS w, COALESCE(s.h,32) AS h,
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
    // HP cheio para voltar
    const hpFull =
      (r.mi_max_hp && Number(r.mi_max_hp) > 0) ? Number(r.mi_max_hp)
      : (r.health_max && Number(r.health_max) > 0) ? Number(r.health_max)
      : 1;

    // Sorteia nova posição dentro do retângulo do spawn
    const nx = Math.round((Number(r.x) || 0) + Math.random() * Math.max(1, Number(r.w)));
    const ny = Math.round((Number(r.y) || 0) + Math.random() * Math.max(1, Number(r.h)));

    await run(
      `UPDATE monster_instances
          SET state            = 'ALIVE',
              hp               = $2,
              respawn_at       = NULL,
              last_hit_hero_id = NULL,
              last_hit_at      = NULL,
              x                = $3,
              y                = $4,
              updated_at       = now()
        WHERE id = $1`,
      [r.id, hpFull, nx, ny]
    );

    // Notifica frontend que a instância renasceu (com posição)
    try {
      broadcast({
        type: 'monster_respawned',
        id: r.id,
        mapKey: r.map_key,
        monsterKey: r.monsterKey,
        hp: hpFull,
        maxHp: hpFull,
        x: nx,
        y: ny
      });
    } catch (e) {
      if (DEBUG) console.warn('[respawn] broadcast failed:', e?.message);
    }

    // Semeia a posição no AI (para começar a andar)
    try {
      if (typeof seedAI === 'function') {
        seedAI({
          id: r.id,
          x: nx, y: ny,
          mapKey: r.map_key,
          spawnRect: { x: Number(r.x) || 0, y: Number(r.y) || 0, w: Number(r.w) || 32, h: Number(r.h) || 32 }
        });
      }
    } catch (e) {
      if (DEBUG) console.warn('[respawn] seed AI failed:', e?.message);
    }
  }

  if (due.length) console.log(`[respawn] revived ${due.length} instance(s)`);
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
