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

// ======= Estado em RAM =======
let timer = null;
let running = false;

const _lastAtkAt      = new Map(); // monsterId -> ms
const _lastMoveAt     = new Map(); // monsterId -> ms
const _lastPosWriteAt = new Map(); // monsterId -> ms
const _wasQuantized   = new Set(); // monsterId -> bool

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

function candidateTilesToward(mx, my, hx, hy, m) {
  const dxTiles = hx - mx;
  const dyTiles = hy - my;
  if (dxTiles === 0 && dyTiles === 0) return [];

  const preferX = Math.abs(dxTiles) >= Math.abs(dyTiles);
  const dirs = [];

  const pushDir = (dx, dy) => {
    if (!dx && !dy) return;
    const candX = mx + dx;
    const candY = my + dy;
    if (!isTileInsideSpawn(candX, candY, m)) return;
    const key = tileKey(candX, candY);
    if (!dirs.some((d) => d.key === key)) dirs.push({ nx: candX, ny: candY, key });
  };

  const primary = preferX
    ? [{ dx: Math.sign(dxTiles), dy: 0 }, { dx: 0, dy: Math.sign(dyTiles) }]
    : [{ dx: 0, dy: Math.sign(dyTiles) }, { dx: Math.sign(dxTiles), dy: 0 }];
  for (const d of primary) pushDir(d.dx, d.dy);

  const lateral = preferX
    ? [{ dx: 0, dy: 1 }, { dx: 0, dy: -1 }]
    : [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }];
  for (const d of lateral) pushDir(d.dx, d.dy);

  return dirs;
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
    if (!monsters.length || !heroes.length) { running = false; return; }

    const slice = monsters.slice(0, MONSTER_MAX_PER_TICK);
    const monsterTilesByMap = buildMonsterTileMap(monsters);
    const heroTilesByMap = buildHeroTileSet(heroes);

    const heroesByMap = new Map();
    for (const h of heroes) {
      if (!heroesByMap.has(h.map_key)) heroesByMap.set(h.map_key, []);
      heroesByMap.get(h.map_key).push(h);
    }

    const now = Date.now();

    for (const m of slice) {
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
      if (!adjacent) {
        const lastMove = _lastMoveAt.get(m.id) || 0;
        if (now - lastMove >= MONSTER_STEP_MS) {
          const fromKey = tileKey(mx, my);
          const candidates = candidateTilesToward(mx, my, hx, hy, m);
          let moved = false;

          for (const step of candidates) {
            const destKey = tileKey(step.nx, step.ny);
            if (destKey === fromKey) continue;

            const destSet = tilesForMap.get(destKey);
            const blockedByMonster = destSet && destSet.size > 0;
            const blockedByHero = heroTilesForMap.has(destKey);
            if (blockedByMonster || blockedByHero) continue;

            let fromSet = tilesForMap.get(fromKey);
            if (fromSet) {
              fromSet.delete(m.id);
              if (!fromSet.size) tilesForMap.delete(fromKey);
            }

            if (!tilesForMap.has(destKey)) tilesForMap.set(destKey, new Set());
            tilesForMap.get(destKey).add(m.id);

            const px = centerOfTile(step.nx);
            const py = centerOfTile(step.ny);
            m.x = px; m.y = py;
            _lastMoveAt.set(m.id, now);
            await updateMonsterPos(m.id, px, py, now);

            if (global._sendToMap) {
              try { global._sendToMap(m.map_key, { type: 'monster_move', id: m.id, x: px, y: py }); } catch {}
            }

            moved = true;
            break;
          }

          if (!moved) {
            _lastMoveAt.set(m.id, now);
          }
        }
        continue; // não ataca enquanto não estiver ao lado
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
