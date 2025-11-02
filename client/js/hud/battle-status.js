// client/js/hud/battle-status.js
import { onMessage } from '../ws/singleton.js';

(function () {
  const state = {
    heroId: null,
    inBattle: false,
    since: null,
    lastEventAt: null,
  };
  window.__IN_BATTLE = false;

  const CSS = `
  .battle-indicator {
    position: fixed;
    top: 86px;
    right: 22px;
    z-index: 9998;
    display: none;
    pointer-events: none;
  }
  .battle-indicator.active {
    display: flex;
  }
  .battle-indicator-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    background: linear-gradient(135deg, rgba(120,24,24,0.92), rgba(60,10,10,0.94));
    border: 1px solid rgba(255,140,140,0.35);
    border-radius: 14px;
    box-shadow: 0 14px 34px rgba(0,0,0,0.45);
    color: #ffdede;
    font-family: "Inter", system-ui, sans-serif;
    pointer-events: auto;
  }
  .battle-indicator-icon {
    font-size: 22px;
    filter: drop-shadow(0 2px 2px rgba(0,0,0,0.35));
  }
  .battle-indicator-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .battle-indicator-title {
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .battle-indicator-sub {
    font-size: 11px;
    opacity: 0.9;
    max-width: 240px;
    line-height: 1.4;
  }
  @media (max-width: 720px) {
    .battle-indicator { top: 72px; right: 12px; }
    .battle-indicator-sub { max-width: 200px; }
  }
  `;

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

  function ensureDom() {
    if (document.getElementById('battle-indicator')) return;

    const styleId = 'battle-indicator-style';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    const root = document.createElement('div');
    root.id = 'battle-indicator';
    root.className = 'battle-indicator';
    root.innerHTML = `
      <div class="battle-indicator-card">
        <div class="battle-indicator-icon">⚔️</div>
        <div class="battle-indicator-text">
          <div class="battle-indicator-title" data-role="title"></div>
          <div class="battle-indicator-sub" data-role="subtitle"></div>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    applyTexts();
  }

  function applyTexts() {
    const root = document.getElementById('battle-indicator');
    if (!root) return;
    const title = root.querySelector('[data-role="title"]');
    const subtitle = root.querySelector('[data-role="subtitle"]');
    if (title) {
      title.textContent = translate('hud.battle.title', 'Battle Mode');
    }
    if (subtitle) {
      subtitle.textContent = translate('hud.battle.description', 'You are in combat. Logging out now will leave your hero behind.');
    }
  }

  function setBodyFlag(active) {
    try {
      document.body.classList.toggle('hero-in-battle', !!active);
    } catch {}
  }

  function updateDom() {
    ensureDom();
    const root = document.getElementById('battle-indicator');
    if (!root) return;
    root.classList.toggle('active', !!state.inBattle);
    if (state.inBattle) {
      applyTexts();
    }
    window.__IN_BATTLE = !!state.inBattle;
    setBodyFlag(state.inBattle);
  }

  function setBattle(active, payload = {}) {
    const next = !!active;
    const changed = state.inBattle !== next;
    state.inBattle = next;
    state.heroId = payload.heroId != null ? String(payload.heroId) : (state.heroId || null);
    state.since = payload.since || null;
    state.lastEventAt = payload.lastEventAt || Date.now();
    updateDom();

    if (changed) {
      const eventName = next ? 'hero:battle-enter' : 'hero:battle-leave';
      try {
        window.dispatchEvent(new CustomEvent(eventName, {
          detail: {
            heroId: state.heroId,
            since: state.since,
            lastEventAt: state.lastEventAt,
          }
        }));
      } catch {}
    }
  }

  function beforeUnload(ev) {
    if (!state.inBattle) return;
    const message = translate('hud.battle.leaveWarning', 'You are in battle! Leaving now may kill your hero.');
    ev.preventDefault();
    ev.returnValue = message;
    return message;
  }

  onMessage('hero_battle', (msg) => {
    if (!msg) return;
    const heroId = msg.heroId != null ? String(msg.heroId) : state.heroId;
    const inBattle = msg.inBattle === true;
    const payload = {
      heroId,
      since: msg.since || null,
      lastEventAt: msg.lastEventAt || Date.now(),
    };
    setBattle(inBattle, payload);
  });

  window.addEventListener('beforeunload', beforeUnload);
  document.addEventListener('i18n:ready', applyTexts);
  document.addEventListener('i18n:change', applyTexts);

  window.HeroBattle = {
    isInBattle: () => !!state.inBattle,
    getHeroId: () => state.heroId,
  };
})();
