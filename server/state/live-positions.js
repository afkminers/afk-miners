'use strict';

// Shared in-memory registry for the authoritative, real-time player positions.
// Each entry is keyed by playerId and stores { x, y, mapKey, ts } where ts is
// the last time (ms epoch) the position was updated. Modules that care about
// positional precision (combat routes, monster AI, etc.) can require this file
// to access the same Map instance that the WebSocket pipeline mutates.

const livePositions = new Map();

function normalizePosition(pos = {}) {
  const mapKey = pos.mapKey || pos.map_key || 'house';
  const ts = Number.isFinite(pos.ts) ? Number(pos.ts) : Date.now();
  return {
    x: Number(pos.x || 0) | 0,
    y: Number(pos.y || 0) | 0,
    mapKey: String(mapKey || 'house'),
    ts,
  };
}

function setLivePlayerPosition(playerId, pos) {
  const id = String(playerId || '');
  if (!id || !pos) {
    if (id) livePositions.delete(id);
    return null;
  }
  const normalized = normalizePosition(pos);
  livePositions.set(id, normalized);
  return normalized;
}

function getLivePlayerPosition(playerId) {
  const id = String(playerId || '');
  if (!id) return null;
  return livePositions.get(id) || null;
}

function removeLivePlayerPosition(playerId) {
  const id = String(playerId || '');
  if (!id) return false;
  return livePositions.delete(id);
}

module.exports = {
  livePositions,
  setLivePlayerPosition,
  getLivePlayerPosition,
  removeLivePlayerPosition,
};
