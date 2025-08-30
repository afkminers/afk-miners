// server/player/routes.js
const express = require('express');
const router = express.Router();

const { all, get, run } = require('../models/db');

const MAX_SPEED_PX_PER_S = 180;          // teto de velocidade (px/s)
const EXTRA_GRACE_PX = 48;               // tolerância p/ jitter/rede
const MAX_UPDATES_PER_5S = 12;           // rate limit p/ /pos
const RL_WINDOW_MS = 5000;

// Cache em memória (fallback caso não haja Redis nessa rota)
const rlMem = new Map(); // key: playerId => { ts[], lastPrune }

// ---------- Helpers de mapa/colisão (cache server-side) ----------
const mapCache = new Map(); // key => { json, cols, rows, grid }
const TILE = 32;

async function loadMapJson(mapKey) {
  const row = await get('SELECT "dataJSON" FROM maps WHERE key=$1', [mapKey]);
  return row?.dataJSON || null;
}

async function loadMapObjects(mapKey) {
  return await all(
    `SELECT type, x, y, w, h, "propsJSON" FROM map_objects WHERE "mapKey"=$1`,
    [mapKey]
  );
}

function hasSolidProp(o) {
  const props = o.propsJSON && typeof o.propsJSON === 'object' ? o.propsJSON : {};
  if (Array.isArray(o.propsJSON)) {
    return o.propsJSON.some(p => p.name === 'solid' && (p.value === true || p.value === 1));
  }
  return !!(props.solid === true || props.solid === 1);
}

function buildCollisionGridFromObjects(mapW, mapH, objs) {
  const cols = Math.floor(mapW / TILE);
  const rows = Math.floor(mapH / TILE);
  const grid = new Uint8Array(cols * rows);
  for (const o of objs) {
    const t = String(o.type || '').toLowerCase();
    const solid = t === 'solid' || hasSolidProp(o);
    if (!solid) continue;
    const x0 = Math.floor(o.x / TILE), y0 = Math.floor(o.y / TILE);
    const x1 = Math.floor((o.x + o.w - 1) / TILE);
    const y1 = Math.floor((o.y + o.h - 1) / TILE);
    for (let cy=y0; cy<=y1; cy++) for (let cx=x0; cx<=x1; cx++) {
      if (cx>=0 && cy>=0 && cx<cols && cy<rows) grid[cy*cols + cx] = 1;
    }
  }
  return { grid, cols, rows };
}

function buildCollisionGridFromTiled(json) {
  const cols = json.width|0, rows = json.height|0;
  const grid = new Uint8Array(cols * rows);
  const layer = (json.layers || []).find(l =>
    l.type === 'tilelayer' && l.name && String(l.name).toLowerCase().includes('collision')
  );
  if (layer && Array.isArray(layer.data)) {
    for (let i=0;i<layer.data.length;i++) if (layer.data[i]) grid[i]=1;
  }
  return { grid, cols, rows };
}

async function getMapCollision(mapKey) {
  if (mapCache.has(mapKey)) return mapCache.get(mapKey);

  const json = await loadMapJson(mapKey);
  if (!json) throw new Error('map-not-found');

  const objs = await loadMapObjects(mapKey);
  const mapW = (json.width || 64) * TILE;
  const mapH = (json.height || 64) * TILE;

  let coll;
  if (objs && objs.length) coll = buildCollisionGridFromObjects(mapW, mapH, objs);
  else coll = buildCollisionGridFromTiled(json);

  const entry = { json, cols: coll.cols, rows: coll.rows, grid: coll.grid };
  mapCache.set(mapKey, entry);
  return entry;
}

function isSolidAt(grid, cols, rows, x, y) {
  const cx = Math.floor(x / TILE);
  const cy = Math.floor(y / TILE);
  if (cx<0 || cy<0 || cx>=cols || cy>=rows) return true;
  return !!grid[cy*cols + cx];
}

function inWorld(cols, rows, x, y) {
  const w = cols*TILE, h = rows*TILE;
  return x>=0 && y>=0 && x<w && y<h;
}

// ---------- Rate Limit simples (fallback sem Redis) ----------
function rlAllow(playerId) {
  const now = Date.now();
  const win = RL_WINDOW_MS;

  let slot = rlMem.get(playerId);
  if (!slot) { slot = { ts: [] }; rlMem.set(playerId, slot); }

  // drop antigos
  slot.ts = slot.ts.filter(t => now - t <= win);

  if (slot.ts.length >= MAX_UPDATES_PER_5S) return false;
  slot.ts.push(now);
  return true;
}

// ---------- Rotas ----------
router.get('/me', async (req, res) => {
  // Aqui você pode enriquecer com heroes/itens, mantive o essencial
  res.json({
    id: req.user.id,
    name: req.user.name,
  });
});

router.get('/pos', async (req, res) => {
  const mapKey = String(req.query.map || 'house');
  try {
    const row = await get(
      `SELECT x, y, last_seq AS "seq", updated_at AS "updatedAt"
         FROM player_last_pos
        WHERE player_id = $1 AND map_key = $2`,
      [req.user.id, mapKey]
    );
    if (!row) return res.json({ x: null, y: null, seq: 0, updatedAt: null });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: 'pos-read-failed' });
  }
});

router.post('/pos', async (req, res) => {
  try {
    // Rate limit (fallback). Se quiser, troque por um middleware com Redis.
    if (!rlAllow(req.user.id)) {
      return res.status(429).json({ error: 'rate-limited' });
    }

    const { mapKey, x, y, seq, clientTs } = req.body || {};
    const map = String(mapKey || 'house');
    const nx = Number(x), ny = Number(y);
    const cseq = Number(seq || 0);
    const cts = Number(clientTs || 0);

    if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
      return res.status(400).json({ error: 'invalid-pos' });
    }

    // Mapa válido + colisão
    const { cols, rows, grid } = await getMapCollision(map);

    if (!inWorld(cols, rows, nx, ny)) {
      return res.status(400).json({ error: 'out-of-bounds' });
    }
    if (isSolidAt(grid, cols, rows, nx, ny)) {
      return res.status(400).json({ error: 'inside-solid' });
    }

    // Carrega última posição p/ validação de velocidade e replay
    const prev = await get(
      `SELECT x, y, last_seq AS seq, EXTRACT(EPOCH FROM (now() - updated_at)) AS age
         FROM player_last_pos
        WHERE player_id=$1 AND map_key=$2`,
      [req.user.id, map]
    );

    // Replay/ordenamento
    if (prev && cseq && prev.seq != null && cseq <= Number(prev.seq)) {
      return res.status(409).json({ error: 'stale-seq' });
    }

    // Anti-teleport/speedhack (se tiver posição anterior)
    if (prev && Number.isFinite(prev.x) && Number.isFinite(prev.y)) {
      // Delta tempo (server-side); se clientTs vier, usamos o menor (fail-safe)
      const dtServer = Math.max(0.05, Math.min(5, (prev.age != null ? Number(prev.age) : 0))); // 0.05–5s
      const dtClient = (cts ? Math.min(5, Math.max(0.05, (Date.now() - cts)/1000 )) : dtServer);
      const dt = Math.min(dtServer + 0.15, dtClient + 0.15); // pequena tolerância

      const dx = nx - Number(prev.x);
      const dy = ny - Number(prev.y);
      const dist = Math.hypot(dx, dy);
      const maxDist = (MAX_SPEED_PX_PER_S * dt) + EXTRA_GRACE_PX;

      if (dist > maxDist) {
        // suspeito: ignora update, responde 202 (aceito mas sem persistir)
        return res.status(202).json({ ok: false, reason: 'too-fast' });
      }
    }

    // UPSERT
    await run(
      `INSERT INTO player_last_pos (player_id, map_key, x, y, last_seq, updated_at)
            VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (player_id, map_key)
         DO UPDATE SET x=$3, y=$4, last_seq=$5, updated_at=now()`,
      [req.user.id, map, Math.round(nx), Math.round(ny), cseq || ((prev?.seq|0)+1)]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error('[pos] error:', e?.message);
    res.status(500).json({ error: 'pos-write-failed' });
  }
});

module.exports = router;
