// Hub WebSocket com “salas” por mapa (rooms) + helpers de broadcast.
// Versão: reduz spam de logs para eventos de alta frequência,
// retorna contagem de clients atingidos e protege envios por-socket.

let wss = null;
const rooms = new Map();
const _sendErrorLogged = new WeakSet();
const DBG = String(process.env.WS_DEBUG || '').trim() === '1';

// Tipos de eventos de alta frequência que não devem logar por padrão
const HIGH_FREQ_TYPES = new Set(['monster_move', 'player_pos', 'monster_move_ping']);

function isOpen(sock) { return sock && sock.readyState === 1; }
function roomOf(mapKey) {
  const key = String(mapKey || 'house');
  if (!rooms.has(key)) rooms.set(key, new Set());
  return rooms.get(key);
}
function safeStringify(obj) {
  try { return JSON.stringify(obj); }
  catch (e) {
    try {
      const simple = {};
      for (const k of Object.keys(obj || {})) {
        const v = obj[k];
        simple[k] = (typeof v === 'object') ? String(v) : v;
      }
      return JSON.stringify(simple);
    } catch { return String(obj); }
  }
}
function attach(serverWss) {
  wss = serverWss;
  if (DBG) {
    try { console.debug('[ws-bus] attached wss, clients:', (wss && wss.clients && wss.clients.size) || 0); } catch {}
  }
}
function _safeSend(socket, text) {
  if (!socket) return false;
  if (!isOpen(socket)) return false;
  try { socket.send(text); return true; }
  catch (err) {
    if (! _sendErrorLogged.has(socket)) {
      _sendErrorLogged.add(socket);
      try { console.warn('[ws-bus] send failed to socket (logged once):', err?.message || err); } catch {}
    }
    return false;
  }
}

/** Broadcast global (retorna count) */
function broadcast(obj) {
  if (!wss) return 0;
  const msg = safeStringify(obj);
  let count = 0;
  try {
    for (const c of wss.clients) {
      if (isOpen(c)) {
        if (_safeSend(c, msg)) count++;
      }
    }
  } catch (e) {
    try { console.warn('[ws-bus] broadcast loop failed:', e?.message || e); } catch {}
  }
  // suprime logs de tipos muito frequentes a não ser que DBG=1
  const t = obj?.type;
  if (DBG || !HIGH_FREQ_TYPES.has(t)) {
    try { console.info('[ws-bus] broadcast', t || '(no-type)', '-> clients:', count); } catch {}
  }
  return count;
}

/** Insere socket na sala do mapa */
function joinMapSocket(mapKey, ws) {
  const set = roomOf(mapKey);
  set.add(ws);
  ws.__mapKey = String(mapKey || 'house');

  if (!ws.__roomBound) {
    ws.__roomBound = true;
    const onClose = () => {
      try {
        const rk = ws.__mapKey;
        if (rk && rooms.has(rk)) rooms.get(rk).delete(ws);
      } catch {}
    };
    try {
      ws.on('close', onClose);
      ws.on('error', onClose);
    } catch (e) {
      try { console.warn('[ws-bus] joinMapSocket: failed bind close/error:', e?.message || e); } catch {}
    }
  }
}

function moveSocketToMap(a, b) {
  let ws, toMapKey;
  if (typeof a === 'string') { toMapKey = a; ws = b; } else { ws = a; toMapKey = b; }
  if (!ws) return;
  const from = ws?.__mapKey;
  if (from && rooms.has(from)) {
    try { rooms.get(from).delete(ws); } catch {}
  }
  joinMapSocket(toMapKey, ws);
}

/** Broadcast apenas para sockets no mapa (retorna count) */
function broadcastToMap(mapKey, obj) {
  const set = rooms.get(String(mapKey || 'house'));
  if (!set || set.size === 0) {
    if (DBG) {
      try { console.debug('[ws-bus] broadcastToMap: no clients in map', String(mapKey || 'house')); } catch {}
    }
    return 0;
  }
  const msg = safeStringify(obj);
  let count = 0;
  for (const c of set) {
    if (isOpen(c)) {
      if (_safeSend(c, msg)) count++;
    }
  }
  const t = obj?.type;
  if (DBG || !HIGH_FREQ_TYPES.has(t)) {
    try { console.info('[ws-bus] broadcastToMap', String(mapKey || 'house'), t || '(no-type)', '-> clients:', count); } catch {}
  }
  return count;
}

module.exports = {
  attach,
  broadcast,
  joinMapSocket,
  moveSocketToMap,
  broadcastToMap,
};