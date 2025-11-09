// server/ws/bus.js
// Hub WebSocket com “salas” por mapa (rooms) + helpers de broadcast.

let wss = null;

// rooms[mapKey] = Set<WebSocket>
const rooms = new Map();

function resolveSocketPlayerId(ws) {
  if (!ws) return null;
  const candidate =
    ws._player?.id ??
    ws._playerId ??
    ws.playerId ??
    ws.userId ??
    ws.user?.id ??
    null;
  if (candidate == null) return null;
  try { return String(candidate); }
  catch { return null; }
}

function forEachPlayerSocket(playerId, fn) {
  const pid = String(playerId || '').trim();
  if (!pid || typeof fn !== 'function' || !wss) return 0;
  let count = 0;
  wss.clients.forEach((sock) => {
    if (!isOpen(sock)) return;
    const sid = resolveSocketPlayerId(sock);
    if (!sid || sid !== pid) return;
    count += 1;
    try { fn(sock); } catch {}
  });
  return count;
}

function isOpen(sock) {
  // 1 === WebSocket.OPEN (evita require de 'ws' aqui)
  return sock && sock.readyState === 1;
}

function roomOf(mapKey) {
  const key = String(mapKey || 'house');
  if (!rooms.has(key)) rooms.set(key, new Set());
  return rooms.get(key);
}

/** Anexa o WebSocketServer criado no index.js */
function attach(serverWss) {
  wss = serverWss;
}

/** Envia para TODOS os clientes conectados (global) */
function broadcast(obj) {
  if (!wss) return;
  const msg = JSON.stringify(obj);
  wss.clients.forEach((c) => {
    if (isOpen(c)) {
      try { c.send(msg); } catch {}
    }
  });
}

/** Coloca o socket na sala de um mapa */
function joinMapSocket(mapKey, ws) {
  const set = roomOf(mapKey);
  set.add(ws);
  ws.__mapKey = String(mapKey || 'house');

  // limpeza ao fechar/erro (registrar apenas uma vez)
  if (!ws.__roomBound) {
    ws.__roomBound = true;
    const onClose = () => {
      try {
        const rk = ws.__mapKey;
        if (rk && rooms.has(rk)) rooms.get(rk).delete(ws);
      } catch {}
    };
    ws.on('close', onClose);
    ws.on('error', onClose);
  }
}

/**
 * Move o socket de uma sala para outra.
 * Tolerante à ordem dos argumentos:
 *  - moveSocketToMap(ws, 'house')
 *  - moveSocketToMap('house', ws)
 */
function moveSocketToMap(a, b) {
  let ws, toMapKey;
  if (typeof a === 'string') { toMapKey = a; ws = b; }
  else { ws = a; toMapKey = b; }

  const from = ws?.__mapKey;
  if (from && rooms.has(from)) {
    try { rooms.get(from).delete(ws); } catch {}
  }
  joinMapSocket(toMapKey, ws);
}

function movePlayerToMap(playerId, mapKey, opts = {}) {
  const mk = String(mapKey || 'house');
  const ts = Number(opts?.ts) > 0 ? Number(opts.ts) : Date.now();
  const hasCoords = Number.isFinite(opts?.x) && Number.isFinite(opts?.y);

  return forEachPlayerSocket(playerId, (sock) => {
    try { moveSocketToMap(sock, mk); }
    catch {}
    sock._mapKey = mk;
    if (hasCoords) {
      sock._pos = { x: opts.x | 0, y: opts.y | 0, mapKey: mk, ts };
    }
  });
}

function sendToPlayer(playerId, obj) {
  if (!obj || typeof obj !== 'object' || !wss) return 0;
  const payload = JSON.stringify(obj);
  return forEachPlayerSocket(playerId, (sock) => {
    try { sock.send(payload); } catch {}
  });
}

/** Envia mensagem apenas para quem está em um dado mapa */
function broadcastToMap(mapKey, obj) {
  const set = rooms.get(String(mapKey || 'house'));
  if (!set || set.size === 0) return;
  const msg = JSON.stringify(obj);
  for (const c of set) {
    if (isOpen(c)) {
      try { c.send(msg); } catch {}
    }
  }
}

module.exports = {
  attach,
  broadcast,
  joinMapSocket,
  moveSocketToMap,
  broadcastToMap,
  sendToPlayer,
  movePlayerToMap,
};
