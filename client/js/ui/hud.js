const numberFormatter = new Intl.NumberFormat('pt-BR');

const defaultState = {
  name: 'Jogador',
  ping: 0,
  session: 0,
  gold: 0,
  diamonds: 0,
  level: 1,
  hp: { current: 0, max: 0 },
  mp: { current: 0, max: 0 },
  xp: { current: 0, max: 0 },
  stamina: { current: 0, max: 0 },
};

function cloneState(source) {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(source); } catch (_) {}
  }
  return JSON.parse(JSON.stringify(source));
}

const elements = {
  name: null,
  ping: null,
  session: null,
  gold: null,
  diamonds: null,
  minimap: null,
  bars: {
    hp: { fill: null, text: null },
    mp: { fill: null, text: null },
    xp: { fill: null, text: null },
    stamina: { fill: null, text: null },
  },
};

let hudState = window.hudState ? Object.assign(cloneState(defaultState), window.hudState) : cloneState(defaultState);
let initialized = false;

function clampPercent(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function safeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function setPlayerName(name) {
  if (typeof name !== 'string' || !name.trim()) return;
  hudState.name = name.trim();
  if (elements.name) {
    elements.name.textContent = hudState.name;
  }
}

function setPing(ms) {
  hudState.ping = Math.max(0, Math.round(ms || 0));
  if (elements.ping) {
    elements.ping.textContent = `${hudState.ping}`;
  }
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const base = [minutes.toString().padStart(2, '0'), seconds.toString().padStart(2, '0')];
  if (hours > 0) base.unshift(hours.toString().padStart(2, '0'));
  return base.join(':');
}

function setSessionTime(ms) {
  hudState.session = Math.max(0, Number(ms) || 0);
  if (elements.session) {
    elements.session.textContent = formatDuration(hudState.session);
  }
}

function setCurrency(kind, value) {
  const amount = Math.max(0, safeNumber(value));
  hudState[kind] = amount;
  const el = elements[kind];
  if (el) el.textContent = numberFormatter.format(amount);
}

function applyBar(kind) {
  const bar = hudState[kind];
  const refs = elements.bars[kind];
  if (!bar || !refs) return;
  const current = safeNumber(bar.current);
  const max = Math.max(0, safeNumber(bar.max));
  const percent = max > 0 ? clampPercent((current / max) * 100) : 0;
  if (refs.fill) refs.fill.style.width = `${percent}%`;
  if (refs.text) {
    const baseText = `${numberFormatter.format(current)}/${numberFormatter.format(max)}`;
    if (kind === 'xp') {
      const lvlRaw = Number(hudState.level);
      const level = Number.isFinite(lvlRaw) ? Math.max(0, Math.floor(lvlRaw)) : null;
      refs.text.textContent = level != null ? `Lv ${level} ${baseText}` : baseText;
    } else {
      refs.text.textContent = baseText;
    }
  }
}

function mergeStat(kind, payload, next) {
  const target = hudState[kind] || { current: 0, max: 0 };
  hudState[kind] = target;
  if (payload && typeof payload === 'object') {
    if (payload.current != null) target.current = safeNumber(payload.current);
    if (payload.max != null) target.max = safeNumber(payload.max);
  }
  const prefix = kind === 'stamina' ? 'stamina' : kind;
  if (next && next[`${prefix}`] != null && typeof next[`${prefix}`] !== 'object') {
    target.current = safeNumber(next[`${prefix}`]);
  }
  if (next && next[`${prefix}Current`] != null) {
    target.current = safeNumber(next[`${prefix}Current`]);
  }
  if (next && next[`${prefix}Max`] != null) {
    target.max = safeNumber(next[`${prefix}Max`]);
  }
}

function renderHud() {
  setPlayerName(hudState.name);
  setPing(hudState.ping);
  setSessionTime(hudState.session);
  setCurrency('gold', hudState.gold);
  setCurrency('diamonds', hudState.diamonds);
  applyBar('hp');
  applyBar('mp');
  applyBar('xp');
  applyBar('stamina');
}

function drawMinimapPlaceholder() {
  if (!elements.minimap) return;
  const ctx = elements.minimap.getContext('2d');
  if (!ctx) return;
  const { width, height } = elements.minimap;
  ctx.fillStyle = '#050608';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#2d333f';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, width - 2, height - 2);
  ctx.fillStyle = '#3e8be6';
  ctx.font = '10px "Press Start 2P", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('WIP', width / 2, height / 2);
}

function cacheElements() {
  elements.name = document.getElementById('playerName');
  elements.ping = document.getElementById('pingValue');
  elements.session = document.getElementById('sessionTime');
  elements.gold = document.getElementById('goldValue');
  elements.diamonds = document.getElementById('diamondValue');
  elements.minimap = document.getElementById('hud-minimap');
  elements.bars.hp.fill = document.getElementById('bar-hp-fill');
  elements.bars.hp.text = document.getElementById('bar-hp-text');
  elements.bars.mp.fill = document.getElementById('bar-mp-fill');
  elements.bars.mp.text = document.getElementById('bar-mp-text');
  elements.bars.xp.fill = document.getElementById('bar-xp-fill');
  elements.bars.xp.text = document.getElementById('bar-xp-text');
  elements.bars.stamina.fill = document.getElementById('bar-stamina-fill');
  elements.bars.stamina.text = document.getElementById('bar-stamina-text');
}

function initHudShell() {
  if (initialized) return;
  cacheElements();
  drawMinimapPlaceholder();
  renderHud();
  initialized = true;
}

function updateHud(next = {}) {
  if (!next || typeof next !== 'object') return hudState;
  if (next.name != null) setPlayerName(next.name);
  if (next.ping != null) setPing(next.ping);
  if (next.session != null) setSessionTime(next.session);
  if (next.gold != null || next.coins != null) {
    setCurrency('gold', next.gold ?? next.coins);
  }
  if (next.diamonds != null || next.gems != null) {
    setCurrency('diamonds', next.diamonds ?? next.gems);
  }
  if (next.level != null) {
    const level = Number(next.level);
    if (Number.isFinite(level) && level > 0) {
      hudState.level = level;
    }
  } else if (next.heroLevel != null) {
    const heroLevel = Number(next.heroLevel);
    if (Number.isFinite(heroLevel) && heroLevel > 0) {
      hudState.level = heroLevel;
    }
  }
  mergeStat('hp', next.hp, next);
  mergeStat('mp', next.mp, next);
  mergeStat('xp', next.xp, next);
  mergeStat('stamina', next.stamina, next);
  renderHud();
  return hudState;
}

window.hudState = hudState;
window.updateHud = updateHud;

function applyHeroHpUpdate(heroId, hp, maxHp) {
  if (hp != null) {
    hudState.hp.current = safeNumber(hp);
  }
  if (maxHp != null) {
    hudState.hp.max = safeNumber(maxHp);
  }
  applyBar('hp');
  return hudState.hp;
}

window.HUD = {
  init: initHudShell,
  render: renderHud,
  setPlayerName,
  setPing,
  setSessionTime,
  setLevel(level) {
    if (!Number.isFinite(Number(level))) return;
    hudState.level = Number(level);
    applyBar('xp');
  },
  setCurrency,
  applyBar,
  state: hudState,
};

window.HUD_ApplyHeroHpUpdate = applyHeroHpUpdate;

document.addEventListener('DOMContentLoaded', () => {
  initHudShell();
});

export { initHudShell, updateHud, setPlayerName, setPing, setSessionTime };
