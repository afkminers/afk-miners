// client/js/ui/dm-chat.js
import { apiGet } from '../api.js';
import { getSocket, onMessage, wsSend } from '../ws/singleton.js';

const DM_SCOPE_PREFIX = 'dm:';

const conversations = new Map();
let tabsContainer = null;
let panelsContainer = null;
let inputEl = null;
let focusInputFn = () => {};
let currentScope = 'default';
let currentUserId = null;
let formEl = null;

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

  const loadMore = document.createElement('button');
  loadMore.type = 'button';
  loadMore.className = 'dm-load-more';
  loadMore.textContent = 'Carregar mais';
  loadMore.hidden = true;

  const list = document.createElement('div');
  list.className = 'dm-message-list';

  panel.appendChild(loadMore);
  panel.appendChild(list);
  return { panel, loadMore, list };
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
  tabsContainer.appendChild(tabEl);

  const { panel, loadMore, list } = createPanelElement(scope);
  panelsContainer.appendChild(panel);

  const conv = {
    friendId,
    friendName: label,
    scope,
    tabEl,
    panelEl: panel,
    loadMoreEl: loadMore,
    listEl: list,
    messages: [],
    nextCursor: null,
    loading: false,
    unreadCount: 0,
    pending: new Map(),
    hasLoadedInitial: false,
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

  conversations.set(friendId, conv);
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
    bubble.textContent = message.body || '';
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
  activateDmScope(conv.scope);
}

export function initDmChat({ tabsEl, panelsEl, input, focusInput }) {
  tabsContainer = tabsEl;
  panelsContainer = panelsEl;
  inputEl = input;
  focusInputFn = typeof focusInput === 'function' ? focusInput : () => {};
  formEl = null;
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
