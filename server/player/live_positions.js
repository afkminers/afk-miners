// server/player/live_positions.js
// Autoridade em memória das posições ao vivo dos jogadores (por playerId).
// Mantém compat: heroId, heroAlive, listFreshHeroesByMap.
// TTL configurável por env: LIVE_POS_TTL_MS (default 1500ms)

const TTL_MS = Math.max(300, Number(process.env.LIVE_POS_TTL_MS || 1500));
const GC_MS  = Math.max(TTL_MS, Number(process.env.LIVE_POS_GC_MS  || 5000));

/** store: playerId -> { x, y, mapKey, heroId, heroAlive, ts } */
const store = new Map();

/**
 * setLivePlayerPosition
 * Assinaturas aceitas:
 *  - setLivePlayerPosition(playerId, x, y, mapKey, heroId?, heroAlive?, ts?)
 *  - setLivePlayerPosition(playerId, {x,y,mapKey,heroId,heroAlive,ts})
 */
function setLivePlayerPosition(playerId, xOrObj, y, mapKey, heroId, heroAlive, ts) {
  const id = String(playerId || '').trim();
  if (!id) return null;

  let nx, ny, nMap, nHeroId, nAlive, nTs;

  if (xOrObj && typeof xOrObj === 'object') {
    nx      = Number(xOrObj.x ?? 0);
    ny      = Number(xOrObj.y ?? 0);
    nMap    = String(xOrObj.mapKey || 'house');
    nHeroId = xOrObj.heroId != null ? String(xOrObj.heroId) : null;
    nAlive  = xOrObj.heroAlive === false ? false : true;
    nTs     = Number(xOrObj.ts) > 0 ? Number(xOrObj.ts) : Date.now();
  } else {
    nx      = Number(xOrObj ?? 0);
    ny      = Number(y ?? 0);
    nMap    = String(mapKey || 'house');
    nHeroId = heroId != null ? String(heroId) : null;
    nAlive  = heroAlive === false ? false : true;
    nTs     = Number(ts) > 0 ? Number(ts) : Date.now();
  }

  const prev = store.get(id) || {};
  const next = {
    x: nx | 0,
    y: ny | 0,
    mapKey: nMap || prev.mapKey || 'house',
    heroId: nHeroId != null ? nHeroId : (prev.heroId ?? null),
    heroAlive: nAlive ?? (prev.heroAlive ?? true),
    ts: nTs,
  };

  store.set(id, next);
  return next;
}

function getLivePlayerPosition(playerId) {
  const id = String(playerId || '').trim();
  if (!id) return null;
  const pos = store.get(id);
  if (!pos) return null;
  if (Date.now() - (pos.ts || 0) > TTL_MS) {
    store.delete(id);
    return null;
  }
  return pos;
}

function clearLivePlayerPosition(playerId) {
  const id = String(playerId || '').trim();
  if (id) store.delete(id);
}

/** Lista heróis “frescos” por mapa — compat com IA/aggro */
function listFreshHeroesByMap(mapKey, maxAgeMs = TTL_MS) {
  const key = String(mapKey || 'house');
  const now = Date.now();
  const out = [];
  for (const [pid, pos] of store.entries()) {
    if (!pos) continue;
    if (pos.mapKey !== key) continue;
    if (pos.heroAlive === false) continue;
    if (now - (pos.ts || 0) > maxAgeMs) continue;
    out.push({
      playerId: pid,
      heroId: pos.heroId ?? null,
      x: pos.x | 0,
      y: pos.y | 0,
      updatedMs: pos.ts || 0,
    });
  }
  return out;
}

/** Útil quando o servidor sabe que o herói morreu/renasceu */
function markHeroAlive(playerId, alive, heroId = null) {
  const id = String(playerId || '').trim();
  if (!id) return;
  const cur = store.get(id);
  if (!cur) return;
  cur.heroAlive = !!alive;
  if (heroId != null) cur.heroId = String(heroId);
  cur.ts = Date.now();
  store.set(id, cur);
}

/** GC periódico para limpar posições expiradas */
setInterval(() => {
  const now = Date.now();
  for (const [id, pos] of store.entries()) {
    if (!pos || now - (pos.ts || 0) > TTL_MS) store.delete(id);
  }
}, GC_MS);

/** Lista todos os playerIds presentes no cache live (útil para flusher) */
function listPlayerIds() {
  return Array.from(store.keys());
}

module.exports = {
  setLivePlayerPosition,
  getLivePlayerPosition,
  clearLivePlayerPosition,
  listFreshHeroesByMap,
  markHeroAlive,
  listPlayerIds,           // <<<<< ADICIONADO
  TTL_MS,
};


