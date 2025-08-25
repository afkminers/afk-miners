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

// Chat global — init seguro e tolerante (connect WS, load history, bind UI)
(function initGlobalChat() {
  // aguarda DOM por segurança
  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  onReady(() => {
    const btnDefault = document.getElementById('btnDefault');
    const btnGlobal  = document.getElementById('btnGlobal');
    const chatBox    = document.getElementById('chatBox');
    const chatInput  = document.getElementById('chatInput');
    const chatSend   = document.getElementById('chatSend');
    const chatForm   = document.getElementById('chatForm');

    if (!chatBox || !chatInput || !chatSend || !btnDefault || !btnGlobal || !chatForm) {
      console.warn('[chat] elementos do DOM ausentes — verifique client/app.html');
      return;
    }

    let ws = null;
    let myId = '';
    let myName = 'Você';
    // seen message ids to avoid duplicates from multiple sockets / server echoes
    const seenMsgIds = new Set();

    function log(...args){ try{ console.log('[chat]', ...args); }catch{} }

    function connectWS() {
      try {
        // close previous socket if exists (avoid double connections)
        try { if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) ws.close(); } catch {}
        ws = new WebSocket((location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/ws');
      } catch (e) {
        log('erro ao criar WebSocket', e);
        ws = null; return;
      }

      try { window._game_ws = ws; } catch (e) {}

      ws.addEventListener('open', async () => {
        log('ws aberto');
        try { btnGlobal.classList.add('active'); btnDefault.classList.remove('active'); } catch(e){}

        // handshake auth — extrae /api/player/me (note: endpoint retorna { profile: {...} })
        try {
          const raw = await fetch('/api/player/me', { credentials: 'include' }).then(r => r.ok ? r.json() : null);
          const me = (raw && raw.profile) ? raw.profile : raw;
          myId = String((me && (me.id || me.playerId)) || '');
          myName = (me && (me.name || me.username || me.displayName)) || myName;
          // expose for debugging
          try { window._chat_me = { id: myId, name: myName }; } catch (e) {}
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'auth', id: myId, name: myName }));
            log('sent auth handshake', { id: myId, name: myName });
          }
          // load history
          const hist = await fetch('/api/chat/global?limit=200', { credentials: 'include' }).then(r => r.ok ? r.json() : []);
          for (const m of hist) appendChatRow({ fromId: m.fromId, fromName: m.fromName||m.from, text: m.text, ts: (new Date(m.created_at)).getTime() });
        } catch (e) { log('auth/history failed', e && e.message); }
      });

      ws.addEventListener('message', (evt) => {
        try {
          const d = JSON.parse(evt.data);
          log('ws message', d);
          if (d.type === 'chat' && d.scope === 'global') {
            // dedupe by server id (if present)
            if (d.id) {
              if (seenMsgIds.has(String(d.id))) return;
              seenMsgIds.add(String(d.id));
            }
            appendChatRow({ id: d.id, fromId: d.fromId, fromName: d.fromName, text: d.text, ts: d.ts || Date.now(), _clientId: d._clientId || null });
          }
        } catch (e) { log('bad ws message', e); }
      });

      ws.addEventListener('close', () => log('ws fechado'));
      ws.addEventListener('error', (e) => log('ws erro', e && e.message));
    }

    const typingIndicator = document.createElement('div');
    typingIndicator.id = 'typingIndicator';
    typingIndicator.style.padding = '6px 8px';
    typingIndicator.style.fontSize = '13px';
    typingIndicator.style.opacity = '.9';
    chatBox.parentNode.insertBefore(typingIndicator, chatBox.nextSibling);

    let typingSet = new Set();
    function updateTypingUI() {
      if (!typingIndicator) return;
      const names = Array.from(typingSet);
      typingIndicator.textContent = names.length ? (names.join(', ') + (names.length===1 ? ' está digitando…' : ' estão digitindo…')) : '';
    }

    // deterministic color from id (HSL)
    function colorFromId(id) {
      if (!id) return '#ffffff';
      let h = 0;
      for (let i=0;i<id.length;i++) h = (h*31 + id.charCodeAt(i)) >>> 0;
      const hue = h % 360;
      return `hsl(${hue} 90% 60%)`;
    }

    // store pending messages until ack
    const pendingMap = new Map();

    function appendChatRow(msg){
      // dedupe: se já existe uma mensagem com o mesmo id ou pendingId, não re-adicionar
      try {
        if (msg.id) {
          if (seenMsgIds.has(String(msg.id))) return;
          // also check DOM just in case
          if (chatBox.querySelector(`[data-msg-id="${msg.id}"]`)) { seenMsgIds.add(String(msg.id)); return; }
        } else if (msg._pendingId) {
          if (chatBox.querySelector(`[data-pending-id="${msg._pendingId}"]`)) return;
        } else {
          const last = chatBox.lastElementChild;
          if (last) {
            const lastText = last.textContent || '';
            const lastName = (last.querySelector && last.querySelector('.name') && last.querySelector('.name').textContent) || '';
            if (lastName === (msg.fromName || '') && lastText.includes((msg.text||'').trim())) return;
          }
        }
      } catch (e) {}

      const d = document.createElement('div');
      d.className='chat-row';
      const time = new Date(msg.ts||Date.now()).toLocaleTimeString();
      const isMe = (msg.fromId && myId && String(msg.fromId) === String(myId)) || (!msg.fromId && msg.fromName && myName && String(msg.fromName) === String(myName));
      d.classList.add(isMe ? 'me' : 'other');
      const displayName = escapeHtml(msg.fromName || (isMe ? myName : 'Anon'));
      d.innerHTML = `<strong class="name">${displayName}</strong>: ${escapeHtml(msg.text)} <span class="muted" style="opacity:.6;font-size:11px;margin-left:8px">(${time})</span>`;
      // apply color
      const nameEl = d.querySelector('.name');
      const color = colorFromId(msg.fromId || msg.fromName);
      if (nameEl) nameEl.style.color = isMe ? '#ffd166' : color;
      // if pending (no id yet) create pending marker
      if (msg._pendingId) {
        d.dataset.pendingId = msg._pendingId;
        const mark = document.createElement('span');
        mark.className = 'pending';
        mark.textContent = ' ⏳';
        nameEl.insertAdjacentElement('afterend', mark);
      }
      if (msg.id) { d.dataset.msgId = msg.id; seenMsgIds.add(String(msg.id)); }
      chatBox.appendChild(d);
      chatBox.scrollTop = chatBox.scrollHeight;
    }

    // sendChat: attach client side id and mark pending
    async function sendChat(){
      const text = (chatInput.value||'').trim(); if(!text) return;
      if (btnGlobal.classList.contains('active')) {
        if (ws && ws.readyState === WebSocket.OPEN) {
          const localId = (Date.now().toString(36) + Math.random().toString(36).slice(2,8));
          // render as pending using clientId
          appendChatRow({ fromId: myId, fromName: myName, text, ts: Date.now(), _pendingId: localId, id: null });
          pendingMap.set(localId, { text, ts: Date.now() });
          // log ao enviar chat
          console.log('[client] sending chat', { text, scope: 'global', _clientId: localId });
          // envio correto com variáveis definidas
          ws.send(JSON.stringify({ type:'chat', text: text, scope: 'global', _clientId: localId }));
          log('sent chat', text);
          chatInput.value='';
        } else {
          alert('Conexão real-time indisponível.');
        }
      } else {
        appendChatRow({ fromName: 'Você', text, ts: Date.now() }); chatInput.value='';
      }
    }

    btnDefault.addEventListener('click', ()=>{ btnDefault.classList.add('active'); btnGlobal.classList.remove('active'); });
    btnGlobal.addEventListener('click', ()=>{ btnGlobal.classList.add('active'); btnDefault.classList.remove('active'); });

    chatSend.addEventListener('click', sendChat);
    chatForm.addEventListener('submit', (e)=>{ e.preventDefault(); sendChat(); });
    chatInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); sendChat(); } });

    // iniciar conexão WebSocket (garante ws não ser null antes de registrar handlers adicionais)
    try { connectWS(); } catch (e) { console.warn('connectWS failed', e); }

    // handle incoming messages and acks and typing
    ws.addEventListener('message', (evt) => {
      try {
        const d = JSON.parse(evt.data);
        log('ws message', d);
        if (d.type === 'chat' && d.scope === 'global') {
          // if server echoed _clientId, try to match and mark pending -> delivered
          if (d._clientId) {
            const pendingEl = chatBox.querySelector(`[data-pending-id="${d._clientId}"]`);
            if (pendingEl) {
              // replace pending entry with authoritative message (set data-msgid)
              pendingEl.dataset.msgId = d.id;
              const mark = pendingEl.querySelector('.pending');
              if (mark) { mark.textContent = ' ✓'; mark.style.opacity = '.9'; }
              pendingEl.removeAttribute('data-pending-id');
              // update content to server text (filtered)
              const textNode = pendingEl.querySelector('.muted') ? pendingEl.querySelector('.muted').previousSibling : null;
            } else {
              // no pending match — append normalmente
              appendChatRow({ id: d.id, fromId: d.fromId, fromName: d.fromName, text: d.text, ts: d.ts || Date.now() });
            }
          } else {
            appendChatRow({ id: d.id, fromId: d.fromId, fromName: d.fromName, text: d.text, ts: d.ts || Date.now() });
          }
        } else if (d.type === 'chat_ack') {
          // robust fallback: if ack returns _clientId, mark pending
          if (d._clientId) {
            const p = chatBox.querySelector(`[data-pending-id="${d._clientId}"]`);
            if (p) {
              const mark = p.querySelector('.pending');
              if (mark) { mark.textContent = ' ✓'; mark.style.opacity = '.9'; }
              p.removeAttribute('data-pending-id');
              p.dataset.msgId = d.id || '';
            }
          } else if (d.id) {
            // if server ack only with id, try match by content/time (best-effort) — leaving minimal behavior
          }
        } else if (d.type === 'typing') {
          if (!d.fromId) return;
          if (d.state) typingSet.add(d.fromName || 'Anon');
          else typingSet.delete(d.fromName || 'Anon');
          updateTypingUI();
        } else if (d.type === 'error') {
          console.warn('chat error', d);
          if (d.code === 'rate_limited') alert('Você está enviando mensagens rápido demais. Aguarde.');
          if (d.code === 'muted') alert('Você está silenciado até ' + new Date(d.until).toLocaleString());
        }
      } catch (e) { log('bad ws message', e); }
    });

    // send typing events (debounced)
    let typingTimer = null;
    let lastTypingState = false;
    chatInput.addEventListener('input', () => {
      const isTyping = chatInput.value.trim().length > 0;
      if (isTyping !== lastTypingState) {
        lastTypingState = isTyping;
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type:'typing', state: isTyping }));
      }
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => {
        if (lastTypingState) {
          lastTypingState = false;
          if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type:'typing', state: false }));
        }
      }, 2500);
    });

    // lazy-load: add a button at top to load earlier messages
    const loadMoreBtn = document.createElement('button');
    loadMoreBtn.textContent = 'Carregar mensagens anteriores';
    loadMoreBtn.style.display = 'block';
    loadMoreBtn.style.width = '100%';
    loadMoreBtn.style.margin = '6px 0';
    chatBox.parentNode.insertBefore(loadMoreBtn, chatBox);
    let earliestMessageId = null;
    loadMoreBtn.addEventListener('click', async () => {
      try {
        // determine earliest id visible (assume first child corresponds to earliest)
        const first = chatBox.querySelector('.chat-row');
        const id = first && first.dataset && first.dataset.msgId ? Number(first.dataset.msgId) : earliestMessageId;
        const url = '/api/chat/global?limit=50' + (id ? '&before=' + id : '');
        const hist = await fetch(url, { credentials: 'include' }).then(r => r.ok ? r.json() : []);
        if (hist && hist.length) {
          // prepend messages
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
  });
})();

function escapeHtml(input) {
  if (input === null || input === undefined) return '';
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
// expõe globalmente caso outras partes do client chamem como window.escapeHtml
window.escapeHtml = escapeHtml;

// --- Mini-map renderer ---
// procura canvas #miniMap e desenha snapshot do currentScene (se disponível)
(function initMiniMap() {
  const el = document.getElementById('miniMap');
  if (!el) return;
  const ctx = el.getContext('2d');
  const W = el.width, H = el.height;

  // tenta várias formas de pedir um snapshot ao scene
  function getSceneSnapshot() {
    try {
      // preferência: função explícita exposta pelo scene
      if (currentScene && typeof currentScene.getSnapshot === 'function') {
        return currentScene.getSnapshot();
      }
      // alternativa: propriedades comuns
      if (currentScene && currentScene.player) {
        return {
          mapW: currentScene.mapWidth || 1024,
          mapH: currentScene.mapHeight || 1024,
          player: { x: currentScene.player.x || 0, y: currentScene.player.y || 0 },
          entities: currentScene.entities || []
        };
      }
      // fallback: estado global (se você expuser window._playerPos em scenes)
      if (window._mini_map_state) return window._mini_map_state;
    } catch (e) {}
    return null;
  }

  function drawPlaceholder() {
    ctx.fillStyle = '#07121a';
    ctx.fillRect(0,0,W,H);
    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.02)';
    ctx.lineWidth = 1;
    const step = 16;
    for (let x=0;x<W;x+=step){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for (let y=0;y<H;y+=step){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
    // center dot
    ctx.fillStyle = '#ffd166';
    ctx.beginPath(); ctx.arc(W/2, H/2, 4, 0, Math.PI*2); ctx.fill();
  }

  function draw(snapshot) {
    ctx.clearRect(0,0,W,H);
    if (!snapshot) { drawPlaceholder(); return; }

    const mapW = snapshot.mapW || 1024;
    const mapH = snapshot.mapH || 1024;
    // scale to fit
    const scale = Math.min(W / mapW, H / mapH);
    const ox = (W - mapW*scale)/2;
    const oy = (H - mapH*scale)/2;

    // background (simple tiling color)
    ctx.fillStyle = '#0b2a2a';
    ctx.fillRect(0,0,W,H);

    // optionally draw a simple tile grid or minimap texture if snapshot.tiles exists
    if (Array.isArray(snapshot.tiles) && snapshot.tiles.length) {
      // tiles: expect array of {x,y,color} or numeric ids; keep simple
      for (const t of snapshot.tiles) {
        ctx.fillStyle = t.color || '#083';
        ctx.fillRect(ox + t.x*scale, oy + t.y*scale, Math.max(1, scale), Math.max(1, scale));
      }
    } else {
      // draw coarse grid
      ctx.strokeStyle = 'rgba(255,255,255,0.03)';
      ctx.lineWidth = 1;
      const g = 32;
      for (let x=0;x<=mapW;x+=g) {
        ctx.beginPath(); ctx.moveTo(ox + x*scale, oy); ctx.lineTo(ox + x*scale, oy + mapH*scale); ctx.stroke();
      }
      for (let y=0;y<=mapH;y+=g) {
        ctx.beginPath(); ctx.moveTo(ox, oy + y*scale); ctx.lineTo(ox + mapW*scale, oy + y*scale); ctx.stroke();
      }
    }

    // draw entities
    (snapshot.entities || []).forEach(ent => {
      const ex = ox + (ent.x || 0) * scale;
      const ey = oy + (ent.y || 0) * scale;
      ctx.fillStyle = ent.color || '#ff4d4d';
      ctx.beginPath(); ctx.arc(ex, ey, Math.max(1, 3*scale), 0, Math.PI*2); ctx.fill();
    });

    // draw player
    if (snapshot.player) {
      const px = ox + (snapshot.player.x||0) * scale;
      const py = oy + (snapshot.player.y||0) * scale;
      ctx.fillStyle = '#ffd166';
      ctx.beginPath(); ctx.arc(px, py, Math.max(2, 4*scale), 0, Math.PI*2); ctx.fill();
      // add a small halo
      ctx.strokeStyle = 'rgba(255,209,102,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(px, py, Math.max(4, 6*scale), 0, Math.PI*2); ctx.stroke();
    }
  }

  // loop de atualização
  function tick() {
    const snap = getSceneSnapshot();
    draw(snap);
    requestAnimationFrame(tick);
  }
  tick();
})();

// --- WebSocket singleton / reconnect-safe (shared for whole page) ---
(function initGameWS() {
  const G = window;
  if (!G.__GAME_WS_STATE__) G.__GAME_WS_STATE__ = { ws: null, seenMsgIds: new Set() };
  const state = G.__GAME_WS_STATE__;

  function onMessage(evt) {
    try {
      const d = JSON.parse(evt.data);
      // dedupe chat messages by id
      if (d && d.type === 'chat' && d.id) {
        if (state.seenMsgIds.has(String(d.id))) return;
        state.seenMsgIds.add(String(d.id));
      }
      // dispatch to your app handler (implement handleIncomingChat)
      if (typeof window.handleIncomingChat === 'function') {
        window.handleIncomingChat(d);
      } else {
        console.log('[ws] recv', d);
      }
    } catch (e) { console.warn('[ws] bad msg', e && e.message); }
  }

  function closeOld() {
    try {
      if (state.ws) {
        state.ws.removeEventListener('message', onMessage);
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

    state.ws.addEventListener('open', () => {
      console.log('[ws] aberto');
      // auto-send auth if you use cookies / token
      // const token = getCookie('token');
      // if (token) state.ws.send(JSON.stringify({ type: 'auth', token }));
    });

    state.ws.addEventListener('close', () => console.log('[ws] fechado'));
    state.ws.addEventListener('error', (err) => console.warn('[ws] error', err));
    state.ws.addEventListener('message', onMessage);

    return state.ws;
  }

  // send chat - ensures id and timestamp
  function sendChat(text) {
    const ws = connectGameWS();
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    const payload = {
      type: 'chat',
      id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : ('m_' + Date.now() + '_' + Math.random().toString(36).slice(2,8)),
      text: String(text || ''),
      timestamp: Date.now(),
      from: (window.MyPlayerName || null),
      senderId: (window.MyPlayerId || null)
    };
    try { ws.send(JSON.stringify(payload)); } catch (e) { console.warn('[ws] send failed', e && e.message); return false; }
    return payload;
  }

  window.connectGameWS = connectGameWS;
  window.sendChatGlobal = sendChat;
  window.closeGameWS = closeOld;

  // auto-connect once
  if (!state.ws) connectGameWS();
})();
