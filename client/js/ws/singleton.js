// client/js/ws/singleton.js
// WS singleton com reconexão, fila de envio e roteamento por "type"
// Alterações: trata frame {type: 'kicked'} enviado pelo servidor,
// suprime reconexão automática após kick e NÃO reativa reconexão ao chamar getSocket().
// Fornece enableReconnect() e forceReconnect() para reconectar sob controle explícito do UI.
// WS singleton com reconexão, fila de envio e roteamento por "type"
// Tratamento de 'kicked' — suprime reconexão automática e expõe forceReconnect/enableReconnect.

const listeners = new Map(); // type -> Set<fn>
let ws = null;
let ready = false;
let connecting = false;
let queue = [];
let backoff = 500; // ms
const backoffMax = 8000;

// reconnection control flag (global)
if (typeof window !== 'undefined') {
  if (typeof window.__wsShouldReconnect === 'undefined') {
    window.__wsShouldReconnect = true; // true: reconnect allowed; false: suppressed (kicked)
  }
}

// warn suppression for send-suppressed messages
let _warnedSuppressedSend = false;

function url() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

function notify(type, payload) {
  let delivered = false;
  const specific = listeners.get(type);
  if (specific && specific.size) {
    delivered = true;
    for (const fn of specific) { try { fn(payload); } catch {} }
  }
  const any = listeners.get('*');
  if (!delivered && any && any.size) {
    for (const fn of any) { try { fn(payload); } catch {} }
  }
}

function attach(wsInstance) {
  wsInstance.addEventListener('open', () => {
    ready = true;
    connecting = false;
    // reset warned flag when we reconnect successfully
    _warnedSuppressedSend = false;
    const out = queue; queue = [];
    for (const msg of out) {
      try { wsInstance.send(JSON.stringify(msg)); } catch { queue.push(msg); }
    }
  });

  wsInstance.addEventListener('message', (ev) => {
    try {
      const data = JSON.parse(ev.data);

      // server-initiated kick: stop auto-reconnect, notify UI and close socket
      if (data && data.type === 'kicked') {
        try { if (typeof window !== 'undefined') window.__wsShouldReconnect = false; } catch (e) {}
        try { queue = []; } catch (e) {}
        try {
          if (typeof window !== 'undefined' && typeof window.showKickedModal === 'function') {
            window.showKickedModal(data.reason || 'You have been disconnected because your account logged in elsewhere.');
          } else {
            console.warn('[ws] kicked by server:', data.reason || 'replaced_by_new_connection');
          }
        } catch (e) {}
        try { wsInstance.close(); } catch (e) {}
        return;
      }

      if (data && typeof data.type === 'string') notify(data.type, data);
      else notify('*', data);
    } catch {
      // ignore parse errors
    }
  });

  wsInstance.addEventListener('close', () => {
    ready = false;
    connecting = false;
    // only schedule reconnect if not explicitly prevented by the kicked flag
    if (typeof window === 'undefined' || window.__wsShouldReconnect !== false) {
      scheduleReconnect();
    } else {
      try { console.info('[ws] socket closed and reconnection suppressed due to kicked state'); } catch {}
    }
  });

  wsInstance.addEventListener('error', () => {
    try { wsInstance.close(); } catch {}
  });
}

function connect() {
  // If reconnections suppressed, do not attempt to connect
  if (typeof window !== 'undefined' && window.__wsShouldReconnect === false) {
    return ws;
  }

  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return ws;
  if (connecting) return ws;
  connecting = true;
  try {
    ws = new WebSocket(url());
    attach(ws);
  } catch {
    connecting = false;
    scheduleReconnect();
  }
  return ws;
}

let reconnectTimer = null;
function scheduleReconnect() {
  if (typeof window !== 'undefined' && window.__wsShouldReconnect === false) return;
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    backoff = Math.min(backoff * 2, backoffMax);
    connect();
  }, backoff);
}

// Public API

// getSocket() agora NÃO reativa reconexão automaticamente.
export function getSocket() {
  backoff = 500; // reset backoff
  return connect();
}

export function wsSend(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (!msg.type) msg.type = 'message';

  // If reconnection suppressed, do NOT attempt to create socket/reconnect automatically.
  if (typeof window !== 'undefined' && window.__wsShouldReconnect === false) {
    if (!_warnedSuppressedSend) {
      console.warn('[ws] send suppressed: reconnection is disabled (kicked)');
      _warnedSuppressedSend = true;
    }
    return;
  }

  const s = getSocket();
  if (ready && s && s.readyState === WebSocket.OPEN) {
    try { s.send(JSON.stringify(msg)); } catch { queue.push(msg); }
  } else {
    queue.push(msg);
  }
}

export function onMessage(type, fn) {
  const key = type || '*';
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(fn);
  return () => offMessage(key, fn);
}

export function offMessage(type, fn) {
  const key = type || '*';
  const set = listeners.get(key);
  if (!set) return;
  set.delete(fn);
  if (set.size === 0) listeners.delete(key);
}

// Explicit control: enable reconnection (call from UI, e.g. "Reconnect" button)
export function enableReconnect() {
  if (typeof window !== 'undefined') window.__wsShouldReconnect = true;
}

// Force a reconnection attempt (explicit)
export function forceReconnect() {
  if (typeof window !== 'undefined') window.__wsShouldReconnect = true;
  // clear any queued reconnect timer then try connect now
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  backoff = 500;
  try { connect(); } catch (e) {}
}

// Autentica após abrir conexão (chame no app quando tiver identidade)
export async function authenticate(getIdentity) {
  try {
    const ident = await getIdentity();
    if (!ident) return;
    wsSend({ type: 'auth', id: String(ident.id || ''), name: ident.name || 'Anonymous' });
  } catch {}
}

// Expose for non-module consumers (optional)
if (typeof window !== 'undefined') {
  window.forceReconnect = forceReconnect;
  window.enableReconnect = enableReconnect;
}