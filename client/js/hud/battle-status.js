// client/js/hud/battle-status.js
import { onMessage } from '../ws/singleton.js';

(function () {
  const state = {
    heroId: null,
    inBattle: false,
    since: null,
    lastEventAt: null,
  };
  const exitState = {
    locked: true,
    unlockTimer: null,
  };
  let warningHideTimer = null;
  let currentWarningMode = 'safe';
  window.__IN_BATTLE = false;

  const CSS = `
  .battle-indicator {
    position: fixed;
    top: 82px;
    right: 22px;
    z-index: 9998;
    display: none;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    align-items: center;
    justify-content: center;
    background: radial-gradient(circle at 30% 30%, rgba(255,170,170,0.9), rgba(110,0,0,0.85));
    box-shadow: 0 14px 34px rgba(0,0,0,0.45);
    color: #ffe6e6;
    pointer-events: auto;
    cursor: default;
    user-select: none;
    transition: transform 0.18s ease, opacity 0.18s ease;
  }
  .battle-indicator::after {
    content: '';
    position: absolute;
    inset: -6px;
    border-radius: 50%;
    border: 2px solid rgba(255, 90, 90, 0.45);
    opacity: 0;
    transform: scale(0.85);
  }
  .battle-indicator.active {
    display: flex;
    animation: battle-indicator-pulse 1.2s ease-in-out infinite;
  }
  .battle-indicator.active::after {
    opacity: 1;
    animation: battle-indicator-ring 1.8s ease-in-out infinite;
  }
  .battle-indicator-icon {
    font-size: 26px;
    filter: drop-shadow(0 2px 3px rgba(0,0,0,0.45));
  }
  .battle-indicator[aria-hidden="true"] {
    opacity: 0;
    pointer-events: none;
    transform: scale(0.85);
  }
  @media (max-width: 720px) {
    .battle-indicator {
      top: 70px;
      right: 14px;
      width: 44px;
      height: 44px;
    }
    .battle-indicator-icon { font-size: 24px; }
  }

  .battle-exit-warning {
    position: fixed;
    inset: 0;
    display: none;
    align-items: flex-start;
    justify-content: center;
    pointer-events: none;
    z-index: 9999;
    font-family: "Inter", system-ui, sans-serif;
  }
  .battle-exit-warning.visible {
    display: flex;
  }
  .battle-exit-warning-card {
    margin-top: calc(80px + 6vh);
    background: rgba(20, 6, 6, 0.92);
    border: 1px solid rgba(255, 120, 120, 0.35);
    border-radius: 18px;
    padding: 18px 22px;
    display: flex;
    gap: 14px;
    align-items: center;
    color: #ffe6e6;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.55);
    pointer-events: auto;
  }
  .battle-exit-warning-icon {
    font-size: 32px;
    filter: drop-shadow(0 2px 3px rgba(0,0,0,0.55));
  }
  .battle-exit-warning-text {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-width: 320px;
  }
  .battle-exit-warning-title {
    font-size: 16px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .battle-exit-warning-body {
    font-size: 13px;
    line-height: 1.45;
    opacity: 0.92;
  }
  @media (max-width: 720px) {
    .battle-exit-warning-card {
      margin-top: calc(70px + 5vh);
      max-width: 90vw;
    }
  }

  @keyframes battle-indicator-pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.08); }
  }
  @keyframes battle-indicator-ring {
    0% {
      opacity: 0.7;
      transform: scale(0.92);
    }
    70% {
      opacity: 0;
      transform: scale(1.35);
    }
    100% {
      opacity: 0;
      transform: scale(1.5);
    }
  }
  `;

  const WARNING_MODES = {
    battle: {
      icon: '⚔️',
      tooltipKey: 'hud.battle.tooltip',
      tooltipFallback: 'Battle mode — stay online until you reach safety.',
      titleKey: 'hud.battle.exitTitle',
      titleFallback: 'Battle mode active',
      bodyKey: 'hud.battle.exitBody',
      bodyFallback: 'Cancel and stay online — closing the game now leaves your hero exposed to the monsters.',
      promptKey: 'hud.battle.leaveWarning',
      promptFallback: 'Battle mode active! Leaving now will keep your hero online and vulnerable.',
    },
    safe: {
      icon: '🚪',
      tooltipKey: 'hud.battle.safeTooltip',
      tooltipFallback: 'Use the Logout button before closing the tab.',
      titleKey: 'hud.battle.safeExitTitle',
      titleFallback: 'Logout before closing',
      bodyKey: 'hud.battle.safeExitBody',
      bodyFallback: 'Use the Logout button before closing this tab so your hero disconnects safely.',
      promptKey: 'hud.battle.safeExitPrompt',
      promptFallback: 'Logout before closing the tab to protect your hero.',
    },
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

  function ensureDom() {
    const styleId = 'battle-indicator-style';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    if (!document.getElementById('battle-indicator')) {
      const root = document.createElement('div');
      root.id = 'battle-indicator';
      root.className = 'battle-indicator';
      root.setAttribute('aria-hidden', 'true');
      root.innerHTML = `
        <span class="battle-indicator-icon" aria-hidden="true">⚔️</span>
      `;
      root.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (!state.inBattle) return;
        showExitWarning();
      });
      document.body.appendChild(root);
    }

    if (!document.getElementById('battle-exit-warning')) {
      const warn = document.createElement('div');
      warn.id = 'battle-exit-warning';
      warn.className = 'battle-exit-warning';
      warn.setAttribute('aria-hidden', 'true');
      warn.innerHTML = `
        <div class="battle-exit-warning-card" role="alert">
          <div class="battle-exit-warning-icon" aria-hidden="true">⚔️</div>
          <div class="battle-exit-warning-text">
            <div class="battle-exit-warning-title" data-role="warning-title"></div>
            <div class="battle-exit-warning-body" data-role="warning-body"></div>
          </div>
        </div>
      `;
      document.body.appendChild(warn);
    }

    applyTexts(currentWarningMode);
  }

  function getWarningConfig(mode) {
    if (mode && WARNING_MODES[mode]) return WARNING_MODES[mode];
    return WARNING_MODES.battle;
  }

  function normalizeMode(mode) {
    if (typeof mode === 'string' && WARNING_MODES[mode]) return mode;
    if (typeof mode === 'string') return currentWarningMode;
    return currentWarningMode;
  }

  function applyTexts(mode = currentWarningMode) {
    const useMode = normalizeMode(mode);
    currentWarningMode = useMode;
    const config = getWarningConfig(useMode);

    const root = document.getElementById('battle-indicator');
    if (root) {
      const tooltip = translate(config.tooltipKey || 'hud.battle.tooltip', config.tooltipFallback || 'In battle — do not logout.');
      root.setAttribute('title', tooltip);
      root.setAttribute('aria-label', tooltip);
    }

    const warn = document.getElementById('battle-exit-warning');
    if (warn) {
      const titleEl = warn.querySelector('[data-role="warning-title"]');
      const bodyEl = warn.querySelector('[data-role="warning-body"]');
      const iconEl = warn.querySelector('.battle-exit-warning-icon');
      if (iconEl) {
        iconEl.textContent = config.icon || '⚔️';
      }
      if (titleEl) {
        titleEl.textContent = translate(config.titleKey || 'hud.battle.exitTitle', config.titleFallback || 'Battle mode active');
      }
      if (bodyEl) {
        bodyEl.textContent = translate(config.bodyKey || 'hud.battle.exitBody', config.bodyFallback || 'Cancel and stay online or your hero will remain vulnerable.');
      }
    }
  }

  function setBodyFlag(active) {
    try {
      document.body.classList.toggle('hero-in-battle', !!active);
    } catch {}
  }

  function hideExitWarning() {
    const warn = document.getElementById('battle-exit-warning');
    if (!warn) return;
    warn.classList.remove('visible');
    warn.setAttribute('aria-hidden', 'true');
    if (warningHideTimer) {
      window.clearTimeout(warningHideTimer);
      warningHideTimer = null;
    }
  }

  function showExitWarning(mode = (state.inBattle ? 'battle' : 'safe')) {
    ensureDom();
    applyTexts(mode);
    const warn = document.getElementById('battle-exit-warning');
    if (!warn) return;
    warn.classList.add('visible');
    warn.setAttribute('aria-hidden', 'false');
    if (warningHideTimer) {
      window.clearTimeout(warningHideTimer);
    }
    warningHideTimer = window.setTimeout(() => {
      hideExitWarning();
    }, 5200);
  }

  function updateDom() {
    ensureDom();
    const root = document.getElementById('battle-indicator');
    if (!root) return;
    const isActive = !!state.inBattle;
    root.classList.toggle('active', isActive);
    root.setAttribute('aria-hidden', isActive ? 'false' : 'true');
    applyTexts(isActive ? 'battle' : 'safe');
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

    if (!next) {
      hideExitWarning();
    }
  }

  function setExitLock(nextLocked) {
    const shouldLock = !!nextLocked;
    if (exitState.unlockTimer) {
      window.clearTimeout(exitState.unlockTimer);
      exitState.unlockTimer = null;
    }
    exitState.locked = shouldLock;
  }

  function allowExitFor(durationMs = 1500) {
    setExitLock(false);
    if (durationMs > 0) {
      exitState.unlockTimer = window.setTimeout(() => {
        setExitLock(true);
      }, durationMs);
    }
  }

  function beforeUnload(ev) {
    if (!exitState.locked) return;
    const mode = state.inBattle ? 'battle' : 'safe';
    const config = getWarningConfig(mode);
    const message = translate(config.promptKey || 'hud.battle.leaveWarning', config.promptFallback || 'You are in battle! Leaving now may kill your hero.');
    showExitWarning(mode);
    ev.preventDefault();
    ev.returnValue = message;
    return message;
  }

  function onKeydown(ev) {
    if (!exitState.locked) return;
    const key = ev.key || '';
    const isCloseCombo = ((ev.metaKey || ev.ctrlKey) && (key === 'w' || key === 'W'));
    if (isCloseCombo) {
      ev.preventDefault();
      ev.stopPropagation();
      showExitWarning(state.inBattle ? 'battle' : 'safe');
    }
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
  window.addEventListener('keydown', onKeydown, true);
  document.addEventListener('i18n:ready', applyTexts);
  document.addEventListener('i18n:change', applyTexts);

  window.HeroBattle = {
    isInBattle: () => !!state.inBattle,
    getHeroId: () => state.heroId,
    showExitWarning: (mode) => showExitWarning(mode),
    lockExit: () => setExitLock(true),
    unlockExit: () => setExitLock(false),
    allowExitFor: (ms) => allowExitFor(ms),
  };
})();
