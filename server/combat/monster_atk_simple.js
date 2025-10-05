// server/combat/monster_atk_simple.js
const { all, get, run } = require('../models/db'); // helpers do projeto

// ======= Tuning via .env =======
const TILE = 32;

// Loop
const TICK_MS = +(process.env.MONSTER_ATK_TICK_MS || 300);

// Movimento
const MONSTER_STEP_MS        = +(process.env.MONSTER_STEP_MS || 250);    // 1 passo (1 tile) a cada X ms
const MONSTER_PERSIST_POS_MS = +(process.env.MONSTER_PERSIST_POS_MS || 1000); // persiste pos no DB no máx. 1x/s

// Ataque corpo-a-corpo
const ATK_COOLDOWN_MS = +(process.env.MONSTER_ATK_COOLDOWN_MS || 900);
const DMG_MIN  = +(process.env.MONSTER_BASE_DMG_MIN || 6);
const DMG_MAX  = +(process.env.MONSTER_BASE_DMG_MAX || 12);

// Gate do spawn (agora DESLIGADO por padrão)
const CHASE_INSIDE_SPAWN_ONLY = (process.env.MONSTER_CHASE_INSIDE_SPAWN_ONLY ?? '0') === '1';

// Fallback: mesmo com gate ligado, se não achar alvo dentro do spawn,
// permite perseguir até N tiles de distância (evita mobs parados)
const CHASE_MAX_TILES = +(process.env.MONSTER_CHASE_MAX_TILES || 25);

// Evita processar monstro demais por tick (alivia pool)
const MONSTER_MAX_PER_TICK = +(process.env.MONSTER_MAX_PER_TICK || 40);
const MONSTER_SEARCH_DEPTH = +(process.env.MONSTER_STEP_SEARCH_DEPTH || 4);
const MONSTER_STEP_BACKTRACK_PENALTY = +(process.env.MONSTER_STEP_BACKTRACK_PENALTY || 2);
const MONSTER_STACK_RESOLVE_DEPTH = +(process.env.MONSTER_STACK_RESOLVE_DEPTH || 6);

// ======= Estado em RAM =======
let timer = null;
let running = false;

const _lastAtkAt      = new Map(); // monsterId -> ms
const _lastMoveAt     = new Map(); // monsterId -> ms
const _lastPosWriteAt = new Map(); // monsterId -> ms
const _wasQuantized   = new Set(); // monsterId -> bool
const _livePos        = new Map(); // monsterId -> { x, y, mapKey }

// ======= Utils =======
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
const tileOf = (v) => Math.floor(Number(v || 0) / TILE);
const centerOfTile = (t) => (t * TILE) + TILE / 2;
const tileKey = (tx, ty) => `${tx},${ty}`;

function buildMonsterTileMap(list = []) {
  const byMap = new Map();
  for (const m of list) {
    const mapKey = m?.map_key == null ? '__null__' : String(m.map_key);
    const tx = tileOf(m?.x);
    const ty = tileOf(m?.y);
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) continue;
    if (!byMap.has(mapKey)) byMap.set(mapKey, new Map());
    const grid = byMap.get(mapKey);
    const key = tileKey(tx, ty);
    let set = grid.get(key);
    if (!set) { set = new Set(); grid.set(key, set); }
    set.add(m.id);
  }
  return byMap;
}

function buildHeroTileSet(list = []) {
  const byMap = new Map();
  for (const h of list) {
    const mapKey = h?.map_key == null ? '__null__' : String(h.map_key);
    const tx = tileOf(h?.x);
    const ty = tileOf(h?.y);
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) continue;
    if (!byMap.has(mapKey)) byMap.set(mapKey, new Set());
    byMap.get(mapKey).add(tileKey(tx, ty));
  }
  return byMap;
}

function isAdjacent4Tiles(mx, my, hx, hy) {
  const dx = Math.abs(mx - hx);
  const dy = Math.abs(my - hy);
  return (dx + dy) === 1; // ortogonal
}

function isInsideSpawnRect(hx, hy, m, pad = 0) {
  const sx = Number(m.sx) | 0;
  const sy = Number(m.sy) | 0;
  const sw = Math.max(1, Number(m.sw) || 32);
  const sh = Math.max(1, Number(m.sh) || 32);
  return hx >= sx - pad && hx <= sx + sw + pad &&
         hy >= sy - pad && hy <= sy + sh + pad;
}

function isTileInsideSpawn(tx, ty, m) {
  if (!CHASE_INSIDE_SPAWN_ONLY) return true;
  const sx = Number(m.sx) | 0, sy = Number(m.sy) | 0;
  const sw = Math.max(1, Number(m.sw) || 32);
  const sh = Math.max(1, Number(m.sh) || 32);
  const minTx = tileOf(sx);
  const maxTx = tileOf(sx + sw - 1);
  const minTy = tileOf(sy);
  const maxTy = tileOf(sy + sh - 1);
  return tx >= minTx && tx <= maxTx && ty >= minTy && ty <= maxTy;
}

const CARDINAL_STEPS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

function findNearestFreeTile({
  startTx,
  startTy,
  monster,
  tilesForMap,
  heroTiles,
  maxDepth = MONSTER_STACK_RESOLVE_DEPTH,
}) {
  if (maxDepth <= 0) return null;

  const queue = [{ tx: startTx, ty: startTy, depth: 0 }];
  const visited = new Set([tileKey(startTx, startTy)]);
  const heroTileSet = heroTiles instanceof Set ? heroTiles : new Set();

  while (queue.length) {
    const node = queue.shift();
    if (node.depth >= maxDepth) continue;

    for (const step of CARDINAL_STEPS) {
      const nx = node.tx + step.dx;
      const ny = node.ty + step.dy;
      if (!isTileInsideSpawn(nx, ny, monster)) continue;

      const key = tileKey(nx, ny);
      if (visited.has(key)) continue;
      visited.add(key);

      const blockedByHero = heroTileSet.has(key);
      const occupantSet = tilesForMap.get(key);
      const blockedByMonster = occupantSet && occupantSet.size > 0;

      if (!blockedByHero && !blockedByMonster) {
        return { tx: nx, ty: ny };
      }

      if (blockedByHero) continue;

      queue.push({ tx: nx, ty: ny, depth: node.depth + 1 });
    }
  }

  return null;
}

function tilesOccupiedByOthers(set, monsterId) {
  if (!set) return 0;
  if (!set.size) return 0;
  if (!set.has(monsterId)) return set.size;
  if (set.size <= 1) return 0;
  return set.size - 1;
}

function findBestStepToward({
  mx,
  my,
  hx,
  hy,
  monster,
  tilesForMap,
  heroTiles,
}) {
  const heroTilesSet = heroTiles instanceof Set ? heroTiles : new Set();
  const originKey = tileKey(mx, my);
  const visited = new Set([originKey]);
  const queue = [];
  const currentDist = Math.abs(mx - hx) + Math.abs(my - hy);

  const pushNode = (nx, ny, depth, firstStep) => {
    if (depth > MONSTER_SEARCH_DEPTH) return;
    if (!isTileInsideSpawn(nx, ny, monster)) return;
    const key = tileKey(nx, ny);
    if (visited.has(key)) return;
    visited.add(key);
    queue.push({
      nx,
      ny,
      key,
      depth,
      firstStep,
      dist: Math.abs(nx - hx) + Math.abs(ny - hy),
    });
  };

  for (const step of CARDINAL_STEPS) {
    const nx = mx + step.dx;
    const ny = my + step.dy;
    pushNode(nx, ny, 1, { nx, ny });
  }

  let best = null;

  const scoreNode = (node) => {
    const firstDist = Math.abs(node.firstStep.nx - hx) + Math.abs(node.firstStep.ny - hy);
    const distDelta = firstDist - currentDist;
    const backtrackPenalty = distDelta > 0 ? distDelta * MONSTER_STEP_BACKTRACK_PENALTY : 0;
    return node.dist + (node.depth * 0.1) + backtrackPenalty;
  };

  while (queue.length) {
    queue.sort((a, b) => {
      const sa = scoreNode(a);
      const sb = scoreNode(b);
      if (sa !== sb) return sa - sb;
      if (a.dist !== b.dist) return a.dist - b.dist;
      return a.depth - b.depth;
    });

    const node = queue.shift();
    const destKey = node.key;
    if (destKey === originKey) continue;

    const blockedByHero = heroTilesSet.has(destKey);
    const destSet = tilesForMap.get(destKey);
    const blockedByMonster = tilesOccupiedByOthers(destSet, monster.id) > 0;

    if (!blockedByHero && !blockedByMonster) {
      const score = scoreNode(node);
      const improves = !best || score < best.score;
      const keepsDistanceReasonable = node.dist <= currentDist || currentDist <= 1;
      if (improves && keepsDistanceReasonable) {
        best = {
          nx: node.firstStep.nx,
          ny: node.firstStep.ny,
          score,
          dist: node.dist,
          depth: node.depth,
        };
        if (node.depth === 1 && node.dist <= currentDist) break;
      }
    }

    if (node.depth >= MONSTER_SEARCH_DEPTH) {
      continue;
    }

    for (const step of CARDINAL_STEPS) {
      const nx = node.nx + step.dx;
      const ny = node.ny + step.dy;
      pushNode(nx, ny, node.depth + 1, node.firstStep);
    }
  }

  return best;
}

async function resolveTileStacks({
  tilesForMap,
  heroTiles,
  monstersById,
  now,
  budget,
  movedSet,
}) {
  if (budget <= 0) return 0;
  const heroTileSet = heroTiles instanceof Set ? heroTiles : new Set();
  let used = 0;

  for (const [tileKeyStr, occupants] of Array.from(tilesForMap.entries())) {
    if (used >= budget) break;
    if (!occupants || occupants.size <= 1) continue;

    const ids = Array.from(occupants);
    // Keep the first occupant, try to move the rest away
    for (let i = 1; i < ids.length && used < budget; i++) {
      const monsterId = ids[i];
      const monster = monstersById.get(monsterId);
      if (!monster) continue;

      const lastMove = _lastMoveAt.get(monsterId) || 0;
      if (now - lastMove < MONSTER_STEP_MS) continue;

      const [txStr, tyStr] = tileKeyStr.split(',');
      const tx = Number(txStr);
      const ty = Number(tyStr);
      if (!Number.isFinite(tx) || !Number.isFinite(ty)) continue;

      const escape = findNearestFreeTile({
        startTx: tx,
        startTy: ty,
        monster,
        tilesForMap,
        heroTiles: heroTileSet,
      });

      if (!escape) continue;

      const fromSet = tilesForMap.get(tileKeyStr);
      if (fromSet) {
        fromSet.delete(monsterId);
        if (!fromSet.size) tilesForMap.delete(tileKeyStr);
      }

      const destKey = tileKey(escape.tx, escape.ty);
      if (!tilesForMap.has(destKey)) tilesForMap.set(destKey, new Set());
      tilesForMap.get(destKey).add(monsterId);

      const px = centerOfTile(escape.tx);
      const py = centerOfTile(escape.ty);
      monster.x = px;
      monster.y = py;
      _livePos.set(monsterId, { x: px, y: py, mapKey: monster.map_key });
      _lastMoveAt.set(monsterId, now);
      movedSet.add(monsterId);

      try { await updateMonsterPos(monsterId, px, py, now); } catch {}

      if (global._sendToMap) {
        try { global._sendToMap(monster.map_key, { type: 'monster_move', id: monsterId, x: px, y: py }); } catch {}
      }

      used++;
      if (used >= budget) break;
    }
  }

  return used;
}

// ======= DB =======
async function fetchAliveMonsters() {
  const sql = `
    SELECT mi.id, mi.map_key, mi.x, mi.y, mi.hp, mi.hp_max,
           s.id              AS spawn_id,
           s.x               AS sx,
           s.y               AS sy,
           COALESCE(s.w,32)  AS sw,
           COALESCE(s.h,32)  AS sh,
           s."monsterKey"    AS monster_key,
           COALESCE(mm.name, s."monsterKey") AS monster_name
      FROM monster_instances mi
      LEFT JOIN spawns s ON s.id = mi.spawn_id
      LEFT JOIN monsters_master mm ON mm.key = s."monsterKey"
     WHERE mi.state = 'ALIVE' AND mi.hp > 0
  `;
  return await all(sql);
}

async function fetchAliveHeroesWithPos() {
  const sql = `
    SELECT ph.id AS hero_id, ph."playerId" AS player_id,
           ph.hp, ph.max_hp, ph.alive,
           pl.map_key, pl.x, pl.y
      FROM player_heroes ph
      JOIN player_last_pos pl
        ON pl.player_id::text = ph."playerId"::text
     WHERE ph.alive = TRUE AND ph.hp > 0
  `;
  return await all(sql);
}

async function applyDamageToHero(heroId, dmg) {
  const sql = `
    UPDATE player_heroes
       SET hp = GREATEST(hp - $2, 0),
           alive = CASE WHEN hp - $2 <= 0 THEN FALSE ELSE alive END
     WHERE id = $1
     RETURNING id, hp, max_hp, alive
  `;
  return await get(sql, [heroId, dmg]);
}

async function markLastHit(monsterId, heroId) {
  try {
    await run(
      `UPDATE monster_instances
          SET last_hit_hero_id = $2,
              last_hit_at = NOW()
        WHERE id = $1`,
      [monsterId, heroId]
    );
  } catch {}
}

async function updateMonsterPos(id, px, py, now) {
  const lastW = _lastPosWriteAt.get(id) || 0;
  if (now - lastW < MONSTER_PERSIST_POS_MS) return; // throttling de escrita
  try {
    await run(`UPDATE monster_instances SET x=$2, y=$3 WHERE id=$1`, [id, px | 0, py | 0]);
    _lastPosWriteAt.set(id, now);
  } catch {}
}

// ======= Loop =======
async function tick() {
  if (running) return; // anti overlap
  running = true;

  try {
    const [monsters, heroes] = await Promise.all([
      fetchAliveMonsters(),
      fetchAliveHeroesWithPos(),
    ]);

    for (const m of monsters) {
      const live = _livePos.get(m.id);
      if (!live) continue;
      if (Number.isFinite(live.x)) m.x = live.x;
      if (Number.isFinite(live.y)) m.y = live.y;
      if (live.mapKey !== undefined && live.mapKey !== null) m.map_key = live.mapKey;
    }

    if (_livePos.size) {
      const aliveIds = new Set(monsters.map(m => m.id));
      for (const id of _livePos.keys()) {
        if (!aliveIds.has(id)) _livePos.delete(id);
      }
    }
    if (!monsters.length || !heroes.length) { running = false; return; }

    const monsterTilesByMap = buildMonsterTileMap(monsters);
    const heroTilesByMap = buildHeroTileSet(heroes);

    const heroesByMap = new Map();
    for (const h of heroes) {
      if (!heroesByMap.has(h.map_key)) heroesByMap.set(h.map_key, []);
      heroesByMap.get(h.map_key).push(h);
    }

    const now = Date.now();
    const monstersById = new Map(monsters.map(m => [m.id, m]));
    const movedThisTick = new Set();
    let movesUsed = 0;

    for (const [mapKeyStr, tilesForMap] of monsterTilesByMap.entries()) {
      if (movesUsed >= MONSTER_MAX_PER_TICK) break;
      const heroTilesForMap = heroTilesByMap.get(mapKeyStr) || new Set();
      movesUsed += await resolveTileStacks({
        tilesForMap,
        heroTiles: heroTilesForMap,
        monstersById,
        now,
        budget: MONSTER_MAX_PER_TICK - movesUsed,
        movedSet: movedThisTick,
      });
    }

    for (const m of monsters) {
      const alreadyMoved = movedThisTick.has(m.id);
      const hs = heroesByMap.get(m.map_key);
      if (!hs || !hs.length) continue;

      const mapKeyStr = m.map_key == null ? '__null__' : String(m.map_key);
      let tilesForMap = monsterTilesByMap.get(mapKeyStr);
      if (!tilesForMap) {
        tilesForMap = new Map();
        monsterTilesByMap.set(mapKeyStr, tilesForMap);
      }
      const heroTilesForMap = heroTilesByMap.get(mapKeyStr) || new Set();

      // Quantiza 1x: centraliza no tile
      if (!_wasQuantized.has(m.id)) {
        const mx0 = tileOf(m.x), my0 = tileOf(m.y);
        const cx = centerOfTile(mx0), cy = centerOfTile(my0);
        if (cx !== (m.x | 0) || cy !== (m.y | 0)) {
          await updateMonsterPos(m.id, cx, cy, now);
          m.x = cx; m.y = cy;
        }
        _wasQuantized.add(m.id);
        _livePos.set(m.id, { x: m.x, y: m.y, mapKey: m.map_key });
      }

      // Alvo mais próximo (aplica gate se ligado; senão, considera todos)
      let best = null;
      let bestD = Infinity;

      const mx = tileOf(m.x), my = tileOf(m.y);
      const currentTileKey = tileKey(mx, my);
      if (!tilesForMap.has(currentTileKey)) {
        tilesForMap.set(currentTileKey, new Set([m.id]));
      } else {
        const set = tilesForMap.get(currentTileKey);
        if (!set.has(m.id)) set.add(m.id);
      }

      // 1) tenta dentro do spawn
      for (const h of hs) {
        const hx = tileOf(h.x), hy = tileOf(h.y);
        if (CHASE_INSIDE_SPAWN_ONLY && !isInsideSpawnRect(h.x, h.y, m)) continue;
        const d = Math.abs(mx - hx) + Math.abs(my - hy);
        if (d < bestD) { bestD = d; best = h; }
      }

      // 2) fallback: não achou ninguém dentro → aceita fora até CHASE_MAX_TILES
      if (!best && CHASE_MAX_TILES > 0) {
        for (const h of hs) {
          const hx = tileOf(h.x), hy = tileOf(h.y);
          const d = Math.abs(mx - hx) + Math.abs(my - hy);
          if (d <= CHASE_MAX_TILES && d < bestD) { bestD = d; best = h; }
        }
      }

      if (!best) continue;

      const hx = tileOf(best.x), hy = tileOf(best.y);
      const adjacent = isAdjacent4Tiles(mx, my, hx, hy);

      // 1) mover se não adjacente
      if (!adjacent && !alreadyMoved) {
        const lastMove = _lastMoveAt.get(m.id) || 0;
        const canMove = now - lastMove >= MONSTER_STEP_MS && movesUsed < MONSTER_MAX_PER_TICK;
        if (canMove) {
          const fromKey = tileKey(mx, my);
          const bestStep = findBestStepToward({
            mx,
            my,
            hx,
            hy,
            monster: m,
            tilesForMap,
            heroTiles: heroTilesForMap,
          });

          if (bestStep) {
            const destKey = tileKey(bestStep.nx, bestStep.ny);

            let fromSet = tilesForMap.get(fromKey);
            if (fromSet) {
              fromSet.delete(m.id);
              if (!fromSet.size) tilesForMap.delete(fromKey);
            }

            if (!tilesForMap.has(destKey)) tilesForMap.set(destKey, new Set());
            tilesForMap.get(destKey).add(m.id);

            const px = centerOfTile(bestStep.nx);
            const py = centerOfTile(bestStep.ny);
            m.x = px; m.y = py;
            _livePos.set(m.id, { x: px, y: py, mapKey: m.map_key });
            _lastMoveAt.set(m.id, now);
            movedThisTick.add(m.id);
            movesUsed++;
            await updateMonsterPos(m.id, px, py, now);

            if (global._sendToMap) {
              try { global._sendToMap(m.map_key, { type: 'monster_move', id: m.id, x: px, y: py }); } catch {}
            }
          } else {
            _lastMoveAt.set(m.id, now);
          }
        }
        continue; // não ataca enquanto não estiver ao lado
      } else if (!adjacent) {
        continue;
      }

      // 2) adjacente → tentar bater (cooldown)
      const lastAtk = _lastAtkAt.get(m.id) || 0;
      if (now - lastAtk < ATK_COOLDOWN_MS) continue;

      const dmg = rand(DMG_MIN, DMG_MAX);

      try {
        const resHero = await applyDamageToHero(best.hero_id, dmg);
        await markLastHit(m.id, best.hero_id);
        _lastAtkAt.set(m.id, now);

        // remove do lote se morreu (evita múltiplos hits no mesmo tick)
        if (resHero?.alive === false) {
          const arr = heroesByMap.get(best.map_key);
          if (arr) {
            const idx = arr.findIndex(hh => String(hh.hero_id) === String(best.hero_id));
            if (idx >= 0) arr.splice(idx, 1);
          }
        } else if (resHero) {
          best.hp = resHero.hp;
        }

        if (global._sendToMap) {
          global._sendToMap(best.map_key, {
            type: 'hero_hit',
            heroId: best.hero_id,
            dmg,
            hp: resHero?.hp,
            hpMax: resHero?.max_hp,
            died: resHero?.alive === false,
            instanceId: m.id,
            monster: {
              id: m.id,
              key: m.monster_key || 'unknown',
              name: m.monster_name || m.monster_key || 'Monster',
              x: m.x, y: m.y,
              mapKey: best.map_key,
              spawnId: m.spawn_id
            }
          });
        }
      } catch {
        // erro de DB no hit — segue sem derrubar
      }
    }
  } catch (err) {
    console.warn('[monster_atk_simple] tick error:', err && err.message);
  } finally {
    running = false;
  }
}

function start() {
  if (timer) return;
  timer = setInterval(() => { tick(); }, TICK_MS);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop };
