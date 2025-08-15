// js/landing_fx.js
// Partículas e glows “bonitos” para a landing (fora do modal)
// (versão com mais alcance/quantidade e jitter visual)

const FX = (() => {
  let cvs, ctx, DPR = 1, W = 0, H = 0, on = false, raf = 0, t = 0;
  const sparks = [];

  // âncoras (frações 0..1)
  const anchors = {
    // Zephyr (esquerda) — mão azul e chamas laranja
    L1: { x: 0.26, y: 0.43, hue: 195, r: 96 }, // maior alcance
    L2: { x: 0.72, y: 0.62, hue: 30,  r: 102 },
    // Wizard (direita) — orbe do cajado
    R1: { x: 0.21, y: 0.18, hue: 300, r: 98 }
  };

  function sel() {
    cvs = document.getElementById('landingFx');
    if (!cvs) return false;
    ctx = cvs.getContext('2d', { alpha: true });
    return true;
  }

  function resize() {
    if (!cvs) return;
    const r = cvs.getBoundingClientRect();
    DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    W = Math.max(1, Math.floor(r.width * DPR));
    H = Math.max(1, Math.floor(r.height * DPR));
    cvs.width = W; cvs.height = H;
  }

  function imgRect(id) {
    const el = document.getElementById(id);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { l: r.left * DPR, t: r.top * DPR, w: r.width * DPR, h: r.height * DPR };
  }

  function fromFrac(rect, f) {
    if (!rect) return { x: -9999, y: -9999 };
    return { x: rect.l + f.x * rect.w, y: rect.t + f.y * rect.h };
  }

  function addSpark(x, y, hue) {
    const speed = 0.6 + Math.random() * 1.6; // mais rápido
    const spread = 1.2;                      // mais aberto
    sparks.push({
      x, y,
      vx: (Math.random() - 0.5) * 1.6 * spread,
      vy: -speed,
      life: 28 + Math.random() * 38,  // vida maior
      s: (Math.random() < 0.18 ? 3 : 2),
      hue
    });
  }

  function glow(x, y, r, hue) {
    const c1 = `hsla(${hue}, 95%, 65%, 0.95)`;
    const c2 = `hsla(${hue}, 90%, 55%, 0.45)`;
    const g = ctx.createRadialGradient(x, y, r * 0.08, x, y, r);
    g.addColorStop(0, c1);
    g.addColorStop(0.45, c2);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    t++;

    ctx.clearRect(0, 0, W, H);

    const rL = imgRect('heroL-img');
    const rR = imgRect('heroR-img');

    const pL1 = fromFrac(rL, anchors.L1);
    const pL2 = fromFrac(rL, anchors.L2);
    const pR1 = fromFrac(rR, anchors.R1);

    const jig = (n, amp=3) => Math.sin((t + n) * 0.06) * amp;

    // glows maiores
    glow(pL1.x + jig(0,2), pL1.y + jig(3,2), anchors.L1.r, anchors.L1.hue);
    glow(pL2.x + jig(7,2), pL2.y + jig(5,2), anchors.L2.r, anchors.L2.hue);
    glow(pR1.x + jig(2,2), pR1.y + jig(9,2), anchors.R1.r, anchors.R1.hue);

    // mais partículas por frame
    for (let i = 0; i < 2; i++) addSpark(pL1.x, pL1.y, anchors.L1.hue);
    for (let i = 0; i < 2; i++) addSpark(pL2.x, pL2.y, anchors.L2.hue);
    for (let i = 0; i < 2; i++) addSpark(pR1.x, pR1.y, anchors.R1.hue);

    // update/desenho das faíscas
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.x += s.vx; s.y += s.vy; s.life--;
      if (s.life <= 0 || s.x < -16 || s.x > W + 16 || s.y < -16) { sparks.splice(i, 1); continue; }
      const alpha = Math.max(0, Math.min(1, s.life / 34));
      ctx.fillStyle = `hsla(${s.hue}, 95%, 70%, ${alpha})`;
      const r = s.s;
      ctx.fillRect(Math.round(s.x), Math.round(s.y), r, r);
      // halo ao redor
      ctx.globalAlpha = alpha * 0.28;
      ctx.beginPath(); ctx.arc(s.x, s.y, r * 3.1, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${s.hue}, 90%, 60%, 0.25)`; ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function start() {
    if (on) return;
    if (!sel()) return;
    on = true;
    resize();
    window.addEventListener('resize', resize);
    loop();
  }

  function stop() {
    if (!on) return;
    on = false;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    ctx && ctx.clearRect(0, 0, W, H);
    sparks.length = 0;
  }

  return { start, stop };
})();

// inicia quando a landing está visível; pausa quando entra no app
(function wire() {
  const appMain = document.getElementById('appMain');
  const visible = () => appMain && appMain.classList.contains('hidden');

  if (visible()) FX.start();

  document.addEventListener('landing-visibility', (e) => {
    if (e.detail?.visible) FX.start(); else FX.stop();
  });

  const obs = new MutationObserver(() => {
    if (visible()) FX.start(); else FX.stop();
  });
  if (appMain) obs.observe(appMain, { attributes:true, attributeFilter:['class'] });
})();
