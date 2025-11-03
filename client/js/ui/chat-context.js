// client/js/ui/chat-context.js
// Context menu no histórico do chat (Default/Global/Log).
// Ações: Copiar nome, Enviar DM, Adicionar amigo, Bloquear.
// v3: evita ações em si mesmo, usa apiGet/apiPost (CSRF), e posiciona o menu dentro do #chatDock.

import { apiGet, apiPost } from '../api.js';

const SCOPE_BOX_IDS = ['chatBox','chatLogBox']; // default + log
let state = { name: null, id: null, anchorEl: null };

const $ = (sel, root=document) => root.querySelector(sel);

function withinChat(el) {
  return !!el && SCOPE_BOX_IDS.some(id => document.getElementById(id)?.contains(el));
}
function findRowEl(target) {
  let el = target;
  for (let i=0;i<5 && el;i++) {
    if (el.dataset && (el.dataset.fromName || el.dataset.fromId || el.dataset.from)) return el;
    el = el.parentElement;
  }
  el = target.closest?.('#chatBox > * , #chatLogBox > *') || null;
  return el || target;
}
function extractNameAndId(el) {
  const dataName = el?.dataset?.fromName || el?.dataset?.author || el?.dataset?.from || null;
  const dataId   = el?.dataset?.fromId   || null;
  if (dataName || dataId) return { name: dataName, id: dataId };

  const text = String(el?.textContent || '').trim();
  const m = text.match(/^(?:\[[^\]]+\]\s*)?([^:]{1,40}?)\s*:\s/);
  if (m && m[1]) return { name: m[1].trim(), id: null };
  return { name: null, id: null };
}

function getMe() {
  const me = window._chat_me || {};
  return {
    id: String(me.id || ''),
    name: String(me.name || '').toLocaleLowerCase()
  };
}
function isSelf(targetId, targetName) {
  const me = getMe();
  const byId = !!me.id && !!targetId && String(targetId) === String(me.id);
  const byName = !!me.name && !!targetName && String(targetName).toLocaleLowerCase() === me.name;
  return !!(byId || byName);
}

async function getFriends() {
  try {
    const data = await apiGet('/api/friends');
    return Array.isArray(data) ? data : (Array.isArray(data?.friends) ? data.friends : []);
  } catch { return []; }
}
function openDmById(friendId, name) {
  const detail = { friendId, friend: { friendId, friendName: name }};
  window.dispatchEvent(new CustomEvent('dm:open', { detail }));
}
async function resolveFriendIdByName(name) {
  const friends = await getFriends();
  const n = String(name || '').toLocaleLowerCase();
  const found = friends.find?.(f => String(f.friendName || f.name || '').toLocaleLowerCase() === n);
  return found ? String(found.friendId || found.id) : null;
}
async function addFriendByName(name) {
  return apiPost('/api/friends/request', { username: String(name || '').trim() });
}
async function blockFriendById(friendId) {
  return apiPost(`/api/friends/${encodeURIComponent(friendId)}/block`, {});
}

/* ======= UI ======= */
function ensureMenu() {
  let el = document.getElementById('chatCtxMenu');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'chatCtxMenu';
  el.setAttribute('role','menu');
  el.innerHTML = `
    <div class="ctx-title" aria-live="polite"></div>
    <button type="button" data-act="copy"  title="Copiar o nome">Copiar nome</button>
    <button type="button" data-act="dm"    title="Abrir conversa privada">Enviar mensagem</button>
    <button type="button" data-act="add"   title="Enviar solicitação de amizade">Adicionar amigo</button>
    <button type="button" data-act="block" title="Bloquear jogador">Bloquear</button>
  `;
  (document.getElementById('chatDock') || document.body).appendChild(el);
  el.addEventListener('click', onMenuClick);
  return el;
}

function positionMenuFixed(el, clientX, clientY) {
  // ancora dentro do chatDock; se não existir, dentro da viewport
  const dock = document.getElementById('chatDock');
  const bounds = dock ? dock.getBoundingClientRect() : {left:8, top:8, right: window.innerWidth-8, bottom: window.innerHeight-8};
  el.hidden = false; // precisa estar visível para medir
  const r = el.getBoundingClientRect();
  const pad = 8;

  let x = clientX + 6;
  let y = clientY + 6;

  // Se estourar para a direita, cola no limite
  if (x + r.width > bounds.right - pad) x = bounds.right - pad - r.width;
  // Se estourar para baixo, abre para cima
  if (y + r.height > bounds.bottom - pad) y = clientY - r.height - 6;
  // Clamps finais
  x = Math.max(bounds.left + pad, Math.min(x, bounds.right - pad - r.width));
  y = Math.max(bounds.top  + pad, Math.min(y, bounds.bottom - pad - r.height));

  el.style.left = `${Math.round(x)}px`;
  el.style.top  = `${Math.round(y)}px`;
}

function showMenu(clientX, clientY, name, id, anchorEl) {
  state = { name, id, anchorEl };
  const el = ensureMenu();
  el.querySelector('.ctx-title').textContent = name ? String(name) : '(desconhecido)';

  // disponibilidade
  const self = isSelf(id, name);
  const btnDM    = el.querySelector('[data-act="dm"]');
  const btnAdd   = el.querySelector('[data-act="add"]');
  const btnBlock = el.querySelector('[data-act="block"]');

  [btnDM, btnAdd, btnBlock].forEach(b => { if (b) b.disabled = !!self; });
  if (self) {
    btnDM?.setAttribute('title','Você não pode abrir DM consigo mesmo.');
    btnAdd?.setAttribute('title','Você não pode se adicionar.');
    btnBlock?.setAttribute('title','Você não pode se bloquear.');
  }

  positionMenuFixed(el, clientX, clientY);

  // fechar
  const closer = () => hideMenu();
  window.addEventListener('click', closer, { capture:true, once:true });
  window.addEventListener('keydown', (e)=>{ if (e.key==='Escape') hideMenu(); }, { once:true });
  window.addEventListener('scroll', closer, { once:true });
  window.addEventListener('resize', closer, { once:true });
}
function hideMenu() {
  const el = document.getElementById('chatCtxMenu');
  if (el) el.hidden = true;
}

async function onMenuClick(e) {
  const act = e.target?.dataset?.act;
  if (!act) return;
  const name = state.name;
  let   id   = state.id;

  // trava ações em si mesmo (evita FRIEND_SELF_NOT_ALLOWED do backend)
  if (isSelf(id, name) && act !== 'copy') {
    hideMenu();
    return;
  }

  try {
    if (act === 'copy') {
      await navigator.clipboard.writeText(String(name||''));
    } else if (act === 'dm') {
      if (!id) id = await resolveFriendIdByName(name);
      if (id) openDmById(id, name);
      else alert('Vocês ainda não são amigos. Envie um pedido antes.');
    } else if (act === 'add') {
      await addFriendByName(name);
      alert('Solicitação de amizade enviada.');
    } else if (act === 'block') {
      if (!id) id = await resolveFriendIdByName(name);
      if (!id) throw new Error('Só é possível bloquear amigos existentes.');
      await blockFriendById(id);
      alert('Jogador bloqueado.');
    }
  } catch (err) {
    const msg = typeof err?.message === 'string' ? err.message : JSON.stringify(err);
    alert(msg);
  } finally {
    hideMenu();
  }
}

/* ======= Handler global ======= */
document.addEventListener('contextmenu', (e) => {
  if (!withinChat(e.target)) return; // fora do chat → deixa menu do browser normal
  const row = findRowEl(e.target);
  const { name, id } = extractNameAndId(row);
  if (!name) return;                 // sem nome conhecido → não intercepta
  e.preventDefault();                // bloqueia menu do browser
  showMenu(e.clientX, e.clientY, name, id, row);
});
