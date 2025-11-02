'use strict';

const {
  ensureCanMessage,
  insertMessage,
  markDelivered,
  markRead,
  countUnreadForPair,
} = require('../services/direct-messages');
const bus = require('./bus');

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

async function handleSend(ws, data) {
  const senderId = resolveUserId(ws);
  if (!senderId) return;
  const friendId = String(data.to || data.friendId || '').trim();
  const body = data.body != null ? data.body : data.text;
  const clientId = data.clientId || null;
  if (!friendId) {
    send(ws, { type: 'dm:error', error: 'FRIEND_ID_REQUIRED', clientId });
    return;
  }

  try {
    await ensureCanMessage({ senderId, recipientId: friendId });
    const row = await insertMessage({ senderId, recipientId: friendId, body });
    const message = mapMessage(row);
    const payload = { type: 'dm:send', message, clientId };
    send(ws, payload);

    const unread = await countUnreadForPair(friendId, senderId);
    const recvPayload = {
      type: 'dm:recv',
      message,
      fromId: senderId,
      unreadCount: unread,
    };
    if (friendId === senderId) {
      send(ws, recvPayload);
    } else {
      bus.sendToPlayer(friendId, recvPayload);
    }
  } catch (err) {
    const code = err?.code || err?.payload?.error || 'DM_SEND_FAILED';
    send(ws, { type: 'dm:error', error: code, clientId });
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
    default:
      return false;
  }
}

module.exports = {
  handleMessage,
};
