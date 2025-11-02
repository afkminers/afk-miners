import { getSocket, onMessage, wsSend, authenticate } from '../ws/singleton.js';
import { initDmChat, openConversation, isDmScope, activateDmScope, handleDmSubmit } from './dm-chat.js';

const CHANNELS = [
  { id: 'local', label: 'Local', scope: 'local' },
  { id: 'global', label: 'Global', scope: 'global' },
  { id: 'comercio', label: 'Comércio', scope: 'comercio' },
  { id: 'guild', label: 'Guild', scope: 'guild' },
  { id: 'ajuda', label: 'Ajuda', scope: 'ajuda' },
];

const LOG_SCOPE = 'log';
const STORAGE_KEY = 'chatActiveScope';
const MAX_BUFFER = 200;

const chatState = {
  root: null,
  tabs: null,
  panels: null,
  input: null,
  form: null,
  tabButtons: new Map(),
  logElements: new Map(),
  buffers: new Map(),
  activeScope: 'local',
  seenMessageIds: new Set(),
  dm: null,
  dmTabsAnchor: null,
  dmPanelsAnchor: null,
};

CHANNELS.forEach(({ scope }) => {
  chatState.buffers.set(scope, []);
});
chatState.buffers.set(LOG_SCOPE, []);

function formatTime(ts) {
  const date = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(date.getTime())) return '00:00';
  const hh = date.getHours().toString().padStart(2, '0');
  const mm = date.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

function getLabel(scope) {
  if (isDmScope(scope)) return 'DM';
  if (scope === LOG_SCOPE) return 'Log';
  const found = CHANNELS.find((c) => c.scope === scope || c.id === scope);
  return found ? found.label : scope;
}

function ensureBuffer(scope) {
  if (!chatState.buffers.has(scope)) {
    chatState.buffers.set(scope, []);
  }
  return chatState.buffers.get(scope);
}

function appendBuffer(scope, entry) {
  const buffer = ensureBuffer(scope);
  buffer.push(entry);
  while (buffer.length > MAX_BUFFER) buffer.shift();
  return buffer;
}

function renderScope(scope) {
  const panel = chatState.logElements.get(scope);
  const buffer = chatState.buffers.get(scope) || [];
  if (!panel) return;
  panel.innerHTML = '';
  for (const entry of buffer) {
    const row = document.createElement('div');
    row.className = 'chat-line';
    row.dataset.scope = scope;
    if (entry.system) row.dataset.system = 'true';
    const timestamp = formatTime(entry.timestamp);
    const label = getLabel(scope);
    const author = entry.author ? ` <strong>${entry.author}</strong>` : '';
    row.innerHTML = `[${timestamp}][${label}]${author} ${entry.message}`;
    panel.appendChild(row);
  }
  panel.scrollTop = panel.scrollHeight;
}

function setTabSelected(scope) {
  chatState.tabButtons.forEach((btn, key) => {
    const isActive = key === scope;
    btn.setAttribute('aria-selected', String(isActive));
    btn.dataset.active = isActive ? 'true' : 'false';
  });
}

function showPanel(scope) {
  chatState.logElements.forEach((panel, key) => {
    const shouldShow = key === scope;
    panel.parentElement?.classList.toggle('chat-panel--active', shouldShow);
    if (shouldShow) {
      panel.parentElement?.removeAttribute('hidden');
    } else {
      panel.parentElement?.setAttribute('hidden', 'true');
    }
  });
}

function setInputPlaceholder(scope) {
  if (!chatState.input) return;
  const label = getLabel(scope);
  chatState.input.placeholder = `[#${label}] Digite uma mensagem...`;
}

function storeActiveScope(scope) {
  try { localStorage.setItem(STORAGE_KEY, scope); } catch {}
}

function setScope(scope, { focusInput = true } = {}) {
  const raw = typeof scope === 'string' ? scope : 'local';
  let normalized = raw;
  if (isDmScope(raw)) {
    normalized = raw;
  } else if (raw === LOG_SCOPE) {
    normalized = LOG_SCOPE;
  } else {
    const channel = CHANNELS.find((c) => c.scope === raw || c.id === raw);
    normalized = channel ? channel.scope : 'local';
  }
  chatState.activeScope = normalized;
  if (isDmScope(normalized)) {
    activateDmScope(normalized);
  } else {
    setTabSelected(normalized);
    showPanel(normalized);
  }
  setInputPlaceholder(normalized);
  renderScope(normalized);
  storeActiveScope(normalized);
  if (focusInput && chatState.input) {
    chatState.input.focus();
  }
}

function getActiveScope() {
  return chatState.activeScope;
}

function pushEntry(scope, message, { author = null, system = false, id = null, timestamp = Date.now() } = {}) {
  const rawScope = typeof scope === 'string' ? scope.toLowerCase() : scope;
  const normalized = rawScope === LOG_SCOPE
    ? LOG_SCOPE
    : (CHANNELS.find((c) => c.id === rawScope || c.scope === rawScope)?.scope || 'local');
  if (id != null) {
    const key = String(id);
    if (chatState.seenMessageIds.has(key)) return;
    chatState.seenMessageIds.add(key);
  }
  const entry = {
    scope: normalized,
    message,
    author,
    system,
    timestamp,
  };
  appendBuffer(normalized, entry);
  if (chatState.activeScope === normalized) {
    renderScope(normalized);
  }
}

function pushMessage(channel, message, options = {}) {
  pushEntry(channel, message, options);
}

function pushLog(message, channel = LOG_SCOPE) {
  pushEntry(channel, message, { system: true });
}

function restoreStoredScope() {
  let stored = null;
  try { stored = localStorage.getItem(STORAGE_KEY); } catch {}
  if (stored && (stored === LOG_SCOPE || CHANNELS.some((c) => c.scope === stored || c.id === stored) || isDmScope(stored))) {
    return stored;
  }
  return 'local';
}

function markButtons() {
  if (!chatState.tabs) return;
  chatState.tabButtons.clear();
  chatState.tabs.querySelectorAll('.chat-tab[data-scope]').forEach((btn) => {
    const scope = btn.getAttribute('data-scope');
    if (!scope) return;
    chatState.tabButtons.set(scope, btn);
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      if (isDmScope(scope)) return;
      setScope(scope);
    });
  });
}

function cacheLogs() {
  chatState.logElements.clear();
  if (!chatState.panels) return;
  chatState.panels.querySelectorAll('.chat-log[data-log]').forEach((log) => {
    const scope = log.getAttribute('data-log');
    if (!scope) return;
    chatState.logElements.set(scope, log);
  });
}

async function hydrateIdentity() {
  getSocket();
  await authenticate(async () => {
    const resp = await fetch('/api/player/me', { credentials: 'include', cache: 'no-store' }).catch(() => null);
    if (!resp || !resp.ok) return null;
    const raw = await resp.json().catch(() => null);
    const profile = raw?.profile || raw || {};
    const id = profile?.id ?? profile?.playerId ?? null;
    const name = profile?.name ?? profile?.username ?? profile?.displayName ?? 'Você';
    if (id) {
      try { window._chat_me = { id: String(id), name }; } catch {}
      return { id, name };
    }
    return null;
  });
}

async function fetchHistoryIfNeeded() {
  if (chatState.seenMessageIds.size > 0) return;
  try {
    const resp = await fetch('/api/chat/global?limit=200', { credentials: 'include', cache: 'no-store' });
    if (!resp.ok) return;
    const data = await resp.json().catch(() => []);
    if (!Array.isArray(data)) return;
    data.forEach((item) => {
      const msg = String(item?.text || '').trim();
      if (!msg) return;
      const id = item?.id != null ? String(item.id) : null;
      const author = item?.fromName || item?.from || null;
      const ts = item?.createdAt || item?.created_at || Date.now();
      pushEntry('global', msg, { author, id, timestamp: ts });
    });
  } catch (err) {
    console.warn('[chat] history failed:', err?.message || err);
  }
}

function handleIncomingChat(payload) {
  if (!payload) return;
  const scope = String(payload.scope || 'global').toLowerCase();
  const text = String(payload.text || '').trim();
  if (!text) return;
  const author = payload.fromName || payload.from || null;
  const id = payload.id != null ? payload.id : payload.messageId ?? null;
  const ts = payload.createdAt || payload.created_at || payload.ts || Date.now();
  pushEntry(scope, text, { author, id, timestamp: ts });
}

function handleTickChat(list) {
  if (!Array.isArray(list)) return;
  list.forEach((msg) => {
    if (!msg) return;
    const scope = String(msg.scope || 'global').toLowerCase();
    const text = String(msg.text || '').trim();
    if (!text) return;
    const id = msg.id != null ? msg.id : null;
    const author = msg.fromName || msg.from || null;
    const ts = msg.createdAt || msg.created_at || msg.ts || Date.now();
    pushEntry(scope, text, { author, id, timestamp: ts });
  });
}

function bindTickListener() {
  window.addEventListener('tick:chat:append', (event) => {
    handleTickChat(event?.detail);
  });
}

function bindWsListener() {
  onMessage('chat', handleIncomingChat);
}

function focusChatInput() {
  if (chatState.input) chatState.input.focus();
}

function setupForm() {
  if (!chatState.form) return;
  chatState.form.addEventListener('submit', (event) => {
    event.preventDefault();
    sendCurrentMessage();
  });
}

function sendCurrentMessage() {
  if (!chatState.input) return;
  const text = chatState.input.value.trim();
  if (!text) return;
  const scope = getActiveScope();
  if (isDmScope(scope)) {
    if (handleDmSubmit(scope, text)) {
      chatState.input.value = '';
    }
    return;
  }
  if (scope === 'global') {
    wsSend({ type: 'chat', scope: 'global', text });
    chatState.input.value = '';
    return;
  }
  pushEntry(scope, text, { author: 'Você', system: false });
  chatState.input.value = '';
}

function initFriendsIntegration() {
  window.addEventListener('dm:open', (event) => {
    const detail = event?.detail || {};
    const friend = detail.friend || { friendId: detail.friendId };
    if (!friend || !friend.friendId) return;
    openConversation(friend);
  });
}

function ensureDmIntegration() {
  const tabsAnchor = chatState.tabs?.querySelector('[data-dm-anchor]') || null;
  const panelsAnchor = chatState.panels?.querySelector('[data-dm-anchor]') || null;
  chatState.dmTabsAnchor = tabsAnchor;
  chatState.dmPanelsAnchor = panelsAnchor;
  chatState.dm = initDmChat({
    tabsEl: chatState.tabs,
    panelsEl: chatState.panels,
    tabsAnchorEl: tabsAnchor,
    panelsAnchorEl: panelsAnchor,
    input: chatState.input,
    focusInput: focusChatInput,
    setScope,
    getScope: getActiveScope,
  });
}

function initChat(root) {
  if (!root || chatState.root) return;
  chatState.root = root;
  chatState.tabs = root.querySelector('#chatTabs');
  chatState.panels = root.querySelector('#chatPanels');
  chatState.input = root.querySelector('#chatInput');
  chatState.form = root.querySelector('#chatForm');
  cacheLogs();
  markButtons();
  ensureDmIntegration();
  setupForm();
  bindWsListener();
  bindTickListener();
  initFriendsIntegration();
  hydrateIdentity()
    .then(fetchHistoryIfNeeded)
    .catch(() => {});
  const initial = restoreStoredScope();
  if (isDmScope(initial)) {
    setScope('local', { focusInput: false });
  } else {
    setScope(initial, { focusInput: false });
  }
  renderScope(chatState.activeScope);
}

function exposeApi() {
  if (!window.Chat) window.Chat = {};
  window.Chat.init = initChat;
  window.Chat.pushMessage = (channel, message, options = {}) => pushMessage(channel, message, options);
  window.Chat.pushLog = (message, channel = LOG_SCOPE) => pushLog(message, channel);
  window.Chat.switchTo = (scope) => setScope(scope, { focusInput: true });
  window.Chat.clearLogHighlight = () => {};
  window.Chat.getState = () => ({
    activeScope: chatState.activeScope,
    buffers: Array.from(chatState.buffers.entries()).reduce((acc, [key, value]) => {
      acc[key] = value.slice();
      return acc;
    }, {}),
  });
}

function exposeSendChat() {
  window.sendChat = function sendChat(scope, message) {
    if (!message) return;
    if (isDmScope(scope)) {
      if (handleDmSubmit(scope, message)) return;
    }
    if (scope === 'global') {
      wsSend({ type: 'chat', scope: 'global', text: message });
    } else {
      pushEntry(scope, message, { author: 'Você' });
    }
  };
}

exposeApi();
exposeSendChat();

document.addEventListener('DOMContentLoaded', () => {
  const chatRoot = document.getElementById('chat');
  if (chatRoot) initChat(chatRoot);
});

export { initChat, pushMessage, pushLog, setScope };
