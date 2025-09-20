// client/js/ui/hero-floating-damage.js
import { onMessage } from '../ws/singleton.js';

(function () {
  const POPS = []; // {x,y,text,life,duration,vy}
  const LIFE_MS = 800;

  function now() { return performance.now(); }

  // posição atual do herói (aproximação)
  function getHeroWorldPos() {
    try {
      const ctrl = window.GameScene?.controller;
      if (ctrl && typeof ctrl.getPosition === 'function') return ctrl.getPosition();
    } catch {}
    return { x: 0, y: 0 };
  }

  function addPopup(text, { x, y }) {
    POPS.push({ x, y, text: String(text), created: now(), duration: LIFE_MS, vy: -28 });
    if (POPS.length > 40) POPS.shift();
  }

  // WS: quando **o herói** leva dano
  onMessage('hero_dmg', (m) => {
    const activeId = (window.Team?.getActiveHeroId && window.Team.getActiveHeroId()) || window.ActiveHeroId || null;
    if (!activeId) return;
    if (String(m.heroId) !== String(activeId)) return;

    // origem no herói
    const p = getHeroWorldPos();
    addPopup(`-${m.amount}`, p);

    // opcional: escrever no chat-log também
    if (window.Chat?.pushLog) {
      window.Chat.pushLog(`[Dano] ${m.byMob ?? m.instanceId} → você: ${m.amount}`);
    }
  });

  // (opcional) mostra “+N” ao curar (se um dia emitir hero_heal)
  onMessage('hero_heal', (m) => {
    const activeId = (window.Team?.getActiveHeroId && window.Team.getActiveHeroId()) || window.ActiveHeroId || null;
    if (!activeId) return;
    if (String(m.heroId) !== String(activeId)) return;
    const p = getHeroWorldPos();
    addPopup(`+${m.amount}`, p);
  });

  function render(ctx, camera, dt) {
    if (!ctx || !camera) return;
    const t = now();

    for (let i = POPS.length - 1; i >= 0; i--) {
      const p = POPS[i];
      const age = t - p.created;
      if (age >= p.duration) { POPS.splice(i, 1); continue; }

      const k = age / p.duration;
      const alpha = 1 - k;
      const dy = p.vy * (age / 1000); // sobe devagar

      const z = (typeof camera.getZoom === 'function') ? camera.getZoom() : 1;
      const sx = (p.x - camera.x) * z;
      const sy = (p.y - camera.y + dy) * z;

      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.font = `${Math.round(14 * z)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // contorno
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillText(p.text, sx + 1, sy + 1);
      ctx.fillText(p.text, sx - 1, sy + 1);
      ctx.fillText(p.text, sx + 1, sy - 1);
      ctx.fillText(p.text, sx - 1, sy - 1);

      // texto
      ctx.fillStyle = '#ef4444'; // vermelho (dano); se curar, mude para verde
      if (p.text.startsWith('+')) ctx.fillStyle = '#10b981';
      ctx.fillText(p.text, sx, sy);
      ctx.restore();
    }
  }

  // API pública para o loop principal
  window.HeroDamageUI = { render };
})();
