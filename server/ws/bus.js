// server/ws/bus.js
// Hub WebSocket com “salas” por mapa (rooms) + helpers de broadcast.

let wss = null;

// rooms[mapKey] = Set<WebSocket>
const rooms = new Map();

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
};
