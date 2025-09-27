// server/player/live_positions.js
// In-memory authority of player positions shared between WS and combat AI.

const livePositions = new Map(); // playerId -> { x, y, mapKey, heroId, heroAlive, ts }

function sanitizeInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? (n | 0) : (fallback | 0);
}

function sanitizeTs(ts) {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? n : Date.now();
}

function sanitizeMapKey(mapKey, fallback = 'house') {
  const key = String(mapKey || '').trim();
  return key ? key : String(fallback || 'house');
}

function setLivePosition(playerId, pos = {}) {
  const pid = String(playerId || '').trim();
  if (!pid) return null;

  const prev = livePositions.get(pid) || {};
  const ts = sanitizeTs(pos.ts ?? prev.ts ?? Date.now());
  const mapKey = sanitizeMapKey(pos.mapKey ?? prev.mapKey ?? 'house');
  const heroId = pos.heroId != null ? String(pos.heroId) : (prev.heroId != null ? String(prev.heroId) : null);
  const heroAlive = pos.heroAlive === false ? false : (pos.heroAlive === true ? true : (prev.heroAlive === false ? false : true));

  const next = {
    x: sanitizeInt(pos.x ?? prev.x ?? 0),
    y: sanitizeInt(pos.y ?? prev.y ?? 0),
    mapKey,
    heroId,
    heroAlive,
    ts,
  };

  livePositions.set(pid, next);
  return next;
}

function getLivePosition(playerId) {
  const pid = String(playerId || '').trim();
  if (!pid) return null;
  return livePositions.get(pid) || null;
}

function removeLivePosition(playerId) {
  const pid = String(playerId || '').trim();
  if (!pid) return;
  livePositions.delete(pid);
}

function listPlayerIds() {
  return Array.from(livePositions.keys());
}

function listFreshHeroesByMap(mapKey, maxAgeMs = 1000) {
  const now = Date.now();
  const key = sanitizeMapKey(mapKey);
  const maxAge = Number(maxAgeMs);

  const fresh = [];
  for (const [pid, pos] of livePositions.entries()) {
    if (!pos) continue;
    if (pos.mapKey !== key) continue;
    if (pos.heroAlive === false) continue;
    const age = now - (pos.ts || 0);
    if (Number.isFinite(maxAge) && maxAge >= 0 && age > maxAge) continue;
    fresh.push({
      playerId: pid,
      heroId: pos.heroId || null,
      x: pos.x | 0,
      y: pos.y | 0,
      updatedMs: pos.ts || 0,
    });
  }
  return fresh;
}

module.exports = {
  setLivePosition,
  getLivePosition,
  removeLivePosition,
  listPlayerIds,
  listFreshHeroesByMap,
};
