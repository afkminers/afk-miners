// client/js/ui/chat-context.js
// Context menu do chat (Default/Global/Log).
// Agora permite abrir DM POR NOME (sem amizade). Se houver friendId, usa id; se não houver, usa friendName.
// Mantém Add/Block via API. Mantém posicionamento dentro do #chatDock.

import { apiGet, apiPost } from '../api.js';

const SCOPE_BOX_SEL = '#chatBox, #chatLogBox';
let state = { name: null, id: null };

const $ = (sel, root=document) => root.querySelector(sel);
function getDock(){ return document.getElementById('chatDock'); }

/* ---------- parse da linha ---------- */
function rowFromTarget(target){
  let el = target;
  for (let i=0; i<6 && el; i++){
    if (el.dataset && (el.dataset.fromName || el.dataset.fromId || el.dataset.from)) return el;
    el = el.parentElement;
  }
  return target.closest?.('#chatBox > * , #chatLogBox > *') || null;
}
function extractNameAndId(el){
  const dataName = el?.dataset?.fromName || el?.dataset?.author || el?.dataset?.from || null;
  const dataId   = el?.dataset?.fromId   || null;
  if (dataName || dataId) return { name: dataName, id: dataId };

  const text = String(el?.textContent || '').trim();
  const m = text.match(/^(?:\[[^\]]+\]\s*)?([^:]{1,40}?)\s*:\s/);
  if (m && m[1]) return { name: m[1].trim(), id: null };
  return { name: null, id: null };
}

/* ---------- me/self ---------- */
function getMe(){
  const me = window._chat_me || {};
  return { id: String(me.id || ''), name: String(me.name || '').toLowerCase() };
}
function isSelf(targetId, targetName){
  const me = getMe();
  const byId   = !!me.id && !!targetId && String(targetId) === me.id;
  const byName = !!me.name && !!targetName && String(targetName).toLowerCase() === me.name;
  return !!(byId || byName);
}

/* ---------- friends helpers ---------- */
async function getFriends(){
  try{
    const data = await apiGet('/api/friends');
    const arr = Array.isArray(data) ? data : (Array.isArray(data?.friends) ? data.friends : []);
    return arr.map(x => {
      const statusStr = String(x.status || x.state || '').toLowerCase();
      const accepted =
        x.accepted === true ||
        x.isFriend === true ||
        /^(accepted|friends?|ok|active)$/.test(statusStr);
      const blocked =
        x.blocked === true ||
        x.isBlocked === true ||
        /blocked/.test(statusStr);
      return {
        id: String(x.friendId ?? x.id ?? x.userId ?? x.uid ?? ''),
        name: String(x.friendName ?? x.name ?? x.username ?? '').trim(),
        accepted, blocked, status: statusStr
      };
    });
  }catch{ return []; }
}
async function addFriendByName(name){
  return apiPost('/api/friends/request', { username: String(name||'').trim() });
}
async function blockFriendById(friendId){
  return apiPost(`/api/friends/${encodeURIComponent(friendId)}/block`, {});
}

/* ---------- abrir DM ---------- */
// Preferimos abrir com friendId; se não tiver, abrimos com friendName (DM efêmera por nome).
async function openDmByTarget({ id, name }){
  // Consulta lista de amigos e só usa friendId se houver amizade aceita
  const friends = await getFriends();
  const found = friends.find(f =>
    (id && f.id === String(id)) ||
    (name && f.name && f.name.toLowerCase() === String(name).toLowerCase())
  );

  const isAccepted = !!found?.accepted;

  const friend = {};
  if (isAccepted) {
    friend.friendId   = String(found.id);
    friend.friendName = found.name || name || '';
  } else {
    // Força DM efêmera por nome: sem id ⇒ sem histórico ⇒ backend aceita via toName
    friend.friendName = String(name || '');
  }

  window.dispatchEvent(new CustomEvent('dm:open', { detail: { friend } }));
}


/* ---------- UI (menu) ---------- */
function ensureMenu(){
  let el = document.getElementById('chatCtxMenu');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'chatCtxMenu';
  el.setAttribute('role','menu');
  el.innerHTML = `
    <div class="ctx-title" aria-live="polite"></div>
    <button type="button" data-act="copy">Copiar nome</button>
    <button type="button" data-act="dm">Enviar mensagem</button>
    <button type="button" data-act="add">Adicionar amigo</button>
    <button type="button" data-act="block">Bloquear</button>
  `;
    // usar sempre o body quando for position: fixed (evita clipping/offsets)
  document.body.appendChild(el);
  el.addEventListener('click', onMenuClick);
  return el;
}
function positionMenu(el, clientX, clientY){
  // limitar pelo viewport para position: fixed
  const bounds = { left: 8, top: 8, right: window.innerWidth - 8, bottom: window.innerHeight - 8 };
  el.hidden = false;
  const r = el.getBoundingClientRect();
  const pad = 8;

  let x = clientX + 6;
  let y = clientY + 6;

  if (x + r.width  > bounds.right  - pad) x = bounds.right  - pad - r.width;
  if (y + r.height > bounds.bottom - pad) y = clientY - r.height - 6;

  x = Math.max(bounds.left + pad, Math.min(x, bounds.right  - pad - r.width));
  y = Math.max(bounds.top  + pad, Math.min(y, bounds.bottom - pad - r.height));

  el.style.position = 'fixed';
  el.style.left = `${Math.round(x)}px`;
  el.style.top  = `${Math.round(y)}px`;
}

function showMenu(clientX, clientY, name, id){
  const el = ensureMenu();
  state = { name, id };
  el.querySelector('.ctx-title').textContent = name || '(desconhecido)';

  const self = isSelf(id, name);
  ['dm','add','block'].forEach(act => {
    const btn = el.querySelector(`[data-act="${act}"]`);
    if (btn) btn.disabled = self;
  });

  positionMenu(el, clientX, clientY);

  const closer = () => hideMenu();
  window.addEventListener('click', closer, { capture:true, once:true });
  window.addEventListener('keydown', (e)=>{ if (e.key==='Escape') hideMenu(); }, { once:true });
  window.addEventListener('scroll', closer, { once:true });
  window.addEventListener('resize', closer, { once:true });
}
function hideMenu(){
  const el = document.getElementById('chatCtxMenu');
  if (el) el.hidden = true;
}

/* ---------- Toast retrô (sem alert) ---------- */
function showToast(msg){
  try{
    if (window.Chat?.toast) return window.Chat.toast(String(msg));
  }catch{}
  // fallback minimalista
  console.log('[toast]', msg);
}

/* ---------- ações ---------- */
async function onMenuClick(e){
  const act = e.target?.dataset?.act;
  if (!act) return;
  const { name, id } = state;
  if (isSelf(id, name) && act !== 'copy'){ hideMenu(); return; }

  try{
    if (act === 'copy'){
      await navigator.clipboard.writeText(String(name||''));
      showToast('Nome copiado.');
    } else if (act === 'dm'){
      await openDmByTarget({ id, name });
    } else if (act === 'add'){
      await addFriendByName(name);
      showToast('Solicitação de amizade enviada.');
    } else if (act === 'block'){
      if (id) {
        await blockFriendById(id);
        showToast('Jogador bloqueado.');
      } else {
        showToast('Para bloquear, adicione e identifique o jogador primeiro.');
      }
    }
  }catch(err){
    const msg = typeof err?.message === 'string' ? err.message : JSON.stringify(err);
    showToast(msg);
  }finally{
    hideMenu();
  }
}

/* ---------- binding ---------- */
const container = getDock() || document;
container.addEventListener('contextmenu', (e) => {
  const scope = e.target.closest?.(SCOPE_BOX_SEL);
  if (!scope) return;
  const row = rowFromTarget(e.target);
  const { name, id } = extractNameAndId(row);
  if (!name) return;
  e.preventDefault();
  showMenu(e.clientX, e.clientY, name, id);
}, true);
