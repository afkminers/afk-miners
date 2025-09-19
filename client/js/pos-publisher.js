// /client/js/pos-publisher.js
// Publica posição quantizada no centro do tile (32px) via WS,
// com flush ao parar, flush periódico e flush ao fechar a aba.

import { wsSend } from './ws/singleton.js';

const TILE = 32;
const HALF = TILE / 2;

const state = {
  lastTileX: null,
  lastTileY: null,
  lastSentAt: 0,
  pending: null,
  idleTimer: null,
};

const FLUSH_MS = Number(window.ENV?.FLUSH_POS_INTERVAL_MS || 5000);
const IDLE_FLUSH_MS = 300; // “posição final” ~300ms após parar

export function setMapKey(mapKey) {
  const mk = String(mapKey || 'house');
  window.game = window.game || { state: {} };
  window.game.state.mapKey = mk;
}

function getMapKey() {
  return (window.game && window.game.state && window.game.state.mapKey) || 'house';
}

// quantiza qualquer (x,y) pro centro do tile
function toTileCenter(v) {
  // ex.: 0..31 -> 16; 32..63 -> 48; etc.
  return Math.round((v - HALF) / TILE) * TILE + HALF;
}

function isAdjacent32(ax, ay, bx, by) {
  const dx = Math.abs(bx - ax);
  const dy = Math.abs(by - ay);
  return (dx === TILE && dy === 0) || (dx === 0 && dy === TILE);
}

function flushNow() {
  if (!state.pending) return;
  const { x, y, mapKey } = state.pending;
  try {
    wsSend({ type: 'pos', x: x | 0, y: y | 0, mapKey });
    state.lastTileX = x;
    state.lastTileY = y;
    state.lastSentAt = performance.now();
  } catch {}
  state.pending = null;
}

export function publishPos(x, y) {
  // quantiza pro centro do tile
  const qx = toTileCenter(x);
  const qy = toTileCenter(y);
  const mapKey = getMapKey();
  const now = performance.now();

  // sempre mantém o último ponto em pending, mesmo sem mudar de tile
  state.pending = { x: qx, y: qy, mapKey };

  // só transmite imediatamente quando mudou de tile (32px) e respeita adjacency
  const changedTile = (qx !== state.lastTileX || qy !== state.lastTileY);
  const firstSend = (state.lastTileX == null || state.lastTileY == null);
  const adjacencyOk = firstSend || isAdjacent32(state.lastTileX, state.lastTileY, qx, qy);
  const throttleOk = (now - state.lastSentAt) >= 150;

  if (changedTile && adjacencyOk && throttleOk) {
    flushNow();
  }

  // reprograma o idle flush (manda a posição “final” quando parar)
  if (state.idleTimer) clearTimeout(state.idleTimer);
  state.idleTimer = setTimeout(() => flushNow(), IDLE_FLUSH_MS);
}

// flush periódico de segurança (queda de pacotes, quedas de idle, etc.)
setInterval(() => flushNow(), Math.max(1000, FLUSH_MS));

// flush ao trocar de aba/fechar
function flushBeforeExit() {
  try { flushNow(); } catch {}
}
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushBeforeExit();
});
window.addEventListener('pagehide', flushBeforeExit);
window.addEventListener('beforeunload', flushBeforeExit);
