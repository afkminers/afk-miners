// client/js/ui/dm-chat.js
import { apiGet } from '../api.js';
import { getSocket, onMessage, wsSend } from '../ws/singleton.js';
import { renderRichText } from './emoji.js';

const DM_SCOPE_PREFIX = 'dm:';

const conversations = new Map();
const NUDGE_COOLDOWN_MS = 15_000;
const NUDGE_ACK_TIMEOUT_MS = 5_000;
const localNudgeCooldowns = new Map();
const pendingNudges = new Map();

let sfxMuted = false;
let nudgeAudio = null;

function readMutePreference() {
  try {
    const muted = localStorage.getItem('sfx-muted');
    return muted === '1' || muted === 'true';
  } catch {
    return false;
  }
}

function ensureMuteWatcher() {
  if (typeof window === 'undefined') return;
  sfxMuted = readMutePreference();
  const handler = (event) => {
    const muted = !!(event?.detail?.muted);
    sfxMuted = muted;
  };
  window.addEventListener('sfx-mute', handler);
  if (typeof document !== 'undefined') {
    document.addEventListener('sfx-mute', handler);
  }
}

function ensureNudgeAudio() {
  if (nudgeAudio) return;
  try {
    nudgeAudio = new Audio('/sfx/click.mp3');
    nudgeAudio.preload = 'auto';
    nudgeAudio.volume = 0.75;
  } catch {
    nudgeAudio = null;
  }
}

function playNudgeSound() {
  if (sfxMuted) return;
  ensureNudgeAudio();
  if (!nudgeAudio) return;
  try {
    nudgeAudio.currentTime = 0;
    nudgeAudio.play().catch(() => {});
  } catch {}
}

ensureMuteWatcher();
let tabsContainer = null;
let panelsContainer = null;
let tabsAnchorEl = null;
let panelsAnchorEl = null;
let inputEl = null;
let focusInputFn = () => {};
let currentScope = 'default';
let currentUserId = null;
let formEl = null;
let setScopeFn = null;
let getScopeFn = null;
const nudgeErrorMessages = {
  DM_NUDGE_COOLDOWN: 'Aguarde alguns segundos para enviar outro nudge.',
  DM_NUDGE_RATE_LIMIT: 'Muitas cutucadas em sequência. Tente novamente mais tarde.',
  DM_BLOCKED: 'Cutucadas estão bloqueadas entre vocês.',
  DM_NOT_ALLOWED: 'Somente amigos podem usar nudge.',
  DM_NUDGE_TIMEOUT: 'Não foi possível confirmar o nudge. Tente novamente.',
  FRIEND_NOT_FOUND: 'Amizade não encontrada.',
  DM_NUDGE_FAILED: 'Falha ao enviar nudge.',
};

function createError(code) {
  const err = new Error(code || 'DM_NUDGE_FAILED');
  err.code = code || 'DM_NUDGE_FAILED';
  return err;
}

function getLocalCooldownUntil(friendId) {
  return Number(localNudgeCooldowns.get(friendId)) || 0;
}

function setLocalCooldown(friendId, untilTs) {
  if (!friendId) return;
  localNudgeCooldowns.set(friendId, Number(untilTs) || Date.now());
}

function clearLocalCooldown(friendId) {
  if (!friendId) return;
  localNudgeCooldowns.delete(friendId);
}

function createPendingNudge(friendId) {
  if (pendingNudges.has(friendId)) {
    return pendingNudges.get(friendId);
  }
  let resolveFn;
  let rejectFn;
  const promise = new Promise((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  const timer = setTimeout(() => {
    pendingNudges.delete(friendId);
    rejectFn(createError('DM_NUDGE_TIMEOUT'));
  }, NUDGE_ACK_TIMEOUT_MS);
  const entry = { resolve: resolveFn, reject: rejectFn, timer, promise };
  pendingNudges.set(friendId, entry);
  return entry;
}

function settlePendingNudge(friendId, ok, code) {
  const entry = pendingNudges.get(friendId);
  if (!entry) return { ok: false };
  pendingNudges.delete(friendId);
  clearTimeout(entry.timer);
  if (ok) {
    const until = Date.now() + NUDGE_COOLDOWN_MS;
    setLocalCooldown(friendId, until);
    entry.resolve({ cooldownUntil: until });
    return { ok: true, cooldownUntil: until };
  }
  const err = createError(code);
  entry.reject(err);
  return { ok: false, error: err.code };
}

function scheduleNudgeAvailabilityCheck(conv) {
  if (!conv) return;
  if (conv.nudgeTimer) {
    clearTimeout(conv.nudgeTimer);
    conv.nudgeTimer = null;
  }
  const now = Date.now();
  const cooldownUntil = Math.max(getLocalCooldownUntil(conv.friendId), Number(conv.nudgeAvailableAt) || 0);
  const remaining = Math.max(0, cooldownUntil - now);
  if (conv.nudgeButtonEl) {
    const busy = !!conv.nudgeBusy;
    conv.nudgeButtonEl.disabled = busy || remaining > 0;
    conv.nudgeButtonEl.classList.toggle('is-busy', busy);
    if (remaining > 0) {
      conv.nudgeButtonEl.title = `Aguarde ${Math.ceil(remaining / 1000)}s`;
      conv.nudgeButtonEl.dataset.cooldown = String(Math.ceil(remaining / 1000));
    } else {
      conv.nudgeButtonEl.title = 'Enviar nudge';
      conv.nudgeButtonEl.removeAttribute('data-cooldown');
    }
  }
  if (remaining > 0) {
    conv.nudgeTimer = setTimeout(() => {
      conv.nudgeTimer = null;
      scheduleNudgeAvailabilityCheck(conv);
    }, Math.min(remaining, 1_000));
  }
}

function showNudgeFeedback(conv, message, tone = 'info', duration = 2_000) {
  if (!conv?.nudgeFeedbackEl) return;
  conv.nudgeFeedbackEl.textContent = message || '';
  if (message) {
    conv.nudgeFeedbackEl.dataset.tone = tone;
  } else {
    conv.nudgeFeedbackEl.removeAttribute('data-tone');
  }
  conv.nudgeFeedbackEl.hidden = !message;
  if (conv.nudgeFeedbackTimer) {
    clearTimeout(conv.nudgeFeedbackTimer);
    conv.nudgeFeedbackTimer = null;
  }
  if (message && duration > 0) {
    conv.nudgeFeedbackTimer = setTimeout(() => {
      conv.nudgeFeedbackEl.hidden = true;
      conv.nudgeFeedbackEl.textContent = '';
      conv.nudgeFeedbackEl.removeAttribute('data-tone');
      conv.nudgeFeedbackTimer = null;
    }, duration);
  }
}

function animateNudge(conv, incoming) {
  if (!conv) return;
  const classes = incoming ? ['is-nudged', 'is-nudged--incoming'] : ['is-nudged'];
  const apply = (el) => {
    if (!el) return;
    el.classList.add(...classes);
    setTimeout(() => {
      el.classList.remove(...classes);
    }, 1_200);
  };
  apply(conv.tabEl);
  apply(conv.panelEl);
}

function getNudgeMessage(code) {
  if (!code) return nudgeErrorMessages.DM_NUDGE_FAILED;
  return nudgeErrorMessages[code] || `Erro (${code}).`;
}

function nowIso() {
  return new Date().toISOString();
}

function resolveUserId() {
  if (currentUserId) return currentUserId;
  try {
    if (window._chat_me?.id) {
      currentUserId = String(window._chat_me.id);
      return currentUserId;
    }
  } catch {}
  return null;
}

function scopeForFriend(friendId) {
  return `${DM_SCOPE_PREFIX}${friendId}`;
}

function setActiveScope(scope) {
  if (typeof setScopeFn === 'function') {
    try {
      setScopeFn(scope);
      return;
    } catch {
      // fall back to local activation if the host callback fails
    }
  }
  activateDmScope(scope);
}

export function isDmScope(scope) {
  return typeof scope === 'string' && scope.startsWith(DM_SCOPE_PREFIX);
}

function friendIdFromScope(scope) {
  if (!isDmScope(scope)) return null;
  return scope.slice(DM_SCOPE_PREFIX.length);
}

function emitUnread(friendId, unreadCount) {
  window.dispatchEvent(
    new CustomEvent('dm:unread', {
      detail: { friendId: String(friendId), unreadCount: Number(unreadCount) || 0 },
    })
  );
}

function createTabElement(friendId, friendName) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chat-tab dm-tab';
  btn.dataset.scope = scopeForFriend(friendId);
  btn.innerHTML = `
    <span class="dm-tab-label">${friendName}</span>
    <span class="dm-tab-badge" aria-hidden="true"></span>
    <span class="dm-tab-close" role="button" aria-label="Fechar conversa">✕</span>
  `;
  return btn;
}

function createPanelElement(scope) {
  const panel = document.createElement('div');
  panel.className = 'chat-box chat-box--dm';
  panel.dataset.scope = scope;
  panel.hidden = true;

  const toolbar = document.createElement('div');
  toolbar.className = 'dm-toolbar';

  const nudgeButton = document.createElement('button');
  nudgeButton.type = 'button';
  nudgeButton.className = 'dm-nudge-button';
  nudgeButton.textContent = 'Nudge';
  nudgeButton.title = 'Enviar nudge';
  nudgeButton.setAttribute('aria-label', 'Enviar nudge');

  const nudgeFeedback = document.createElement('div');
  nudgeFeedback.className = 'dm-nudge-feedback';
  nudgeFeedback.hidden = true;

  toolbar.appendChild(nudgeButton);
  toolbar.appendChild(nudgeFeedback);

  const loadMore = document.createElement('button');
  loadMore.type = 'button';
  loadMore.className = 'dm-load-more';
  loadMore.textContent = 'Carregar mais';
  loadMore.hidden = true;

  const list = document.createElement('div');
  list.className = 'dm-message-list';

  panel.appendChild(toolbar);
  panel.appendChild(loadMore);
  panel.appendChild(list);
  return { panel, loadMore, list, nudgeButton, nudgeFeedback };
}

function ensureCurrentUser() {
  const id = resolveUserId();
  if (!id) return null;
  return id;
}

function scrollToBottom(conv) {
  if (!conv || !conv.listEl) return;
  const shouldStick = conv.panelEl.scrollHeight - conv.panelEl.clientHeight - conv.panelEl.scrollTop < 64;
  if (shouldStick) {
    conv.panelEl.scrollTop = conv.panelEl.scrollHeight;
  }
}

function renderBadge(conv) {
  if (!conv?.tabEl) return;
  const badge = conv.tabEl.querySelector('.dm-tab-badge');
  if (!badge) return;
  const value = Number(conv.unreadCount || 0);
  if (value > 0) {
    badge.hidden = false;
    badge.textContent = value > 99 ? '99+' : String(value);
    conv.tabEl.classList.add('has-unread');
  } else {
    badge.hidden = true;
    badge.textContent = '';
    conv.tabEl.classList.remove('has-unread');
  }
}

function createConversation(friendId, friendName) {
  if (!tabsContainer || !panelsContainer) return null;
  const scope = scopeForFriend(friendId);
  if (conversations.has(friendId)) return conversations.get(friendId);

  const label = friendName || `Jogador ${friendId}`;
  const tabEl = createTabElement(friendId, label);
  if (tabsAnchorEl && tabsAnchorEl.parentNode === tabsContainer) {
    tabsContainer.insertBefore(tabEl, tabsAnchorEl);
  } else {
    tabsContainer.appendChild(tabEl);
  }

  const { panel, loadMore, list, nudgeButton, nudgeFeedback } = createPanelElement(scope);
  if (panelsAnchorEl && panelsAnchorEl.parentNode === panelsContainer) {
    panelsContainer.insertBefore(panel, panelsAnchorEl);
  } else {
    panelsContainer.appendChild(panel);
  }

  const conv = {
    friendId,
    friendName: label,
    scope,
    tabEl,
    panelEl: panel,
    loadMoreEl: loadMore,
    listEl: list,
    nudgeButtonEl: nudgeButton,
    nudgeFeedbackEl: nudgeFeedback,
    messages: [],
    nextCursor: null,
    loading: false,
    unreadCount: 0,
    pending: new Map(),
    hasLoadedInitial: false,
    nudgeBusy: false,
    nudgeTimer: null,
    nudgeFeedbackTimer: null,
    nudgeAvailableAt: getLocalCooldownUntil(friendId),
  };

  loadMore.addEventListener('click', () => {
    if (!conv.loading) {
      fetchHistory(conv, { append: true }).catch(() => {});
    }
  });

  tabEl.addEventListener('click', (event) => {
    if (event.target.closest('.dm-tab-close')) {
      closeConversation(friendId);
      return;
    }
    setActiveScope(conv.scope);
  });

  tabEl.addEventListener('keydown', (event) => {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      closeConversation(friendId);
    }
  });

  if (nudgeButton) {
    nudgeButton.addEventListener('click', () => {
      if (conv.nudgeBusy) return;
      conv.nudgeBusy = true;
      showNudgeFeedback(conv, 'Enviando…', 'info', 0);
      scheduleNudgeAvailabilityCheck(conv);
      sendNudge(friendId)
        .catch((err) => {
          conv.nudgeBusy = false;
          const code = err?.code || err?.message;
          if (code === 'DM_NUDGE_COOLDOWN') {
            const until = getLocalCooldownUntil(friendId);
            if (until) conv.nudgeAvailableAt = Math.max(conv.nudgeAvailableAt || 0, until);
          }
          showNudgeFeedback(conv, getNudgeMessage(code), 'error', 4_000);
          scheduleNudgeAvailabilityCheck(conv);
        });
    });
  }

  conversations.set(friendId, conv);
  scheduleNudgeAvailabilityCheck(conv);
  renderBadge(conv);
  return conv;
}

function removeElement(el) {
  if (el && el.remove) {
    el.remove();
  }
}

function closeConversation(friendId) {
  const conv = conversations.get(friendId);
  if (!conv) return;
  const wasActive = currentScope === conv.scope;
  conversations.delete(friendId);
  if (conv.nudgeTimer) {
    clearTimeout(conv.nudgeTimer);
    conv.nudgeTimer = null;
  }
  if (conv.nudgeFeedbackTimer) {
    clearTimeout(conv.nudgeFeedbackTimer);
    conv.nudgeFeedbackTimer = null;
  }
  removeElement(conv.tabEl);
  removeElement(conv.panelEl);
  if (wasActive) {
    setActiveScope('default');
  }
}

function findMessage(conv, predicate) {
  if (!conv) return null;
  for (const msg of conv.messages) {
    if (predicate(msg)) return msg;
  }
  return null;
}

function renderMessage(conv, message) {
  if (!conv || !conv.listEl) return;
  const mine = message.senderId === ensureCurrentUser();
  let row = message.__el;
  if (!row) {
    row = document.createElement('div');
    row.className = 'dm-message';
    row.dataset.messageId = message.id ? String(message.id) : '';
    row.dataset.clientId = message.clientId || '';
    row.innerHTML = `
      <div class="dm-message__bubble"></div>
      <div class="dm-message__meta"></div>
    `;
    message.__el = row;
    if (message.insertBefore) {
      conv.listEl.insertBefore(row, conv.listEl.firstChild);
    } else {
      conv.listEl.appendChild(row);
    }
  }

  row.classList.toggle('from-me', mine);
  row.classList.toggle('from-them', !mine);
  if (message.failed) row.classList.add('is-failed');
  else row.classList.remove('is-failed');

  const bubble = row.querySelector('.dm-message__bubble');
  const meta = row.querySelector('.dm-message__meta');
  if (bubble) {
    renderRichText(bubble, message.body || '');
  }
  if (meta) {
    const parts = [];
    if (message.createdAt) {
      const dt = new Date(message.createdAt);
      if (!Number.isNaN(dt.getTime())) {
        parts.push(dt.toLocaleTimeString());
      }
    }
    if (mine) {
      if (message.readAt) parts.push('Lida');
      else if (message.deliveredAt) parts.push('Entregue');
      else if (message.failed) parts.push('Falha');
      else parts.push('Enviada');
    }
    meta.textContent = parts.join(' · ');
  }
}

function appendMessage(conv, message, { emit = true, prepend = false } = {}) {
  if (!conv) return;
  const msg = { ...message };
  msg.createdAt = msg.createdAt || nowIso();
  if (prepend) {
    msg.insertBefore = true;
    conv.messages.unshift(msg);
  } else {
    conv.messages.push(msg);
  }
  renderMessage(conv, msg);
  delete msg.insertBefore;
  if (!prepend) {
    scrollToBottom(conv);
  }
  if (emit && msg.senderId !== ensureCurrentUser()) {
    const latestId = msg.id || null;
    if (latestId) {
      wsSend({ type: 'dm:ack', messageIds: [latestId], friendId: msg.senderId });
    }
  }
}

async function fetchHistory(conv, { append = false } = {}) {
  if (!conv || conv.loading) return;
  conv.loading = true;
  if (conv.loadMoreEl) {
    conv.loadMoreEl.disabled = true;
    conv.loadMoreEl.textContent = 'Carregando…';
  }
  try {
    const params = new URLSearchParams();
    if (conv.nextCursor) params.set('before', conv.nextCursor);
    if (!append) params.set('limit', '30');
    const res = await apiGet(`/api/friends/${conv.friendId}/dms${params.toString() ? `?${params}` : ''}`);
    const messages = Array.isArray(res?.messages) ? res.messages : [];
    if (!append) {
      conv.messages.length = 0;
      conv.listEl.innerHTML = '';
      for (const raw of messages) {
        appendMessage(conv, {
          id: raw.id,
          clientId: null,
          body: raw.body || raw.bodyOriginal,
          senderId: raw.senderId,
          recipientId: raw.recipientId,
          createdAt: raw.createdAt,
          deliveredAt: raw.deliveredAt,
          readAt: raw.readAt,
        }, { emit: false });
      }
    } else {
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const raw = messages[i];
        appendMessage(conv, {
          id: raw.id,
          clientId: null,
          body: raw.body || raw.bodyOriginal,
          senderId: raw.senderId,
          recipientId: raw.recipientId,
          createdAt: raw.createdAt,
          deliveredAt: raw.deliveredAt,
          readAt: raw.readAt,
        }, { emit: false, prepend: true });
      }
    }
    conv.nextCursor = res?.nextCursor || null;
    conv.unreadCount = Number(res?.unreadCount || 0);
    renderBadge(conv);
    if (conv.loadMoreEl) {
      conv.loadMoreEl.hidden = !conv.nextCursor;
    }
    conv.hasLoadedInitial = true;
  } catch (err) {
    console.warn('[dm-chat] history failed', err?.message);
  } finally {
    conv.loading = false;
    if (conv.loadMoreEl) {
      conv.loadMoreEl.disabled = false;
      conv.loadMoreEl.textContent = conv.nextCursor ? 'Carregar mais' : 'Sem mais mensagens';
    }
  }
}

function ensureHistory(conv) {
  if (!conv || conv.loading) return;
  if (!conv.hasLoadedInitial) {
    fetchHistory(conv, { append: false }).catch(() => {});
  }
}

function markRead(conv) {
  if (!conv) return;
  const latest = conv.messages.length > 0 ? conv.messages[conv.messages.length - 1] : null;
  if (latest?.id) {
    wsSend({ type: 'dm:read', friendId: conv.friendId, upToId: latest.id });
  }
  conv.unreadCount = 0;
  renderBadge(conv);
  emitUnread(conv.friendId, 0);
}

function handleSend(scope, text) {
  if (!isDmScope(scope)) return false;
  const friendId = friendIdFromScope(scope);
  if (!friendId) return false;
  const conv = conversations.get(friendId) || createConversation(friendId, friendId);
  if (!conv) return false;

  const clientId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const payload = {
    type: 'dm:send',
    to: friendId,
    body: text,
    clientId,
  };
  wsSend(payload);

  const message = {
    id: null,
    clientId,
    body: text,
    senderId: ensureCurrentUser(),
    recipientId: friendId,
    createdAt: nowIso(),
    deliveredAt: null,
    readAt: null,
  };
  conv.pending.set(clientId, message);
  appendMessage(conv, message, { emit: false });
  return true;
}

function handleSendEvent(payload) {
  const message = payload?.message;
  if (!message) return;
  const friendId = message.senderId === ensureCurrentUser() ? message.recipientId : message.senderId;
  const conv = conversations.get(friendId) || createConversation(friendId, friendId);
  if (!conv) return;
  const existing = message.clientId ? conv.pending.get(message.clientId) : null;
  if (existing) {
    existing.id = message.id;
    existing.createdAt = message.createdAt;
    existing.deliveredAt = message.deliveredAt;
    existing.readAt = message.readAt;
    existing.failed = false;
    renderMessage(conv, existing);
    conv.pending.delete(message.clientId);
  } else {
    appendMessage(conv, {
      id: message.id,
      clientId: payload.clientId || null,
      body: message.body || message.bodyOriginal,
      senderId: message.senderId,
      recipientId: message.recipientId,
      createdAt: message.createdAt,
      deliveredAt: message.deliveredAt,
      readAt: message.readAt,
    });
  }
}

function handleRecvEvent(payload) {
  const message = payload?.message;
  if (!message) return;
  const friendId = message.senderId;
  const existing = conversations.get(friendId);
  const conv = existing || createConversation(friendId, friendId);
  if (!conv) return;
  appendMessage(conv, {
    id: message.id,
    body: message.body || message.bodyOriginal,
    senderId: message.senderId,
    recipientId: message.recipientId,
    createdAt: message.createdAt,
    deliveredAt: message.deliveredAt,
    readAt: message.readAt,
  });
  const unreadFromServer = Number(payload?.unreadCount || 0);
  if (!existing) {
    conv.unreadCount = unreadFromServer || conv.unreadCount + 1;
    renderBadge(conv);
    emitUnread(conv.friendId, conv.unreadCount);
    window.dispatchEvent(
      new CustomEvent('dm:open', {
        detail: {
          friendId,
          friend: { friendId, friendName: conv.friendName },
        },
      })
    );
    return;
  }
  if (currentScope !== conv.scope) {
    conv.unreadCount = unreadFromServer || conv.unreadCount + 1;
    renderBadge(conv);
    emitUnread(conv.friendId, conv.unreadCount);
  } else {
    markRead(conv);
  }
}

function handleAckEvent(payload) {
  const friendId = payload?.friendId ? String(payload.friendId) : null;
  if (!friendId) return;
  const conv = conversations.get(friendId);
  if (!conv) return;
  const ids = Array.isArray(payload?.messageIds) ? payload.messageIds : [];
  for (const id of ids) {
    const msg = findMessage(conv, (m) => m.id === Number(id));
    if (msg) {
      msg.deliveredAt = payload.deliveredAt || nowIso();
      renderMessage(conv, msg);
    }
  }
}

function handleReadEvent(payload) {
  const readerId = payload?.readerId ? String(payload.readerId) : null;
  const friendId = payload?.friendId ? String(payload.friendId) : null;
  const me = ensureCurrentUser();
  if (!readerId) return;
  if (readerId === me) {
    if (friendId && conversations.has(friendId)) {
      const conv = conversations.get(friendId);
      conv.unreadCount = Number(payload?.unreadCount || 0);
      renderBadge(conv);
      emitUnread(conv.friendId, conv.unreadCount);
    }
    return;
  }
  const conv = conversations.get(readerId);
  if (!conv) return;
  for (const msg of conv.messages) {
    if (msg.senderId === me) {
      msg.readAt = payload?.readAt || nowIso();
      renderMessage(conv, msg);
    }
  }
}

function handleErrorEvent(payload) {
  if (payload?.action === 'nudge') {
    const friendId = payload?.friendId ? String(payload.friendId) : null;
    const code = payload?.error || 'DM_NUDGE_FAILED';
    if (friendId) {
      settlePendingNudge(friendId, false, code);
      if (code === 'DM_NUDGE_COOLDOWN') {
        const until = Date.now() + NUDGE_COOLDOWN_MS;
        setLocalCooldown(friendId, until);
      }
      const conv = conversations.get(friendId);
      if (conv) {
        conv.nudgeBusy = false;
        if (code === 'DM_NUDGE_COOLDOWN') {
          const until = getLocalCooldownUntil(friendId);
          if (until) conv.nudgeAvailableAt = Math.max(conv.nudgeAvailableAt || 0, until);
        }
        showNudgeFeedback(conv, getNudgeMessage(code), 'error', 4_000);
        scheduleNudgeAvailabilityCheck(conv);
      }
      window.dispatchEvent(
        new CustomEvent('dm:nudge', {
          detail: {
            friendId,
            direction: 'error',
            error: code,
            ts: Date.now(),
          },
        })
      );
    }
    return;
  }
  const clientId = payload?.clientId;
  if (!clientId) return;
  for (const conv of conversations.values()) {
    const msg = findMessage(conv, (m) => m.clientId === clientId);
    if (msg) {
      msg.failed = true;
      renderMessage(conv, msg);
      break;
    }
  }
}

function handleNudgeEvent(payload) {
  const me = ensureCurrentUser();
  const fromId = payload?.fromId ? String(payload.fromId) : null;
  const friendId = payload?.friendId ? String(payload.friendId) : null;
  if (!fromId || !friendId) return;
  const ts = Number(payload?.ts) || Date.now();
  const isSender = fromId === me;
  const partnerId = isSender ? friendId : fromId;
  const conv = conversations.get(partnerId) || createConversation(partnerId, partnerId);
  if (isSender) {
    const result = settlePendingNudge(partnerId, true);
    const cooldownUntil = result?.cooldownUntil || getLocalCooldownUntil(partnerId) || (Date.now() + NUDGE_COOLDOWN_MS);
    if (conv) {
      conv.nudgeAvailableAt = Math.max(conv.nudgeAvailableAt || 0, cooldownUntil);
    }
  } else {
    playNudgeSound();
  }
  if (conv) {
    conv.nudgeBusy = false;
    if (payload?.friendName && (!conv.friendName || conv.friendName === partnerId)) {
      conv.friendName = payload.friendName;
    }
    const message = isSender ? 'Nudge enviado!' : `${conv.friendName || 'Seu amigo'} cutucou você!`;
    showNudgeFeedback(conv, message, isSender ? 'success' : 'info', isSender ? 2_000 : 4_000);
    scheduleNudgeAvailabilityCheck(conv);
    animateNudge(conv, !isSender);
  }
  window.dispatchEvent(
    new CustomEvent('dm:nudge', {
      detail: {
        friendId: partnerId,
        direction: isSender ? 'outgoing' : 'incoming',
        ts,
      },
    })
  );
}

export function activateDmScope(scope) {
  currentScope = scope;
  conversations.forEach((conv) => {
    const isActive = conv.scope === scope;
    if (conv.tabEl) conv.tabEl.classList.toggle('active', isActive);
    if (conv.panelEl) conv.panelEl.hidden = !isActive;
    if (isActive) {
      ensureHistory(conv);
      markRead(conv);
    }
  });
  if (typeof focusInputFn === 'function') {
    focusInputFn();
  }
}

export function openConversation(friend) {
  const friendId = String(friend?.friendId || friend?.id || friend);
  if (!friendId) return;
  const name = friend?.friendName || friend?.name || friendId;
  const conv = conversations.get(friendId) || createConversation(friendId, name);
  if (!conv) return;
  setActiveScope(conv.scope);
}

export function initDmChat({
  tabsEl,
  panelsEl,
  input,
  focusInput,
  tabsAnchorEl: providedTabsAnchor = null,
  panelsAnchorEl: providedPanelsAnchor = null,
  setScope,
  getScope,
}) {
  tabsContainer = tabsEl;
  panelsContainer = panelsEl;
  tabsAnchorEl = providedTabsAnchor || (tabsContainer ? tabsContainer.querySelector('.chat-tabs__dm-anchor') : null);
  panelsAnchorEl = providedPanelsAnchor || null;
  inputEl = input;
  focusInputFn = typeof focusInput === 'function' ? focusInput : () => {};
  formEl = null;
  setScopeFn = typeof setScope === 'function' ? setScope : null;
  getScopeFn = typeof getScope === 'function' ? getScope : null;
  try {
    const initialScope = typeof getScopeFn === 'function' ? getScopeFn() : null;
    if (initialScope) {
      currentScope = initialScope;
    }
  } catch {}
  if (input && typeof input.closest === 'function') {
    formEl = input.closest('form');
  }
  if (!formEl && input && input.form) {
    formEl = input.form;
  }

  if (formEl) {
    formEl.addEventListener('submit', (event) => {
      const scope = currentScope;
      const text = (inputEl?.value || '').trim();
      if (!text) return;
      if (handleSend(scope, text)) {
        event.preventDefault();
        inputEl.value = '';
      }
    });
  }

  onMessage('dm:send', handleSendEvent);
  onMessage('dm:recv', handleRecvEvent);
  onMessage('dm:ack', handleAckEvent);
  onMessage('dm:read', handleReadEvent);
  onMessage('dm:error', handleErrorEvent);
  onMessage('dm:nudge', handleNudgeEvent);

  const socket = getSocket();
  if (socket) {
    socket.addEventListener('open', () => {
      conversations.forEach((conv) => {
        conv.hasLoadedInitial = false;
        fetchHistory(conv, { append: false })
          .then(() => {
            if (conv.scope === currentScope) {
              markRead(conv);
            }
          })
          .catch(() => {});
      });
    });
  }
}

export function handleDmSubmit(scope, text) {
  return handleSend(scope, text);
}

export function getDmScopeForFriend(friendId) {
  return scopeForFriend(friendId);
}

export function syncUnreadFromServer(friendId, unreadCount, opts = {}) {
  const conv = conversations.get(friendId);
  if (conv) {
    conv.unreadCount = Number(unreadCount || 0);
    renderBadge(conv);
  }
  if (!opts?.silent) {
    emitUnread(friendId, unreadCount);
  }
}

export function syncFriendData(friend) {
  const friendId = String(friend?.friendId || friend?.id || '');
  if (!friendId) return;
  const conv = conversations.get(friendId);
  if (!conv) return;
  const name = friend?.friendName || friend?.name || friendId;
  conv.friendName = name;
  if (conv.tabEl) {
    const label = conv.tabEl.querySelector('.dm-tab-label');
    if (label) label.textContent = name;
  }
}

export function sendNudge(friendId) {
  const id = String(friendId || '').trim();
  if (!id) {
    return Promise.reject(createError('FRIEND_NOT_FOUND'));
  }
  const now = Date.now();
  const cooldownUntil = getLocalCooldownUntil(id);
  if (cooldownUntil && now < cooldownUntil) {
    return Promise.reject(createError('DM_NUDGE_COOLDOWN'));
  }
  if (pendingNudges.has(id)) {
    return pendingNudges.get(id).promise;
  }
  const entry = createPendingNudge(id);
  try {
    wsSend({ type: 'dm:nudge', to: id });
  } catch (err) {
    pendingNudges.delete(id);
    clearTimeout(entry.timer);
    return Promise.reject(createError(err?.code || 'DM_NUDGE_FAILED'));
  }
  return entry.promise;
}

export function getNudgeErrorMessage(code) {
  return getNudgeMessage(code);
}
