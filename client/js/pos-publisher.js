// /client/js/pos-publisher.js
// Publica posição quantizada no centro do tile (32px) via WS,
// com flush ao parar, flush periódico e flush ao fechar a aba.
// Ajustado para respeitar o MIN_STEP_MS do servidor e evitar "rubber-banding".

import { wsSend } from './ws/singleton.js';

const TILE = 32;
const HALF = TILE / 2;

const state = {
  lastTileX: null,
  lastTileY: null,
  lastSentAt: 0,     // performance.now() do último envio aceito
  pending: null,     // último ponto quantizado aguardando envio
  idleTimer: null,
};

// Server aceita 1 passo/≈106ms (32px / 180px/s × 0.60). Aqui damos folga.
// Você pode sobrepor via window.ENV.MIN_TILE_MS.
const MIN_TILE_MS = Number(window.ENV?.MIN_TILE_MS || 130);

// Intervalos de segurança (podem ser sobrepostos via ENV também)
const FLUSH_MS = Number(window.ENV?.FLUSH_POS_INTERVAL_MS || 120);
const IDLE_FLUSH_MS = Number(window.ENV?.IDLE_FLUSH_MS || 120);

export function setMapKey(mapKey) {
  const mk = String(mapKey || 'house');
  window.game = window.game || { state: {} };
  window.game.state.mapKey = mk;
}

function getMapKey() {
  return (window.game && window.game.state && window.game.state.mapKey) || 'house';
}

// Quantiza qualquer (x,y) para o centro do tile
function toTileCenter(v) {
  // ex.: 0..31 -> 16; 32..63 -> 48; etc.
  return Math.round((v - HALF) / TILE) * TILE + HALF;
}

function isAdjacent32(ax, ay, bx, by) {
  const dx = Math.abs(bx - ax);
  const dy = Math.abs(by - ay);
  return (dx === TILE && dy === 0) || (dx === 0 && dy === TILE);
}

// Envia se:
// - for o mesmo tile (sempre ok), ou
// - mudou de tile E já passou MIN_TILE_MS desde o último envio (ou force=true)
function flushNow({ force = false } = {}) {
  if (!state.pending) return;

  const { x, y, mapKey } = state.pending;
  const changedTile = (x !== state.lastTileX || y !== state.lastTileY);
  const since = performance.now() - state.lastSentAt;

  // Bloqueia envio precoce quando muda de tile, para não tomar pos_snap do servidor
  if (changedTile && !force && since < MIN_TILE_MS) return;

  try {
    wsSend({ type: 'pos', x: x | 0, y: y | 0, mapKey });
    state.lastTileX = x;
    state.lastTileY = y;
    state.lastSentAt = performance.now();
  } catch {
    // silencia erro de WS momentâneo
  } finally {
    state.pending = null;
  }
}

export function publishPos(x, y) {
  // Quantiza pro centro do tile
  const qx = toTileCenter(x);
  const qy = toTileCenter(y);
  const mapKey = getMapKey();
  const now = performance.now();

  // Guarda o último ponto (mesmo que seja o mesmo tile)
  state.pending = { x: qx, y: qy, mapKey };

  // Envia imediatamente quando mudou de tile, é adjacente e já respeita o mínimo
  const changedTile = (qx !== state.lastTileX || qy !== state.lastTileY);
  const firstSend = (state.lastTileX == null || state.lastTileY == null);
  const adjacencyOk = firstSend || isAdjacent32(state.lastTileX, state.lastTileY, qx, qy);
  const minTimeOk = (now - state.lastSentAt) >= MIN_TILE_MS;

  if (changedTile && adjacencyOk && minTimeOk) {
    flushNow();
  }

  // Reprograma o idle flush (manda a “posição final” ao parar),
  // garantindo que, se for mudança de tile, não viole o MIN_TILE_MS.
  if (state.idleTimer) clearTimeout(state.idleTimer);
  const since = now - state.lastSentAt;
  const wait =
    changedTile
      ? Math.max(IDLE_FLUSH_MS, MIN_TILE_MS - since) // espera o que faltar
      : IDLE_FLUSH_MS;                                // mesmo tile pode ir já
  state.idleTimer = setTimeout(() => flushNow(), Math.max(0, wait));
}

// Flush periódico de segurança (quedas de pacote etc.)
// Usa pelo menos MIN_TILE_MS para não disparar mudança de tile precoce.
setInterval(() => flushNow(), Math.max(MIN_TILE_MS, FLUSH_MS));

// Flush ao trocar de aba/fechar
function flushBeforeExit() {
  try { flushNow({ force: true }); } catch {}
}
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushBeforeExit();
});
window.addEventListener('pagehide', flushBeforeExit);
window.addEventListener('beforeunload', flushBeforeExit);
