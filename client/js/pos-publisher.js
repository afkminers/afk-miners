// client/js/pos-publisher.js
import { wsSend } from './ws/singleton.js';

const TILE = 32;
const HALF = TILE / 2;

const state = {
  lastTileX: null,
  lastTileY: null,
  lastSentAt: 0,
};

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

export function publishPos(x, y) {
  // quantiza pro centro do tile
  const qx = toTileCenter(x);
  const qy = toTileCenter(y);

  // só envia quando mudou de tile
  if (qx === state.lastTileX && qy === state.lastTileY) return;

  // respeita o passo adjacente
  if (state.lastTileX != null && state.lastTileY != null) {
    if (!isAdjacent32(state.lastTileX, state.lastTileY, qx, qy)) {
      // ainda andando dentro do mesmo tile ou pulou demais — espera
      return;
    }
  }

  // throttle (precisa casar com o MIN_STEP_MS do servidor)
  const now = performance.now();
  if (now - state.lastSentAt < 150) return;

  state.lastTileX = qx;
  state.lastTileY = qy;
  state.lastSentAt = now;

  try {
    wsSend({ type: 'pos', x: qx | 0, y: qy | 0, mapKey: getMapKey() });
  } catch {}
}
