// client/js/app.js
// Layout “Tibia”: stacks laterais, chat fixo, viewport central com prioridade.
// Abre Skills/Heroes/Inventory sempre dockado (sem cobrir a área jogável).
import { openSkills, openHeroes, openInventory, openSummonPanel } from './app_panels.js';

/* ---------- HTTP helpers + CSRF ---------- */
let CSRF = null;
async function getCsrf(){
  if (CSRF) return CSRF;
  try{
    const r = await fetch('/api/csrf',{credentials:'include',headers:{'Accept':'application/json'},cache:'no-store'});
    const hdr = r.headers.get('x-csrf-token') || r.headers.get('X-CSRF-Token');
    let body=null; try{ body = await r.json(); }catch{}
    CSRF = hdr || body?.token || body?.csrf || body?.csrfToken || null;
  }catch{}
  return CSRF;
}
async function jget(u){
  const r = await fetch(u,{credentials:'include',headers:{'Accept':'application/json'},cache:'no-store'});
  if (r.status === 401){ location.href='/index.html'; throw new Error('401'); }
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function jpost(u,body){
  const tok = await getCsrf().catch(()=>null);
  const r = await fetch(u,{method:'POST',credentials:'include',
    headers:{'Content-Type':'application/json','Accept':'application/json', ...(tok?{'x-csrf-token':tok}:{})},
    body: JSON.stringify(body||{})});
  if (r.status === 401){ location.href='/index.html'; throw new Error('401'); }
  if (r.status === 403){ CSRF=null; await getCsrf().catch(()=>null); return jpost(u,body); }
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

/* ---------- Refs ---------- */
const canvas  = document.getElementById('scene');
const hud     = document.getElementById('hud');
const leftS   = document.getElementById('leftStack');
const rightS  = document.getElementById('rightStack');
const splitL  = document.getElementById('splitLeft');
const splitR  = document.getElementById('splitRight');
const chatDock= document.getElementById('chatDock');

const btnSkills    = document.getElementById('btnSkills');
const btnHeroes    = document.getElementById('btnHeroes');
const btnInventory = document.getElementById('btnInventory');
const btnSummon    = document.getElementById('btnSummon');
const btnLogout    = document.getElementById('btnLogout');

const summonModal  = document.getElementById('summonModal');
const summonClose  = summonModal?.querySelector('.close');

/* ---------- Cena House ---------- */
let currentScene = null;
async function mountSceneHouse(){
  if(currentScene?.unmount) try{ currentScene.unmount(); }catch{}
  try{
    const mod = await import('/js/scenes/house.js');
    currentScene = await mod.mount({ canvas, hud, params:{ map:'house' } });
    applyViewport();
  }catch(e){
    console.error('Falha ao carregar cena house.js', e);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#0b1220'; ctx.fillRect(0,0,canvas.width,canvas.height);
    hud.textContent='HOUSE — erro ao carregar cena';
  }
}

/* ---------- Viewport: respeita stacks laterais e chat ---------- */
function getInt(v){ return parseInt(getComputedStyle(document.documentElement).getPropertyValue(v))||0; }

function applyViewport(){
  // tamanho disponível do centerStage
  const center = document.getElementById('centerStage');
  const rect = center.getBoundingClientRect();

  // margem interna
  const pad = 16;
  const wCSS = Math.max(400, rect.width  - pad);
  const hCSS = Math.max(240, rect.height - pad);

  const dpr = Math.max(1, Math.min(window.devicePixelRatio||1, 3));
  canvas.style.width  = `${wCSS}px`;
  canvas.style.height = `${hCSS}px`;

  const w = Math.round(wCSS*dpr), h=Math.round(hCSS*dpr);
  if (canvas.width!==w || canvas.height!==h){ canvas.width=w; canvas.height=h; }
  try{ currentScene?.resize?.(wCSS, hCSS, dpr); }catch{}
}
window.addEventListener('resize', applyViewport);

/* ---------- Splitters (arrasta para redimensionar as sidebars) ---------- */
function makeVSplitter(splitEl, side){
  let dragging=false, startX=0, startW=0;

  function onDown(e){
    dragging=true;
    startX = e.clientX;
    const root = document.documentElement;
    startW = parseInt(getComputedStyle(root).getPropertyValue(side==='left'?'--leftW':'--rightW'))|| (side==='left'?300:320);
    document.body.style.userSelect='none';
  }
  function onMove(e){
    if(!dragging) return;
    const dx = e.clientX - startX;
    const newW = Math.max(200, Math.min(520, side==='left' ? (startW + dx) : (startW - dx)));
    document.documentElement.style.setProperty(side==='left'?'--leftW':'--rightW', newW+'px');
    applyViewport();
  }
  function onUp(){ dragging=false; document.body.style.userSelect=''; }

  splitEl.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}
if (splitL) makeVSplitter(splitL,'left');
if (splitR) makeVSplitter(splitR,'right');

/* ---------- Abrir painéis (sempre dockados) ---------- */
btnSkills   ?.addEventListener('click', ()=> openSkills(rightS));
btnHeroes   ?.addEventListener('click', ()=> openHeroes(leftS));
btnInventory?.addEventListener('click', ()=> openInventory(rightS));

/* ---------- Summon como MODAL ---------- */
btnSummon?.addEventListener('click', ()=>{
  summonModal.hidden = false;
});
summonClose?.addEventListener('click', ()=> summonModal.hidden = true);
summonModal?.addEventListener('click', (e)=>{ if(e.target===summonModal) summonModal.hidden = true; });

/* ---------- Logout ---------- */
btnLogout?.addEventListener('click', async ()=>{
  try{ await jpost('/api/auth/logout',{}); }catch{}
  location.href='/index.html';
});

/* ---------- Boot (guard starter + cena) ---------- */
(async function boot(){
  await getCsrf().catch(()=>null);
  try{
    const st = await jget('/api/starter/status');
    if (st?.canSelect){ location.href='/starter.html'; return; }
  }catch{}

  await mountSceneHouse();
  applyViewport();
})();

// Garantir que a inicialização ocorra somente depois do DOM estar pronto
document.addEventListener('DOMContentLoaded', () => {
  try {
    // se existir função global de inicialização (onReady / initGlobalChat) execute-a com segurança
    if (typeof onReady === 'function') onReady();
    if (typeof initGlobalChat === 'function') initGlobalChat();
  } catch (err) {
    console.warn('client init failed:', err);
  }
});

// Função utilitária segura para ligar eventos (use onde precisar ligar listeners)
function safeAddListener(selectorOrNode, event, handler) {
  try {
    const node = typeof selectorOrNode === 'string' ? document.querySelector(selectorOrNode) : selectorOrNode;
    if (!node) return false;
    node.addEventListener(event, handler);
    return true;
  } catch (e) {
    return false;
  }
}

/* --- singleton WS (initGameWS) --- */
(function initGameWS() {
  const G = window;
  if (!G.__GAME_WS_STATE__) G.__GAME_WS_STATE__ = { ws: null };
  const state = G.__GAME_WS_STATE__;

  function onMessage(evt) {
    try {
      const d = JSON.parse(evt.data);
      if (typeof window.handleIncomingChat === 'function') {
        try { window.handleIncomingChat(d); } catch (e) { console.warn('[ws] handleIncomingChat failed', e); }
      } else {
        console.log('[ws] recv', d);
      }
    } catch (e) { console.warn('[ws] bad msg', e && e.message); }
  }

  function closeOld() {
    try {
      if (state.ws) {
        try { state.ws.removeEventListener('message', onMessage); } catch (e) {}
        try { state.ws.close(); } catch (e) {}
      }
    } finally { state.ws = null; }
  }

  function connectGameWS() {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) return state.ws;
    closeOld();
    const url = (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/ws';
    try {
      state.ws = new WebSocket(url);
      window.__GAME_WS__ = state.ws;
    } catch (e) {
      console.warn('[ws] create failed', e && e.message);
      state.ws = null;
      return null;
    }

    state.ws.addEventListener('open', () => console.log('[ws] aberto'));
    state.ws.addEventListener('close', () => console.log('[ws] fechado'));
    state.ws.addEventListener('error', (err) => console.warn('[ws] error', err));
    state.ws.addEventListener('message', onMessage);

    return state.ws;
  }

  function sendChatViaWS(payload) {
    const ws = connectGameWS();
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try { ws.send(JSON.stringify(payload)); } catch (e) { console.warn('[ws] send failed', e && e.message); return false; }
    return true;
  }

  window.connectGameWS = connectGameWS;
  window.sendChatViaWS = sendChatViaWS;
  window.closeGameWS = closeOld;

  if (!state.ws) connectGameWS();
})();

/* --- loadChatHistory com fallback --- */
async function loadChatHistory(limit = 200){
  const tries = [
    `/api/chat/global?limit=${limit}`,
    `/api/chat?scope=global&limit=${limit}`,
    `/api/chat/messages/global?limit=${limit}`
  ];
  for (const url of tries) {
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) { console.warn('[chat] history not found at', url, 'status', res.status); continue; }
      const data = await res.json();
      console.log('[chat] history loaded from', url, data);
      return data;
    } catch (err) {
      console.warn('[chat] history fetch failed', url, err);
    }
  }
  return [];
}

/* --- initGlobalChat / handler central (substitui lógica antiga) --- */
onReady(() => {
  // ...existing code...
  const btnDefault = document.getElementById('btnDefault');
  const btnGlobal  = document.getElementById('btnGlobal');
  const chatBox    = document.getElementById('chatBox');
  const chatInput  = document.getElementById('chatInput');
  const chatSend   = document.getElementById('chatSend');
  const chatForm   = document.getElementById('chatForm');

  let myId = '';
  let myName = 'Você';
  const typingSet = new Set();

  function log(...args){ try{ console.log('[chat]', ...args); }catch{} }
  function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]); }
  function colorFromId(id){ if(!id) return '#fff'; let h=0; for(let i=0;i<id.length;i++) h=(h*31+id.charCodeAt(i))>>>0; return `hsl(${h%360} 90% 60%)`; }

  // appendChatRow — dedupe DESABILITADO (temporário)
  function appendChatRow(msg){
    try { console.log('[chat] appendChatRow called', msg); } catch(e){}
    const d = document.createElement('div');
    d.className='chat-row';
    const time = new Date(msg.ts||Date.now()).toLocaleTimeString();
    const isMe = (msg.fromId && myId && String(msg.fromId) === String(myId)) || (!msg.fromId && msg.fromName && String(msg.fromName) === String(myName));
    d.classList.add(isMe ? 'me' : 'other');
    const displayName = escapeHtml(msg.fromName || (isMe ? myName : 'Anon'));
    d.innerHTML = `<strong class="name">${displayName}</strong>: ${escapeHtml(msg.text)} <span class="muted" style="opacity:.6;font-size:11px;margin-left:8px">(${time})</span>`;
    const nameEl = d.querySelector('.name');
    const color = colorFromId(msg.fromId || msg.fromName);
    if (nameEl) nameEl.style.color = isMe ? '#ffd166' : color;
    if (msg._pendingId) {
      d.dataset.pendingId = msg._pendingId;
      const mark = document.createElement('span');
      mark.className = 'pending';
      mark.textContent = ' ⏳';
      nameEl.insertAdjacentElement('afterend', mark);
    }
    if (msg.id) { d.dataset.msgId = msg.id; /* dedupe DESABILITADO - não adicionando seenMsgIds */ }
    chatBox.appendChild(d);
    chatBox.scrollTop = chatBox.scrollHeight;
  }

  // normalizador e entrypoint (usado pelo singleton WS)
  window.handleIncomingChat = function(d) {
    try {
      log('ws message raw', d);
      if (d.type === 'chat') {
        const msg = {
          id: d.id || d._id || d.messageId || null,
          fromId: d.fromId || d.senderId || d.senderConnId || null,
          fromName: d.fromName || d.from || d.fromUser || d.sender || null,
          text: d.text || d.message || '',
          ts: d.ts || d.timestamp || d.created_at || Date.now(),
          _clientId: d._clientId || d._clientid || null,
          _pendingId: d._pendingId || null
        };
        // se servidor devuelve _clientId para confirmar pending, atualiza elemento pendente
        if (msg._clientId || d._clientId) {
          const pendingEl = chatBox.querySelector(`[data-pending-id="${msg._clientId || d._clientId}"]`);
          if (pendingEl) {
            pendingEl.dataset.msgId = msg.id || '';
            const mark = pendingEl.querySelector('.pending');
            if (mark) { mark.textContent = ' ✓'; mark.style.opacity = '.9'; }
            pendingEl.removeAttribute('data-pending-id');
            return;
          }
        }
        appendChatRow(msg);
      } else if (d.type === 'typing') {
        const name = d.fromName || d.from || null;
        if (!name) return;
        if (d.state) typingSet.add(name); else typingSet.delete(name);
        const names = Array.from(typingSet);
        const typingIndicator = document.getElementById('typingIndicator');
        if (typingIndicator) typingIndicator.textContent = names.length ? (names.join(', ') + (names.length===1 ? ' está digitando…' : ' estão digitindo…')) : '';
      } else if (d.type === 'chat_ack') {
        const clientId = d._clientId || d._clientid || null;
        if (clientId) {
          const p = chatBox.querySelector(`[data-pending-id="${clientId}"]`);
          if (p) { const mark = p.querySelector('.pending'); if (mark) { mark.textContent = ' ✓'; mark.style.opacity = '.9'; } p.removeAttribute('data-pending-id'); p.dataset.msgId = d.id || ''; }
        }
      }
    } catch (e) { log('handleIncomingChat failed', e); }
  };

  // conectar singleton e registrar open handler para auth + history
  const singleton = (typeof window.connectGameWS === 'function') ? window.connectGameWS() : (window.__GAME_WS__ || null);

  async function __chat_onopen(){
    log('ws aberto - auth & history');
    try {
      const raw = await fetch('/api/player/me', { credentials: 'include' }).then(r => r.ok ? r.json() : null);
      const me = (raw && raw.profile) ? raw.profile : raw;
      myId = String((me && (me.id || me.playerId)) || '');
      myName = (me && (me.name || me.username || me.displayName)) || myName;
      const ws = (window.__GAME_WS__ || singleton);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'auth', id: myId, name: myName }));
        log('sent auth handshake', { id: myId, name: myName });
      }
      const hist = await loadChatHistory(200);
      for (const m of hist) {
        appendChatRow({ id: m.id, fromId: m.fromId, fromName: m.fromName||m.from, text: m.text, ts: (new Date(m.created_at)).getTime() });
      }
    } catch (e){ log('auth/history failed', e && e.message); }
  }

  try {
    if (singleton) {
      try { singleton.removeEventListener && singleton.removeEventListener('open', __chat_onopen); } catch(e){}
      singleton.addEventListener && singleton.addEventListener('open', __chat_onopen);
    } else {
      try {
        const ws = new WebSocket((location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/ws');
        window._game_ws = ws;
        ws.addEventListener('open', __chat_onopen);
        ws.addEventListener('message', (evt)=>{ try{ window.handleIncomingChat(JSON.parse(evt.data)); }catch(e){} });
      } catch (e) { log('fallback ws failed', e); }
    }
  } catch (e) { log('attach open failed', e); }

  // enviar chat (usa singleton)
  function sendChat(){
    const text = (chatInput.value||'').trim(); if(!text) return;
    if (btnGlobal.classList.contains('active')) {
      const ws = (window.__GAME_WS__ || singleton);
      if (ws && ws.readyState === WebSocket.OPEN) {
        const localId = (Date.now().toString(36) + Math.random().toString(36).slice(2,8));
        appendChatRow({ fromId: myId, fromName: myName, text, ts: Date.now(), _pendingId: localId, id: null });
        try { ws.send(JSON.stringify({ type:'chat', text: text, scope: 'global', _clientId: localId })); } catch (e) { log('ws send failed', e); alert('Envio falhou'); }
        chatInput.value='';
      } else {
        alert('Conexão real-time indisponível.');
      }
    } else {
      appendChatRow({ fromName: 'Você', text, ts: Date.now() }); chatInput.value='';
    }
  }

  // eventos UI (mantém comportamento)
  btnDefault.addEventListener('click', ()=>{ btnDefault.classList.add('active'); btnGlobal.classList.remove('active'); });
  btnGlobal.addEventListener('click', ()=>{ btnGlobal.classList.add('active'); btnDefault.classList.remove('active'); });

  chatSend.addEventListener('click', sendChat);
  chatForm.addEventListener('submit', (e)=>{ e.preventDefault(); sendChat(); });
  chatInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); sendChat(); } });

  // typing debounce
  let typingTimer = null;
  let lastTypingState = false;
  chatInput.addEventListener('input', () => {
    const isTyping = chatInput.value.trim().length > 0;
    if (isTyping !== lastTypingState) {
      lastTypingState = isTyping;
      const ws = (window.__GAME_WS__ || singleton);
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type:'typing', state: isTyping }));
    }
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      if (lastTypingState) {
        lastTypingState = false;
        const ws = (window.__GAME_WS__ || singleton);
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type:'typing', state: false }));
      }
    }, 2500);
  });

  // load more button (mantém comportamento)
  const loadMoreBtn = document.createElement('button');
  loadMoreBtn.textContent = 'Carregar mensagens anteriores';
  loadMoreBtn.style.display = 'block';
  loadMoreBtn.style.width = '100%';
  loadMoreBtn.style.margin = '6px 0';
  chatBox.parentNode.insertBefore(loadMoreBtn, chatBox);
  loadMoreBtn.addEventListener('click', async () => {
    try {
      const first = chatBox.querySelector('.chat-row');
      const id = first && first.dataset && first.dataset.msgId ? first.dataset.msgId : null;
      const url = '/api/chat/global?limit=50' + (id ? '&before=' + id : '');
      const hist = await loadChatHistory(50); // usa fallback
      if (hist && hist.length) {
        for (const m of hist) {
          const d = document.createElement('div');
          d.className = 'chat-row';
          d.dataset.msgId = m.id;
          const isMe = (m.fromId && myId && String(m.fromId) === String(myId));
          d.classList.add(isMe ? 'me' : 'other');
          d.innerHTML = `<strong class="name" style="color:${colorFromId(m.fromId)}">${escapeHtml(m.fromName||'Anon')}</strong>: ${escapeHtml(m.text)} <span class="muted" style="opacity:.6;font-size:11px;margin-left:8px">(${new Date(m.created_at).toLocaleTimeString()})</span>`;
          chatBox.insertBefore(d, chatBox.firstChild);
        }
      } else {
        loadMoreBtn.disabled = true;
        loadMoreBtn.textContent = 'Sem mais mensagens';
      }
    } catch (e) { console.warn('load more failed', e); }
  });

  // ...existing code...
});

// ...existing code...
