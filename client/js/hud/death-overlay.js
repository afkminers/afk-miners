// client/js/hud/death-overlay.js
import { onMessage } from '../ws/singleton.js';
import { apiPost, getCsrf } from '../api.js';

(function () {
  // ===== estado =====
  const state = {
    dead: false,
    heroId: null,
  };

  // ===== i18n helper =====
  function t(key, fallback) {
    try {
      const i18n = window.i18n;
      if (i18n && typeof i18n.t === 'function') {
        const v = i18n.t(key);
        if (v != null && v !== key) return v;
      }
    } catch {}
    return fallback;
  }

  // ===== garante a fonte Press Start 2P (caso app.html não tenha carregado) =====
  function ensurePressStartFont() {
    if (document.querySelector('link[data-press-start]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap';
    link.setAttribute('data-press-start', '1');
    document.head.appendChild(link);
  }

  // ===== CSS retrô injetado =====
  // Moldura pixelada, tarja retro, scanlines, botão laranja com “shine”.
  const CSS = `
  :root {
    --retro-bg: #0d0f17;
    --retro-panel: #141826;
    --retro-panel-2: #0b0e18;
    --retro-accent: #ffb347;
    --retro-accent-2: #ff7a18;
    --retro-danger: #ff4d4d;
    --retro-text: #e8ecf2;
    --retro-muted: #9aa6c0;
    --crt-scanline: rgba(255,255,255,0.04);
    --crt-shadow: 0 20px 60px rgba(0,0,0,.65);
    --pixel: 4px; /* “grossura” do pixel */
  }

  .death-overlay {
    position: fixed; inset: 0; z-index: 9999;
    display: none; align-items: center; justify-content: center;
    background:
      radial-gradient(1200px 800px at 50% 50%, rgba(0,0,0,.65), rgba(0,0,0,.92)),
      var(--retro-bg);
    color: var(--retro-text);
    font-family: "Press Start 2P", monospace;
    letter-spacing: .5px;
    image-rendering: pixelated;
  }

  /* leve CRT/scanlines */
  .death-overlay::after {
    content: "";
    position: absolute; inset: 0; pointer-events: none;
    background:
      repeating-linear-gradient(
        to bottom,
        transparent 0, transparent 2px,
        var(--crt-scanline) 3px, transparent 4px
      );
    mix-blend-mode: overlay; opacity: .6;
  }

  .death-card {
    position: relative;
    width: min(560px, 94vw);
    padding: 28px; /* miolo */
    background:
      linear-gradient(180deg, rgba(25,28,45,.96), rgba(10,12,22,.96)),
      var(--retro-panel);
    box-shadow: var(--crt-shadow);
    text-align: center;
  }

  /* moldura pixelada (8-bit) com pseudo-elementos */
  .death-card::before,
  .death-card::after {
    content: "";
    position: absolute; inset: 0;
    pointer-events: none;
  }

  /* borda externa “denteada” (pixel frame) */
  .death-card::before {
    background:
      linear-gradient(to right, #0000 var(--pixel), rgba(255,255,255,.08) var(--pixel)) top left / calc(100% - var(--pixel)) var(--pixel) no-repeat,
      linear-gradient(to right, #0000 var(--pixel), rgba(255,255,255,.08) var(--pixel)) bottom left / calc(100% - var(--pixel)) var(--pixel) no-repeat,
      linear-gradient(to bottom, #0000 var(--pixel), rgba(255,255,255,.08) var(--pixel)) top left / var(--pixel) calc(100% - var(--pixel)) no-repeat,
      linear-gradient(to bottom, #0000 var(--pixel), rgba(255,255,255,.08) var(--pixel)) top right / var(--pixel) calc(100% - var(--pixel)) no-repeat;
    outline: var(--pixel) solid rgba(255,255,255,.08);
  }

  /* cantos em blocos (quase “pixels” grandes) */
  .death-card::after {
    box-shadow:
      /* top-left blocos */
      calc(var(--pixel) * 1) calc(var(--pixel) * 1) 0 0 rgba(255,255,255,.12) inset,
      calc(var(--pixel) * -1) calc(var(--pixel) * -1) 0 0 rgba(0,0,0,.35) inset;
    border: calc(var(--pixel) * 0) solid transparent;
  }

  /* tarja de título */
  .death-title {
    display: inline-block;
    padding: 10px 12px;
    font-size: 18px;
    color: #fff;
    background:
      linear-gradient(180deg, #b10000, #5d0000);
    border: var(--pixel) solid #260000;
    box-shadow:
      0 var(--pixel) 0 #000 inset,
      0 0 0 var(--pixel) #2b0a0a,
      0 10px 0 rgba(0,0,0,.25);
    text-shadow: 0 2px 0 #000;
  }

  .death-sub {
    margin: 14px 0 10px;
    font-size: 10px;
    color: var(--retro-muted);
    line-height: 1.6;
  }

  .death-art {
    margin: 12px auto 10px;
    width: 120px; height: 120px;
    display: grid; place-items: center;
    background:
      radial-gradient(circle at 50% 40%, rgba(255,90,90,.20), rgba(0,0,0,0) 55%),
      radial-gradient(circle at 50% 60%, rgba(255,122,24,.15), rgba(0,0,0,0) 70%);
    filter: drop-shadow(0 10px 20px rgba(255,0,0,.15));
  }
  .death-art svg { width: 82px; height: 82px; }

  .death-msg {
    margin: 6px 0 18px;
    font-size: 11px;
    color: #ffd37a;
    text-shadow: 0 2px 0 #000;
  }

  .death-actions {
    display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;
  }

  .btn-pixel {
    position: relative;
    display: inline-block;
    padding: 12px 18px;
    font-size: 12px;
    cursor: pointer;
    color: #1a0a00;
    background:
      linear-gradient(180deg, var(--retro-accent), var(--retro-accent-2));
    border: var(--pixel) solid #4a1d00;
    text-shadow: 0 1px 0 rgba(255,255,255,.25);
    box-shadow:
      0 var(--pixel) 0 #000 inset,
      0 0 0 var(--pixel) #2b0a0a,
      0 12px 0 rgba(0,0,0,.35);
    transition: transform .06s ease, filter .15s ease;
    image-rendering: pixelated;
  }

  .btn-pixel::after {
    content: "";
    position: absolute; left: 0; right: 0; top: 0; height: 38%;
    background: linear-gradient(180deg, rgba(255,255,255,.35), rgba(255,255,255,0));
    pointer-events: none;
  }

  .btn-pixel:active { transform: translateY(2px); box-shadow:
      0 var(--pixel) 0 #000 inset,
      0 0 0 var(--pixel) #2b0a0a,
      0 6px 0 rgba(0,0,0,.35);
  }

  .death-note {
    margin-top: 12px;
    font-size: 9px;
    color: var(--retro-muted);
  }

  /* bloqueio de input fora da carta */
  .death-overlay.blocking { pointer-events: auto; }
  .death-overlay.blocking * { pointer-events: auto; }
  `;

  // ===== DOM =====
  function ensureDom() {
    ensurePressStartFont();
    if (document.getElementById('death-overlay')) return;

    // CSS
    const style = document.createElement('style');
    style.id = 'death-overlay-style';
    style.textContent = CSS;
    document.head.appendChild(style);

    // Overlay
    const root = document.createElement('div');
    root.id = 'death-overlay';
    root.className = 'death-overlay blocking';

    // SVG caveira minimalista (sem assets externos)
    const skullSvg = `
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <linearGradient id="g" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stop-color="#ffe3e3"/>
            <stop offset="1" stop-color="#e3bcbc"/>
          </linearGradient>
        </defs>
        <path d="M32 6c12 0 22 8 22 20 0 8-4 12-7 14v6h-6v6h-6v-6h-6v6h-6v-6h-6v-6c-3-2-7-6-7-14 0-12 10-20 22-20z" fill="url(#g)" stroke="#3b2a2a" stroke-width="2"/>
        <rect x="20" y="26" width="8" height="8" fill="#2b1a1a"/>
        <rect x="36" y="26" width="8" height="8" fill="#2b1a1a"/>
        <rect x="28" y="40" width="8" height="4" fill="#2b1a1a"/>
      </svg>
    `;

    root.innerHTML = `
      <div class="death-card">
        <div class="death-title" data-role="title"></div>

        <div class="death-art" aria-hidden="true">${skullSvg}</div>

        <div class="death-sub" data-role="subtitle"></div>
        <div class="death-msg" data-role="message">—</div>

        <div class="death-actions">
          <button class="btn-pixel" id="death-revive" data-role="revive-btn"></button>
        </div>

        <div class="death-note" data-role="note"></div>
      </div>
    `;
    document.body.appendChild(root);

    // ação — botão
    root.querySelector('#death-revive').addEventListener('click', onClickRevive);

    // bloqueio geral de input (fora da card)
    const allowKeys = new Set(['F5', 'F12', 'Escape']);
    const blockMouse = (e) => {
      if (!state.dead) return;
      const card = root.querySelector('.death-card');
      if (card && card.contains(e.target)) return; // permite clicar dentro
      e.stopPropagation(); e.preventDefault();
    };
    root.addEventListener('click', blockMouse, true);
    document.addEventListener('mousedown', blockMouse, true);
    document.addEventListener('touchstart', (e) => {
      if (!state.dead) return;
      const card = root.querySelector('.death-card');
      if (card && card.contains(e.target)) return;
      e.stopPropagation(); e.preventDefault();
    }, { capture: true, passive: false });

    document.addEventListener('keydown', (e) => {
      if (!state.dead) return;
      // Enter = Revive
      if (e.key === 'Enter') {
        const btn = document.getElementById('death-revive');
        if (btn) btn.click();
      }
      if (allowKeys.has(e.key)) return;
      e.stopPropagation(); e.preventDefault();
    }, true);
  }

  function applyTexts() {
    const root = document.getElementById('death-overlay');
    if (!root) return;

    const S = (sel) => root.querySelector(sel);
    const setTxt = (sel, key, fb) => { const el = S(sel); if (el) el.textContent = t(key, fb); };

    setTxt('[data-role="title"]', 'hud.death.title', 'YOU ARE DEAD');
    setTxt('[data-role="subtitle"]', 'hud.death.subtitle', 'Your hero was defeated.');
    setTxt('[data-role="message"]', 'hud.death.revivePrompt', 'Press ENTER or click REVIVE to return.');
    setTxt('[data-role="revive-btn"]', 'hud.death.reviveButton', 'REVIVE');
    setTxt('[data-role="note"]', 'hud.death.note', 'Inputs are blocked while you are dead.');
  }

  function showOverlay() {
    ensureDom();
    applyTexts();
    const el = document.getElementById('death-overlay');
    el.style.display = 'flex';
    state.dead = true;
    window.__HERO_DEAD = true;
    window.dispatchEvent(new CustomEvent('hero:dead', { detail: { heroId: state.heroId } }));
    try { window.CombatActions?.stopAttack?.(); } catch {}
  }

  function hideOverlay() {
    const el = document.getElementById('death-overlay');
    if (el) el.style.display = 'none';
    state.dead = false;
    window.__HERO_DEAD = false;
    window.dispatchEvent(new CustomEvent('hero:revived', { detail: { heroId: state.heroId } }));
  }

  async function onClickRevive() {
    if (!state.heroId) return;
    try {
      await getCsrf().catch(()=>{});
      const r = await apiPost('/api/combat/revive', { heroId: state.heroId });
      if (r?.ok) {
        // servidor emitirá pos_snap_hero + hero_respawn; fechamos já pra responsividade
        hideOverlay();
      } else {
        alert(r?.error || 'Revive failed');
      }
    } catch (e) {
      console.warn('[revive] error:', e?.message || e);
      alert('Revive failed');
    }
  }

  // ===== WS bindings =====
  onMessage('hero_dead', (msg) => {
    state.heroId = String(msg.heroId);
    showOverlay();
  });

  onMessage('hero_respawn', (msg) => {
    if (!state.heroId || String(msg.heroId) === String(state.heroId)) hideOverlay();
  });

  onMessage('pos_snap_hero', (msg) => {
    if (!state.heroId || String(msg.heroId) === String(state.heroId)) hideOverlay();
  });

  document.addEventListener('i18n:ready', applyTexts);
  document.addEventListener('i18n:change', applyTexts);

  // ===== API global para debug/UI =====
  window.DeathHUD = {
    isDead: () => !!state.dead,
    showOverlay, hideOverlay
  };
})();
