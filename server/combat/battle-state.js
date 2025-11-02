// server/combat/battle-state.js
// Rastreador de modo batalha: mantém heróis marcados como "em combate"
// enquanto recebem hits, atacam ou têm agro de monstros.
// - Persiste apenas em memória, mas notifica o cliente via WS.
// - Fornece ganchos para segurar o logout até o herói sair de combate.

const { get } = require('../models/db');
const wsBus = require('../ws/bus');

const DEFAULT_TTL_MS = Math.max(5000, Number(process.env.BATTLE_COMBAT_TTL_MS || 15000));
const SAFE_GRACE_MS = Math.max(2000, Number(process.env.BATTLE_SAFE_GRACE_MS || 5000));

function now() { return Date.now(); }

const heroStates = new Map(); // heroId -> state
const heroPlayerCache = new Map(); // heroId -> playerId
const playerActiveHeroes = new Map(); // playerId -> Set(heroId)
const offlineHolds = new Map(); // playerId -> Set<fn>
const listeners = new Set();

function normalizeId(id) {
  if (id == null) return null;
  const str = String(id).trim();
  return str || null;
}

async function resolvePlayerId(heroId, hintPlayerId = null) {
  const hid = normalizeId(heroId);
  if (!hid) return null;

  if (hintPlayerId != null) {
    const pid = normalizeId(hintPlayerId);
    heroPlayerCache.set(hid, pid);
    return pid;
  }

  if (heroPlayerCache.has(hid)) {
    return heroPlayerCache.get(hid) || null;
  }

  try {
    const row = await get(
      `SELECT "playerId"::text AS player_id FROM player_heroes WHERE id = $1`,
      [hid]
    );
    const pid = row?.player_id ? String(row.player_id) : null;
    heroPlayerCache.set(hid, pid);
    return pid;
  } catch (err) {
    console.warn('[battle] failed to resolve playerId for hero', hid, err?.message);
    heroPlayerCache.set(hid, null);
    return null;
  }
}

function addHeroToPlayer(pid, hid) {
  const playerId = normalizeId(pid);
  if (!playerId) return;
  if (!playerActiveHeroes.has(playerId)) {
    playerActiveHeroes.set(playerId, new Set());
  }
  playerActiveHeroes.get(playerId).add(hid);
}

function removeHeroFromPlayer(pid, hid) {
  const playerId = normalizeId(pid);
  if (!playerId) return;
  const set = playerActiveHeroes.get(playerId);
  if (!set) return;
  set.delete(hid);
  if (set.size === 0) {
    playerActiveHeroes.delete(playerId);
  }
}

function scheduleCheck(hid) {
  const state = heroStates.get(hid);
  if (!state || !state.active) return;
  if (state.timer) clearTimeout(state.timer);

  const expireAt = state.lastTouch + DEFAULT_TTL_MS;
  const wait = Math.max(500, expireAt - now());
  state.timer = setTimeout(() => checkExpiry(hid), wait);
}

function emit(event) {
  for (const fn of listeners) {
    try { fn(event); } catch {}
  }
}

function notifyClient(hid, state) {
  const payload = {
    type: 'hero_battle',
    heroId: hid,
    inBattle: !!state.active,
    since: state.active ? state.since : null,
    lastEventAt: state.lastTouch,
    endedAt: !state.active ? now() : null,
    reason: state.lastReason || null,
    endedReason: !state.active ? (state.lastEndedReason || null) : null,
  };
  const playerId = state.playerId || null;
  if (playerId) {
    try { wsBus.sendToPlayer(playerId, payload); } catch {}
  }
}

function releaseOfflineHoldIfIdle(playerId) {
  const pid = normalizeId(playerId);
  if (!pid) return;
  if (playerActiveHeroes.has(pid)) return; // ainda tem herói em combate
  const holds = offlineHolds.get(pid);
  if (!holds || !holds.size) return;
  offlineHolds.delete(pid);
  for (const fn of holds) {
    try { fn(); } catch {}
  }
}

function checkExpiry(hid) {
  const state = heroStates.get(hid);
  if (!state || !state.active) return;
  const diff = now() - state.lastTouch;
  if (diff >= DEFAULT_TTL_MS) {
    deactivate(hid, { reason: 'timeout' });
  } else {
    scheduleCheck(hid);
  }
}

function deactivate(hid, opts = {}) {
  const state = heroStates.get(hid);
  if (!state) return;

  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }

  state.active = false;
  state.lastEndedReason = opts?.reason || state.lastEndedReason || null;
  state.lastTouch = now();

  removeHeroFromPlayer(state.playerId, hid);
  notifyClient(hid, state);
  emit({ type: 'leave', heroId: hid, playerId: state.playerId, reason: state.lastEndedReason || null });
  releaseOfflineHoldIfIdle(state.playerId);
}

async function touchHero(heroId, opts = {}) {
  const hid = normalizeId(heroId);
  if (!hid) return null;

  let state = heroStates.get(hid);
  if (!state) {
    state = {
      heroId: hid,
      active: false,
      since: 0,
      lastTouch: 0,
      lastReason: null,
      lastEndedReason: null,
      playerId: null,
      timer: null,
    };
    heroStates.set(hid, state);
  }

  const nowTs = now();
  state.lastTouch = nowTs;
  if (opts?.reason) state.lastReason = String(opts.reason);

  if (!state.playerId || opts?.playerId) {
    const resolved = await resolvePlayerId(hid, opts?.playerId || state.playerId);
    state.playerId = resolved || state.playerId || null;
  }

  if (!state.active) {
    state.active = true;
    state.since = nowTs;
    state.lastEndedReason = null;
    addHeroToPlayer(state.playerId, hid);
    notifyClient(hid, state);
    emit({ type: 'enter', heroId: hid, playerId: state.playerId, reason: state.lastReason || null });
  }

  scheduleCheck(hid);
  return state;
}

function isHeroInBattle(heroId) {
  const hid = normalizeId(heroId);
  if (!hid) return false;
  const state = heroStates.get(hid);
  return !!(state && state.active);
}

function hasActiveBattleForPlayer(playerId) {
  const pid = normalizeId(playerId);
  if (!pid) return false;
  const set = playerActiveHeroes.get(pid);
  return !!(set && set.size);
}

function holdPlayerOffline(playerId, fn) {
  const pid = normalizeId(playerId);
  if (!pid || typeof fn !== 'function') return false;
  if (!offlineHolds.has(pid)) offlineHolds.set(pid, new Set());
  offlineHolds.get(pid).add(fn);
  return true;
}

function cancelOfflineHold(playerId) {
  const pid = normalizeId(playerId);
  if (!pid) return;
  offlineHolds.delete(pid);
}

function forceLeave(heroId, opts = {}) {
  const hid = normalizeId(heroId);
  if (!hid) return;
  const state = heroStates.get(hid);
  if (!state) return;
  if (!state.active) {
    state.lastEndedReason = opts?.reason || state.lastEndedReason || null;
    releaseOfflineHoldIfIdle(state.playerId);
    return;
  }
  deactivate(hid, opts);
}

function cooldown(heroId, ms = SAFE_GRACE_MS) {
  const hid = normalizeId(heroId);
  if (!hid) return;
  const state = heroStates.get(hid);
  if (!state || !state.active) return;
  const grace = Math.max(0, Math.min(DEFAULT_TTL_MS, Number(ms) || 0));
  const nowTs = now();
  const candidate = nowTs - (DEFAULT_TTL_MS - grace);
  if (candidate > state.lastTouch) {
    state.lastTouch = candidate;
  }
  scheduleCheck(hid);
}

function onStateChange(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

module.exports = {
  touchHero,
  forceLeave,
  cooldown,
  isHeroInBattle,
  hasActiveBattleForPlayer,
  holdPlayerOffline,
  cancelOfflineHold,
  onStateChange,
};
