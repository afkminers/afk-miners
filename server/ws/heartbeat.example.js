function setupHeartbeat(wss) {
  function noop() {}
  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
  });
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      try { ws.ping(noop); } catch {}
    });
  }, 30000);
  wss.on('close', () => clearInterval(interval));
}
module.exports = { setupHeartbeat };