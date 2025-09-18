// session-manager: ENSURE SINGLE SOCKET PER SESSION
// API:
//   register(sessionId, ws) -> { replaced: boolean, previous: WebSocket|null }
//   unregister(sessionId, ws) -> { removed: boolean, remaining: number }
//   get(sessionId) -> WebSocket|null
// server/ws/session-manager.js
const map = new Map(); // sessionId -> ws

function register(sessionId, ws) {
  if (!sessionId || !ws) return { replaced: false, previous: null };
  const previous = map.get(sessionId) || null;
  // store the new ws (replace previous)
  map.set(sessionId, ws);
  return { replaced: previous !== null, previous };
}

function unregister(sessionId, ws) {
  if (!sessionId) return { removed: false, remaining: 0 };
  const current = map.get(sessionId);
  // only remove if the same socket is being unregistered
  if (current && current === ws) {
    map.delete(sessionId);
    return { removed: true, remaining: 0 };
  }
  // if current !== ws, do nothing: another socket already replaced it
  return { removed: false, remaining: map.has(sessionId) ? 1 : 0 };
}

function get(sessionId) {
  return map.get(sessionId) || null;
}

module.exports = { register, unregister, get };