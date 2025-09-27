// client/js/ui/combat-range-hint.js
// Mensagens flutuantes (estilo Tibia) para feedback rápido de combate.

(function CombatRangeHintModule() {
  const HINTS = [];
  const LIFE_MS = 1200;
  const MAX_ACTIVE = 8;

  let lastText = '';
  let lastAt = 0;

  function now() {
    return performance?.now ? performance.now() : Date.now();
  }

  function getHeroWorldPos() {
    try {
      const ctrl = window.GameScene?.controller;
      if (ctrl && typeof ctrl.getPosition === 'function') {
        return ctrl.getPosition();
      }
    } catch (_) {}
    return null;
  }

  function pushHint(text, opts = {}) {
    const label = String(text || '').trim();
    if (!label) return;

    const t = now();
    if (label === lastText && t - lastAt < 250) return; // evita spam idêntico instantâneo
    lastText = label;
    lastAt = t;

    let { worldPos } = opts;
    if (!worldPos || !Number.isFinite(worldPos.x) || !Number.isFinite(worldPos.y)) {
      worldPos = getHeroWorldPos();
    }
    if (!worldPos || !Number.isFinite(worldPos.x) || !Number.isFinite(worldPos.y)) return;

    const life = Number.isFinite(opts.duration) ? Math.max(100, Number(opts.duration)) : LIFE_MS;
    const baseFont = Number.isFinite(opts.fontSize) ? Math.max(8, Number(opts.fontSize)) : 14;
    const offsetY = Number.isFinite(opts.offsetY) ? Number(opts.offsetY) : -24;
    const vy = Number.isFinite(opts.vy) ? Number(opts.vy) : -22; // px/segundo para subir

    HINTS.push({
      text: label,
      x: Number(worldPos.x) || 0,
      y: (Number(worldPos.y) || 0) + offsetY,
      created: t,
      life,
      fontSize: baseFont,
      color: opts.color || '#f8fafc',
      stroke: opts.stroke || 'rgba(0,0,0,0.82)',
      vy,
    });

    while (HINTS.length > MAX_ACTIVE) HINTS.shift();
  }

  function render(ctx, camera) {
    if (!ctx || !camera || !HINTS.length) return;

    const t = now();
    const zoom = typeof camera.getZoom === 'function' ? camera.getZoom() : 1;

    for (let i = HINTS.length - 1; i >= 0; i--) {
      const hint = HINTS[i];
      const age = t - hint.created;
      if (age >= hint.life) {
        HINTS.splice(i, 1);
        continue;
      }

      const progress = age / hint.life;
      const alpha = Math.max(0, 1 - progress);
      const rise = hint.vy * (age / 1000);

      const sx = (hint.x - camera.x) * zoom;
      const sy = (hint.y - camera.y + rise) * zoom;

      const fontPx = Math.round(hint.fontSize * zoom);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `bold ${fontPx}px 'Trebuchet MS', 'Verdana', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const msg = hint.text;
      const stroke = hint.stroke;
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = Math.max(1, Math.round(fontPx * 0.14));
        try { ctx.strokeText(msg, sx, sy); } catch (_) {}
      }

      ctx.fillStyle = hint.color || '#f8fafc';
      try { ctx.fillText(msg, sx, sy); } catch (_) {}
      ctx.restore();
    }
  }

  function onFrame(ev) {
    if (!HINTS.length) return;
    const detail = ev?.detail || {};
    render(detail.ctx, detail.camera);
  }

  window.CombatRangeHint = {
    show: pushHint,
    clear() {
      HINTS.length = 0;
    },
  };

  window.addEventListener('game:frame', onFrame);
})();

