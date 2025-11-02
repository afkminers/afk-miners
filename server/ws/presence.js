'use strict';

const TTL_SECONDS = Math.max(30, Number(process.env.PRESENCE_TTL_SECONDS || 60));
const HEARTBEAT_GRACE_MS = Math.max(3000, Number(process.env.PRESENCE_GRACE_MS || 5000));
const UPDATE_INTERVAL_MS = Math.max(10000, Number(process.env.PRESENCE_UPDATE_INTERVAL_MS || 30000));
const SWEEP_INTERVAL_MS = Math.max(5000, Math.min(TTL_SECONDS * 500, 15000));
const CHANNEL = 'presence:events';
const KEY_PREFIX = 'presence:user:';

const { all } = require('../models/db');

let redisPublisher = null;
let redisSubscriber = null;
let wssRef = null;
let sweepTimer = null;

const localStates = new Map(); // userId -> { online, lastRefreshAt, lastBroadcastAt }

function isSocketOpen(ws) {
  return ws && ws.readyState === 1;
}

async function attachRedis({ wss, redisPub, redisSub }) {
  wssRef = wss;
  redisPublisher = redisPub || null;
  redisSubscriber = redisSub || null;

  if (redisSubscriber) {
    try {
      await redisSubscriber.subscribe(CHANNEL, handlePresenceMessage);
      console.log('[presence] subscribed to redis channel');
    } catch (err) {
      console.warn('[presence] failed to subscribe channel', err?.message);
    }
  }

  ensureSweepTimer();

  if (redisPublisher && localStates.size > 0) {
    for (const [userId, state] of localStates.entries()) {
      if (!state?.online) continue;
      markOnline(userId, { ts: state.lastRefreshAt }).catch(() => {});
    }
  }

  if (wssRef) {
    wssRef.clients.forEach((sock) => {
      if (!isSocketOpen(sock)) return;
      onAuthenticated(sock).catch(() => {});
    });
  }
}

function ensureSweepTimer() {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [userId, state] of localStates.entries()) {
      if (!state?.online) continue;
      if (now - state.lastRefreshAt <= TTL_SECONDS * 1000 + HEARTBEAT_GRACE_MS) continue;
      markOffline(userId, { reason: 'ttl_expired', ts: now }).catch(() => {});
    }
  }, SWEEP_INTERVAL_MS);
}

function stopSweepTimer() {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

async function handlePresenceMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (!msg || typeof msg !== 'object') return;
  const { type, userId } = msg;
  if (!type || !userId) return;
  const ts = Number(msg.ts) || Date.now();
  const payload = { type: `presence:${type}`, userId: String(userId), ts };
  if (msg.lastSeen) payload.lastSeen = Number(msg.lastSeen) || ts;
  broadcastToFriends(payload);
}

function broadcastToFriends(payload) {
  if (!wssRef) return;
  const message = JSON.stringify(payload);
  wssRef.clients.forEach((sock) => {
    if (!isSocketOpen(sock)) return;
    if (!sock._friends || !sock._friends.has(payload.userId)) return;
    try { sock.send(message); }
    catch (err) { console.warn('[presence] send fail', err?.message); }
  });
}

async function onAuthenticated(ws) {
  const userId = resolveUserId(ws);
  if (!userId) return;
  if (!ws._presence) ws._presence = { };
  if (ws._presence.userId === userId && ws._presence.bound) {
    refreshPresence(userId).catch(() => {});
    return;
  }

  ws._presence.userId = userId;
  ws._presence.bound = true;
  ws._presence.lastSnapshotAt = 0;

  ws._friends = await loadFriendSet(userId);
  if (ws._friends.size > 0) {
    sendInitialSnapshot(ws).catch(() => {});
  }

  await markOnline(userId, { ts: Date.now() });
}

function resolveUserId(ws) {
  const id = ws?._player?.id || ws?._playerId || ws?.userId;
  if (!id) return null;
  return String(id);
}

async function loadFriendSet(userId) {
  try {
    const rows = await all(
      `SELECT CASE WHEN user_a_id = $1 THEN user_b_id ELSE user_a_id END AS friend_id
         FROM friendships
        WHERE (user_a_id = $1 OR user_b_id = $1)
          AND status = 'ACCEPTED'`,
      [userId]
    );
    const set = new Set();
    for (const row of rows || []) {
      if (!row?.friend_id) continue;
      set.add(String(row.friend_id));
    }
    return set;
  } catch (err) {
    console.warn('[presence] failed to load friends', err?.message);
    return new Set();
  }
}

async function sendInitialSnapshot(ws) {
  if (!redisPublisher) return;
  if (!ws || !isSocketOpen(ws)) return;
  if (!ws._friends || ws._friends.size === 0) return;
  const ids = Array.from(ws._friends);
  const keys = ids.map((id) => KEY_PREFIX + id);
  let values;
  try {
    values = await redisPublisher.mGet(keys);
  } catch (err) {
    console.warn('[presence] snapshot mget failed', err?.message);
    return;
  }
  if (!Array.isArray(values)) return;
  const now = Date.now();
  for (let i = 0; i < ids.length; i += 1) {
    const val = values[i];
    if (!val) continue;
    const ts = Number(val) || now;
    try {
      ws.send(JSON.stringify({ type: 'presence:online', userId: ids[i], ts }));
    } catch (err) {
      console.warn('[presence] snapshot send failed', err?.message);
      break;
    }
  }
}

async function onHeartbeat(ws) {
  const userId = resolveUserId(ws);
  if (!userId) return;
  await refreshPresence(userId);
}

async function markOnline(userId, { ts } = {}) {
  if (!userId) return;
  const now = Number(ts) || Date.now();
  const state = localStates.get(userId) || { online: false, lastRefreshAt: 0, lastBroadcastAt: 0 };
  state.lastRefreshAt = now;

  let wasOnline = state.online === true;
  state.online = true;
  localStates.set(userId, state);

  if (!redisPublisher) {
    console.log('[presence] redis unavailable, skipping set for', userId);
    return;
  }

  try {
    const previous = await redisPublisher.set(KEY_PREFIX + userId, String(now), { EX: TTL_SECONDS, GET: true });
    if (!wasOnline && !previous) {
      await publishEvent('online', userId, now, { lastSeen: now });
    } else if (!wasOnline && previous) {
      // ensure watchers know we are online even if leftover key existed
      await publishEvent('online', userId, now, { lastSeen: now });
    }
  } catch (err) {
    console.warn('[presence] markOnline failed', err?.message);
  }
}

async function refreshPresence(userId) {
  if (!userId || !redisPublisher) return;
  const now = Date.now();
  const state = localStates.get(userId) || { online: false, lastRefreshAt: 0, lastBroadcastAt: 0 };
  state.lastRefreshAt = now;
  if (!state.online) state.online = true;
  localStates.set(userId, state);

  try {
    const refreshed = await redisPublisher.expire(KEY_PREFIX + userId, TTL_SECONDS);
    if (refreshed !== 1) {
      await redisPublisher.set(KEY_PREFIX + userId, String(now), { EX: TTL_SECONDS });
      if (!state.sentRecovery) {
        await publishEvent('online', userId, now, { lastSeen: now });
        state.sentRecovery = true;
      }
    }
  } catch (err) {
    console.warn('[presence] refresh failed', err?.message);
  }

  if (now - (state.lastBroadcastAt || 0) >= UPDATE_INTERVAL_MS) {
    state.lastBroadcastAt = now;
    publishEvent('update', userId, now, { lastSeen: now }).catch(() => {});
  }
}

async function markOffline(userId, { reason, ts } = {}) {
  if (!userId) return;
  const state = localStates.get(userId) || { online: false, lastRefreshAt: 0, lastBroadcastAt: 0 };
  if (!state.online) return;
  state.online = false;
  state.lastRefreshAt = ts || Date.now();
  if (redisPublisher) {
    try { await redisPublisher.del(KEY_PREFIX + userId); }
    catch (err) { console.warn('[presence] redis del failed', err?.message); }
  }

  await publishEvent('offline', userId, state.lastRefreshAt, { reason, lastSeen: state.lastRefreshAt });
  localStates.delete(userId);
}

async function publishEvent(type, userId, ts, extra = {}) {
  if (!redisPublisher) return;
  try {
    const payload = JSON.stringify({ type, userId, ts, ...extra });
    await redisPublisher.publish(CHANNEL, payload);
  } catch (err) {
    console.warn('[presence] publish failed', err?.message);
  }
}

async function onDisconnect(ws) {
  const userId = resolveUserId(ws);
  if (!userId) return;
  await markOffline(userId, { reason: 'disconnect', ts: Date.now() });
  localStates.delete(userId);
  if (ws && ws._friends) {
    ws._friends.clear();
  }
}

module.exports = {
  attachRedis,
  onAuthenticated,
  onHeartbeat,
  onDisconnect,
  stopSweepTimer,
};
