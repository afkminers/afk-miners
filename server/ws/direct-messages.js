// server/ws/direct-messages.js
'use strict';

const {
  ensureCanMessage,
  insertMessage,
  markDelivered,
  markRead,
  countUnreadForPair,
} = require('../services/direct-messages');
const bus = require('./bus');
const { get } = require('../models/db'); // resolver destinatário por nome quando não vier friendId

const NUDGE_COOLDOWN_MS = Number(process.env.DM_NUDGE_COOLDOWN_MS || 15_000);
const NUDGE_RATE_WINDOW_MS = Number(process.env.DM_NUDGE_RATE_WINDOW_MS || 60_000);
const NUDGE_RATE_LIMIT = Number(process.env.DM_NUDGE_RATE_LIMIT || 6);

const pairCooldowns = new Map(); // key -> lastTimestamp
const rateBuckets = new Map(); // senderId -> { count, resetAt }

function resolveUserId(ws) {
  const candidates = [
    ws?._player?.id,
    ws?._playerId,
    ws?.playerId,
    ws?.userId,
    ws?.user?.id,
  ];
  for (const value of candidates) {
    if (value == null) continue;
    const str = String(value).trim();
    if (str) return str;
  }
  return null;
}

function mapMessage(row) {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderId: row.senderId,
    recipientId: row.recipientId,
    body: row.bodyOriginal,
    createdAt: row.createdAt,
    deliveredAt: row.deliveredAt,
    readAt: row.readAt,
  };
}

function send(ws, payload) {
  if (!ws || ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch (err) {
    console.warn('[dm] failed to send payload', err?.message);
  }
}

function pairKey(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  return left < right ? `${left}:${right}` : `${right}:${left}`;
}

function checkPairCooldown(senderId, friendId) {
  const key = pairKey(senderId, friendId);
  const last = pairCooldowns.get(key) || 0;
  const now = Date.now();
  if (now - last < NUDGE_COOLDOWN_MS) {
    const err = new Error('DM_NUDGE_COOLDOWN');
    err.code = 'DM_NUDGE_COOLDOWN';
    throw err;
  }
  return key;
}

function markPairCooldown(key) {
  pairCooldowns.set(key, Date.now());
}

function acquireRateBucket(senderId) {
  const now = Date.now();
  let bucket = rateBuckets.get(senderId);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + NUDGE_RATE_WINDOW_MS };
  }
  if (bucket.count >= NUDGE_RATE_LIMIT) {
    const err = new Error('DM_NUDGE_RATE_LIMIT');
    err.code = 'DM_NUDGE_RATE_LIMIT';
    throw err;
  }
  return bucket;
}

function commitRateBucket(senderId, bucket) {
  if (!bucket) return;
  bucket.count += 1;
  rateBuckets.set(senderId, bucket);
}

async function handleSend(ws, data) {
  const senderId = resolveUserId(ws);
  if (!senderId) return;

  const friendIdRaw = String(data.to || data.friendId || '').trim();
  const toNameRaw = String(data.toName || data.username || '').trim();
  const body = data.body != null ? data.body : data.text;
  const clientId = data.clientId || null;

  // Caminho novo: envio por NOME (sem amizade), respeitando bloqueio
  if (!friendIdRaw && toNameRaw) {
    try {
      const toName = toNameRaw.replace(/^@/, '');
      const target = await get(
        `SELECT id, name FROM players WHERE LOWER(name)=LOWER($1) LIMIT 1`,
        [toName]
      );
      if (!target) {
        send(ws, { type: 'dm:error', error: 'USER_NOT_FOUND', clientId });
        return;
      }
      const targetId = String(target.id);

      // Permite DM sem amizade (mas ainda barra bloqueio e self)
      await ensureCanMessage({
        senderId,
        recipientId: targetId,
        allowWithoutFriendship: true,
      });

      const row = await insertMessage({ senderId, recipientId: targetId, body });
      const message = mapMessage(row);

      // resposta para quem enviou
      send(ws, {
        type: 'dm:send',
        message,
        clientId,
        friendName: String(target.name || ''),
        mode: 'name', // <- sinaliza DM sem amizade
      });

      // entrega para o destinatário
      const unread = await countUnreadForPair(targetId, senderId);
      const recvPayload = {
        type: 'dm:recv',
        message,
        fromId: senderId,
        unreadCount: unread,
        friendName: String(target.name || ''),
        mode: 'name', // <- idem
      };

      if (targetId === senderId) {
        send(ws, recvPayload);
      } else {
        bus.sendToPlayer(targetId, recvPayload);
      }
      return;
    } catch (err) {
      const code = err?.code || err?.payload?.error || 'DM_SEND_FAILED';
      send(ws, { type: 'dm:error', error: code, clientId });
      return;
    }
  }

  // Caminho por friendId: agora também permite quando a relação está PENDING
  if (!friendIdRaw) {
    send(ws, { type: 'dm:error', error: 'FRIEND_ID_REQUIRED', clientId });
    return;
  }

  try {
    await ensureCanMessage({
      senderId,
      recipientId: friendIdRaw,
      allowWithoutFriendship: true, // <- ajuste que resolve a falha com pedido pendente
    });
    const row = await insertMessage({ senderId, recipientId: friendIdRaw, body });
    const message = mapMessage(row);
    const payload = { type: 'dm:send', message, clientId };
    send(ws, payload);

    const unread = await countUnreadForPair(friendIdRaw, senderId);
    const recvPayload = {
      type: 'dm:recv',
      message,
      fromId: senderId,
      unreadCount: unread,
    };
    if (friendIdRaw === senderId) {
      send(ws, recvPayload);
    } else {
      bus.sendToPlayer(friendIdRaw, recvPayload);
    }
  } catch (err) {
    const code = err?.code || err?.payload?.error || 'DM_SEND_FAILED';
    send(ws, { type: 'dm:error', error: code, clientId });
  }
}

async function handleNudge(ws, data) {
  const senderId = resolveUserId(ws);
  if (!senderId) return;
  const friendId = String(data.to || data.friendId || data.targetId || '').trim();
  if (!friendId) {
    send(ws, { type: 'dm:error', error: 'FRIEND_NOT_FOUND', action: 'nudge' });
    return;
  }
  if (friendId === senderId) {
    send(ws, { type: 'dm:error', error: 'FRIEND_SELF_NOT_ALLOWED', action: 'nudge', friendId });
    return;
  }
  let rateBucket;
  let cooldownKey;
  try {
    cooldownKey = checkPairCooldown(senderId, friendId);
    rateBucket = acquireRateBucket(senderId);

    // nudge continua exigindo amizade aceita
    await ensureCanMessage({ senderId, recipientId: friendId });

    markPairCooldown(cooldownKey);
    commitRateBucket(senderId, rateBucket);
    const payload = {
      type: 'dm:nudge',
      friendId,
      fromId: senderId,
      ts: new Date().toISOString(),
    };
    send(ws, payload);
    bus.sendToPlayer(friendId, payload);
  } catch (err) {
    const code = err?.code || err?.payload?.error || 'DM_NUDGE_FAILED';
    send(ws, { type: 'dm:error', error: code, action: 'nudge', friendId });
  }
}

async function handleAck(ws, data) {
  const recipientId = resolveUserId(ws);
  if (!recipientId) return;
  const ids = Array.isArray(data.messageIds) ? data.messageIds : data.ids;
  if (!Array.isArray(ids) || !ids.length) return;
  const friendId = String(data.friendId || data.from || '').trim();

  try {
    const count = await markDelivered({ recipientId, messageIds: ids });
    if (count === 0) return;
    const deliveredAt = new Date().toISOString();
    const cleanedIds = ids.map((id) => Number(id)).filter((id) => Number.isFinite(id));
    if (friendId) {
      bus.sendToPlayer(friendId, {
        type: 'dm:ack',
        friendId: recipientId,
        messageIds: cleanedIds,
        deliveredAt,
      });
    }
    send(ws, {
      type: 'dm:ack',
      friendId,
      messageIds: cleanedIds,
      deliveredAt,
    });
  } catch (err) {
    const code = err?.code || 'DM_ACK_FAILED';
    send(ws, { type: 'dm:error', error: code });
  }
}

async function handleRead(ws, data) {
  const readerId = resolveUserId(ws);
  if (!readerId) return;
  const friendId = String(data.friendId || data.partnerId || data.with || '').trim();
  const upToId = data.upToId != null ? data.upToId : data.messageId;

  try {
    const { updated } = await markRead({ recipientId: readerId, friendId, upToId });
    if (updated === 0 && !data.force) {
      return;
    }
    const unreadCount = await countUnreadForPair(readerId, friendId);
    const ts = new Date().toISOString();
    const payload = {
      type: 'dm:read',
      friendId,
      readerId,
      upToId: upToId != null ? Number(upToId) : null,
      unreadCount,
      readAt: ts,
    };
    send(ws, payload);
    if (friendId) {
      bus.sendToPlayer(friendId, payload);
    }
  } catch (err) {
    const code = err?.code || 'DM_READ_FAILED';
    send(ws, { type: 'dm:error', error: code });
  }
}

function handleMessage(ws, data) {
  if (!data || typeof data.type !== 'string') return false;
  switch (data.type) {
    case 'dm:send':
      handleSend(ws, data).catch((err) => console.warn('[dm] send failed', err?.message));
      return true;
    case 'dm:ack':
      handleAck(ws, data).catch((err) => console.warn('[dm] ack failed', err?.message));
      return true;
    case 'dm:read':
      handleRead(ws, data).catch((err) => console.warn('[dm] read failed', err?.message));
      return true;
    case 'dm:nudge':
      handleNudge(ws, data).catch((err) => console.warn('[dm] nudge failed', err?.message));
      return true;
    default:
      return false;
  }
}

module.exports = {
  handleMessage,
};
