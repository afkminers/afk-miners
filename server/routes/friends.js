// server/routes/friends.js
const express = require('express');
const router = express.Router();

const { all, get, run } = require('../models/db');
const makeLimiter = require('../middleware/limiter');
const { getPresenceSnapshot } = require('../ws/presence');
const {
  fetchMessages: fetchDirectMessages,
  fetchFriendship: fetchDmFriendship,
  countUnreadForPair,
} = require('../services/direct-messages');

const listLimiter = makeLimiter({
  windowMs: 1000,
  max: 12,
  message: { error: 'FRIEND_LIST_RATE_LIMIT' },
});

const actionLimiter = makeLimiter({
  windowMs: 60_000,
  max: 20,
  message: { error: 'FRIEND_RATE_LIMIT' },
});

const dmHistoryLimiter = makeLimiter({
  windowMs: 1000,
  max: 30,
  message: { error: 'DM_HISTORY_RATE_LIMIT' },
});

function sendError(res, status, code) {
  return res.status(status).json({ error: code });
}

function normalizeId(raw) {
  const value = String(raw || '').trim();
  return value ? value : null;
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

async function findUserByUsername(username) {
  return get(
    `SELECT id, name FROM players WHERE LOWER(name) = LOWER($1) LIMIT 1`,
    [String(username || '').toLowerCase()]
  );
}

async function findUserById(id) {
  return get(`SELECT id, name FROM players WHERE id = $1`, [String(id)]);
}

async function findFriendship(currentUserId, otherId) {
  return get(
    `SELECT id, user_a_id, user_b_id, status, created_at, updated_at
       FROM friendships
      WHERE pair_left = LEAST($1, $2) AND pair_right = GREATEST($1, $2)`,
    [String(currentUserId), String(otherId)]
  );
}

async function loadFriendRows(currentUserId) {
  return all(
    `SELECT
        f.id,
        f.user_a_id,
        f.user_b_id,
        f.status,
        f.created_at,
        f.updated_at,
        CASE WHEN f.user_a_id = $1 THEN f.user_b_id ELSE f.user_a_id END AS friend_id,
        p.name AS friend_name,
        CASE
          WHEN f.status = 'PENDING' AND f.user_a_id = $1 THEN 'outgoing'
          WHEN f.status = 'PENDING' AND f.user_b_id = $1 THEN 'incoming'
          ELSE NULL
        END AS pending_direction,
        CASE WHEN f.status = 'BLOCKED' THEN f.user_a_id ELSE NULL END AS blocked_by_id
      FROM friendships f
      LEFT JOIN players p
        ON p.id = CASE WHEN f.user_a_id = $1 THEN f.user_b_id ELSE f.user_a_id END
     WHERE f.user_a_id = $1 OR f.user_b_id = $1
     ORDER BY f.updated_at DESC, f.id DESC`,
    [String(currentUserId)]
  );
}

async function loadFriendRow(currentUserId, otherId) {
  return get(
    `SELECT
        f.id,
        f.user_a_id,
        f.user_b_id,
        f.status,
        f.created_at,
        f.updated_at,
        CASE WHEN f.user_a_id = $1 THEN f.user_b_id ELSE f.user_a_id END AS friend_id,
        p.name AS friend_name,
        CASE
          WHEN f.status = 'PENDING' AND f.user_a_id = $1 THEN 'outgoing'
          WHEN f.status = 'PENDING' AND f.user_b_id = $1 THEN 'incoming'
          ELSE NULL
        END AS pending_direction,
        CASE WHEN f.status = 'BLOCKED' THEN f.user_a_id ELSE NULL END AS blocked_by_id
      FROM friendships f
      LEFT JOIN players p
        ON p.id = CASE WHEN f.user_a_id = $1 THEN f.user_b_id ELSE f.user_a_id END
     WHERE f.pair_left = LEAST($1, $2)
       AND f.pair_right = GREATEST($1, $2)`,
    [String(currentUserId), String(otherId)]
  );
}

async function fetchUnreadMap(currentUserId) {
  const map = new Map();
  const me = String(currentUserId);
  const rows = await all(
    `SELECT conversation_left, conversation_right, COUNT(*)::int AS unread
       FROM direct_messages
      WHERE recipient_id = $1 AND read_at IS NULL
      GROUP BY conversation_left, conversation_right`,
    [me]
  );

  for (const row of rows || []) {
    const left = String(row.conversation_left || '');
    const right = String(row.conversation_right || '');
    const friendId = left === me ? right : left;
    if (friendId) {
      map.set(friendId, Number(row.unread) || 0);
    }
  }
  return map;
}

function resolveFriendId(row, currentUserId) {
  const me = String(currentUserId);
  const userA = String(row.user_a_id || '');
  const userB = String(row.user_b_id || '');
  if (row.friend_id) return String(row.friend_id);
  return userA === me ? userB : userA;
}

function buildFriendPayload(row, { currentUserId, presenceMap, unreadMap }) {
  if (!row) return null;
  const me = String(currentUserId);
  const friendId = resolveFriendId(row, me);

  const presence =
    presenceMap?.get(friendId) || {
      online: false,
      lastSeenAt: null,
      status: 'OFFLINE',
      activity: null,
    };

  const unread = unreadMap?.get(friendId) || 0;
  const lastSeenAt = presence.lastSeenAt ? toIso(presence.lastSeenAt) : null;

  return {
    friendshipId: Number(row.id),
    friendId,
    friendName: row.friend_name || null,
    status: row.status,
    pendingDirection: row.pending_direction || null,
    blockedBy:
      row.status === 'BLOCKED'
        ? String(row.blocked_by_id || row.user_a_id || '').trim() || null
        : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),

    // presença antiga (já usada pelo client)
    online: !!presence.online,
    lastSeenAt,
    unreadCount: unread,
    canMessage: row.status === 'ACCEPTED',

    // presença estendida (Fase 2)
    presenceStatus: presence.status || 'OFFLINE',
    presenceActivity: presence.activity || null,
  };
}

router.get('/', listLimiter, async (req, res) => {
  try {
    const currentUserId = String(req.user?.id || '');
    const rows = await loadFriendRows(currentUserId);
    const friendIds = Array.from(
      new Set(
        rows
          .map((row) => resolveFriendId(row, currentUserId))
          .filter((id) => typeof id === 'string' && id)
      )
    );
    const presenceMap = await getPresenceSnapshot(friendIds);
    const unreadMap = await fetchUnreadMap(currentUserId);

    const friends = rows.map((row) =>
      buildFriendPayload(row, { currentUserId, presenceMap, unreadMap })
    );
    res.json({ ok: true, friends });
  } catch (err) {
    console.error('[friends:list] failed', err?.message);
    res.status(500).json({ error: 'FRIEND_LIST_FAILED' });
  }
});

router.post('/request', actionLimiter, async (req, res) => {
  try {
    const currentUserId = String(req.user?.id || '');
    const username = String(req.body?.username || '').trim();
    if (!username) return sendError(res, 400, 'USERNAME_REQUIRED');

    const target = await findUserByUsername(username);
    if (!target) return sendError(res, 404, 'USER_NOT_FOUND');

    const targetId = String(target.id);
    if (targetId === currentUserId) return sendError(res, 400, 'FRIEND_SELF_NOT_ALLOWED');

    const existing = await findFriendship(currentUserId, targetId);
    if (existing) {
      return sendError(res, 409, 'FRIEND_ALREADY_EXISTS');
    }

    try {
      await run(
        `INSERT INTO friendships (user_a_id, user_b_id, status, created_at, updated_at)
         VALUES ($1, $2, 'PENDING', now(), now())`,
        [currentUserId, targetId]
      );
    } catch (err) {
      if (err?.code === '23505') {
        return sendError(res, 409, 'FRIEND_ALREADY_EXISTS');
      }
      throw err;
    }

    const row = await loadFriendRow(currentUserId, targetId);
    const presenceMap = await getPresenceSnapshot([targetId]);
    const unreadMap = await fetchUnreadMap(currentUserId);
    const friendship = buildFriendPayload(row, { currentUserId, presenceMap, unreadMap });

    res.json({ ok: true, friendship });
  } catch (err) {
    console.error('[friends:request] failed', err?.message);
    res.status(500).json({ error: 'FRIEND_REQUEST_FAILED' });
  }
});

router.post('/:friendId/accept', actionLimiter, async (req, res) => {
  try {
    const currentUserId = String(req.user?.id || '');
    const friendId = normalizeId(req.params.friendId);
    if (!friendId) return sendError(res, 400, 'FRIEND_ID_REQUIRED');

    const relation = await findFriendship(currentUserId, friendId);
    if (!relation || relation.status !== 'PENDING') {
      return sendError(res, 404, 'FRIEND_REQUEST_NOT_FOUND');
    }
    if (String(relation.user_b_id) !== currentUserId) {
      return sendError(res, 403, 'FRIEND_REQUEST_NOT_FOR_YOU');
    }

    await run(
      `UPDATE friendships
          SET status = 'ACCEPTED', updated_at = now()
        WHERE id = $1`,
      [relation.id]
    );

    const row = await loadFriendRow(currentUserId, friendId);
    const presenceMap = await getPresenceSnapshot([friendId]);
    const unreadMap = await fetchUnreadMap(currentUserId);
    const friendship = buildFriendPayload(row, { currentUserId, presenceMap, unreadMap });

    res.json({ ok: true, friendship });
  } catch (err) {
    console.error('[friends:accept] failed', err?.message);
    res.status(500).json({ error: 'FRIEND_ACCEPT_FAILED' });
  }
});

router.post('/:friendId/reject', actionLimiter, async (req, res) => {
  try {
    const currentUserId = String(req.user?.id || '');
    const friendId = normalizeId(req.params.friendId);
    if (!friendId) return sendError(res, 400, 'FRIEND_ID_REQUIRED');

    const relation = await findFriendship(currentUserId, friendId);
    if (!relation || relation.status !== 'PENDING') {
      return sendError(res, 404, 'FRIEND_REQUEST_NOT_FOUND');
    }
    if (String(relation.user_b_id) !== currentUserId) {
      return sendError(res, 403, 'FRIEND_REQUEST_NOT_FOR_YOU');
    }

    await run(`DELETE FROM friendships WHERE id = $1`, [relation.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[friends:reject] failed', err?.message);
    res.status(500).json({ error: 'FRIEND_REJECT_FAILED' });
  }
});

router.delete('/:friendId', actionLimiter, async (req, res) => {
  try {
    const currentUserId = String(req.user?.id || '');
    const friendId = normalizeId(req.params.friendId);
    if (!friendId) return sendError(res, 400, 'FRIEND_ID_REQUIRED');

    const relation = await findFriendship(currentUserId, friendId);
    if (!relation || relation.status !== 'ACCEPTED') {
      return sendError(res, 404, 'FRIEND_NOT_FOUND');
    }

    await run(`DELETE FROM friendships WHERE id = $1`, [relation.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[friends:remove] failed', err?.message);
    res.status(500).json({ error: 'FRIEND_REMOVE_FAILED' });
  }
});

router.post('/:friendId/block', actionLimiter, async (req, res) => {
  try {
    const currentUserId = String(req.user?.id || '');
    const friendId = normalizeId(req.params.friendId);
    if (!friendId) return sendError(res, 400, 'FRIEND_ID_REQUIRED');
    if (friendId === currentUserId) return sendError(res, 400, 'FRIEND_SELF_NOT_ALLOWED');

    const target = await findUserById(friendId);
    if (!target) return sendError(res, 404, 'USER_NOT_FOUND');

    await run(
      `INSERT INTO friendships (user_a_id, user_b_id, status, created_at, updated_at)
         VALUES ($1, $2, 'BLOCKED', now(), now())
       ON CONFLICT (pair_left, pair_right)
       DO UPDATE SET
         user_a_id = EXCLUDED.user_a_id,
         user_b_id = EXCLUDED.user_b_id,
         status = 'BLOCKED',
         updated_at = now()`,
      [currentUserId, friendId]
    );

    const row = await loadFriendRow(currentUserId, friendId);
    const presenceMap = await getPresenceSnapshot([friendId]);
    const unreadMap = await fetchUnreadMap(currentUserId);
    const friendship = buildFriendPayload(row, { currentUserId, presenceMap, unreadMap });

    res.json({ ok: true, friendship });
  } catch (err) {
    console.error('[friends:block] failed', err?.message);
    res.status(500).json({ error: 'FRIEND_BLOCK_FAILED' });
  }
});

router.post('/:friendId/unblock', actionLimiter, async (req, res) => {
  try {
    const currentUserId = String(req.user?.id || '');
    const friendId = normalizeId(req.params.friendId);
    if (!friendId) return sendError(res, 400, 'FRIEND_ID_REQUIRED');

    const relation = await findFriendship(currentUserId, friendId);
    if (!relation || relation.status !== 'BLOCKED') {
      return sendError(res, 404, 'FRIEND_NOT_FOUND');
    }
    if (String(relation.user_a_id) !== currentUserId) {
      return sendError(res, 403, 'FRIEND_BLOCKED_BY_OTHER');
    }

    await run(`DELETE FROM friendships WHERE id = $1`, [relation.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[friends:unblock] failed', err?.message);
    res.status(500).json({ error: 'FRIEND_UNBLOCK_FAILED' });
  }
});

router.get('/:friendId/dms', dmHistoryLimiter, async (req, res) => {
  try {
    const currentUserId = String(req.user?.id || '');
    const friendId = normalizeId(req.params.friendId);
    if (!friendId) return sendError(res, 400, 'FRIEND_ID_REQUIRED');

    const relation = await fetchDmFriendship(currentUserId, friendId);
    if (
      !relation ||
      (String(relation.user_a_id) !== currentUserId && String(relation.user_b_id) !== currentUserId)
    ) {
      return sendError(res, 404, 'FRIEND_NOT_FOUND');
    }
    if (relation.status === 'BLOCKED') {
      const blockerId = String(relation.user_a_id);
      const errorCode = blockerId === currentUserId ? 'DM_BLOCKED' : 'DM_NOT_ALLOWED';
      return sendError(res, 403, errorCode);
    }
    if (relation.status !== 'ACCEPTED') {
      return sendError(res, 403, 'DM_NOT_ALLOWED');
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
    const before = req.query.before ? Number(req.query.before) : null;

    const messages = await fetchDirectMessages({
      userId: currentUserId,
      friendId,
      limit,
      beforeId: Number.isFinite(before) && before > 0 ? before : null,
    });

    const nextCursor = messages.length === limit ? messages[0]?.id || null : null;
    const unreadCount = await countUnreadForPair(currentUserId, friendId);

    res.json({ ok: true, messages, nextCursor, unreadCount });
  } catch (err) {
    console.error('[friends:dms] failed', err?.message);
    res.status(500).json({ error: 'DM_HISTORY_FAILED' });
  }
});

module.exports = router;
