// server/ws/chat-handler.js
// Gera o payload do chat com id, inserindo no banco e devolvendo {type:'chat', id, ...}

const { get } = require('../models/db'); // ajuste o caminho se mudar a estrutura

async function createChatPayload(ws, textRaw) {
  const text = String(textRaw || '').trim();
  if (!text) return null;

  // Dados vindos do handshake do WS
  const fromId = ws._player?.id || ws._playerId || ws.playerId || ws.userId || '';
  const fromName = ws._player?.name || ws._playerName || ws.playerName || ws.name || 'player';

  // Insere no banco e pega id + created_at
  let row;
  try {
    row = await get(
      `INSERT INTO chat_messages (scope, fromid, fromname, text)
       VALUES ('global', $1, $2, $3)
       RETURNING id, created_at`,
      [fromId, fromName, text]
    );
  } catch (e) {
    console.warn('[ws-chat] insert failed:', e && e.message);
    return null;
  }

  return {
    type: 'chat',
    scope: 'global',
    id: row.id,
    fromId,
    fromName,
    text,
    ts: new Date(row.created_at).getTime()
  };
}

module.exports = { createChatPayload };