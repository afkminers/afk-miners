// client/js/hud/death-overlay.js
import { onMessage } from '../ws/singleton.js';
import { apiPost, getCsrf } from '../api.js';

(function () {
  // Estado global simples
  const state = {
    dead: false,
    heroId: null,
  };

  function translate(key, fallback) {
    try {
      const inst = window.i18n;
      if (inst && typeof inst.t === 'function') {
        const value = inst.t(key);
        if (value != null && value !== key) return value;
      }
    } catch {}
    return fallback;
  }

  // CSS injetado (sem depender de outro arquivo)
  const CSS = `
  .death-overlay {
    position: fixed; inset: 0; z-index: 9999;
    display: none; align-items: center; justify-content: center;
    background: rgba(5,5,10,0.88); color: #fff; font-family: Inter, system-ui, Arial, sans-serif;
    backdrop-filter: blur(2px);
  }
  .death-card {
    width: min(520px, 92vw); padding: 24px 22px; border-radius: 16px;
    background: linear-gradient(180deg, rgba(20,20,30,0.85), rgba(10,10,15,0.85));
    border: 1px solid rgba(255,255,255,0.08);
    box-shadow: 0 20px 70px rgba(0,0,0,0.45);
    text-align: center;
  }
  .death-title {
    font-size: 28px; letter-spacing: 1px; font-weight: 800; margin: 2px 0 10px;
    color: #ff5a5a; text-shadow: 0 1px 0 #000;
  }
  .death-sub { font-size: 14px; opacity: .85; margin-bottom: 16px; }
  .death-count {
    font-size: 40px; font-weight: 800; letter-spacing: 2px; margin: 12px 0 18px;
    color: #ffd37a; text-shadow: 0 2px 0 #000;
  }
  .death-actions { display: flex; gap: 10px; justify-content: center; }
  .death-btn {
    appearance: none; border: none; border-radius: 12px; padding: 12px 18px; cursor: pointer;
    font-weight: 700; transition: transform .06s ease, opacity .2s ease, box-shadow .2s ease;
  }
  .death-btn:active { transform: translateY(1px); }
  .death-btn-primary {
    background: #3ee07d; color: #0b2415;
    box-shadow: 0 8px 24px rgba(62,224,125,0.28);
  }
  .death-btn-secondary {
    background: #303344; color: #e6e9f2;
  }
  .death-note {
    font-size: 12px; opacity: .65; margin-top: 14px;
  }
  `;

  // Monta DOM uma vez
  function ensureDom() {
    if (document.getElementById('death-overlay')) return;

    // CSS
    const tag = document.createElement('style');
    tag.id = 'death-overlay-style';
    tag.textContent = CSS;
    document.head.appendChild(tag);

    // Overlay
    const root = document.createElement('div');
    root.id = 'death-overlay';
    root.className = 'death-overlay';
    root.innerHTML = `
      <div class="death-card">
        <div class="death-title" data-role="title"></div>
        <div class="death-sub" data-role="subtitle"></div>
        <div class="death-count" id="death-count" data-role="message">—</div>
        <div class="death-actions">
          <button class="death-btn death-btn-primary" id="death-revive" data-role="revive-btn"></button>
        </div>
        <div class="death-note" data-role="note"></div>
      </div>
    `;
    document.body.appendChild(root);

    // Botões
    root.querySelector('#death-revive').addEventListener('click', onClickRevive);

    // Bloqueio de input enquanto ativo (sem atrapalhar F5/DevTools)
    const allowKeys = new Set(['F5', 'F12', 'Escape']);
    const blockInput = (e) => {
      if (!state.dead) return;
      // Deixa clicar nos botões da própria overlay
      const root = document.getElementById('death-overlay');
      if (root && root.contains(e.target)) return;
      // Bloqueia
      e.stopPropagation();
      e.preventDefault();
    };
    // Mouse/Touch
    root.addEventListener('click', blockInput, true);
    document.addEventListener('mousedown', blockInput, true);
    document.addEventListener('touchstart', blockInput, { capture: true, passive: false });
    // Teclado
    document.addEventListener('keydown', (e) => {
      if (!state.dead) return;
      if (allowKeys.has(e.key)) return;
      e.stopPropagation();
      e.preventDefault();
    }, true);
  }

  function applyTexts() {
    const root = document.getElementById('death-overlay');
    if (!root) return;
    const setText = (selector, key, fallback) => {
      const el = root.querySelector(selector);
      if (!el) return;
      const value = translate(key, fallback);
      if (el.tagName === 'BUTTON') {
        el.textContent = value;
      } else {
        el.textContent = value;
      }
    };

    setText('[data-role="title"]', 'hud.death.title', 'YOU ARE DEAD');
    setText('[data-role="subtitle"]', 'hud.death.subtitle', 'Your hero was defeated. Click Revive to return to the temple.');
    setText('[data-role="revive-btn"]', 'hud.death.reviveButton', 'Revive');
    setText('[data-role="note"]', 'hud.death.note', 'Movement and interactions remain blocked while you are dead.');
    const message = translate('hud.death.revivePrompt', 'Click “Revive” to return to the start point.');
    const msgEl = root.querySelector('[data-role="message"]');
    if (msgEl) msgEl.textContent = message;
  }

  function showOverlay() {
    ensureDom();
    applyTexts();
    const el = document.getElementById('death-overlay');
    el.style.display = 'flex';
    document.body.style.pointerEvents = 'auto';
    state.dead = true;
    window.__HERO_DEAD = true;
    window.dispatchEvent(new CustomEvent('hero:dead', { detail: { heroId: state.heroId } }));
    // Para ataques automáticos, se estiverem rodando
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
        // O servidor já vai emitir pos_snap_hero + hero_respawn,
        // mas escondemos na hora pra sensação de responsividade.
        hideOverlay();
      } else {
        alert(r?.error || 'Revive falhou');
      }
    } catch (e) {
      console.warn('[revive] erro:', e?.message || e);
      alert('Revive falhou');
    }
  }

  // ==== WS bindings ====
  onMessage('hero_dead', (msg) => {
    state.heroId = String(msg.heroId);
    showOverlay();
  });

  onMessage('hero_respawn', (msg) => {
    // Segurança: só fecha se for o mesmo herói
    if (!state.heroId || String(msg.heroId) === String(state.heroId)) {
      hideOverlay();
    }
  });

  // Garantia: se o servidor mandar um snap de posição após revive automático, também fechamos
  onMessage('pos_snap_hero', (msg) => {
    if (!state.heroId || String(msg.heroId) === String(state.heroId)) {
      hideOverlay();
    }
  });

  document.addEventListener('i18n:ready', applyTexts);
  document.addEventListener('i18n:change', applyTexts);

  // Expor helper
  window.DeathHUD = {
    isDead: () => !!state.dead,
    showOverlay, hideOverlay
  };
})();
