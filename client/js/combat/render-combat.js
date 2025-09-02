// client/js/combat/render-combat.js
import { combatState, connectCombatWS } from './ws-combat.js';

// ===== DRAW: HP bar =====
export function drawHpBar(ctx, m) {
  if (!m) return;
  const max = Number(m.maxHp ?? m.hpMax ?? 1) || 1;
  const hp  = Math.max(0, Math.min(max, Number(m.hp ?? max)));
  if (typeof m.x !== 'number' || typeof m.y !== 'number') return;

  const w = 28, h = 4, offY = 22;
  const left = Math.round(m.x - (w / 2));
  const top  = Math.round(m.y - offY);

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.45)';   // bg
  ctx.fillRect(left - 1, top - 1, w + 2, h + 2);

  ctx.fillStyle = 'rgba(255,0,0,0.25)'; // red bg
  ctx.fillRect(left, top, w, h);

  const ratio = hp / max;
  ctx.fillStyle = 'rgba(0,220,80,0.9)'; // green
  ctx.fillRect(left, top, Math.round(w * ratio), h);

  ctx.restore();
}

// ===== DRAW: target box =====
export function drawTargetBox(ctx) {
  const id = combatState.targetId;  // <-- unificado
  if (!id) return;

  const gs = window.GameScene;
  const list = Array.from(combatState.monsters.values());
  const idx  = list.findIndex(m => String(m.id) === String(id));
  let m = list[idx >= 0 ? idx : 0];
  if (!m) return;

  let { x, y } = m;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    // aproxima com mob local equivalente
    const locals = gs?.mobs || [];
    if (locals.length) { const lm = locals[(idx >= 0 ? idx : 0) % locals.length]; x = lm?.x; y = lm?.y; }
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;

  const s = 20;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 2;
  ctx.strokeRect(Math.round(x - s/2), Math.round(y - s/2), s, s);
  ctx.restore();
}

// ===== Floaters =====
export function updateAndDrawFloaters(ctx, dtMs) {
  const list = combatState.floaters;
  for (let i = list.length - 1; i >= 0; i--) {
    const f = list[i];
    f.ttl -= dtMs;
    f.y  += f.vy * dtMs;
    if (f.ttl <= 0) { list.splice(i, 1); continue; }

    ctx.save();
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(255,255,255,${(f.ttl/900).toFixed(2)})`;
    ctx.fillText(f.text, Math.round(f.x), Math.round(f.y));
    ctx.restore();
  }
}

// ===== Overlay pronto (default export) =====
export default function installCombatOverlay() {
  connectCombatWS();  // garante WS ligado

  // play.js chama window.CombatUI.render(ctx, camera, dt)
  window.CombatUI = {
    render(ctx, camera, dt) {
      const gs = window.GameScene;
      if (!gs) return;

      const locals = gs.mobs || [];
      const wsList = Array.from(combatState.monsters.values());

      const drawAll = () => {
        for (let i = 0; i < wsList.length; i++) {
          const m = wsList[i];
          let x = m.x, y = m.y;
          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            if (locals.length) { const lm = locals[i % locals.length]; x = lm?.x; y = lm?.y; }
          }
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          drawHpBar(ctx, { ...m, x, y });
        }
        drawTargetBox(ctx);
      };

      if (gs.camera?.apply) gs.camera.apply(ctx, drawAll);
      else drawAll();

      // play.js manda dt em segundos → converte p/ ms
      updateAndDrawFloaters(ctx, dt * 1000);
    }
  };
}
