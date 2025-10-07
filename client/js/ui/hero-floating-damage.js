// client/js/ui/hero-floating-damage.js
import { onMessage } from '../ws/singleton.js';

(function () {
  const POPS = []; // {x,y,text,kind,created,duration,vy}
  const LIFE_MS = 800;
  const MAX_POPUPS = 40;
  const DEFAULT_OFFSET_Y = 18;

  function now() { return performance.now(); }

  function activeHeroId() {
    try {
      if (window.Team?.getActiveHeroId) {
        const id = window.Team.getActiveHeroId();
        if (id != null) return String(id);
      }
    } catch {}
    if (window.ActiveHeroId != null) return String(window.ActiveHeroId);
    return null;
  }

  // posição atual do herói ativo (aproximação)
  function getHeroWorldPos(heroId) {
    if (heroId != null) {
      const active = activeHeroId();
      if (active && String(heroId) !== active) return null;
    }
    try {
      const ctrl = window.GameScene?.controller;
      if (ctrl && typeof ctrl.getPosition === 'function') {
        const pos = ctrl.getPosition();
        if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) return pos;
      }
    } catch {}
    return null;
  }

  function pushPopup({ x, y, text, kind }) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    POPS.push({ x, y: y - DEFAULT_OFFSET_Y, text: String(text ?? ''), kind: kind || '', created: now(), duration: LIFE_MS, vy: -28 });
    if (POPS.length > MAX_POPUPS) POPS.shift();
  }

  function normalizeText(amount, kind) {
    if (amount == null) return '';
    if (typeof amount === 'string') return amount;
    const num = Number(amount);
    if (!Number.isFinite(num)) return String(amount);
    const base = Math.round(Math.abs(num));
    if (kind === 'from_mob' || kind === 'damage' || kind === 'hit') return `-${base}`;
    if (kind === 'heal' || kind === 'from_heal' || kind === 'heal_self') return `+${base}`;
    return String(num);
  }

  function spawn({ x, y, amount, kind }) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const text = normalizeText(amount, kind);
    pushPopup({ x, y, text, kind });
  }

  function spawnAtHero(amount, byKind, heroId) {
    const pos = getHeroWorldPos(heroId);
    if (pos) {
      spawn({ x: pos.x, y: pos.y, amount, kind: byKind || 'from_mob' });
      return true;
    }
    return false;
  }

  // WS: quando **o herói** leva dano
  onMessage('hero_dmg', (m) => {
    const active = activeHeroId();
    if (!active || String(m.heroId) !== active) return;
    if (spawnAtHero(m.amount, 'from_mob', m.heroId)) return;

    const ctrl = window.GameScene?.controller;
    const pos = ctrl?.getPosition?.();
    if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
      spawn({ x: pos.x, y: pos.y, amount: m.amount, kind: 'from_mob' });
    }
  });

  // (opcional) mostra “+N” ao curar (se um dia emitir hero_heal)
  onMessage('hero_heal', (m) => {
    const active = activeHeroId();
    if (!active || String(m.heroId) !== active) return;
    if (spawnAtHero(m.amount, 'heal', m.heroId)) return;

    const ctrl = window.GameScene?.controller;
    const pos = ctrl?.getPosition?.();
    if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
      spawn({ x: pos.x, y: pos.y, amount: m.amount, kind: 'heal' });
    }
  });

  function render(ctx, camera) {
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
      let color = '#ef4444';
      if (p.kind === 'heal' || p.text.startsWith('+')) color = '#10b981';
      ctx.fillStyle = color;
      ctx.fillText(p.text, sx, sy);
      ctx.restore();
    }
  }

  // API pública para o loop principal
  window.HeroDamageUI = { spawn, render, spawnAtHero };
})();
