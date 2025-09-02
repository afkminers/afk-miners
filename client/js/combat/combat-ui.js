// Desenha UI do combate (HP bar, target box, floaters)
// Usa posições do WS quando existir; se não, cola na posição do mob local mais próximo.

import { combatState } from './ws-combat.js';

const TILE = 32;

// --- cache opcional idWS -> idMobLocal (pra não pular de mob)
const ID_BIND = new Map();

function getLocalMobs() {
  return (window.GameScene && window.GameScene.mobs) || [];
}

function nearestLocal(px, py) {
  let best = null, bestD = Infinity;
  for (const m of getLocalMobs()) {
    const dx = (m.x || 0) - px, dy = (m.y || 0) - py;
    const d = dx*dx + dy*dy;
    if (d < bestD) { bestD = d; best = m; }
  }
  return best;
}

// Garante uma posição pra desenhar o monstro m.
// 1) Se m.x/m.y existem, usa.
// 2) Se não existem, tenta mob local ligado no cache.
// 3) Se ainda não tem, liga a um mob local próximo do jogador e usa a posição dele.
function ensurePos(m) {
  if (Number.isFinite(m.x) && Number.isFinite(m.y)) return { x: m.x, y: m.y };

  // já temos um binding?
  const bindId = ID_BIND.get(m.id);
  if (bindId) {
    const mob = getLocalMobs().find(mm => String(mm.id) === String(bindId));
    if (mob) return { x: mob.x, y: mob.y };
  }

  // escolhe um mob local e fixa
  // (como o WS não manda pos, qualquer um serve pra fins visuais)
  const guess = nearestLocal(
    (window.GameScene?.controller?.getPosition?.().x) || 0,
    (window.GameScene?.controller?.getPosition?.().y) || 0
  );
  if (guess) {
    if (!guess.id) guess.id = 'local-' + Math.random().toString(36).slice(2);
    ID_BIND.set(m.id, String(guess.id));
    return { x: guess.x, y: guess.y };
  }

  return null;
}

/* =================== Draw helpers =================== */
export function drawHpBar(ctx, m) {
  if (!m) return;

  const pos = ensurePos(m);
  if (!pos) return;

  const maxHp = Number(m.maxHp ?? m.hp ?? 1) || 1;
  const curHp = Math.max(0, Number(m.hp ?? maxHp));

  const w = TILE - 4;
  const h = 4;
  const x = Math.round(pos.x + 2);
  const y = Math.round(pos.y - 6);

  // fundo
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(x, y, w, h);

  // barra hp
  const pct = Math.max(0, Math.min(1, curHp / maxHp));
  const wHp = Math.round(w * pct);
  ctx.fillStyle = 'lime';
  ctx.fillRect(x, y, wHp, h);

  // borda
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
}

export function drawTargetBox(ctx) {
  const id = combatState.selectedTargetId;
  if (!id) return;
  const m = combatState.monsters.get(id);
  if (!m) return;

  const pos = ensurePos(m);
  if (!pos) return;

  ctx.strokeStyle = 'red';
  ctx.lineWidth = 2;
  ctx.strokeRect(Math.round(pos.x), Math.round(pos.y), TILE, TILE);
}

// Floaters (dano, xp, respawn)
export function updateAndDrawFloaters(ctx, dtMs) {
  const list = combatState.floaters;
  for (let i = list.length - 1; i >= 0; i--) {
    const f = list[i];
    f.ttl -= dtMs;
    if (f.ttl <= 0) { list.splice(i, 1); continue; }
    f.y += f.vy * dtMs;

    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,0,0,0.9)';
    ctx.fillText(f.text, Math.round(f.x), Math.round(f.y));
  }
}

/* ============ Eventos p/ manter selectedTargetId em dia ============ */
window.addEventListener('combat:attack:start', () => {
  // garante que a box vermelha trave no alvo atual
  if (combatState.targetId) combatState.selectedTargetId = combatState.targetId;
});

window.addEventListener('combat:attack:stop', () => {
  combatState.selectedTargetId = null;
});
