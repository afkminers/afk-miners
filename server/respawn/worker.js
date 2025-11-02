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
const RESPAWN_EXTRA_RADIUS = Number(process.env.RESPAWN_TILE_SEARCH_RADIUS || 6);
const RESPAWN_RETRY_DELAY_MS = Number(process.env.RESPAWN_RETRY_DELAY_MS || 1000);

function tileOf(v) {
  return Math.floor(Number(v || 0) / TILE);
}

function centerOfTile(t) {
  return (t * TILE) + TILE / 2;
}

function tileKey(tx, ty) {
  return `${tx},${ty}`;
}

function spawnTileBounds(spawn) {
  const x0 = Number(spawn.x) || 0;
  const y0 = Number(spawn.y) || 0;
  const w  = Math.max(TILE, Number(spawn.w) || 0);
  const h  = Math.max(TILE, Number(spawn.h) || 0);

  const minTx = tileOf(x0);
  const minTy = tileOf(y0);
  const maxTx = tileOf(x0 + w - 1);
  const maxTy = tileOf(y0 + h - 1);

  return { minTx, maxTx, minTy, maxTy };
}

function pickTilesInSpawn(spawn) {
  const { minTx, maxTx, minTy, maxTy } = spawnTileBounds(spawn);

  const tiles = [];
  for (let tx = minTx; tx <= maxTx; tx++) {
    for (let ty = minTy; ty <= maxTy; ty++) {
      tiles.push({ tx, ty });
    }
  }
  return tiles;
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getOccupiedTilesForMap(cache, mapKey) {
  const key = mapKey == null ? '__null__' : String(mapKey);
  if (!cache.has(key)) cache.set(key, new Set());
  return cache.get(key);
}

function markTileOccupied(cache, mapKey, tx, ty) {
  const set = getOccupiedTilesForMap(cache, mapKey);
  set.add(tileKey(tx, ty));
}

function findFreeTileAroundSpawn(spawn, mapKey, occupiedCache) {
  const occ = getOccupiedTilesForMap(occupiedCache, mapKey);
  const bounds = spawnTileBounds(spawn);
  const { minTx, maxTx, minTy, maxTy } = bounds;

  for (let radius = 1; radius <= RESPAWN_EXTRA_RADIUS; radius++) {
    const minX = minTx - radius;
    const maxX = maxTx + radius;
    const minY = minTy - radius;
    const maxY = maxTy + radius;

    for (let tx = minX; tx <= maxX; tx++) {
      for (let ty = minY; ty <= maxY; ty++) {
        const onPerimeter = tx === minX || tx === maxX || ty === minY || ty === maxY;
        if (!onPerimeter) continue;
        const key = tileKey(tx, ty);
        if (occ.has(key)) continue;
        occ.add(key);
        return { x: centerOfTile(tx), y: centerOfTile(ty), tx, ty };
      }
    }
  }
  return null;
}

function reserveTileForSpawn(spawn, mapKey, occupiedCache) {
  const tiles = shuffleInPlace(pickTilesInSpawn(spawn));
  const occ = getOccupiedTilesForMap(occupiedCache, mapKey);

  for (const t of tiles) {
    const key = tileKey(t.tx, t.ty);
    if (occ.has(key)) continue;
    occ.add(key);
    return { x: centerOfTile(t.tx), y: centerOfTile(t.ty), tx: t.tx, ty: t.ty };
  }

  return findFreeTileAroundSpawn(spawn, mapKey, occupiedCache);
}

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
        COALESCE(mi.map_key, s."mapKey") AS map_key,
        s."monsterKey",
        s.x, s.y,                   -- top-left do retângulo do spawn (px)
        COALESCE(s.w, 0) AS w,
        COALESCE(s.h, 0) AS h,
        COALESCE(mm."healthMax", 0) AS health_max,
        mm.speed                     AS speed,
        COALESCE(s."leashPx", 0)    AS leash_px
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

  const occupiedByMap = new Map();
  if (due.length) {
    const aliveTiles = await all(`
      SELECT COALESCE(mi.map_key, s."mapKey") AS map_key,
             mi.x,
             mi.y
        FROM monster_instances mi
        LEFT JOIN spawns s ON s.id = mi.spawn_id
       WHERE mi.state = 'ALIVE'
    `);

    for (const row of aliveTiles) {
      const tx = tileOf(row.x);
      const ty = tileOf(row.y);
      if (!Number.isFinite(tx) || !Number.isFinite(ty)) continue;
      markTileOccupied(occupiedByMap, row.map_key, tx, ty);
    }
  }

  for (const r of due) {
    // HP que vamos usar pra voltar:
    const hpFull =
      (r.mi_max_hp && Number(r.mi_max_hp) > 0) ? Number(r.mi_max_hp)
      : (r.health_max && Number(r.health_max) > 0) ? Number(r.health_max)
      : 1;

    // Escolhe uma posição dentro da área do spawn (em pixels)
    const resolvedMapKey = r.map_key == null ? null : String(r.map_key);
    const occKey = resolvedMapKey ?? '__null__';
    let chosen = reserveTileForSpawn(r, occKey, occupiedByMap);
    if (!chosen) {
      const occ = getOccupiedTilesForMap(occupiedByMap, occKey);
      for (let attempt = 0; attempt < 8 && !chosen; attempt++) {
        const fallbackPos = pickPosInSpawnRect(r);
        const tx = tileOf(fallbackPos.x);
        const ty = tileOf(fallbackPos.y);
        if (!Number.isFinite(tx) || !Number.isFinite(ty)) continue;
        const key = tileKey(tx, ty);
        if (occ.has(key)) continue;
        occ.add(key);
        chosen = {
          x: centerOfTile(tx),
          y: centerOfTile(ty),
          tx,
          ty,
        };
      }
    }

    if (!chosen) {
      await run(
        `UPDATE monster_instances
            SET respawn_at = NOW() + ($2 || ' milliseconds')::interval
          WHERE id = $1`,
        [r.id, String(Math.max(250, RESPAWN_RETRY_DELAY_MS))]
      );
      if (DEBUG) console.log('[respawn] no free tile, delaying instance', r.id);
      continue;
    }

    const px = Math.round(chosen.x);
    const py = Math.round(chosen.y);

    await run(
      `UPDATE monster_instances
          SET state            = 'ALIVE',
              hp               = $2,
              respawn_at       = NULL,
              last_hit_hero_id = NULL,
              last_hit_at      = NULL,
              x                = $3,
              y                = $4,
              map_key          = $5,
              updated_at       = now()
        WHERE id = $1`,
      [r.id, hpFull, px, py, resolvedMapKey]
    );

    try {
      const simpleAi = require('../combat/monster_atk_simple');
      if (simpleAi && typeof simpleAi.resetInstanceState === 'function') {
        simpleAi.resetInstanceState(r.id);
      }
    } catch {}

    try {
      const aiMobs = require('../combat/ai-mobs');
      if (aiMobs && typeof aiMobs.seedPosition === 'function') {
        aiMobs.seedPosition({
          id: r.id,
          x: px,
          y: py,
          mapKey: resolvedMapKey,
          spawnRect: { x: r.x, y: r.y, w: r.w, h: r.h },
          monsterKey: r.monsterKey,
          speed: r.speed,
          leashPx: r.leash_px,
          resetThreat: true,
        });
      }
    } catch {}

    // Notifica frontend que a instância renasceu, COM x,y em pixels
    try {
      const payload = {
        type: 'monster_respawned',
        id: r.id,
        mapKey: resolvedMapKey,
        monsterKey: r.monsterKey,
        spawnId: r.spawn_id,      // <-- opcional
        hp: hpFull,
        maxHp: hpFull,
        x: px,
        y: py,
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
