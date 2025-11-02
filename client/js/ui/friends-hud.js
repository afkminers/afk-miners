// client/js/ui/friends-hud.js
// HUD panel for managing the friends list with live presence dots and REST actions.

import { apiGet, apiPost, apiDelete } from '../api.js';
import { getSocket, onMessage } from '../ws/singleton.js';
import {
  openConversation as openDmConversation,
  syncUnreadFromServer,
  syncFriendData,
  sendNudge,
  getNudgeErrorMessage,
} from './dm-chat.js';

const REFRESH_INTERVAL = 30_000;

let initPromise = null;
let buttonEl = null;
let panelEl = null;
let surfaceEl = null;
let addFormEl = null;
let addInputEl = null;
let loaderEl = null;
let feedbackEl = null;
let lists = {};
let counts = {};
let badgeEl = null;
let contextMenuEl = null;
let contextMenuFriendId = null;
let refreshTimer = null;
let currentUserId = null;
let loadPromise = null;
let feedbackTimer = null;
let actionsObserver = null;

const friendsById = new Map();
const pendingActions = new Set();
const unsubscribers = [];

const ERROR_MESSAGES = {
  USER_NOT_FOUND: 'Jogador não encontrado.',
  FRIEND_ALREADY_EXISTS: 'Vocês já têm uma pendência.',
  FRIEND_SELF_NOT_ALLOWED: 'Você não pode adicionar a si mesmo.',
  FRIEND_REQUEST_NOT_FOUND: 'Solicitação não encontrada.',
  FRIEND_REQUEST_NOT_FOR_YOU: 'Essa solicitação não pertence a você.',
  FRIEND_NOT_FOUND: 'Amizade não encontrada.',
  FRIEND_BLOCKED_BY_OTHER: 'Somente quem bloqueou pode desbloquear.',
  FRIEND_LIST_RATE_LIMIT: 'Muitas consultas em sequência. Aguarde um pouco.',
  FRIEND_RATE_LIMIT: 'Muitas ações em sequência. Tente novamente em instantes.',
  DM_NUDGE_COOLDOWN: 'Aguarde alguns segundos para cutucar de novo.',
  DM_NUDGE_RATE_LIMIT: 'Muitas cutucadas seguidas. Tente mais tarde.',
  DM_BLOCKED: 'Não é possível cutucar este jogador agora.',
  DM_NOT_ALLOWED: 'Somente amigos aceitos podem usar nudge.',
  DM_NUDGE_FAILED: 'Não foi possível enviar o nudge.',
  DM_NUDGE_TIMEOUT: 'Não foi possível confirmar o nudge. Tente novamente.',
};

const SUCCESS_MESSAGES = {
  request: 'Solicitação enviada!',
  accept: 'Solicitação aceita. Agora vocês são amigos!',
  reject: 'Solicitação rejeitada.',
  remove: 'Amigo removido.',
  block: 'Jogador bloqueado.',
  unblock: 'Bloqueio removido.',
  nudge: 'Nudge enviado!',
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseTime(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : null;
}

function normalizeFriend(raw) {
  if (!raw) return null;
  const friendId = String(raw.friendId ?? raw.friendshipId ?? '').trim();
  if (!friendId) return null;
  const name = raw.friendName || `Jogador #${friendId}`;
  const createdAt = parseTime(raw.createdAt) ?? Date.now();
  const updatedAt = parseTime(raw.updatedAt) ?? createdAt;
  const lastSeen = parseTime(raw.lastSeenAt);
  return {
    friendshipId: Number(raw.friendshipId) || null,
    friendId,
    name,
    status: String(raw.status || 'PENDING').toUpperCase(),
    direction: raw.pendingDirection || null,
    blockedBy: raw.blockedBy ? String(raw.blockedBy) : null,
    createdAt,
    updatedAt,
    unreadCount: Number(raw.unreadCount) || 0,
    online: !!raw.online,
    lastSeenAt: lastSeen,
    canMessage: !!raw.canMessage,
  };
}

function ensureContextMenu() {
  if (contextMenuEl) return;
  contextMenuEl = document.createElement('div');
  contextMenuEl.className = 'friend-context-menu';
  contextMenuEl.setAttribute('role', 'menu');
  contextMenuEl.innerHTML = `
    <button type="button" class="friend-context-item" data-action="message">Send Message</button>
    <button type="button" class="friend-context-item" data-action="nudge">Cutucar</button>
    <button type="button" class="friend-context-item" data-action="remove">Remover</button>
    <button type="button" class="friend-context-item" data-action="block">Bloquear</button>
  `;
  surfaceEl.appendChild(contextMenuEl);
}

function closeContextMenu() {
  if (!contextMenuEl) return;
  contextMenuEl.classList.remove('is-open');
  contextMenuEl.setAttribute('aria-hidden', 'true');
  contextMenuFriendId = null;
}

function openContextMenuFor(friend, anchorRect) {
  ensureContextMenu();
  if (!contextMenuEl) return;
  contextMenuFriendId = friend.friendId;
  const removeBtn = contextMenuEl.querySelector('[data-action="remove"]');
  const blockBtn = contextMenuEl.querySelector('[data-action="block"]');
  const messageBtn = contextMenuEl.querySelector('[data-action="message"]');
  const nudgeBtn = contextMenuEl.querySelector('[data-action="nudge"]');
  if (messageBtn) {
    const canMessage = friend.status === 'ACCEPTED' && friend.canMessage !== false;
    messageBtn.disabled = !canMessage;
    messageBtn.title = canMessage ? 'Enviar mensagem privada' : 'Mensagem indisponível';
  }
  if (nudgeBtn) {
    const canNudge = friend.status === 'ACCEPTED' && friend.canMessage !== false && friend.status !== 'BLOCKED';
    nudgeBtn.disabled = !canNudge;
    nudgeBtn.title = canNudge ? 'Enviar nudge' : 'Nudge indisponível';
  }
  const canRemove = friend.status === 'ACCEPTED';
  if (removeBtn) {
    removeBtn.disabled = !canRemove;
    removeBtn.textContent = 'Remover';
  }
  if (blockBtn) {
    const isBlockedByMe = friend.status === 'BLOCKED' && friend.blockedBy && friend.blockedBy === currentUserId;
    const label = isBlockedByMe ? 'Desbloquear' : 'Bloquear';
    blockBtn.textContent = label;
    blockBtn.dataset.mode = isBlockedByMe ? 'unblock' : 'block';
    blockBtn.disabled = false;
    if (friend.status === 'BLOCKED' && friend.blockedBy && friend.blockedBy !== currentUserId) {
      // Não podemos desbloquear se outro usuário bloqueou.
      blockBtn.disabled = false;
      blockBtn.dataset.mode = 'block';
      blockBtn.textContent = 'Bloquear';
    }
  }

  contextMenuEl.classList.add('is-open');
  contextMenuEl.setAttribute('aria-hidden', 'false');
  const surfRect = surfaceEl.getBoundingClientRect();
  const menuRect = contextMenuEl.getBoundingClientRect();
  let left = anchorRect.left - surfRect.left;
  let top = anchorRect.top - surfRect.top;
  if (isNaN(left) || isNaN(top)) {
    left = surfRect.width - menuRect.width - 12;
    top = 12;
  }
  const maxLeft = Math.max(8, surfRect.width - menuRect.width - 8);
  const maxTop = Math.max(8, surfRect.height - menuRect.height - 8);
  contextMenuEl.style.left = `${Math.max(8, Math.min(left, maxLeft))}px`;
  contextMenuEl.style.top = `${Math.max(8, Math.min(top, maxTop))}px`;
  const first = contextMenuEl.querySelector('button:not([disabled])') || contextMenuEl.querySelector('button');
  first?.focus();
}

function formatRelative(ts) {
  if (!ts) return 'offline';
  const now = Date.now();
  const diff = Math.max(0, now - ts);
  const sec = Math.round(diff / 1000);
  if (sec < 45) return 'há instantes';
  const min = Math.round(sec / 60);
  if (min < 60) return `há ${min}m`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.round(hours / 24);
  return `há ${days}d`;
}

function showFeedback(message, kind = 'info') {
  if (!feedbackEl) return;
  if (feedbackTimer) {
    clearTimeout(feedbackTimer);
    feedbackTimer = null;
  }
  feedbackEl.textContent = message || '';
  if (message) {
    feedbackEl.dataset.kind = kind;
    feedbackTimer = setTimeout(() => {
      feedbackEl.textContent = '';
      delete feedbackEl.dataset.kind;
      feedbackTimer = null;
    }, 4200);
  } else {
    delete feedbackEl.dataset.kind;
  }
}

function setLoadingState(isLoading) {
  if (loaderEl) loaderEl.hidden = !isLoading;
  if (panelEl) panelEl.classList.toggle('is-loading', !!isLoading);
}

function setFormLoading(isLoading) {
  if (!addFormEl) return;
  addFormEl.classList.toggle('is-loading', !!isLoading);
  if (addInputEl) addInputEl.disabled = !!isLoading;
  const submit = addFormEl.querySelector('button[type="submit"]');
  if (submit) submit.disabled = !!isLoading;
}

function setRowBusy(friendId, busy) {
  if (!panelEl || !friendId) return;
  const row = panelEl.querySelector(`[data-friend-id="${friendId}"]`);
  if (!row) return;
  row.classList.toggle('is-busy', !!busy);
  row.querySelectorAll('button').forEach((btn) => {
    if (!btn.hasAttribute('data-menu-toggle')) {
      btn.disabled = !!busy;
    }
  });
}

function updateButtonBadge(pendingCount, unreadTotal) {
  if (!badgeEl) return;
  const value = pendingCount > 0 ? pendingCount : unreadTotal;
  if (value > 0) {
    badgeEl.hidden = false;
    badgeEl.textContent = value > 99 ? '99+' : String(value);
    buttonEl?.setAttribute('data-has-alert', '1');
  } else {
    badgeEl.hidden = true;
    buttonEl?.removeAttribute('data-has-alert');
  }
}

function renderSections() {
  const pending = [];
  const accepted = [];
  const blocked = [];
  friendsById.forEach((friend) => {
    if (friend.status === 'PENDING') pending.push(friend);
    else if (friend.status === 'ACCEPTED') accepted.push(friend);
    else if (friend.status === 'BLOCKED') blocked.push(friend);
  });

  pending.sort((a, b) => {
    if (a.direction !== b.direction) {
      if (a.direction === 'incoming') return -1;
      if (b.direction === 'incoming') return 1;
    }
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
  accepted.sort((a, b) => {
    const nameA = a.name.toLowerCase();
    const nameB = b.name.toLowerCase();
    if (nameA < nameB) return -1;
    if (nameA > nameB) return 1;
    return (a.friendId < b.friendId ? -1 : 1);
  });
  blocked.sort((a, b) => {
    const nameA = a.name.toLowerCase();
    const nameB = b.name.toLowerCase();
    if (nameA < nameB) return -1;
    if (nameA > nameB) return 1;
    return (a.friendId < b.friendId ? -1 : 1);
  });

  renderSection('pending', pending);
  renderSection('friends', accepted);
  renderSection('blocked', blocked);

  const unreadTotal = accepted.reduce((acc, friend) => acc + (friend.unreadCount || 0), 0);
  updateButtonBadge(pending.length, unreadTotal);
}

function renderSection(key, items) {
  const container = lists[key];
  const countEl = counts[key];
  if (!container) return;
  container.innerHTML = '';
  if (countEl) countEl.textContent = String(items.length);
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'friend-empty';
    empty.textContent =
      key === 'pending'
        ? 'Nenhuma solicitação.'
        : key === 'friends'
          ? 'Nenhum amigo ainda.'
          : 'Nenhum bloqueado.';
    container.appendChild(empty);
    if (contextMenuFriendId) closeContextMenu();
    return;
  }
  const frag = document.createDocumentFragment();
  for (const friend of items) {
    frag.appendChild(buildFriendRow(friend));
  }
  container.appendChild(frag);
  if (contextMenuFriendId && !friendsById.has(contextMenuFriendId)) {
    closeContextMenu();
  }
}

function buildFriendRow(friend) {
  const row = document.createElement('div');
  row.className = 'friend-item';
  row.tabIndex = 0;
  row.dataset.friendId = friend.friendId;
  row.dataset.status = friend.status;
  if (friend.direction) row.dataset.direction = friend.direction;
  row.dataset.online = friend.online ? '1' : '0';

  const initials = escapeHtml((friend.name || '?').trim().slice(0, 1).toUpperCase() || '?');
  const presenceText = friend.online ? 'Online agora' : (friend.lastSeenAt ? `Visto ${formatRelative(friend.lastSeenAt)}` : 'Offline');
  const presenceTitle = friend.online
    ? 'Online agora'
    : friend.lastSeenAt
      ? new Date(friend.lastSeenAt).toLocaleString()
      : 'Ainda sem presença registrada';
  const unread = friend.unreadCount > 0
    ? `<span class="friend-unread" aria-label="${friend.unreadCount} mensagens não lidas">${friend.unreadCount}</span>`
    : '';

  let tag = '';
  if (friend.status === 'PENDING') {
    tag = friend.direction === 'incoming'
      ? '<span class="friend-tag incoming">Recebida</span>'
      : '<span class="friend-tag outgoing">Enviada</span>';
  } else if (friend.status === 'BLOCKED') {
    const isMe = friend.blockedBy && friend.blockedBy === currentUserId;
    tag = isMe
      ? '<span class="friend-tag blocked">Bloqueado</span>'
      : '<span class="friend-tag blocked danger">Bloqueou você</span>';
  } else {
    tag = '<span class="friend-tag accepted">Amigo</span>';
  }

  row.innerHTML = `
    <div class="friend-avatar" aria-hidden="true">
      <span class="friend-avatar__bg"></span>
      <span class="friend-avatar__initial">${initials}</span>
      <span class="presence-dot ${friend.online ? 'is-online' : 'is-offline'}" data-role="presence-dot" title="${escapeHtml(presenceTitle)}"></span>
    </div>
    <div class="friend-info">
      <div class="friend-line friend-line--primary">
        <span class="friend-name">${escapeHtml(friend.name)}</span>
        ${tag}
      </div>
      <div class="friend-line friend-line--secondary">
        <span class="friend-presence" data-role="presence-label" title="${escapeHtml(presenceTitle)}">${escapeHtml(presenceText)}</span>
        ${unread}
      </div>
    </div>
    <button type="button" class="friend-menu-toggle" data-menu-toggle aria-haspopup="menu" aria-label="Ações">⋮</button>
  `;

  if (friend.status === 'PENDING' && friend.direction === 'incoming') {
    const actions = document.createElement('div');
    actions.className = 'friend-inline-actions';
    actions.innerHTML = `
      <button type="button" class="friend-inline-btn" data-action="accept" data-id="${friend.friendId}">Aceitar</button>
      <button type="button" class="friend-inline-btn danger" data-action="reject" data-id="${friend.friendId}">Rejeitar</button>
    `;
    row.appendChild(actions);
  }

  return row;
}

function updatePresenceFor(friend) {
  if (!panelEl) return;
  const row = panelEl.querySelector(`[data-friend-id="${friend.friendId}"]`);
  if (!row) return;
  row.dataset.online = friend.online ? '1' : '0';
  const dot = row.querySelector('[data-role="presence-dot"]');
  const label = row.querySelector('[data-role="presence-label"]');
  const title = friend.online
    ? 'Online agora'
    : friend.lastSeenAt
      ? new Date(friend.lastSeenAt).toLocaleString()
      : 'Ainda sem presença registrada';
  const text = friend.online ? 'Online agora' : (friend.lastSeenAt ? `Visto ${formatRelative(friend.lastSeenAt)}` : 'Offline');
  if (dot) {
    dot.classList.toggle('is-online', !!friend.online);
    dot.classList.toggle('is-offline', !friend.online);
    dot.setAttribute('title', title);
  }
  if (label) {
    label.textContent = text;
    label.setAttribute('title', title);
  }
}

function applyFriend(rawFriend) {
  const friend = normalizeFriend(rawFriend);
  if (!friend) return;
  friendsById.set(friend.friendId, friend);
  syncUnreadFromServer(friend.friendId, friend.unreadCount || 0, { silent: true });
  syncFriendData(friend);
}

function removeFriend(friendId) {
  if (!friendId) return;
  friendsById.delete(friendId);
  syncUnreadFromServer(friendId, 0, { silent: true });
}

async function ensureCurrentUser() {
  if (currentUserId) return currentUserId;
  if (window._chat_me?.id) {
    currentUserId = String(window._chat_me.id);
    return currentUserId;
  }
  try {
    const data = await apiGet('/api/player/me');
    const profile = data?.profile ? data.profile : data;
    const id = profile?.id ?? profile?.playerId;
    if (id != null) {
      currentUserId = String(id);
    }
  } catch (err) {
    console.warn('[friends-hud] não foi possível obter o usuário atual', err?.message);
  }
  return currentUserId;
}

async function loadFriends({ silent = false } = {}) {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    if (!silent) setLoadingState(true);
    try {
      await ensureCurrentUser();
      const data = await apiGet('/api/friends');
      const list = Array.isArray(data?.friends) ? data.friends : [];
      friendsById.clear();
      for (const raw of list) {
        applyFriend(raw);
      }
      renderSections();
    } catch (err) {
      if (!silent) {
        const code = err?.payload?.error || err?.message || 'FRIEND_LIST_FAILED';
        showFeedback(ERROR_MESSAGES[code] || `Erro ao carregar a lista (${code}).`, 'error');
      }
    } finally {
      if (!silent) setLoadingState(false);
      loadPromise = null;
    }
  })();
  return loadPromise;
}

function startAutoRefresh() {
  stopAutoRefresh();
  refreshTimer = window.setInterval(() => {
    loadFriends({ silent: true }).catch(() => {});
  }, REFRESH_INTERVAL);
}

function stopAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

function handlePresenceEvent(kind, payload) {
  if (!payload || !payload.userId) return;
  const friendId = String(payload.userId);
  const friend = friendsById.get(friendId);
  if (!friend) return;
  const ts = Number(payload.lastSeen || payload.ts || Date.now());
  if (kind === 'online') {
    friend.online = true;
    friend.lastSeenAt = ts;
  } else if (kind === 'offline') {
    friend.online = false;
    friend.lastSeenAt = ts;
  } else {
    friend.online = true;
    if (ts) friend.lastSeenAt = ts;
  }
  updatePresenceFor(friend);
}

function mapError(err) {
  const code = err?.payload?.error || err?.message || 'UNKNOWN';
  return ERROR_MESSAGES[code] || `Erro (${code}).`;
}

function mapNudgeError(err) {
  const code = err?.code || err?.payload?.error || err?.message || 'DM_NUDGE_FAILED';
  return getNudgeErrorMessage(code) || mapError({ message: code });
}

function highlightFriendRow(friendId) {
  if (!surfaceEl) return;
  const row = surfaceEl.querySelector(`.friend-item[data-friend-id="${friendId}"]`);
  if (!row) return;
  row.classList.add('is-nudged');
  setTimeout(() => {
    row.classList.remove('is-nudged');
  }, 1000);
}

function triggerNudge(friendId) {
  const id = String(friendId || '').trim();
  if (!id) {
    showFeedback('Amigo inválido.', 'error');
    return;
  }
  highlightFriendRow(id);
  sendNudge(id).catch((err) => {
    showFeedback(mapNudgeError(err), 'error');
  });
}

async function handleAction(action, friendId, options = {}) {
  const keyBase = friendId ? `${action}:${friendId}` : `${action}:${(options.username || '').toLowerCase()}`;
  if (!keyBase) return;
  if (pendingActions.has(keyBase)) return;
  pendingActions.add(keyBase);
  if (friendId) setRowBusy(friendId, true);
  if (action === 'request') setFormLoading(true);
  try {
    if (action === 'request') {
      const username = (options.username || '').trim();
      if (!username) {
        showFeedback('Informe um nome de jogador.', 'error');
        return;
      }
      const res = await apiPost('/api/friends/request', { username });
      if (res?.friendship) {
        applyFriend(res.friendship);
        renderSections();
        showFeedback(SUCCESS_MESSAGES.request, 'success');
      }
      if (addInputEl) addInputEl.value = '';
      return;
    }
    if (action === 'accept') {
      const res = await apiPost(`/api/friends/${friendId}/accept`, {});
      if (res?.friendship) {
        applyFriend(res.friendship);
        renderSections();
        showFeedback(SUCCESS_MESSAGES.accept, 'success');
      }
      return;
    }
    if (action === 'reject') {
      await apiPost(`/api/friends/${friendId}/reject`, {});
      removeFriend(friendId);
      renderSections();
      showFeedback(SUCCESS_MESSAGES.reject, 'success');
      return;
    }
    if (action === 'remove') {
      await apiDelete(`/api/friends/${friendId}`);
      removeFriend(friendId);
      renderSections();
      showFeedback(SUCCESS_MESSAGES.remove, 'success');
      return;
    }
    if (action === 'block') {
      const res = await apiPost(`/api/friends/${friendId}/block`, {});
      if (res?.friendship) {
        applyFriend(res.friendship);
        renderSections();
        showFeedback(SUCCESS_MESSAGES.block, 'success');
      }
      return;
    }
    if (action === 'unblock') {
      await apiPost(`/api/friends/${friendId}/unblock`, {});
      removeFriend(friendId);
      renderSections();
      showFeedback(SUCCESS_MESSAGES.unblock, 'success');
    }
  } catch (err) {
    showFeedback(mapError(err), 'error');
  } finally {
    pendingActions.delete(keyBase);
    if (friendId) setRowBusy(friendId, false);
    if (action === 'request') setFormLoading(false);
  }
}

function handlePanelClick(event) {
  const toggle = event.target.closest('[data-menu-toggle]');
  if (toggle) {
    const row = toggle.closest('.friend-item');
    if (!row) return;
    const friend = friendsById.get(row.dataset.friendId);
    if (!friend) return;
    const rect = toggle.getBoundingClientRect();
    openContextMenuFor(friend, { left: rect.left + rect.width, top: rect.top });
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  const actionBtn = event.target.closest('[data-action]');
  if (actionBtn) {
    const action = actionBtn.dataset.action;
    if (action === 'accept' || action === 'reject') {
      const id = actionBtn.dataset.id;
      handleAction(action, id).catch(() => {});
      event.preventDefault();
      return;
    }
  }
  if (contextMenuEl && contextMenuEl.classList.contains('is-open') && !contextMenuEl.contains(event.target)) {
    closeContextMenu();
  }
}

function handleContextMenu(event) {
  const row = event.target.closest('.friend-item');
  if (!row) return;
  event.preventDefault();
  const friend = friendsById.get(row.dataset.friendId);
  if (!friend) return;
  openContextMenuFor(friend, { left: event.clientX, top: event.clientY });
}

function handleKeyboard(event) {
  if (!panelEl || !panelEl.classList.contains('is-open')) return;
  if (event.key === 'Escape') {
    if (contextMenuEl && contextMenuEl.classList.contains('is-open')) {
      closeContextMenu();
      event.stopPropagation();
      event.preventDefault();
      return;
    }
    closePanel();
    buttonEl?.focus();
    event.preventDefault();
    return;
  }
  if (event.key === 'F10' && event.shiftKey) {
    const row = event.target.closest?.('.friend-item');
    if (row) {
      const friend = friendsById.get(row.dataset.friendId);
      if (friend) {
        const rect = row.getBoundingClientRect();
        openContextMenuFor(friend, { left: rect.right, top: rect.top + 12 });
        event.preventDefault();
      }
    }
  } else if (event.key === 'Enter') {
    const row = event.target.closest?.('.friend-item');
    if (!row || event.target !== row) return;
    const friend = friendsById.get(row.dataset.friendId);
    if (friend) {
      const rect = row.getBoundingClientRect();
      openContextMenuFor(friend, { left: rect.right, top: rect.top + 12 });
      event.preventDefault();
    }
  }
}

function handleContextMenuClick(event) {
  if (!contextMenuEl || !contextMenuEl.classList.contains('is-open')) return;
  const btn = event.target.closest('button[data-action]');
  if (!btn) return;
  const friendId = contextMenuFriendId;
  if (!friendId) return;
  const action = btn.dataset.action;
  if (action === 'block') {
    const mode = btn.dataset.mode === 'unblock' ? 'unblock' : 'block';
    handleAction(mode, friendId).catch(() => {});
  } else if (action === 'remove') {
    handleAction('remove', friendId).catch(() => {});
  } else if (action === 'nudge') {
    triggerNudge(friendId);
  } else if (action === 'message') {
    const friend = friendsById.get(friendId);
    if (friend && friend.status === 'ACCEPTED' && friend.canMessage !== false) {
      openDmConversation(friend);
      closePanel();
    }
  }
  closeContextMenu();
}

function openPanel() {
  if (!panelEl) return;
  panelEl.classList.add('is-open');
  panelEl.setAttribute('aria-hidden', 'false');
  buttonEl?.classList.add('is-active');
  buttonEl?.setAttribute('aria-expanded', 'true');
  surfaceEl?.focus();
  startAutoRefresh();
  loadFriends({ silent: true }).catch(() => {});
}

function closePanel() {
  if (!panelEl) return;
  stopAutoRefresh();
  closeContextMenu();
  panelEl.classList.remove('is-open');
  panelEl.setAttribute('aria-hidden', 'true');
  buttonEl?.classList.remove('is-active');
  buttonEl?.setAttribute('aria-expanded', 'false');
}

function togglePanel() {
  if (!panelEl) return;
  const open = panelEl.classList.contains('is-open');
  if (open) closePanel();
  else openPanel();
}

function ensureButtonInTopbar() {
  const actions = document.querySelector('.topbar .actions');
  if (!actions || !buttonEl) return;
  if (!actions.contains(buttonEl)) {
    try {
      const anchor = actions.querySelector('#btnSettings') || actions.querySelector('#btnLogout');
      if (anchor) {
        actions.insertBefore(buttonEl, anchor);
      } else {
        actions.appendChild(buttonEl);
      }
    } catch {}
  }
}

function setupDom() {
  const actions = document.querySelector('.topbar .actions');
  if (!actions) return false;
  if (!buttonEl) {
    buttonEl = document.createElement('button');
    buttonEl.type = 'button';
    buttonEl.className = 'hud-friends-btn';
    buttonEl.id = 'btnFriends';
    buttonEl.setAttribute('aria-haspopup', 'dialog');
    buttonEl.setAttribute('aria-expanded', 'false');
    buttonEl.innerHTML = `
      <span class="hud-friends-btn__icon" aria-hidden="true"></span>
      <span class="hud-friends-btn__label">Friends</span>
      <span class="hud-friends-btn__badge" data-role="badge" hidden>0</span>
    `;
    badgeEl = buttonEl.querySelector('[data-role="badge"]');

    panelEl = document.createElement('div');
    panelEl.className = 'friend-panel';
    panelEl.setAttribute('aria-hidden', 'true');
    panelEl.innerHTML = `
      <div class="friend-panel__overlay" data-close="1"></div>
      <aside class="friend-panel__surface" role="dialog" aria-modal="false" aria-labelledby="friendPanelTitle" tabindex="-1">
        <header class="friend-panel__header">
          <h2 id="friendPanelTitle" class="friend-panel__title">Friend List</h2>
          <button type="button" class="friend-panel__close" data-close="1" aria-label="Fechar">✕</button>
        </header>
        <div class="friend-panel__body">
          <form class="friend-add-form" data-role="add-form">
            <label class="sr-only" for="friendAddInput">Adicionar por nome de usuário</label>
            <input id="friendAddInput" data-role="add-input" class="friend-input" type="text" maxlength="32" placeholder="Nome do jogador" autocomplete="off" />
            <button type="submit" class="friend-add-btn">Adicionar</button>
          </form>
          <p class="friend-feedback" data-role="feedback" aria-live="polite"></p>
          <div class="friend-loader" data-role="loader" hidden>Carregando…</div>
          <div class="friend-sections">
            <section class="friend-section" data-section="pending">
              <header class="friend-section__header">
                <h3>Pendente</h3>
                <span class="friend-section__count" data-count="pending">0</span>
              </header>
              <div class="friend-list" data-list="pending"></div>
            </section>
            <section class="friend-section" data-section="friends">
              <header class="friend-section__header">
                <h3>Amigos</h3>
                <span class="friend-section__count" data-count="friends">0</span>
              </header>
              <div class="friend-list" data-list="friends"></div>
            </section>
            <section class="friend-section" data-section="blocked">
              <header class="friend-section__header">
                <h3>Bloqueados</h3>
                <span class="friend-section__count" data-count="blocked">0</span>
              </header>
              <div class="friend-list" data-list="blocked"></div>
            </section>
          </div>
        </div>
      </aside>
    `;
    document.body.appendChild(panelEl);

    surfaceEl = panelEl.querySelector('.friend-panel__surface');
    addFormEl = panelEl.querySelector('[data-role="add-form"]');
    addInputEl = panelEl.querySelector('[data-role="add-input"]');
    loaderEl = panelEl.querySelector('[data-role="loader"]');
    feedbackEl = panelEl.querySelector('[data-role="feedback"]');
    lists = {
      pending: panelEl.querySelector('[data-list="pending"]'),
      friends: panelEl.querySelector('[data-list="friends"]'),
      blocked: panelEl.querySelector('[data-list="blocked"]'),
    };
    counts = {
      pending: panelEl.querySelector('[data-count="pending"]'),
      friends: panelEl.querySelector('[data-count="friends"]'),
      blocked: panelEl.querySelector('[data-count="blocked"]'),
    };
  }

  ensureButtonInTopbar();

  if (!actionsObserver) {
    actionsObserver = new MutationObserver(() => ensureButtonInTopbar());
    try {
      actionsObserver.observe(actions, { childList: true });
      unsubscribers.push(() => { try { actionsObserver?.disconnect(); } catch {}; actionsObserver = null; });
    } catch {}
  }

  return true;
}

function bindEvents() {
  if (!panelEl || !buttonEl) return;
  buttonEl.addEventListener('click', togglePanel);
  buttonEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      togglePanel();
    }
  });
  panelEl.addEventListener('click', (event) => {
    const close = event.target.closest('[data-close]');
    if (close) {
      closePanel();
      buttonEl?.focus();
      return;
    }
    handlePanelClick(event);
  });
  panelEl.addEventListener('contextmenu', handleContextMenu);
  panelEl.addEventListener('keydown', handleKeyboard, true);
  surfaceEl?.addEventListener('scroll', closeContextMenu, { passive: true });
  if (addFormEl) {
    addFormEl.addEventListener('submit', (event) => {
      event.preventDefault();
      handleAction('request', null, { username: addInputEl?.value || '' }).catch(() => {});
    });
  }
  ensureContextMenu();
  contextMenuEl?.addEventListener('click', handleContextMenuClick);
  document.addEventListener('keydown', handleKeyboard, true);
  document.addEventListener('click', (event) => {
    if (!contextMenuEl || !contextMenuEl.classList.contains('is-open')) return;
    if (!contextMenuEl.contains(event.target)) closeContextMenu();
  });

  const unreadHandler = (event) => {
    const detail = event.detail || {};
    const friendId = detail.friendId ? String(detail.friendId) : null;
    if (!friendId) return;
    const friend = friendsById.get(friendId);
    if (!friend) return;
    friend.unreadCount = Number(detail.unreadCount || 0);
    renderSections();
  };
  window.addEventListener('dm:unread', unreadHandler);
  unsubscribers.push(() => window.removeEventListener('dm:unread', unreadHandler));

  const nudgeEventHandler = (event) => {
    const detail = event.detail || {};
    const friendId = detail.friendId ? String(detail.friendId) : null;
    if (!friendId) return;
    if (detail.direction === 'incoming') {
      highlightFriendRow(friendId);
      showFeedback('Você recebeu um nudge!', 'info');
    } else if (detail.direction === 'outgoing') {
      highlightFriendRow(friendId);
      showFeedback(SUCCESS_MESSAGES.nudge, 'success');
    } else if (detail.direction === 'error') {
      showFeedback(getNudgeErrorMessage(detail.error || 'DM_NUDGE_FAILED'), 'error');
    }
  };
  window.addEventListener('dm:nudge', nudgeEventHandler);
  unsubscribers.push(() => window.removeEventListener('dm:nudge', nudgeEventHandler));
}

function bindPresenceEvents() {
  unsubscribers.push(onMessage('presence:online', (payload) => handlePresenceEvent('online', payload)));
  unsubscribers.push(onMessage('presence:offline', (payload) => handlePresenceEvent('offline', payload)));
  unsubscribers.push(onMessage('presence:update', (payload) => handlePresenceEvent('update', payload)));
}

export function initFriendHud() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (!setupDom()) return;
    bindEvents();
    bindPresenceEvents();
    getSocket();
    await ensureCurrentUser();
    await loadFriends({ silent: true });
  })().catch((err) => {
    console.error('[friends-hud] init failed', err);
  });
  return initPromise;
}

window.addEventListener('beforeunload', () => {
  unsubscribers.forEach((fn) => { try { fn(); } catch {} });
  unsubscribers.length = 0;
});
