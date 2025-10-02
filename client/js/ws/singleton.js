// server/ws/singleton.js
const WebSocket = require('ws');
const { setLivePlayerPosition, clearLivePlayerPosition } = require('../player/live_positions');

const wss = new WebSocket.Server({ noServer: true });
const clients = new Map();

wss.on('connection', (ws, req) => {
  const auth = { playerId: null, name: null };
  clients.set(ws, auth);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const type = String(msg.type || '').toLowerCase();

    // Autenticação
    if (type === 'auth') {
      auth.playerId = String(msg.id || msg.playerId || '');
      auth.name = String(msg.name || 'Player');
      ws.send(JSON.stringify({ type: 'auth_ok', playerId: auth.playerId }));
      return;
    }

    // Posição (ATUALIZADO)
    if (type === 'pos') {
      if (!auth.playerId) return;
      
      const x = Number(msg.x || 0);
      const y = Number(msg.y || 0);
      const mapKey = String(msg.mapKey || 'house');
      
      // Atualiza cache em memória
      setLivePlayerPosition(auth.playerId, x, y, mapKey);
      
      // Broadcast para outros clientes (opcional)
      broadcast({
        type: 'player_moved',
        playerId: auth.playerId,
        x, y, mapKey,
        ts: Date.now()
      }, ws);
      return;
    }

    // Chat global
    if (type === 'chat' && msg.scope === 'global') {
      if (!auth.playerId || !msg.text) return;
      broadcast({
        type: 'chat',
        scope: 'global',
        fromId: auth.playerId,
        fromName: auth.name,
        text: String(msg.text).substring(0, 500),
        ts: Date.now()
      });
      return;
    }
  });

  ws.on('close', () => {
    if (auth.playerId) {
      clearLivePlayerPosition(auth.playerId);
    }
    clients.delete(ws);
  });

  ws.on('error', (err) => {
    console.warn('[ws] error:', err.message);
  });
});

function broadcast(data, excludeWs = null) {
  const payload = JSON.stringify(data);
  for (const [client, _auth] of clients.entries()) {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      try { client.send(payload); } catch {}
    }
  }
}

function send(playerId, data) {
  const id = String(playerId);
  const payload = JSON.stringify(data);
  for (const [client, auth] of clients.entries()) {
    if (auth.playerId === id && client.readyState === WebSocket.OPEN) {
      try { client.send(payload); } catch {}
    }
  }
}

module.exports = { wss, broadcast, send };
