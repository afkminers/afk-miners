// client/js/ws/singleton.js
const listeners = new Map(); // type -> Set<fn>
let ws = null;
let ready = false;
let connecting = false;
let queue = [];
let backoff = 500; // ms
const backoffMax = 8000;

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

function notify(type, payload) {
  let delivered = false;
  const set = listeners.get(type);
  if (set && set.size) {
    delivered = true;
    for (const fn of set) { try { fn(payload); } catch {} }
  }
  const any = listeners.get('*');
  if (!delivered && any && any.size) {
    for (const fn of any) { try { fn(payload); } catch {} }
  }
}

function attach(s) {
  s.addEventListener('open', () => {
    ready = true; connecting = false;
    const out = queue; queue = [];
    for (const msg of out) { try { s.send(JSON.stringify(msg)); } catch { queue.push(msg); } }
  });
  s.addEventListener('message', (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data && typeof data.type === 'string') notify(data.type, data);
      else notify('*', data);
    } catch {}
  });
  s.addEventListener('close', () => { ready = false; connecting = false; scheduleReconnect(); });
  s.addEventListener('error', () => { try { s.close(); } catch {} });
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return ws;
  if (connecting) return ws;
  connecting = true;
  try { ws = new WebSocket(wsUrl()); attach(ws); }
  catch { connecting = false; scheduleReconnect(); }
  return ws;
}

let reconnectTimer = null;
function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    backoff = Math.min(backoff * 2, backoffMax);
    connect();
  }, backoff);
}

export function getSocket() {
  backoff = 500; // reseta backoff a cada uso
  return connect();
}

export function wsSend(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (!msg.type) msg.type = 'message';
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
  return () => {
    const set = listeners.get(key);
    if (!set) return;
    set.delete(fn);
    if (set.size === 0) listeners.delete(key);
  };
}

// Compat: aceita (id, name) ou uma função getIdentity()
export async function authenticate(idOrFn, name) {
  let ident = null;
  try {
    ident = (typeof idOrFn === 'function') ? await idOrFn() : { id: idOrFn, name };
  } catch {}
  if (!ident || !ident.id) return;

  const s = getSocket();
  if (s.readyState === WebSocket.CONNECTING) {
    await new Promise(res => s.addEventListener('open', res, { once: true }));
  } else if (s.readyState !== WebSocket.OPEN) {
    await new Promise(res => s.addEventListener('open', res, { once: true }));
  }
  s.send(JSON.stringify({ type: 'auth', id: String(ident.id || ''), name: ident.name || 'Anonymous' }));
}
