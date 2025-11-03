// server/services/direct-messages.js
'use strict';

const MAX_BODY_LENGTH = 2000;

const { all, get, run } = require('../models/db');

function normalizeId(value) {
  if (value == null) return null;
  const str = String(value).trim();
  return str || null;
}

function canonicalPair(a, b) {
  const left = normalizeId(a);
  const right = normalizeId(b);
  if (!left || !right) return null;
  return left < right
    ? { left, right }
    : { left: right, right: left };
}

function sanitizeBody(body) {
  const text = String(body || '').trim();
  if (!text) return '';
  if (text.length > MAX_BODY_LENGTH) {
    return text.slice(0, MAX_BODY_LENGTH);
  }
  return text;
}

async function fetchFriendship(a, b) {
  const pair = canonicalPair(a, b);
  if (!pair) return null;
  return get(
    `SELECT id, user_a_id, user_b_id, status
       FROM friendships
      WHERE pair_left = $1 AND pair_right = $2
      LIMIT 1`,
    [pair.left, pair.right]
  );
}

function isBlockedRow(row) {
  return !!row && row.status === 'BLOCKED';
}

async function ensureCanMessage({ senderId, recipientId, allowWithoutFriendship = false }) {
  const sender = normalizeId(senderId);
  const recipient = normalizeId(recipientId);
  if (!sender || !recipient) {
    const error = new Error('DM_NOT_ALLOWED');
    error.code = 'DM_NOT_ALLOWED';
    throw error;
  }
  if (sender === recipient) {
    const error = new Error('FRIEND_SELF_NOT_ALLOWED');
    error.code = 'FRIEND_SELF_NOT_ALLOWED';
    throw error;
  }

  const relation = await fetchFriendship(sender, recipient);

  // Bloqueio sempre impede DM
  if (relation && isBlockedRow(relation)) {
    // Opcional: tratar quem bloqueou (user_a_id) diferente
    const blockerId = String(relation.user_a_id);
    const code = blockerId === sender ? 'DM_BLOCKED' : 'DM_NOT_ALLOWED';
    const err = new Error(code);
    err.code = code;
    throw err;
  }

  // Amizade aceita → permitido
  if (relation && relation.status === 'ACCEPTED') {
    return { ok: true, mode: 'friends' };
  }

  // Sem amizade → permitido somente quando explicitamente liberado (envio por nome)
  if (allowWithoutFriendship) {
    return { ok: true, mode: 'name' };
  }

  const error = new Error('DM_NOT_ALLOWED');
  error.code = 'DM_NOT_ALLOWED';
  throw error;
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    conversationId: row.conversation_id || null,
    senderId: String(row.sender_id),
    recipientId: String(row.recipient_id),
    bodyOriginal: row.body_original,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    deliveredAt: row.delivered_at ? (row.delivered_at instanceof Date ? row.delivered_at.toISOString() : row.delivered_at) : null,
    readAt: row.read_at ? (row.read_at instanceof Date ? row.read_at.toISOString() : row.read_at) : null,
    blockedAt: row.blocked_at ? (row.blocked_at instanceof Date ? row.blocked_at.toISOString() : row.blocked_at) : null,
  };
}

async function insertMessage({ senderId, recipientId, body }) {
  const cleanBody = sanitizeBody(body);
  if (!cleanBody) {
    const error = new Error('DM_BODY_REQUIRED');
    error.code = 'DM_BODY_REQUIRED';
    throw error;
  }
  const row = await get(
    `INSERT INTO direct_messages (sender_id, recipient_id, body_original)
         VALUES ($1, $2, $3)
      RETURNING id, conversation_id, sender_id, recipient_id,
                body_original, created_at, delivered_at, read_at, blocked_at`,
    [senderId, recipientId, cleanBody]
  );
  return mapRow(row);
}

async function fetchMessages({ userId, friendId, limit = 50, beforeId = null }) {
  const pair = canonicalPair(userId, friendId);
  if (!pair) return [];
  const cappedLimit = Math.min(Math.max(Number(limit) || 0, 1), 100);
  const rows = await all(
    `SELECT id, conversation_id, sender_id, recipient_id,
            body_original, created_at, delivered_at, read_at, blocked_at
       FROM direct_messages
      WHERE conversation_left = $1 AND conversation_right = $2
        AND ($3::bigint IS NULL OR id < $3)
      ORDER BY id DESC
      LIMIT $4`,
    [pair.left, pair.right, beforeId ? Number(beforeId) : null, cappedLimit]
  );
  return rows.reverse().map(mapRow);
}

async function markDelivered({ recipientId, messageIds }) {
  const ids = Array.from(new Set((Array.isArray(messageIds) ? messageIds : []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)));
  if (!ids.length) return 0;
  const res = await run(
    `UPDATE direct_messages
        SET delivered_at = COALESCE(delivered_at, now())
      WHERE recipient_id = $1 AND id = ANY($2::bigint[])`,
    [recipientId, ids]
  );
  return res?.rowCount || 0;
}

async function markRead({ recipientId, friendId, upToId }) {
  const pair = canonicalPair(recipientId, friendId);
  if (!pair) return { updated: 0 };
  const maxId = Number(upToId) > 0 ? Number(upToId) : null;
  const res = await run(
    `UPDATE direct_messages
        SET read_at = COALESCE(read_at, now()),
            delivered_at = COALESCE(delivered_at, now())
      WHERE recipient_id = $1
        AND conversation_left = $2
        AND conversation_right = $3
        AND ($4::bigint IS NULL OR id <= $4)
        AND read_at IS NULL`,
    [recipientId, pair.left, pair.right, maxId]
  );
  return { updated: res?.rowCount || 0 };
}

async function countUnreadForPair(userId, friendId) {
  const pair = canonicalPair(userId, friendId);
  if (!pair) return 0;
  const row = await get(
    `SELECT COUNT(*)::int AS total
       FROM direct_messages
      WHERE recipient_id = $1
        AND conversation_left = $2
        AND conversation_right = $3
        AND read_at IS NULL`,
    [userId, pair.left, pair.right]
  );
  return Number(row?.total) || 0;
}

async function listUnreadSummary(userId) {
  const uid = normalizeId(userId);
  if (!uid) return new Map();
  const rows = await all(
    `SELECT conversation_left, conversation_right, COUNT(*)::int AS unread
       FROM direct_messages
      WHERE recipient_id = $1 AND read_at IS NULL
      GROUP BY conversation_left, conversation_right`,
    [uid]
  );
  const map = new Map();
  for (const row of rows || []) {
    const left = String(row.conversation_left || '');
    const right = String(row.conversation_right || '');
    const friend = left === uid ? right : left;
    if (friend) map.set(friend, Number(row.unread) || 0);
  }
  return map;
}

module.exports = {
  ensureCanMessage,
  insertMessage,
  fetchMessages,
  markDelivered,
  markRead,
  countUnreadForPair,
  listUnreadSummary,
  fetchFriendship,
};
