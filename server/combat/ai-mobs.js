  // server/combat/ai-mobs.js
  // IA server-authoritative estilo Tibia/Ragnarok:
  // - Capta alvos via player_online (presença real) + player_last_pos (última posição conhecida).
  // - Threat/Agro com decaimento + histerese (troca de alvo “natural” entre heróis).
  // - Chase cardinal com colisão no servidor.
  // - Ataque com alcance (px) + LOS (Bresenham).
  // - Sem targeting.js e sem dependências no cliente.

  const K = require('../balance/config');
  const { all, run } = require('../models/db');
  const { getGrid } = require('../maps/grid');
  const { hasLineOfSight } = require('./los');
  // const { inReachPx } = require('./geom');
  const { applyMobHit } = require('./service');
  const { listFreshHeroesByMap } = require('../player/live_positions');

  const PX_PER_TILE = 32;
  const HOME_TOLERANCE_PX = PX_PER_TILE / 2;

  let broadcast = () => {};
  try {
    // se existir, usamos para notificar clientes da posição do mob
    ({ broadcast } = require('../ws/bus'));
  } catch {}

  // --------- Tuning ----------
  const TICK_MS = 100;                  // 10 tps
  const STEP_PX = 32;                   // 1 tile
  const DEFAULT_CHASE_SPEED_PX_S = 90;  // px/s
  const MIN_CHASE_SPEED_PX_S = 32;      // px/s (≈1 tile/s)
  const MAX_CHASE_SPEED_PX_S = 420;     // px/s (~Tibia haste early game)
  const GIVEUP_MS = 8000;               // desiste se perder o alvo por muito tempo
  const ONLINE_RECENT_MS = 4000;       // presença considerada “viva” nos últimos 4s

  // Anti-hit fantasma (idades máximas aceitáveis das posições)
  const STALE_HERO_MS = 400;           // herói precisa ter pos ≤ 400ms
  const STALE_MOB_MS  = 800;           // mob precisa ter pos ≤ 800ms


  // Threat / Aggro
  const THREAT_ON_SIGHT = 2.5;          // ganho por tick quando vê
  const THREAT_ON_HIT   = 7;            // ganho quando herói bate no mob
  const THREAT_DECAY    = 0.9;          // decaimento por segundo
  const SWITCH_HYSTERESIS = 5;          // delta para trocar de alvo

  // Depuração
  const DEBUG_AI = process.env.AI_MOBS_DEBUG === '1';
  // toggles de teste – úteis para diagnosticar LOS/colisão
  const IGNORE_LOS = process.env.AI_MOBS_IGNORE_LOS === '1';
  const IGNORE_COLLISION = process.env.AI_MOBS_IGNORE_COLLISION === '1';

  const HERO_MEMORY_TTL_MS = 15000;
  const HERO_PREDICTION_MAX_TILES = 2;
  const CROWD_PENALTY_SCALE = 0.35;
  const SURROUND_PENALTY = 0.9;
  const FLANK_BONUS = 0.8;

  // --------- Estado ----------
  const mobs = new Map(); // instanceId -> state
  const heroMemory = new Map(); // heroId -> { cx, cy, lastCx, lastCy, heading, updatedAt, mapKey }
  let loopTimer = null;
  let lastTickAt = 0;

  // --------- Helpers ----------
  /** Converte coordenadas em pixels para tiles antes de checar LOS. */
  function hasLoSpx(losGrid, ax, ay, bx, by) {
    const aCx = Math.floor(ax / STEP_PX);
    const aCy = Math.floor(ay / STEP_PX);
    const bCx = Math.floor(bx / STEP_PX);
    const bCy = Math.floor(by / STEP_PX);
    return hasLineOfSight(losGrid, aCx, aCy, bCx, bCy);
  }

  function chebyPx(ax, ay, bx, by) {
    return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
  }

  function normalizeMonsterPos({ x, y, spawnRect }) {
    let rawX = Number(x ?? 0);
    let rawY = Number(y ?? 0);
    if (!Number.isFinite(rawX)) rawX = 0;
    if (!Number.isFinite(rawY)) rawY = 0;

    let px = Math.round(rawX);
    let py = Math.round(rawY);

    if (spawnRect && Number.isFinite(spawnRect.x) && Number.isFinite(spawnRect.y)) {
      const sx = Number(spawnRect.x);
      const sy = Number(spawnRect.y);
      const rawW = Number(spawnRect.w);
      const rawH = Number(spawnRect.h);
      const sw = Number.isFinite(rawW) && rawW > 0 ? rawW : PX_PER_TILE;
      const sh = Number.isFinite(rawH) && rawH > 0 ? rawH : PX_PER_TILE;

      const centerX = sx + sw / 2;
      const centerY = sy + sh / 2;

      const rawDist = Math.hypot(px - centerX, py - centerY);

      const tilePx = Math.round(rawX) * PX_PER_TILE + PX_PER_TILE / 2;
      const tilePy = Math.round(rawY) * PX_PER_TILE + PX_PER_TILE / 2;
      const tileDist = Math.hypot(tilePx - centerX, tilePy - centerY);

      if (tileDist + (PX_PER_TILE * 0.75) < rawDist) {
        px = Math.round(tilePx);
        py = Math.round(tilePy);
      }
    }

    return { x: px, y: py };
  }

  function computeSpawnCenterPx(spawnRect, fallbackPos = null) {
    if (spawnRect && Number.isFinite(spawnRect.x) && Number.isFinite(spawnRect.y)) {
      const sx = Number(spawnRect.x);
      const sy = Number(spawnRect.y);
      const rawW = Number(spawnRect.w);
      const rawH = Number(spawnRect.h);
      const sw = Number.isFinite(rawW) && rawW > 0 ? rawW : PX_PER_TILE;
      const sh = Number.isFinite(rawH) && rawH > 0 ? rawH : PX_PER_TILE;
      return {
        x: Math.round(sx + sw / 2),
        y: Math.round(sy + sh / 2),
      };
    }

    if (fallbackPos && Number.isFinite(fallbackPos.x) && Number.isFinite(fallbackPos.y)) {
      return { x: fallbackPos.x | 0, y: fallbackPos.y | 0 };
    }

    return { x: 0, y: 0 };
  }

  function canMobHitNow({ now, mob, tgtPos, losGrid }) {
    // posições
    const mx = mob.x, my = mob.y;
    const hx = tgtPos?.x, hy = tgtPos?.y;

    if (hx == null || hy == null || mx == null || my == null) {
      return { ok:false, reason:'no_pos' };
    }

    // frescor das posições
    const heroAge = now - (tgtPos.updatedMs ?? 0);
    const mobAge  = now - (mob.posUpdatedAt ?? 0);

    if (heroAge > STALE_HERO_MS) return { ok:false, reason:`stale_hero_${heroAge}ms` };
    if (mobAge  > STALE_MOB_MS)  return { ok:false, reason:`stale_mob_${mobAge}ms`  };

    // alcance em px (usa o mesmo que já calculamos no ensureMob)
    const atkPx   = Math.max(mob.attackRangePx || STEP_PX, STEP_PX);
    const distPxC = chebyPx(mx, my, hx, hy); // chebyshev (robusto p/ grid)
    if (distPxC > atkPx) return { ok:false, reason:`out_of_range_${distPxC}gt${atkPx}` };

    // LOS real
    const canSee  = IGNORE_LOS ? true : hasLoSpx(losGrid, mx, my, hx, hy);
    if (!canSee)  return { ok:false, reason:'no_los' };

    return { ok:true, distPxC: distPxC, atkPx };
  }

  function recordHeroObservation({ heroId, mapKey, x, y, now }) {
    if (!heroId) return;
    const cx = Math.floor(Number(x ?? 0) / STEP_PX);
    const cy = Math.floor(Number(y ?? 0) / STEP_PX);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;

    const id = String(heroId);
    const prev = heroMemory.get(id);
    let heading = prev?.heading || null;
    if (!prev || prev.cx !== cx || prev.cy !== cy) {
      const dx = cx - (prev?.cx ?? cx);
      const dy = cy - (prev?.cy ?? cy);
      if (dx || dy) {
        const clampedDx = Math.max(-HERO_PREDICTION_MAX_TILES, Math.min(dx, HERO_PREDICTION_MAX_TILES));
        const clampedDy = Math.max(-HERO_PREDICTION_MAX_TILES, Math.min(dy, HERO_PREDICTION_MAX_TILES));
        heading = (clampedDx || clampedDy) ? { dx: clampedDx, dy: clampedDy } : null;
      }
    }

    heroMemory.set(id, {
      cx,
      cy,
      lastCx: prev?.cx ?? cx,
      lastCy: prev?.cy ?? cy,
      heading: heading && (heading.dx || heading.dy) ? heading : null,
      updatedAt: now,
      mapKey,
    });
  }

  function updateHeroMemoryForMap(mapKey, heroes, now) {
    const seen = new Set();
    if (Array.isArray(heroes)) {
      for (const hero of heroes) {
        if (!hero || hero.heroId == null) continue;
        recordHeroObservation({ heroId: hero.heroId, mapKey, x: hero.x, y: hero.y, now });
        seen.add(String(hero.heroId));
      }
    }

    for (const [heroId, mem] of heroMemory.entries()) {
      if (!mem || (mem.mapKey != null && mem.mapKey !== mapKey)) continue;
      if (seen.has(heroId)) continue;
      if (now - (mem.updatedAt || 0) > HERO_MEMORY_TTL_MS) {
        heroMemory.delete(heroId);
      }
    }
  }

  function predictHeroTileCx(mem, fallbackCx, fallbackCy) {
    if (!mem) return null;
    let dx = 0;
    let dy = 0;
    if (mem.heading && (mem.heading.dx || mem.heading.dy)) {
      dx = mem.heading.dx;
      dy = mem.heading.dy;
    } else if (Number.isFinite(mem.cx) && Number.isFinite(mem.lastCx)) {
      dx = mem.cx - mem.lastCx;
      dy = mem.cy - mem.lastCy;
    }
    dx = Math.max(-HERO_PREDICTION_MAX_TILES, Math.min(dx, HERO_PREDICTION_MAX_TILES));
    dy = Math.max(-HERO_PREDICTION_MAX_TILES, Math.min(dy, HERO_PREDICTION_MAX_TILES));
    if (!dx && !dy) return null;
    return {
      cx: fallbackCx + dx,
      cy: fallbackCy + dy,
      heading: mem.heading || null,
      updatedAt: mem.updatedAt || Date.now(),
    };
  }

  function computeMobDensityPenalty({ occupancy, cx, cy, mobId, heroCx, heroCy }) {
    if (!occupancy) return 0;
    let penalty = 0;

    const key = tileKey(cx, cy);
    const set = occupancy.get(key);
    if (set && set.size) {
      const others = set.has(mobId) ? Math.max(0, set.size - 1) : set.size;
      if (others > 0) penalty += others * 4;
    }

    for (const dir of CARDINAL_DIRS) {
      const nx = cx + dir.dx;
      const ny = cy + dir.dy;
      const nearSet = occupancy.get(tileKey(nx, ny));
      if (nearSet && nearSet.size) {
        penalty += Math.min(nearSet.size, 4) * CROWD_PENALTY_SCALE;
      }
    }

    if (Number.isFinite(heroCx) && Number.isFinite(heroCy)) {
      const distHero = Math.abs(cx - heroCx) + Math.abs(cy - heroCy);
      if (distHero === 1) {
        let adjacentCount = 0;
        for (const dir of CARDINAL_DIRS) {
          const adjSet = occupancy.get(tileKey(heroCx + dir.dx, heroCy + dir.dy));
          if (adjSet && adjSet.size) adjacentCount += adjSet.size;
        }
        if (adjacentCount > 1) penalty += (adjacentCount - 1) * SURROUND_PENALTY;
      }
    }

    return penalty;
  }

  function computeMobFlankBonus({ cx, cy, heroCx, heroCy, heading }) {
    if (!heading || !(heading.dx || heading.dy)) return 0;
    if (!Number.isFinite(heroCx) || !Number.isFinite(heroCy)) return 0;
    const relX = cx - heroCx;
    const relY = cy - heroCy;
    const manhattan = Math.abs(relX) + Math.abs(relY);
    if (manhattan !== 1) return 0;

    const facingX = Math.sign(heading.dx || 0);
    const facingY = Math.sign(heading.dy || 0);
    if (facingX && relX === facingX) return FLANK_BONUS;
    if (facingY && relY === facingY) return FLANK_BONUS;
    if ((facingX && relY !== 0) || (facingY && relX !== 0)) return FLANK_BONUS * 0.6;
    if ((relX && facingX && relX === -facingX) || (relY && facingY && relY === -facingY)) return -FLANK_BONUS * 0.5;
    return 0;
  }


  // --------- DB helpers ----------
  async function fetchAliveMonsters() {
    return (await all(`
      SELECT mi.id,
            COALESCE(mi.map_key, s."mapKey") AS map_key,
            mi.x, mi.y,
            mm.attack_range,      -- tiles
            mm.aggro_range,       -- tiles
            mm.attack_ms,         -- ms
            mm.speed              AS speed,
            mm.key                AS monster_key,
            s.x  AS spawn_x,
            s.y  AS spawn_y,
            COALESCE(s.w, 0) AS spawn_w,
            COALESCE(s.h, 0) AS spawn_h
        FROM monster_instances mi
        JOIN monsters_master mm ON mm.id = mi.monster_id
        LEFT JOIN spawns s ON s.id = mi.spawn_id
      WHERE mi.state = 'ALIVE' AND mi.hp > 0
    `)) || [];
  }

  // 💡 Usa player_online (presença real) + última posição daquele player no mesmo mapa.
  //    **Filtra só heróis VIVOS (hp > 0)** para não mirar em morto.
  async function fetchOnlineHeroesInMap(mapKey) {
    const now = Date.now();
    const merged = [];
    const seen = new Set();

    const live = listFreshHeroesByMap(mapKey, ONLINE_RECENT_MS) || [];
    for (const lp of live) {
      if (!lp?.heroId) continue;
      const hid = String(lp.heroId);
      if (seen.has(hid)) continue;
      merged.push({
        heroId: hid,
        x: lp.x | 0,
        y: lp.y | 0,
        updatedMs: Number(lp.updatedMs || now),
      });
      seen.add(hid);
    }

    const rows = await all(`
      SELECT ph.id::text         AS hero_id,
            plp.x|0             AS x,
            plp.y|0             AS y,
            (EXTRACT(EPOCH FROM plp.updated_at) * 1000)::bigint AS updated_ms
        FROM player_last_pos plp
        JOIN player_heroes ph
          ON ph."playerId"::text = plp.player_id::text
      WHERE plp.map_key = $1
        AND ph.hp > 0
        AND plp.updated_at >= NOW() - ($2 || ' milliseconds')::interval
      ORDER BY plp.updated_at DESC
    `, [mapKey, String(Math.max(ONLINE_RECENT_MS, 60000))]) || [];

    for (const row of rows) {
      const hid = row?.hero_id ? String(row.hero_id) : null;
      if (!hid || seen.has(hid)) continue;
      merged.push({
        heroId: hid,
        x: row.x | 0,
        y: row.y | 0,
        updatedMs: Number(row.updated_ms || now),
      });
      seen.add(hid);
    }

    return merged;
  }


  async function getHeroLastPosPx(heroId, mapKey) {
    const row = await all(`
      SELECT plp.x|0 AS x, plp.y|0 AS y,
             (EXTRACT(EPOCH FROM plp.updated_at) * 1000)::bigint AS updated_ms
        FROM player_last_pos plp
        JOIN player_heroes ph ON ph."playerId"::text = plp.player_id::text
      WHERE ph.id::text = $1
        AND plp.map_key = $2
      ORDER BY plp.updated_at DESC
      LIMIT 1
    `, [String(heroId), String(mapKey)]);

    return row?.[0]
      ? { x: row[0].x | 0, y: row[0].y | 0, updatedMs: Number(row[0].updated_ms || 0) }
      : null;
  }


  // --------- State helpers ----------
  function resolveMobSpeedPx(stat) {
    // `speed` no YAML (monsters_master.speed) é interpretado como pixels por segundo.
    const raw = Number(stat);
    if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_CHASE_SPEED_PX_S;
    const clamped = Math.max(MIN_CHASE_SPEED_PX_S, Math.min(MAX_CHASE_SPEED_PX_S, raw));
    return clamped;
  }

  function ensureMob(instanceId, patch = {}) {
    const id = String(instanceId);
    const cur = mobs.get(id) || {};

    const spawnRect = patch.spawnRect || cur.spawnRect || null;
    const pos = normalizeMonsterPos({
      x: patch.x ?? cur.x ?? 0,
      y: patch.y ?? cur.y ?? 0,
      spawnRect
    });

    const spawnHome = computeSpawnCenterPx(spawnRect, pos);
    let home = spawnHome;
    if (patch.home && Number.isFinite(patch.home.x) && Number.isFinite(patch.home.y)) {
      home = { x: patch.home.x | 0, y: patch.home.y | 0 };
    } else if (!spawnRect && cur.home && Number.isFinite(cur.home.x) && Number.isFinite(cur.home.y)) {
      home = { x: cur.home.x | 0, y: cur.home.y | 0 };
    }

    // tiles recebidos do SELECT (fallback para valores anteriores/constantes)
    const attackRangeTiles = Number(patch.attack_range ?? cur.attack_range ?? 1);
    const aggroRangeTiles  = Math.max(1, Number(patch.aggro_range ?? cur.aggro_range ?? 8));
    const attackMs         = Number(patch.attack_ms    ?? cur.attack_ms    ?? 1200);

    let speedStat = null;
    if (Number.isFinite(Number(patch.speed)) && Number(patch.speed) > 0) {
      speedStat = Number(patch.speed);
    } else if (Number.isFinite(Number(cur.speed)) && Number(cur.speed) > 0) {
      speedStat = Number(cur.speed);
    }
    const moveSpeedPx = resolveMobSpeedPx(speedStat);

    const pendingStepPatch = patch.pendingStep;
    const pendingStep = pendingStepPatch === undefined
      ? (cur.pendingStep || null)
      : (pendingStepPatch && Number.isFinite(pendingStepPatch.x) && Number.isFinite(pendingStepPatch.y)
          ? { x: pendingStepPatch.x | 0, y: pendingStepPatch.y | 0 }
          : null);

    const next = {
      instanceId: id,
      mapKey: patch.mapKey ?? cur.mapKey ?? null,
      x: pos.x | 0,
      y: pos.y | 0,
      speed: speedStat,
      moveSpeedPx,
      monsterKey: patch.monsterKey ?? cur.monsterKey ?? null,

      // runtime
      posUpdatedAt: Number(patch.posUpdatedAt ?? cur.posUpdatedAt ?? Date.now()),
      mode: cur.mode || 'idle',
      targetHeroId: cur.targetHeroId || null,
      lastSeenAt: cur.lastSeenAt || 0,
      repathAt: cur.repathAt || 0,
      lastSwitchAt: cur.lastSwitchAt || 0,
      threat: cur.threat || new Map(),
      pendingStep,


      // === Ranges em PX e cooldown em ms, todos no mesmo relógio (ms) ===
      attackRangePx: (attackRangeTiles * PX_PER_TILE) | 0,
      aggroRangePx:  (aggroRangeTiles  * PX_PER_TILE) | 0,
      attackMs,
      lastAttackAt: Number(cur.lastAttackAt || 0),

      // mantém os originais para debug (opcional)
      attack_range: attackRangeTiles,
      aggro_range:  aggroRangeTiles,
      attack_ms:    attackMs,

      // debug
      spawnRect,
      home,
      _returningHome: cur._returningHome || false,
    };

    mobs.set(id, next);
    return next;
  }

  function computeRepathCooldownMs(mob) {
    const speed = Number.isFinite(mob?.moveSpeedPx) ? mob.moveSpeedPx : DEFAULT_CHASE_SPEED_PX_S;
    const travelMs = (STEP_PX / Math.max(1, speed)) * 1000;
    return Math.max(90, Math.min(420, travelMs * 0.9));
  }

  // Exposta para seed inicial a partir do index.js
  function seedPosition({ id, x, y, mapKey, spawnRect, speed = null, monsterKey = null }) {
    ensureMob(id, {
      x: (x | 0),
      y: (y | 0),
      mapKey: String(mapKey),
      mode: 'idle',
      targetHeroId: null,
      posUpdatedAt: Date.now(),
      spawnRect,
      speed,
      monsterKey,
      pendingStep: null,
    });
  }



  // Exposta para herói->mob (quando herói bate, aumenta threat)
  function addThreatFromHeroHit(instanceId, heroId, amount = THREAT_ON_HIT) {
    const mob = mobs.get(String(instanceId));
    if (!mob) return;
    const cur = mob.threat.get(String(heroId)) || 0;
    const inc = Math.max(0, Number(amount) || 0);
    mob.threat.set(String(heroId), cur + inc);
    if (DEBUG_AI) console.log(`[ai-mobs] threat++ mob=${instanceId} hero=${heroId} -> ${cur}+${inc}`);
  }

  // --------- Boot/Stop ----------
  async function start() {
    if (loopTimer) return;

    const alive = await fetchAliveMonsters();
    for (const r of alive) {
      const sx = Number(r.spawn_x);
      const sy = Number(r.spawn_y);
      const hasSpawn = Number.isFinite(sx) && Number.isFinite(sy);
      const spawnRect = hasSpawn
        ? {
            x: sx,
            y: sy,
            w: Number(r.spawn_w),
            h: Number(r.spawn_h)
          }
        : null;

      ensureMob(r.id, {
        mapKey: r.map_key,
        x: (r.x | 0),
        y: (r.y | 0),
        mode: 'idle',
        attack_range: r.attack_range,  // ainda em tiles (ok)
        aggro_range:  r.aggro_range,   // ainda em tiles (ok)
        attack_ms:    r.attack_ms,
        spawnRect,
        speed: r.speed,
        monsterKey: r.monster_key,
        pendingStep: null,
      });

    }

    lastTickAt = Date.now();
    loopTimer = setInterval(tickLoop, TICK_MS);
    console.log('[ai-mobs] started. alive=', alive.length);
  }

  function stop() {
    if (loopTimer) clearInterval(loopTimer);
    loopTimer = null;
    mobs.clear();
    console.log('[ai-mobs] stopped.');
  }

  // --------- Loop principal ----------
  const CARDINAL_DIRS = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];

  function tileKey(cx, cy) {
    return `${cx}|${cy}`;
  }

  function losGridRows(losGrid) {
    if (!losGrid || !losGrid.cols) return 0;
    return Math.floor(losGrid.data.length / losGrid.cols);
  }

  function isSolidTile(losGrid, cx, cy) {
    if (!losGrid || !losGrid.data) return false;
    if (cx < 0 || cy < 0) return true;
    if (cx >= losGrid.cols) return true;
    const rows = losGridRows(losGrid);
    if (cy >= rows) return true;
    const idx = cy * losGrid.cols + cx;
    return losGrid.data[idx] === 1;
  }

  function isTileBlockedByMobs(occupancy, cx, cy, ignoreId) {
    if (!occupancy) return false;
    const key = tileKey(cx, cy);
    const set = occupancy.get(key);
    if (!set || set.size === 0) return false;
    if (set.size === 1 && set.has(ignoreId)) return false;
    return true;
  }

  function buildHeroTileSet(mapKey, heroes, now = Date.now()) {
    const res = new Set();
    if (Array.isArray(heroes)) {
      for (const h of heroes) {
        const cx = Math.floor(Number(h?.x) / STEP_PX);
        const cy = Math.floor(Number(h?.y) / STEP_PX);
        if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
        res.add(tileKey(cx, cy));
      }
    }

    const mapStr = mapKey != null ? String(mapKey) : null;
    for (const mem of heroMemory.values()) {
      if (!mem) continue;
      if (mapStr && String(mem.mapKey) !== mapStr) continue;
      if (now - (mem.updatedAt || 0) > HERO_MEMORY_TTL_MS) continue;
      const cx = Number(mem.cx);
      const cy = Number(mem.cy);
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
      res.add(tileKey(cx, cy));
    }

    return res;
  }

  function buildMobOccupancy(list) {
    const occ = new Map();
    if (!Array.isArray(list)) return occ;
    for (const mob of list) {
      const cx = Math.floor(Number(mob?.x) / STEP_PX);
      const cy = Math.floor(Number(mob?.y) / STEP_PX);
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
      mob._tileCx = cx;
      mob._tileCy = cy;
      mob._tileKey = tileKey(cx, cy);
      let set = occ.get(mob._tileKey);
      if (!set) {
        set = new Set();
        occ.set(mob._tileKey, set);
      }
      set.add(mob.instanceId);
    }
    return occ;
  }

  async function maybeReturnMobHome({ mob, dt, losGrid, occupancy, heroTiles }) {
    if (!mob) return;

    const homeX = Number(mob?.home?.x);
    const homeY = Number(mob?.home?.y);
    if (!Number.isFinite(homeX) || !Number.isFinite(homeY)) {
      mob._returningHome = false;
      mob.pendingStep = null;
      return;
    }

    const distChebyPx = Math.max(Math.abs(mob.x - homeX), Math.abs(mob.y - homeY));
    if (distChebyPx <= HOME_TOLERANCE_PX) {
      mob._returningHome = false;
      if (distChebyPx > 0) {
        mob.x = homeX | 0;
        mob.y = homeY | 0;
        mob.posUpdatedAt = Date.now();
        mob._tileCx = Math.floor(mob.x / STEP_PX);
        mob._tileCy = Math.floor(mob.y / STEP_PX);
        mob._tileKey = tileKey(mob._tileCx, mob._tileCy);
        try {
          await run(
            `UPDATE monster_instances SET x=$2, y=$3, updated_at=now() WHERE id=$1`,
            [mob.instanceId, mob.x | 0, mob.y | 0]
          );
          try {
            broadcast({ type: 'mob_pos', instanceId: mob.instanceId, mapKey: mob.mapKey, x: mob.x, y: mob.y });
          } catch {}
        } catch (e) {
          console.warn('[ai-mobs] home persist error:', e?.message);
        }
      }
      mob.pendingStep = null;
      return;
    }

    if (!mob._returningHome) {
      mob.pendingStep = null;
    }
    mob._returningHome = true;

    const target = { x: homeX, y: homeY };
    let stepTarget = null;

    const hasValidPending = mob.pendingStep && Number.isFinite(mob.pendingStep.x) && Number.isFinite(mob.pendingStep.y);
    if (hasValidPending) {
      stepTarget = mob.pendingStep;
    } else {
      const step = pickStepGreedy(mob, target, losGrid, occupancy, heroTiles, null);
      if (!step) {
        mob.pendingStep = null;
        return;
      }
      stepTarget = { x: step.x | 0, y: step.y | 0 };
      mob.pendingStep = stepTarget;
    }

    const reached = await moveMobAndPersist(mob, stepTarget, dt, losGrid, occupancy);
    if (reached) {
      mob.pendingStep = null;
    }
  }

  function findNearestFreeTile({
    startCx,
    startCy,
    occupancy,
    heroTiles,
    losGrid,
    ignoreId,
    maxDepth = 8,
  }) {
    const queue = [{ cx: startCx, cy: startCy, depth: 0 }];
    const visited = new Set([tileKey(startCx, startCy)]);

    while (queue.length) {
      const node = queue.shift();
      if (node.depth >= maxDepth) continue;

      for (const dir of CARDINAL_DIRS) {
        const nx = node.cx + dir.dx;
        const ny = node.cy + dir.dy;
        if (isSolidTile(losGrid, nx, ny)) continue;
        const k = tileKey(nx, ny);
        if (visited.has(k)) continue;
        visited.add(k);
        if (heroTiles && heroTiles.has(k)) {
          // evita ocupar o mesmo tile que o herói, mas pode explorar ao redor
          queue.push({ cx: nx, cy: ny, depth: node.depth + 1 });
          continue;
        }

        const blocked = isTileBlockedByMobs(occupancy, nx, ny, ignoreId);
        if (!blocked) {
          return { cx: nx, cy: ny };
        }

        queue.push({ cx: nx, cy: ny, depth: node.depth + 1 });
      }
    }
    return null;
  }

  async function teleportMobToTile({ mob, cx, cy, occupancy }) {
    if (!mob) return;
    const prevCx = Math.floor(Number(mob.x) / STEP_PX);
    const prevCy = Math.floor(Number(mob.y) / STEP_PX);
    const prevKey = tileKey(prevCx, prevCy);

    const px = cx * STEP_PX + STEP_PX / 2;
    const py = cy * STEP_PX + STEP_PX / 2;
    mob.x = px | 0;
    mob.y = py | 0;
    mob.posUpdatedAt = Date.now();

    if (occupancy) {
      const prevSet = occupancy.get(prevKey);
      if (prevSet) {
        prevSet.delete(mob.instanceId);
        if (!prevSet.size) occupancy.delete(prevKey);
      }

      const destKey = tileKey(cx, cy);
      let set = occupancy.get(destKey);
      if (!set) {
        set = new Set();
        occupancy.set(destKey, set);
      }
      set.add(mob.instanceId);

      mob._tileCx = cx;
      mob._tileCy = cy;
      mob._tileKey = destKey;
    }

    try {
      await run(
        `UPDATE monster_instances SET x=$2, y=$3, updated_at=now() WHERE id=$1`,
        [mob.instanceId, mob.x | 0, mob.y | 0]
      );
      try {
        broadcast({ type: 'mob_pos', instanceId: mob.instanceId, mapKey: mob.mapKey, x: mob.x, y: mob.y });
      } catch {}
    } catch (e) {
      console.warn('[ai-mobs] teleport persist error:', e?.message);
    }
  }

  async function resolveMobStacks({ mobsInMap, occupancy, heroTiles, losGrid }) {
    if (!Array.isArray(mobsInMap) || mobsInMap.length === 0) return;
    const stacks = new Map();
    for (const mob of mobsInMap) {
      if (!mob || mob._tileKey == null) continue;
      if (!stacks.has(mob._tileKey)) stacks.set(mob._tileKey, []);
      stacks.get(mob._tileKey).push(mob);
    }

    for (const [key, stack] of stacks.entries()) {
      if (!Array.isArray(stack) || stack.length <= 1) continue;
      // mantém o primeiro no tile atual, desloca os demais
      stack.sort((a, b) => {
        const ia = Number(a?.instanceId) || 0;
        const ib = Number(b?.instanceId) || 0;
        return ia - ib;
      });

      for (let i = 1; i < stack.length; i++) {
        const mob = stack[i];
        const startCx = mob?._tileCx;
        const startCy = mob?._tileCy;
        if (!Number.isFinite(startCx) || !Number.isFinite(startCy)) continue;

        const free = findNearestFreeTile({
          startCx,
          startCy,
          occupancy,
          heroTiles,
          losGrid,
          ignoreId: mob.instanceId,
          maxDepth: 10,
        });

        if (!free) continue;
        await teleportMobToTile({ mob, cx: free.cx, cy: free.cy, occupancy });
      }
    }
  }

  async function tickLoop() {
    const now = Date.now();
    const dt = Math.min(0.25, (now - lastTickAt) / 1000);
    lastTickAt = now;

    // group by map
    const byMap = new Map();
    for (const m of mobs.values()) {
      if (!m.mapKey) continue;
      if (!byMap.has(m.mapKey)) byMap.set(m.mapKey, []);
      byMap.get(m.mapKey).push(m);
    }

    for (const [mapKey, list] of byMap.entries()) {
      const heroes = await fetchOnlineHeroesInMap(mapKey);

      const { grid, cols } = await getGrid(mapKey);
      const losGrid = { data: grid, cols };
      const occupancy = buildMobOccupancy(list);

      updateHeroMemoryForMap(mapKey, heroes, now);

      const heroTiles = buildHeroTileSet(mapKey, heroes, now);

      await resolveMobStacks({ mobsInMap: list, occupancy, heroTiles, losGrid });

      if (DEBUG_AI) {
        console.log(`[ai-mobs] tick map=${mapKey} heroes=${heroes.length} mobs=${list.length}`);
        if (heroes.length === 0 && list.length) {
          console.log(`[ai-mobs] no heroes online in map=${mapKey}`);
        }
      }

      for (const mob of list) {
        try {
          await stepMob(now, dt, mob, heroes, losGrid, occupancy, heroTiles);
        } catch (e) {
          console.warn('[ai-mobs] stepMob error:', e?.message);
        }
      }
    }
  }

async function stepMob(now, dt, mob, heroes, losGrid, occupancy, heroTiles) {
  decayThreat(mob, dt);
  selectTargetByThreat(now, mob, heroes, losGrid);

  if (!mob.targetHeroId) {
    mob.mode = 'idle';
    await maybeReturnMobHome({ mob, dt, losGrid, occupancy, heroTiles });
    return;
  }

  // 1) Posição do alvo: tentar "ao vivo" na lista heroes; se não houver, cair pro DB.
  let tgtPos =
    heroes.find(h => h.heroId === mob.targetHeroId) ||
    await getHeroLastPosPx(mob.targetHeroId, mob.mapKey);

  if (!tgtPos) {
    const mem = mob.targetHeroId ? heroMemory.get(String(mob.targetHeroId)) : null;
    if (mem && mem.mapKey === mob.mapKey && now - (mem.updatedAt || 0) <= HERO_MEMORY_TTL_MS) {
      tgtPos = {
        heroId: mob.targetHeroId,
        x: mem.cx * STEP_PX + STEP_PX / 2,
        y: mem.cy * STEP_PX + STEP_PX / 2,
        updatedMs: mem.updatedAt || now,
      };
    }
  }

  if (tgtPos && mob.targetHeroId) {
    recordHeroObservation({ heroId: mob.targetHeroId, mapKey: mob.mapKey, x: tgtPos.x, y: tgtPos.y, now });
  }

  if (!tgtPos) {
    if (now - mob.lastSeenAt > GIVEUP_MS) { mob.targetHeroId = null; mob.mode = 'idle'; }
    mob.pendingStep = null;
    return;
  }

  // 2) Melee estilo Tibia: aceita adjacência em 8-direções (inclui diagonal)
  //    e também checa alcance real do monstro em pixels com tolerância.
  const TILE = PX_PER_TILE;
  const dx = tgtPos.x - mob.x;
  const dy = tgtPos.y - mob.y;

  const mobCx  = Math.floor(mob.x / TILE);
  const mobCy  = Math.floor(mob.y / TILE);
  const heroCx = Math.floor(tgtPos.x / TILE);
  const heroCy = Math.floor(tgtPos.y / TILE);

  if (heroTiles && Number.isFinite(heroCx) && Number.isFinite(heroCy)) {
    heroTiles.add(tileKey(heroCx, heroCy));
  }

  // Chebyshev distance: <= 1 significa mesmo tile ou qualquer adjacente (8-dir)
  const dxC = Math.abs(mobCx - heroCx);
  const dyC = Math.abs(mobCy - heroCy);
  const isAdj8Cell = Math.max(dxC, dyC) <= 1;

  // Use o alcance em pixels do mob (+ tolerância) como fallback
  const PX_TOL = 0; // sem tolerância: evita “hit de longe”
  const atkPx = Math.max(mob.attackRangePx || TILE, TILE);
  const inRangePx = (dx * dx + dy * dy) <= (atkPx + PX_TOL) * (atkPx + PX_TOL);

  // Precisa ter linha de visão...
  const canSeeNow = IGNORE_LOS ? true : hasLoSpx(losGrid, mob.x, mob.y, tgtPos.x, tgtPos.y);

  if (DEBUG_AI) {
    const cheby = Math.max(Math.abs(dx), Math.abs(dy)) | 0;
    console.log(
      `[ai-mobs] tgt mob=${mob.instanceId} -> hero=${mob.targetHeroId} cheby=${cheby}px ` +
      `cells mob=(${mobCx},${mobCy}) hero=(${heroCx},${heroCy}) inRangePx=${inRangePx} los=${canSeeNow}`
    );
  }


  // >>> DESARME quando sair do alcance/LoS (evita "rajada" ao reentrar)
  if (!(inRangePx && canSeeNow)) {
    if (mob.mode === 'attack') mob.mode = 'chase';
    mob.lastAttackAt = 0; // força cooldown completo ao reentrar
  }

  // ATAQUE: SOMENTE se alcance/LOS ok E posições "frescas" (anti-stale hard-guard)
  if ((inRangePx || isAdj8Cell) && canSeeNow) {
    // compõe alvo com timestamp (se veio do DB, virá velho)
    let tgt = heroes.find(h => h.heroId === mob.targetHeroId);
    if (!tgt) {
      const fb = await getHeroLastPosPx(mob.targetHeroId, mob.mapKey);
      tgt = fb ? { heroId: mob.targetHeroId, x: fb.x, y: fb.y, updatedMs: fb.updatedMs || 0 } : null;
    }

    const gate = canMobHitNow({ now, mob, tgtPos: tgt, losGrid });
    if (!gate.ok) {
      if (DEBUG_AI) {
        console.log('[ai-mobs] HIT BLOQUEADO', gate.reason,
          'mob=', mob.instanceId, 'hero=', mob.targetHeroId,
          'mobPos=', {x:mob.x,y:mob.y, age: now-(mob.posUpdatedAt||0)},
          'heroPos=', tgt ? {x:tgt.x,y:tgt.y, age: now-(tgt.updatedMs||0)} : null
        );
      }
      // desarma ataque e volta a perseguir
      if (mob.mode === 'attack') mob.mode = 'chase';
      mob.lastAttackAt = 0;
      return;
    }

    mob.mode = 'attack';
    mob.pendingStep = null;
    mob.lastSeenAt = now;

    const cd = Number(mob.attackMs || (K.MONSTER_SPEED_MS && K.MONSTER_SPEED_MS.DEFAULT) || 1200);
    if ((now - (mob.lastAttackAt || 0)) >= cd) {
      mob.lastAttackAt = now;
      if (DEBUG_AI) {
        console.log('[ai-mobs] atk (melee px-range)', mob.instanceId, '->', mob.targetHeroId,
          'cells mob=', mobCx, mobCy, 'hero=', heroCx, heroCy, 'dx,dy=', dx|0, dy|0);
      }
      try {
        await applyMobHit({
          attackerInstanceId: String(mob.instanceId),
          targetHeroId: String(mob.targetHeroId),
          attackInfo: { min: 1, max: 3 },
          attackerPos: {
            x: Number.isFinite(mob.x) ? mob.x : undefined,
            y: Number.isFinite(mob.y) ? mob.y : undefined,
            mapKey: mob.mapKey,
            face: mob.face,
            unit: 'px',
            assumeTiles: false,
            assumePx: true,
          },
        });
      } catch (e) {
        console.warn('[ai-mobs] applyMobHit error:', e?.message);
      }
    }
    return;
  }



  // 3) CHASE (greedy cardinal com colisão no servidor)
  mob.mode = 'chase';

  const hasValidStep = mob.pendingStep && Number.isFinite(mob.pendingStep.x) && Number.isFinite(mob.pendingStep.y);
  let stepTarget = hasValidStep ? mob.pendingStep : null;

  if (!stepTarget && now >= mob.repathAt) {
    const heroMem = mob.targetHeroId ? heroMemory.get(String(mob.targetHeroId)) : null;
    const step = pickStepGreedy(mob, tgtPos, losGrid, occupancy, heroTiles, heroMem);
    if (step) {
      mob.pendingStep = { x: step.x | 0, y: step.y | 0 };
      stepTarget = mob.pendingStep;
      const cooldown = computeRepathCooldownMs(mob);
      mob.repathAt = now + cooldown;
    } else {
      mob.pendingStep = null;
      mob.repathAt = now + Math.max(120, computeRepathCooldownMs(mob));
    }
  }

  if (stepTarget) {
    const reached = await moveMobAndPersist(mob, stepTarget, dt, losGrid, occupancy);
    if (reached) {
      mob.pendingStep = null;
      mob.repathAt = now;
    }
  }

}

  // --------- Threat ----------
  function decayThreat(mob, dt) {
    if (!mob.threat || mob.threat.size === 0) return;
    const dec = THREAT_DECAY * dt;
    for (const [hid, v] of mob.threat.entries()) {
      const nv = Math.max(0, v - dec);
      if (nv <= 0.001) mob.threat.delete(hid);
      else mob.threat.set(hid, nv);
    }
  }

  function selectTargetByThreat(now, mob, heroes, losGrid) {
    const aggroR2 = (mob.aggroRangePx || (8 * PX_PER_TILE)) ** 2;

    // DEBUG: distância mais próxima (mesmo que fora do aggro)
    let nearest = { id: null, d2: Infinity };

    for (const h of heroes) {
      const dx = mob.x - h.x, dy = mob.y - h.y;
      const d2 = dx*dx + dy*dy;
      if (d2 < nearest.d2) nearest = { id: h.heroId, d2 };

      if (d2 <= aggroR2) {
        const canSee = IGNORE_LOS ? true : hasLoSpx(losGrid, mob.x, mob.y, h.x, h.y);
        const base = canSee ? THREAT_ON_SIGHT : THREAT_ON_SIGHT * 0.4;
        const cur = mob.threat.get(h.heroId) || 0;
        const next = cur + base;
        mob.threat.set(h.heroId, next);

        if (DEBUG_AI) {
          const cheby = Math.max(Math.abs(dx), Math.abs(dy)) | 0;
          console.log(
            `[ai-mobs] inRange mob=${mob.instanceId} hero=${h.heroId} cheby=${cheby}px canSee=${canSee} threat=${next.toFixed(2)}`
          );
        }


        if (canSee) mob.lastSeenAt = now;
      }
    }

    if (DEBUG_AI && nearest.id) {
      const cheby = Math.max(
        Math.abs(mob.x - heroes.find(h => h.heroId === nearest.id).x),
        Math.abs(mob.y - heroes.find(h => h.heroId === nearest.id).y)
      ) | 0;
      const aggro = Math.sqrt(aggroR2) | 0; // pode manter esse, é só info
      console.log(`[ai-mobs] nearest mob=${mob.instanceId} -> hero=${nearest.id} cheby=${cheby}px (aggro≈${aggro}px)`);
    }


    // Escolhe o maior threat; troca só se superar atual + histerese
    let bestId = null, bestV = -1;
    for (const [hid, v] of mob.threat.entries()) if (v > bestV) { bestV = v; bestId = hid; }

    if (!bestId) { mob.targetHeroId = null; return; }
    if (!mob.targetHeroId) {
      mob.targetHeroId = bestId;
      mob.lastSwitchAt = now;
      mob.lastSeenAt = now;
      if (DEBUG_AI) console.log(`[ai-mobs] target set mob=${mob.instanceId} -> ${bestId} (threat=${bestV.toFixed(2)})`);
      return;
    }

    if (bestId !== mob.targetHeroId) {
      const curV = mob.threat.get(mob.targetHeroId) || 0;
      if (bestV >= curV + SWITCH_HYSTERESIS) {
        if (DEBUG_AI) console.log(`[ai-mobs] switch target ...`);
        mob.targetHeroId = bestId;
        mob.lastSwitchAt = now;
        mob.lastAttackAt = 0; // <<< evita hit “de graça” ao trocar de alvo
      }
    }
  }

  // --------- Movement ----------
  function isBlockedPx(losGrid, wx, wy) {
    if (IGNORE_COLLISION) return false; // toggle de teste
    const cx = Math.floor(wx / STEP_PX);
    const cy = Math.floor(wy / STEP_PX);
    if (cx < 0 || cy < 0 || cy * losGrid.cols + cx >= losGrid.data.length) return true;
    // grid.js marca 1 como sólido/bloqueado. Se o seu mapa usar o inverso, troque para === 0.
    return losGrid.data[cy * losGrid.cols + cx] === 1;
  }

  function pickStepGreedy(mob, tgtPos, losGrid, occupancy, heroTiles, heroMem) {
    const c0x = Math.floor(mob.x / STEP_PX), c0y = Math.floor(mob.y / STEP_PX);
    const heroCx = Math.floor(tgtPos.x / STEP_PX), heroCy = Math.floor(tgtPos.y / STEP_PX);
    const predicted = predictHeroTileCx(heroMem, heroCx, heroCy);
    const goalCx = Number.isFinite(predicted?.cx) ? predicted.cx : heroCx;
    const goalCy = Number.isFinite(predicted?.cy) ? predicted.cy : heroCy;
    const currentDist = Math.abs(c0x - goalCx) + Math.abs(c0y - goalCy);

    const heroTilesSet = heroTiles || new Set();

    const candidates = [];
    for (const dir of CARDINAL_DIRS) {
      candidates.push({ cx: c0x + dir.dx, cy: c0y + dir.dy });
    }

    let best = null;
    let bestScore = Infinity;

    for (const c of candidates) {
      const wx = c.cx * STEP_PX + STEP_PX / 2;
      const wy = c.cy * STEP_PX + STEP_PX / 2;
      if (isBlockedPx(losGrid, wx, wy)) continue;
      const key = tileKey(c.cx, c.cy);
      if (heroTilesSet.has(key)) continue;
      if (c.cx === heroCx && c.cy === heroCy) continue;
      if (isTileBlockedByMobs(occupancy, c.cx, c.cy, mob.instanceId)) continue;

      const distGoal = Math.abs(c.cx - goalCx) + Math.abs(c.cy - goalCy);
      const distHero = Math.abs(c.cx - heroCx) + Math.abs(c.cy - heroCy);
      const densityPenalty = computeMobDensityPenalty({
        occupancy,
        cx: c.cx,
        cy: c.cy,
        mobId: mob.instanceId,
        heroCx,
        heroCy,
      });
      const flank = computeMobFlankBonus({
        cx: c.cx,
        cy: c.cy,
        heroCx,
        heroCy,
        heading: predicted?.heading,
      });

      let score = distGoal + densityPenalty - flank;
      if (distHero <= 1 && densityPenalty < 0.6) score -= 0.25;
      if (distGoal > currentDist && currentDist > 1) score += (distGoal - currentDist) * 1.4;

      if (score < bestScore) {
        bestScore = score;
        best = { x: wx, y: wy };
      }
    }

    if (!best && DEBUG_AI) console.log(`[ai-mobs] path blocked mob=${mob.instanceId}`);
    return best;
  }

function clampToMapPx(losGrid, px) {
  const cols = losGrid.cols;
  const rows = Math.floor(losGrid.data.length / cols);
  const maxX = cols * PX_PER_TILE - 1;
  const maxY = rows * PX_PER_TILE - 1;
  return {
    x: Math.max(0, Math.min(px.x, maxX)),
    y: Math.max(0, Math.min(px.y, maxY)),
  };
}

async function moveMobAndPersist(mob, step, dt, losGrid, occupancy) {
  if (!mob || !step) return true;
  const speed = Number.isFinite(mob.moveSpeedPx) ? mob.moveSpeedPx : DEFAULT_CHASE_SPEED_PX_S;
  const maxMove = Math.max(0, speed * Math.max(0, dt));

  const dx = step.x - mob.x;
  const dy = step.y - mob.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= 0.5) {
    mob.x = step.x | 0;
    mob.y = step.y | 0;
    mob.posUpdatedAt = Date.now();
    return true;
  }

  const ux = dx / dist;
  const uy = dy / dist;
  const nx = dist <= maxMove ? step.x : (mob.x + ux * maxMove);
  const ny = dist <= maxMove ? step.y : (mob.y + uy * maxMove);

  const prevCx = Math.floor(mob.x / STEP_PX);
  const prevCy = Math.floor(mob.y / STEP_PX);

  // clamp dentro do mapa (evita OOB por arredondamento/velocidade)
  const clamped = losGrid ? clampToMapPx(losGrid, { x: nx|0, y: ny|0 }) : { x: nx|0, y: ny|0 };
  mob.x = clamped.x; mob.y = clamped.y;
  mob.posUpdatedAt = Date.now(); // <<< posição do mob ficou "fresca" agora

  const nextCx = Math.floor(mob.x / STEP_PX);
  const nextCy = Math.floor(mob.y / STEP_PX);

  if (prevCx !== nextCx || prevCy !== nextCy) {
    if (occupancy) {
      const prevKey = tileKey(prevCx, prevCy);
      const prevSet = occupancy.get(prevKey);
      if (prevSet) {
        prevSet.delete(mob.instanceId);
        if (!prevSet.size) occupancy.delete(prevKey);
      }
      const nextKey = tileKey(nextCx, nextCy);
      let set = occupancy.get(nextKey);
      if (!set) {
        set = new Set();
        occupancy.set(nextKey, set);
      }
      set.add(mob.instanceId);
      mob._tileCx = nextCx;
      mob._tileCy = nextCy;
      mob._tileKey = nextKey;
    }
    try {
      await run(
        `UPDATE monster_instances SET x=$2, y=$3, updated_at=now() WHERE id=$1`,
        [mob.instanceId, mob.x | 0, mob.y | 0]
      );


      try {
        broadcast({ type:'mob_pos', instanceId: mob.instanceId, mapKey: mob.mapKey, x: mob.x, y: mob.y });
      } catch {}
    } catch (e) {
      console.warn('[ai-mobs] persist pos error:', e?.message);
    }
  }

  const remaining = Math.hypot(step.x - mob.x, step.y - mob.y);
  return remaining <= 1.25;
}


  // limpa threat de um herói (ex.: ao morrer/respawnar)
  function removeHeroThreat(heroId) {
    const hid = String(heroId);
    for (const mob of mobs.values()) {
      if (mob?.threat?.has(hid)) mob.threat.delete(hid);
      if (mob.targetHeroId === hid) {
        mob.targetHeroId = null;
        mob.mode = 'idle';
        mob.lastAttackAt = 0;
      }
    }
  }

  // --------- Exports ----------
  module.exports = {
    start,
    stop,
    seedPosition,
    addThreatFromHeroHit,
    removeHeroThreat,
    _state: mobs
  };

