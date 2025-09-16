// client/js/pos-publisher.js
// Publica posição do jogador (WS + fallback HTTP) e inclui mapKey.
// Usa um leve throttle pra não spammar o servidor.

import { wsSend } from './ws.js'; // se seu projeto NÃO usa ESM, veja nota mais abaixo

const POS_HTTP_INTERVAL_MS = 300;   // fallback HTTP, ~3x/seg
const FORCE_HTTP_EVERY_MS  = 2000;  // garante um POST a cada 2s mesmo sem mover
let lastSentAt = 0;
let lastX = null, lastY = null, lastMap = null;

function getCsrf() {
  const m = document.cookie.match(/(?:^|;\s*)csrf=([^;]+)/);
  return m ? m[1] : '';
}

function getMapKey() {
  // ajuste aqui se seu estado do jogo guarda o mapKey em outro lugar
  return (window.game && window.game.state && window.game.state.mapKey) || 'house';
}

export function setMapKey(mapKey) {
  window.game = window.game || { state: {} };
  window.game.state.mapKey = mapKey || 'house';
}

export async function publishPos(x, y) {
  const now = Date.now();
  const mapKey = getMapKey();
  const ix = (x | 0), iy = (y | 0);

  const moved = ix !== lastX || iy !== lastY || mapKey !== lastMap;
  const timeSince = now - lastSentAt;

  // Envia pelo WebSocket sempre que houver movimento significativo
  try {
    wsSend({ type: 'pos', x: ix, y: iy, mapKey });
  } catch {}

  // Fallback HTTP (e também reforça presença online no servidor)
  if (moved && timeSince >= POS_HTTP_INTERVAL_MS || timeSince >= FORCE_HTTP_EVERY_MS) {
    lastSentAt = now;
    lastX = ix; lastY = iy; lastMap = mapKey;

    fetch('/api/player/pos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf': getCsrf()
      },
      body: JSON.stringify({ x: ix, y: iy, mapKey })
    }).catch(() => {});
  }
}
