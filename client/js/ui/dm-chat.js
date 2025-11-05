// client/js/ui/dm-chat.js
import { apiGet } from '../api.js';
import { getSocket, onMessage, wsSend } from '../ws/singleton.js';
import { renderRichText } from './emoji.js';
import { getMyPresence } from './presence-controls.js';

// i18n global (já configurado em lang-menu.js)
const i18n = (window && window.i18n) || {
  t(key) { return key; },
};


const DM_SCOPE_PREFIX = 'dm:';

// Agora as conversas podem ser chaveadas por:
// - "123" (friendId)   → conversa com ID conhecido
// - "@nome" (minúsculo) → conversa só por nome, sem amizade
//
// Map é indexado pela "chave do alvo" (targetKey), NÃO só por id.
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

// ========= Estado da UI =========
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

// ========= Helpers de chave/escopo =========
function norm(s){ return String(s||'').trim(); }
function keyFromId(id){ return String(id); }
function keyFromName(name){ return '@' + String(name||'').toLowerCase(); }
function isNameKey(key){ return typeof key === 'string' && key.startsWith('@'); }
function nameFromKey(key){ return isNameKey(key) ? key.slice(1) : ''; }

function scopeForKey(targetKey) {
  return `${DM_SCOPE_PREFIX}${targetKey}`;
}
export function isDmScope(scope) {
  return typeof scope === 'string' && scope.startsWith(DM_SCOPE_PREFIX);
}
function targetKeyFromScope(scope) {
  if (!isDmScope(scope)) return null;
  return scope.slice(DM_SCOPE_PREFIX.length);
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

function nowIso() {
  return new Date().toISOString();
}

// Estou em "Aparecer Offline"?
function isAppearOffline() {
  try {
    if (typeof getMyPresence !== 'function') return false;
    const me = getMyPresence();
    const status = String(me?.status || '').toUpperCase();
    return status === 'APPEAR_OFFLINE';
  } catch {
    return false;
  }
}

// ========= Nudge infra =========
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
function getNudgeMessage(code) {
  if (!code) return nudgeErrorMessages.DM_NUDGE_FAILED;
  return nudgeErrorMessages[code] || `Erro (${code}).`;
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

// ========= UI util =========
function emitUnread(targetKey, unreadCount) {
  const friendId = isNameKey(targetKey) ? '' : String(targetKey);
  window.dispatchEvent(
    new CustomEvent('dm:unread', {
      detail: { friendId, unreadCount: Number(unreadCount) || 0 },
    })
  );
}
function removeElement(el) { try { el?.remove?.(); } catch {} }

function createTabElement(targetKey, friendName) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chat-tab dm-tab';
  btn.dataset.scope = scopeForKey(targetKey);
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

  // slot de presença no topo da DM
  const presenceBox = document.createElement('div');
  presenceBox.className = 'dm-presence';
  presenceBox.setAttribute('aria-live', 'polite');
  presenceBox.style.marginRight = 'auto';
  presenceBox.textContent = 'Offline';
  toolbar.appendChild(presenceBox);

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

  // agora retornamos também o presenceBox
  return { panel, loadMore, list, nudgeButton, nudgeFeedback, presenceBox };
}

function setDmPresence(conv, presence) {
  if (!conv?.presenceBoxEl) return;

  const online = !!presence?.online;
  const st = String(
    presence?.status || (online ? 'ONLINE' : 'OFFLINE')
  ).toUpperCase();
  const act = presence?.activity ? String(presence.activity).toUpperCase() : null;

  const statusLabel =
    st === 'AFK' ? i18n.t('status.afk') :
    st === 'BUSY' ? i18n.t('status.busy') :
    st === 'APPEAR_OFFLINE' ? i18n.t('status.appearOffline') :
    st === 'OFFLINE' ? i18n.t('status.offline') :
    i18n.t('status.online');

  const activityLabel =
    act === 'HOUSE' ? i18n.t('activity.house') :
    act === 'ADVENTURE' ? i18n.t('activity.adventure') :
    act === 'TRAINING' ? i18n.t('activity.training') :
    act === 'DUNGEON' ? i18n.t('activity.dungeon') :
    null;

  let text;
  if (!online) {
    text = i18n.t('status.offline');
  } else if (activityLabel) {
    text = `${statusLabel} — ${i18n.t('presence.playingNow.prefix')} ${activityLabel}`;
  } else {
    text = statusLabel;
  }

  conv.presenceBoxEl.textContent = text;
}



function scrollToBottom(conv) {
  if (!conv || !conv.listEl) return;
  const shouldStick = conv.panelEl.scrollHeight - conv.panelEl.clientHeight - conv.panelEl.scrollTop < 64;
  if (shouldStick) conv.panelEl.scrollTop = conv.panelEl.scrollHeight;
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

function scheduleNudgeAvailabilityCheck(conv) {
  if (!conv) return;
  if (conv.nudgeTimer) { clearTimeout(conv.nudgeTimer); conv.nudgeTimer = null; }

  // se não tem friendId, nudge é indisponível (somente amigos)
  if (!conv.friendId) {
    if (conv.nudgeButtonEl) {
      conv.nudgeButtonEl.disabled = true;
      conv.nudgeButtonEl.title = 'Nudge disponível apenas para amigos.';
    }
    return;
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
  if (message) conv.nudgeFeedbackEl.dataset.tone = tone;
  else conv.nudgeFeedbackEl.removeAttribute('data-tone');

  conv.nudgeFeedbackEl.hidden = !message;
  if (conv.nudgeFeedbackTimer) { clearTimeout(conv.nudgeFeedbackTimer); conv.nudgeFeedbackTimer = null; }
  if (message && duration > 0) {
    conv.nudgeFeedbackTimer = setTimeout(() => {
      conv.nudgeFeedbackEl.hidden = true;
      conv.nudgeFeedbackEl.textContent = '';
      conv.nudgeFeedbackEl.removeAttribute('data-tone');
      conv.nudgeFeedbackTimer = null;
    }, duration);
  }
}

// ========= Render de mensagens =========
function renderMessage(conv, message) {
  if (!conv || !conv.listEl) return;
  const mine = String(message.senderId) === resolveUserId();
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
  if (message.failed) row.classList.add('is-failed'); else row.classList.remove('is-failed');

  const bubble = row.querySelector('.dm-message__bubble');
  const meta = row.querySelector('.dm-message__meta');
  if (bubble) { renderRichText(bubble, message.body || ''); }
  if (meta) {
    const parts = [];
    if (message.createdAt) {
      const dt = new Date(message.createdAt);
      if (!Number.isNaN(dt.getTime())) parts.push(dt.toLocaleTimeString());
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
  if (!prepend) scrollToBottom(conv);

  // ACK de leitura só se a mensagem veio do outro e houver friendId conhecido
  if (emit && String(msg.senderId) !== resolveUserId() && conv.friendId) {
    const latestId = msg.id || null;
    if (latestId) wsSend({ type: 'dm:ack', messageIds: [latestId], friendId: conv.friendId });
  }
}

// ========= Conversa (criar/fechar/upgrade) =========
function createConversation(targetKey, friendName) {
  if (!tabsContainer || !panelsContainer) return null;
  if (conversations.has(targetKey)) return conversations.get(targetKey);

  const label = friendName || (isNameKey(targetKey) ? nameFromKey(targetKey) : `Jogador ${targetKey}`);
  const tabEl = createTabElement(targetKey, label);
  if (tabsAnchorEl && tabsAnchorEl.parentNode === tabsContainer) {
    tabsContainer.insertBefore(tabEl, tabsAnchorEl);
  } else {
    tabsContainer.appendChild(tabEl);
  }

  // DEPOIS
  const scope = scopeForKey(targetKey);
  const {
    panel,
    loadMore,
    list,
    nudgeButton,
    nudgeFeedback,
    presenceBox,        // 👈 adicionar aqui
  } = createPanelElement(scope);
  if (panelsAnchorEl && panelsAnchorEl.parentNode === panelsContainer) {
    panelsContainer.insertBefore(panel, panelsAnchorEl);
  } else {
    panelsContainer.appendChild(panel);
  }

  const conv = {
    // chave principal desta conversa
    key: targetKey,               // "123" ou "@nome"
    friendId: isNameKey(targetKey) ? '' : String(targetKey),
    friendName: label,
    scope,
    tabEl,
    panelEl: panel,
    loadMoreEl: loadMore,
    listEl: list,
    nudgeButtonEl: nudgeButton,
    nudgeFeedbackEl: nudgeFeedback,
    presenceBoxEl: presenceBox,  // 👈 novo
    messages: [],
    nextCursor: null,
    loading: false,
    unreadCount: 0,
    pending: new Map(),
    hasLoadedInitial: false,
    nudgeBusy: false,
    nudgeTimer: null,
    nudgeFeedbackTimer: null,
    nudgeAvailableAt: isNameKey(targetKey) ? 0 : getLocalCooldownUntil(targetKey),
  };

  // presença inicial padrão até chegar algo do servidor / friends HUD
  setDmPresence(conv, { online: false, status: 'OFFLINE', activity: null });

  if (loadMore) {
    loadMore.addEventListener('click', () => {
      if (!conv.loading) fetchHistory(conv, { append: true }).catch(() => {});
    });
  }

  tabEl.addEventListener('click', (event) => {
    if (event.target.closest('.dm-tab-close')) {
      closeConversation(targetKey);
      return;
    }
    // Primeiro avisa o host (se existir), depois ativa localmente.
    try { if (typeof setScopeFn === 'function') setScopeFn(conv.scope); } catch {}
    activateDmScope(conv.scope);
  });


  tabEl.addEventListener('keydown', (event) => {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      closeConversation(targetKey);
    }
  });

  if (nudgeButton) {
    nudgeButton.addEventListener('click', () => {
      if (!conv.friendId) {
        showNudgeFeedback(conv, 'Nudge disponível apenas para amigos.', 'info', 3000);
        scheduleNudgeAvailabilityCheck(conv);
        return;
      }
      if (conv.nudgeBusy) return;
      conv.nudgeBusy = true;
      showNudgeFeedback(conv, 'Enviando…', 'info', 0);
      scheduleNudgeAvailabilityCheck(conv);
      sendNudge(conv.friendId).catch((err) => {
        conv.nudgeBusy = false;
        const code = err?.code || err?.message;
        if (code === 'DM_NUDGE_COOLDOWN') {
          const until = getLocalCooldownUntil(conv.friendId);
          if (until) conv.nudgeAvailableAt = Math.max(conv.nudgeAvailableAt || 0, until);
        }
        showNudgeFeedback(conv, getNudgeMessage(code), 'error', 4_000);
        scheduleNudgeAvailabilityCheck(conv);
      });
    });
  }

  conversations.set(targetKey, conv);
  scheduleNudgeAvailabilityCheck(conv);
  renderBadge(conv);

  return conv;
}

function closeConversation(targetKey) {
  const conv = conversations.get(targetKey);
  if (!conv) return;
  const wasActive = currentScope === conv.scope;
  conversations.delete(targetKey);

  if (conv.nudgeTimer) { clearTimeout(conv.nudgeTimer); conv.nudgeTimer = null; }
  if (conv.nudgeFeedbackTimer) { clearTimeout(conv.nudgeFeedbackTimer); conv.nudgeFeedbackTimer = null; }

  removeElement(conv.tabEl);
  removeElement(conv.panelEl);

  if (wasActive) {
  try { if (typeof setScopeFn === 'function') setScopeFn('default'); } catch {}
  activateDmScope('default');
}
}

// Migra @nome → id (quando o servidor revelar)
function upgradeConversationKey(conv, newFriendId, maybeName) {
  if (!conv || !newFriendId) return conv;
  const oldKey = conv.key;
  const newKey = keyFromId(newFriendId);
  if (oldKey === newKey) return conv;

  // Atualiza mapa
  conversations.delete(oldKey);
  conversations.set(newKey, conv);

  // Atualiza campos da conversa
  conv.key = newKey;
  conv.friendId = newKey;
  if (maybeName) conv.friendName = maybeName;

  // Atualiza escopo/datasets
  const oldScope = conv.scope;
  conv.scope = scopeForKey(newKey);
  if (conv.tabEl) conv.tabEl.dataset.scope = conv.scope;
  if (conv.panelEl) conv.panelEl.dataset.scope = conv.scope;

  // Label da aba
  const label = conv.tabEl?.querySelector('.dm-tab-label');
  if (label) label.textContent = conv.friendName || newKey;

  // Se estava ativa, mantém ativa no novo escopo
  if (currentScope === oldScope) {
    currentScope = conv.scope;
    activateDmScope(conv.scope);
  }

  // Recalcula disponibilidade do nudge e histórico
  scheduleNudgeAvailabilityCheck(conv);
  conv.hasLoadedInitial = false;
  return conv;
}

// ========= Histórico / leitura =========
async function fetchHistory(conv, { append = false } = {}) {
  if (!conv || conv.loading) return;
  if (!conv.friendId) {
    // DM por nome não tem endpoint de histórico
    conv.hasLoadedInitial = true;
    if (conv.loadMoreEl) { conv.loadMoreEl.hidden = true; }
    return;
  }

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
    const code = (err && (err.code || err.message)) || '';
    console.warn('[dm-chat] history failed', code);

    // Tratar como DM efêmera quando não houver amizade aceita:
    // FRIEND_NOT_FOUND (sem relação), DM_NOT_ALLOWED (pendente) ou DM_BLOCKED (bloqueado)
    const codeStr = String(code || '');
    if (
      codeStr.includes('FRIEND_NOT_FOUND') ||
      codeStr.includes('DM_NOT_ALLOWED') ||
      codeStr.includes('DM_BLOCKED')
    ) {
      conv.hasLoadedInitial = true;
      if (conv.loadMoreEl) conv.loadMoreEl.hidden = true;

      // 🔧 Fixa em modo "name" para evitar novas tentativas por id
      conv.friendId = '';
      scheduleNudgeAvailabilityCheck(conv);
    }
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
  if (!conv.hasLoadedInitial) fetchHistory(conv, { append: false }).catch(() => {});
}

function markRead(conv) {
  if (!conv || !conv.friendId) return;

  // Se estou em "Aparecer Offline", NÃO manda dm:read pro servidor.
  // O outro jogador não recebe o status "Lida".
  if (isAppearOffline()) {
    // Mas localmente limpamos o contador de não lidas da aba.
    conv.unreadCount = 0;
    renderBadge(conv);
    emitUnread(conv.key, 0);
    return;
  }

  const latest = conv.messages.length > 0
    ? conv.messages[conv.messages.length - 1]
    : null;

  if (latest?.id) {
    wsSend({
      type: 'dm:read',
      friendId: conv.friendId,
      upToId: latest.id,
    });
  }

  conv.unreadCount = 0;
  renderBadge(conv);
  emitUnread(conv.key, 0);
}


// ========= Procura/aux =========
function findMessage(conv, predicate) {
  if (!conv) return null;
  for (const msg of conv.messages) if (predicate(msg)) return msg;
  return null;
}
function findConvKeyByNameLower(nameLower) {
  const key = '@' + String(nameLower || '').toLowerCase();
  return conversations.has(key) ? key : null;
}

// ========= Envio =========
function handleSend(scope, text) {
  if (!isDmScope(scope)) return false;
  const targetKey = targetKeyFromScope(scope);
  if (!targetKey) return false;

  // Garante conversa
  let conv = conversations.get(targetKey);
  if (!conv) {
    const label = isNameKey(targetKey) ? nameFromKey(targetKey) : targetKey;
    conv = createConversation(targetKey, label);
  }
    // Se a conversa é @nome, garantimos que continue sem friendId (name-mode pegajoso)
  if (isNameKey(targetKey)) {
    conv.friendId = '';
  }
  if (!conv) return false;

  const clientId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  // Decide como enviar: por id ou por nome (modo @nome é sempre por nome)
  const byName = isNameKey(targetKey) || !conv.friendId;
  const payload = { type: 'dm:send', body: text, clientId };
  if (byName) {
    const toName = (conv.friendName && String(conv.friendName).trim()) || nameFromKey(targetKey);
    payload.toName = toName;
  } else {
    payload.to = String(conv.friendId);
  }


  try { wsSend(payload); } catch (e) { /* UI marca falha abaixo via erro */ }

  // Mensagem otimista
  const message = {
    id: null,
    clientId,
    body: text,
    senderId: resolveUserId(),
    recipientId: conv.friendId || null,
    createdAt: nowIso(),
    deliveredAt: null,
    readAt: null,
  };
  conv.pending.set(clientId, message);
  appendMessage(conv, message, { emit: false });
  return true;
}

// ========= Eventos do servidor =========
function handleSendEvent(payload) {
  const message = payload?.message;
  if (!message) return;

  const me = resolveUserId();
  const iAmSender = String(message.senderId) === me;
  const partnerId = iAmSender ? String(message.recipientId) : String(message.senderId);
  const friendName = payload?.friendName || message.friendName || null;
  const mode = payload?.mode || 'friends'; // 👈 vem do servidor

  // Procura conversa por id; se não achar e houver nome, tenta @nome
  let key = conversations.has(partnerId) ? partnerId : null;
  if (!key && friendName) key = findConvKeyByNameLower(friendName);

  // Cria do jeito certo conforme o modo
  let conv = key ? conversations.get(key) : null;
  if (!conv) {
    if (mode === 'name' && friendName) {
      conv = createConversation('@' + String(friendName).toLowerCase(), friendName);
    } else {
      conv = createConversation(partnerId, friendName || partnerId);
    }
  }

  // 🔧 Se for "name", NÃO promover para ID; se for amigos, aí sim promove
  if (mode === 'name') {
    conv.friendId = '';
  } else if (conv && !conv.friendId && partnerId) {
    conv = upgradeConversationKey(conv, partnerId, friendName);
  }

  // Concilia pendente por clientId (envio meu)
  const existing = message.clientId && conv.pending.get(message.clientId);
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

  const me = resolveUserId();
  const fromId = String(message.senderId);
  const friendName = payload?.friendName || message.friendName || null;
  const mode = payload?.mode || 'friends';

  // Tenta por id; se não houver, tenta @nome
  let key = conversations.has(fromId) ? fromId : null;
  if (!key && friendName) key = findConvKeyByNameLower(friendName);

  // Cria do jeito certo
  let conv = key ? conversations.get(key) : null;
  if (!conv) {
    if (mode === 'name' && friendName) {
      conv = createConversation('@' + String(friendName).toLowerCase(), friendName);
    } else {
      conv = createConversation(fromId, friendName || fromId);
    }
  }

  // 🔧 Não promover se for "name"; se for amigos, promove
  if (mode === 'name') {
    conv.friendId = '';
  } else if (conv && !conv.friendId) {
    conv = upgradeConversationKey(conv, fromId, friendName);
  }

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
  const isActive = currentScope === conv.scope;

  if (!isActive) {
    conv.unreadCount = unreadFromServer || conv.unreadCount + 1;
    renderBadge(conv);
    emitUnread(conv.key, conv.unreadCount);
  } else {
    markRead(conv);
  }
}

function handleAckEvent(payload) {
  const friendId = payload?.friendId ? String(payload.friendId) : null;
  if (!friendId) return;

  // Acha conversa (pode ter sido @nome → já atualizamos em send/recv)
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
  const me = resolveUserId();
  if (!readerId) return;

  if (readerId === me) {
    if (friendId && conversations.has(friendId)) {
      const conv = conversations.get(friendId);
      conv.unreadCount = Number(payload?.unreadCount || 0);
      renderBadge(conv);
      emitUnread(conv.key, conv.unreadCount);
    }
    return;
  }

  const conv = conversations.get(readerId);
  if (!conv) return;
  for (const msg of conv.messages) {
    if (String(msg.senderId) === me) {
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
      window.dispatchEvent(new CustomEvent('dm:nudge', {
        detail: { friendId, direction: 'error', error: code, ts: Date.now() },
      }));
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
  const me = resolveUserId();
  const fromId = payload?.fromId ? String(payload.fromId) : null;
  const friendId = payload?.friendId ? String(payload.friendId) : null;
  if (!fromId || !friendId) return;

  const ts = Number(payload?.ts) || Date.now();
  const isSender = fromId === me;
  const partnerId = isSender ? friendId : fromId;

  const isUnavailable = payload?.mode === 'unavailable';
  const isSilent = !!payload?.silent;

  let conv = conversations.get(partnerId) || createConversation(partnerId, partnerId);

  if (isSender) {
    const result = settlePendingNudge(partnerId, true);
    const cooldownUntil =
      result?.cooldownUntil ||
      getLocalCooldownUntil(partnerId) ||
      (Date.now() + NUDGE_COOLDOWN_MS);
    if (conv) {
      conv.nudgeAvailableAt = Math.max(conv.nudgeAvailableAt || 0, cooldownUntil);
    }
  } else {
    // decide se toca ou não o som
    let shouldSilent = isSilent;
    try {
      const mine = typeof getMyPresence === 'function' ? getMyPresence() : null;
      if (mine && String(mine.status || '').toUpperCase() === 'BUSY') {
        shouldSilent = true;
      }
    } catch {}
    if (!shouldSilent) {
      playNudgeSound();
    }
  }

  if (conv) {
    conv.nudgeBusy = false;

    let message;
    let tone = 'info';
    let duration = 4000;

    if (isSender && isUnavailable) {
      message =
        (i18n && typeof i18n.t === 'function'
          ? i18n.t('dm.nudge.unavailable')
          : null) || 'Destinatário indisponível.';
      tone = 'warn';
      duration = 3000;
    } else {
      if (isSender) {
        message =
          (i18n && typeof i18n.t === 'function'
            ? i18n.t('dm.nudge.sent')
            : null) || 'Nudge enviado!';
        tone = 'success';
        duration = 2000;
      } else {
        message = `${conv.friendName || 'Seu amigo'} cutucou você!`;
        tone = 'info';
        duration = 4000;
      }
    }

    showNudgeFeedback(conv, message, tone, duration);
    scheduleNudgeAvailabilityCheck(conv);

    // anima (classe CSS)
    const classes = isSender ? ['is-nudged'] : ['is-nudged', 'is-nudged--incoming'];
    [conv.tabEl, conv.panelEl].forEach((el) => {
      try {
        el.classList.add(...classes);
        setTimeout(() => el.classList.remove(...classes), 1200);
      } catch {}
    });
  }

  window.dispatchEvent(
    new CustomEvent('dm:nudge', {
      detail: { friendId: partnerId, direction: isSender ? 'outgoing' : 'incoming', ts },
    }),
  );
}


// ========= API público (export) =========
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
  if (typeof focusInputFn === 'function') focusInputFn();
}

export function openConversation(friend) {
  // Aceita { friendId, friendName } OU { id, name } OU valor direto (id)
  const id = friend && (friend.friendId ?? friend.id);
  const name = friend && (friend.friendName ?? friend.name);
  const targetKey =
    id != null && String(id) !== '' ? keyFromId(id) : keyFromName(name || '');
  if (!targetKey) return;

  const label = name || (isNameKey(targetKey) ? nameFromKey(targetKey) : targetKey);
  const conv = conversations.get(targetKey) || createConversation(targetKey, label);
  if (!conv) return;

  // se veio do Friends HUD, já aplica presença inicial
  if (friend) {
    setDmPresence(conv, {
      online: !!friend.online,
      status: friend.presenceStatus || (friend.online ? 'ONLINE' : 'OFFLINE'),
      activity: friend.presenceActivity || null,
    });
  }

  // Primeiro tenta propagar pro host, depois garante local
  try {
    if (typeof setScopeFn === 'function') setScopeFn(conv.scope);
  } catch {}
  activateDmScope(conv.scope);
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

  try { const initialScope = typeof getScopeFn === 'function' ? getScopeFn() : null; if (initialScope) currentScope = initialScope; } catch {}

  if (input && typeof input.closest === 'function') formEl = input.closest('form');
  if (!formEl && input && input.form) formEl = input.form;

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

  // atualiza presença no topo da DM quando o servidor mandar presence:update
  onMessage('presence:update', (payload) => {
    if (!payload?.userId || !payload?.presence) return;
    const userId = String(payload.userId);
    conversations.forEach((conv) => {
      if (conv?.friendId && String(conv.friendId) === userId) {
        setDmPresence(conv, payload.presence);
      }
    });
  });

  const socket = getSocket();
  if (socket) {
    socket.addEventListener('open', () => {
      conversations.forEach((conv) => {
        conv.hasLoadedInitial = false;
        fetchHistory(conv, { append: false })
          .then(() => {
            if (conv.scope === currentScope) markRead(conv);
          })
          .catch(() => {});
      });
    });
  }
}


// Permite que outros módulos abram a DM com:
// window.dispatchEvent(new CustomEvent('dm:open', { detail: { friendId, friendName } }))
try {
  window.addEventListener('dm:open', (ev) => {
    const d = ev?.detail || {};
    openConversation(d.friend || d);
  });
} catch {}


export function handleDmSubmit(scope, text) {
  return handleSend(scope, text);
}

// Compat: quando o chamador só tem friendId
export function getDmScopeForFriend(friendId) {
  return scopeForKey(keyFromId(friendId));
}

export function syncUnreadFromServer(friendId, unreadCount, opts = {}) {
  const key = keyFromId(friendId);
  const conv = conversations.get(key);
  if (conv) {
    conv.unreadCount = Number(unreadCount || 0);
    renderBadge(conv);
  }
  if (!opts?.silent) emitUnread(key, unreadCount);
}

export function syncFriendData(friend) {
  const friendId = String(friend?.friendId || friend?.id || '');
  if (!friendId) return;
  const key = keyFromId(friendId);
  const conv = conversations.get(key);
  if (!conv) return;
  const name = friend?.friendName || friend?.name || friendId;
  conv.friendName = name;
  const label = conv.tabEl?.querySelector('.dm-tab-label');
  if (label) label.textContent = name;
}

export function sendNudge(friendId) {
  const id = String(friendId || '').trim();
  if (!id) return Promise.reject(createError('FRIEND_NOT_FOUND'));

  const now = Date.now();
  const cooldownUntil = getLocalCooldownUntil(id);
  if (cooldownUntil && now < cooldownUntil) return Promise.reject(createError('DM_NUDGE_COOLDOWN'));
  if (pendingNudges.has(id)) return pendingNudges.get(id).promise;

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
