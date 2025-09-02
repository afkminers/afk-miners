// client/js/combat/render-combat.js
import { combatState } from './ws-combat.js';

// Barra de HP em cima do tile (32x32)
export function drawHpBar(ctx, m) {
  if (!m || m.hp == null || m.maxHp == null) return;
  if (typeof m.x !== 'number' || typeof m.y !== 'number') return;

  const tileW = 32;
  const w = tileW - 4;
  const h = 4;
  const x = Math.round(m.x + 2);
  const y = Math.round(m.y - 6);

  // fundo
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(x, y, w, h);

  // hp
  const pct = Math.max(0, Math.min(1, m.hp / (m.maxHp || 1)));
  const wHp = Math.round(w * pct);
  ctx.fillStyle = 'lime';
  ctx.fillRect(x, y, wHp, h);

  // borda
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
}

// box vermelho no alvo selecionado
export function drawTargetBox(ctx) {
  const id = combatState.selectedTargetId;
  if (!id) return;
  const m = combatState.monsters.get(id);
  if (!m || typeof m.x !== 'number' || typeof m.y !== 'number') return;

  ctx.strokeStyle = 'red';
  ctx.lineWidth = 2;
  ctx.strokeRect(Math.round(m.x), Math.round(m.y), 32, 32);
}

// atualiza/desenha floaters (dano, “respawn”, etc.)
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

// helper opcional: desenhar tudo de uma vez para 1 monstro
export function drawMonsterUI(ctx, m) {
  drawHpBar(ctx, m);
  // (target box é global; chame drawTargetBox uma vez por frame)
}
