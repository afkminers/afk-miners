// server/ws/bus.js
let wss = null;

function attach(serverWss) { wss = serverWss; }

function broadcast(obj) {
  if (!wss) return;
  const msg = JSON.stringify(obj);
  wss.clients.forEach(c => {
    if (c && c.readyState === 1) { try { c.send(msg); } catch {} }
  });
}

module.exports = { attach, broadcast };