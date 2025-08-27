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
const btnSettings  = document.getElementById('btnSettings');
const btnLogout    = document.getElementById('btnLogout');

const summonModal  = document.getElementById('summonModal');
const summonClose  = summonModal?.querySelector('.close');

/* ---------- Util CSS Vars ---------- */
function setRootVar(name, value){ document.documentElement.style.setProperty(name, String(value)); }
function getRootVar(name, fallback){
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!v) return fallback;
  return v;
}

/* ---------- Topbar height -> --topbarH ---------- */
function updateTopbarHeight(){
  const tb = document.querySelector('.topbar');
  const h = Math.round((tb?.getBoundingClientRect().height || 56));
  setRootVar('--topbarH', h+'px');
}

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
function applyViewport(){
  // tamanho disponível do centerStage
  const center = document.getElementById('centerStage');
  if (!center || !canvas) return;
  const rect = center.getBoundingClientRect();

  const pad = 16;
  const wCSS = Math.max(400, rect.width  - pad);
  const hCSS = Math.max(240, rect.height - pad);

  // DPR cap pode ser controlado por GameSettings (play.js usa também)
  const st = (window.GameSettings?.getState && window.GameSettings.getState()) || {};
  const baseDpr = window.devicePixelRatio || 1;
  const dpr = Math.max(1, Math.min(baseDpr, Number(st.dprCap || baseDpr)));

  canvas.style.width  = `${wCSS}px`;
  canvas.style.height = `${hCSS}px`;

  const w = Math.round(wCSS*dpr), h=Math.round(hCSS*dpr);
  if (canvas.width!==w || canvas.height!==h){ canvas.width=w; canvas.height=h; }

  try{ currentScene?.resize?.(wCSS, hCSS, dpr); }catch{}
}
window.addEventListener('resize', ()=>{ updateTopbarHeight(); applyViewport(); });

/* ---------- Splitters (arrasta para redimensionar as sidebars) ---------- */
function makeVSplitter(splitEl, side){
  let dragging=false, startX=0, startW=0;

  function onDown(e){
    dragging=true;
    startX = e.clientX;
    const root = document.documentElement;
    startW = parseInt(getComputedStyle(root).getPropertyValue(side==='left'?'--leftW':'--rightW'))|| (side==='left'?300:320);
    document.body.style.userSelect='none';
    e.preventDefault();
  }
  function onMove(e){
    if(!dragging) return;
    const dx = e.clientX - startX;
    const newW = Math.max(200, Math.min(520, side==='left' ? (startW + dx) : (startW - dx)));
    document.documentElement.style.setProperty(side==='left'?'--leftW':'--rightW', newW+'px');
    applyViewport();
  }
  function onUp(){ dragging=false; document.body.style.userSelect=''; }

  splitEl?.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}
makeVSplitter(splitL,'left');
makeVSplitter(splitR,'right');

/* ---------- Resizer do Chat (arrasta a barrinha no topo do chat) ---------- */
(function mountChatResizer(){
  if (!chatDock) return;
  let res = document.getElementById('chatResizer');
  if (!res){
    res = document.createElement('div');
    res.id = 'chatResizer';
    // insere como primeiro filho do chatDock (uma barrinha horizontal)
    chatDock.insertBefore(res, chatDock.firstChild);
  }
  let dragging=false, startY=0, startH=0;

  function onDown(e){
    dragging=true;
    startY = e.clientY;
    const cur = parseInt(getRootVar('--chatH','170px')) || 170;
    startH = cur;
    document.body.style.userSelect='none';
    e.preventDefault();
  }
  function onMove(e){
    if(!dragging) return;
    const dy = startY - e.clientY; // arrastar pra cima aumenta área do jogo (reduz chat)
    const newH = Math.max(120, Math.min(window.innerHeight*0.6, startH + dy));
    setRootVar('--chatH', Math.round(newH) + 'px');
    applyViewport();
  }
  function onUp(){ dragging=false; document.body.style.userSelect=''; }

  res.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
})();

/* ---------- Abrir painéis (sempre dockados) ---------- */
btnSkills   ?.addEventListener('click', ()=> openSkills(rightS));
btnHeroes   ?.addEventListener('click', ()=> openHeroes(leftS));
btnInventory?.addEventListener('click', ()=> openInventory(rightS));

/* ---------- Settings (dock no stack direito) ---------- */
btnSettings?.addEventListener('click', ()=>{
  if (window.openSettingsPanel) window.openSettingsPanel(rightS);
});
// atalho opcional F10
window.addEventListener('keydown', (e)=>{
  if (e.key === 'F10'){
    e.preventDefault();
    if (window.openSettingsPanel) window.openSettingsPanel(rightS);
  }
});

/* ---------- Flags vindas do Settings -> UI Scale / Imersivo / Overlay Chat ---------- */
function applyUiFromSettings(){
  const st = (window.GameSettings?.getState && window.GameSettings.getState()) || {};
  // UI scale
  const ui = Number(st.uiScale || 1);
  setRootVar('--ui-scale', ui);

  // Imersivo & Overlay Chat
  document.body.classList.toggle('immersive', !!st.immersive);
  document.body.classList.toggle('overlay-chat', !!st.overlayChat);

  // quando muda layout, refaz viewport
  updateTopbarHeight();
  applyViewport();

  // avisa o jogo (play.js) que houve mudança (ele cuida de zoom/smoothing/DPR)
  const ev = new Event('settings:changed');
  document.dispatchEvent(ev);
}
// aplica uma vez no boot e fica ouvindo mudanças do painel
document.addEventListener('GameSettings:changed', applyUiFromSettings);

/* ---------- Summon como MODAL ---------- */
btnSummon?.addEventListener('click', ()=>{
  if (summonModal) summonModal.hidden = false;
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
  updateTopbarHeight();                 // mede topbar e define --topbarH
  await getCsrf().catch(()=>null);
  try{
    const st = await jget('/api/starter/status');
    if (st?.canSelect){ location.href='/starter.html'; return; }
  }catch{}

  // aplica estado atual do Settings (se já carregou)
  applyUiFromSettings();

  await mountSceneHouse();
  applyViewport();
})();

/* ===================== Chat global — init seguro (WS + UI) ===================== */
(function initGlobalChat() {
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

    function log(...args){ try{ console.log('[chat]', ...args); }catch{} }

    function connectWS() {
      try {
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
            appendChatRow({ fromId: d.fromId, fromName: d.fromName, text: d.text, ts: d.ts || Date.now() });
          }
        } catch (e) { log('bad ws message', e); }
      });

      ws.addEventListener('close', () => log('ws fechado'));
      ws.addEventListener('error', (e) => log('ws erro', e && e.message));
    }

    function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, (m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
    function appendChatRow(msg){
      const d = document.createElement('div');
      d.className='chat-row';
      const time = new Date(msg.ts||Date.now()).toLocaleTimeString();
      const isMe = (msg.fromId && myId && String(msg.fromId) === String(myId)) || (!msg.fromId && msg.fromName && myName && String(msg.fromName) === String(myName));
      d.classList.add(isMe ? 'me' : 'other');
      const displayName = escapeHtml(msg.fromName || (isMe ? myName : 'Anon'));
      const extraYou = isMe ? ' <span class="you-tag">(Você)</span>' : '';
      d.innerHTML = `<strong class="name">${displayName}</strong>${extraYou}: ${escapeHtml(msg.text)} <span class="muted" style="opacity:.6;font-size:11px;margin-left:8px">(${time})</span>`;
      chatBox.appendChild(d);
      chatBox.scrollTop = chatBox.scrollHeight;
    }

    connectWS();

    async function sendChat(){
      const text = (chatInput.value||'').trim(); if(!text) return;
      if (btnGlobal.classList.contains('active')) {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type:'chat', scope:'global', text }));
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
  });
})();
