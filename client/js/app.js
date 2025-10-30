// client/js/app.js
// Layout “Tibia”: stacks laterais, chat fixo, viewport central com prioridade.
// Abre Skills/Heroes/Inventory sempre dockado (sem cobrir a área jogável).

import './tick.js';
import { openSkills, openHeroes, openInventory, openSummonPanel } from './app_panels.js';
import { getSocket, onMessage, wsSend, authenticate } from './ws/singleton.js';
import { HeroState } from './state/hero-state.js';

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

/* ---------- Tela de loading retro ---------- */
const loadingScreenEl   = document.getElementById('loadingScreen');
const loadingBarEl      = loadingScreenEl?.querySelector('[data-loading-bar]');
const loadingBarFillEl  = loadingScreenEl?.querySelector('.loading-bar-fill');
const loadingPercentEl  = loadingScreenEl?.querySelector('[data-loading-percent]');
const loadingTipEl      = document.getElementById('loadingTip');

const LOADING_TIPS = [
  'Melhore a picareta no ferreiro para desbloquear minérios lendários.',
  'Heróis com afinidades diferentes liberam combos poderosos no AFK.',
  'Use o chat global para recrutar aliados antes de enfrentar chefes.',
  'Não esqueça de equipar relíquias na House: elas rendem bônus passivos.',
  'Visite a fazenda para colher ingredientes e reforçar seus buffs.',
  'Complete missões diárias para garantir fragmentos extras de herói.',
  'Ajuste o zoom no menu de opções para enxergar melhor o campo de batalha.'
];

let loadingTipIndex = -1;
let loadingTipTimer = null;
let loadingBarTimer = null;
let loadingProgress = 0;
let loadingActive = false;

function setLoadingProgress(value, immediate = false) {
  if (!loadingBarFillEl) return;
  const target = Math.max(0, Math.min(100, value));
  loadingProgress = immediate ? target : Math.max(loadingProgress, target);
  loadingBarFillEl.style.width = `${loadingProgress}%`;
  if (loadingPercentEl) loadingPercentEl.textContent = String(Math.round(loadingProgress));
  if (loadingBarEl) loadingBarEl.setAttribute('aria-valuenow', String(Math.round(loadingProgress)));
}

function pickNextTipIndex() {
  if (!LOADING_TIPS.length) return 0;
  if (LOADING_TIPS.length === 1) return 0;
  let next = loadingTipIndex;
  while (next === loadingTipIndex) {
    next = Math.floor(Math.random() * LOADING_TIPS.length);
  }
  return next;
}

function swapLoadingTip(immediate = false) {
  if (!loadingTipEl || !LOADING_TIPS.length) return;
  loadingTipIndex = pickNextTipIndex();
  const tip = LOADING_TIPS[loadingTipIndex];
  const apply = () => {
    loadingTipEl.textContent = tip;
    loadingTipEl.classList.remove('is-swapping');
  };
  if (immediate) {
    apply();
    return;
  }
  loadingTipEl.classList.add('is-swapping');
  setTimeout(apply, 160);
}

function beginRetroLoading() {
  if (!loadingScreenEl || loadingActive) return;
  loadingActive = true;
  loadingScreenEl.classList.remove('loading-hidden');
  loadingScreenEl.setAttribute('aria-hidden', 'false');
  setLoadingProgress(0, true);
  swapLoadingTip(true);
  loadingTipTimer = window.setInterval(() => swapLoadingTip(false), 6200);
  loadingBarTimer = window.setInterval(() => {
    const step = loadingProgress + (4 + Math.random() * 9);
    setLoadingProgress(Math.min(step, 96));
  }, 900);
}

function finishRetroLoading() {
  if (!loadingScreenEl || !loadingActive) return;
  loadingActive = false;
  if (loadingTipTimer) { window.clearInterval(loadingTipTimer); loadingTipTimer = null; }
  if (loadingBarTimer) { window.clearInterval(loadingBarTimer); loadingBarTimer = null; }
  loadingTipEl?.classList.remove('is-swapping');
  setLoadingProgress(100, true);
  loadingScreenEl.classList.add('loading-hidden');
  loadingScreenEl.setAttribute('aria-hidden', 'true');
  window.setTimeout(() => {
    try { loadingScreenEl.remove(); } catch {}
  }, 700);
}

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

/* ---------- Cena House (modular, DONO do movimento/WS pos) ---------- */
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

/* ---------- Viewport ---------- */
function applyViewport(){
  const center = document.getElementById('centerStage');
  if (!center || !canvas) return;
  const rect = center.getBoundingClientRect();

  const pad = 16;
  const wCSS = Math.max(400, rect.width  - pad);
  const hCSS = Math.max(240, rect.height - pad);

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

/* ---------- Splitters ---------- */
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

/* ---------- Resizer do Chat ---------- */
(function mountChatResizer(){
  if (!chatDock) return;
  let res = document.getElementById('chatResizer');
  if (!res){
    res = document.createElement('div');
    res.id = 'chatResizer';
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
    const dy = startY - e.clientY;
    const newH = Math.max(120, Math.min(window.innerHeight*0.6, startH + dy));
    setRootVar('--chatH', Math.round(newH) + 'px');
    applyViewport();
  }
  function onUp(){ dragging=false; document.body.style.userSelect=''; }
  res.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
})();

/* ---------- Botões / Painéis ---------- */
btnSkills   ?.addEventListener('click', ()=> openSkills(rightS));
btnHeroes   ?.addEventListener('click', ()=> openHeroes(leftS));
btnInventory?.addEventListener('click', ()=> openInventory(rightS));

/* ---------- Settings ---------- */
function applyUiFromSettings(){
  const st = (window.GameSettings?.getState && window.GameSettings.getState()) || {};
  const ui = Number(st.uiScale || 1);
  setRootVar('--ui-scale', ui);
  document.body.classList.toggle('immersive', !!st.immersive);
  document.body.classList.toggle('overlay-chat', !!st.overlayChat);
  updateTopbarHeight();
  applyViewport();
  document.dispatchEvent(new Event('settings:changed'));
}
btnSettings?.addEventListener('click', ()=>{ if (window.openSettingsPanel) window.openSettingsPanel(rightS); });
window.addEventListener('keydown', (e)=>{
  if (e.key === 'F10'){
    e.preventDefault();
    if (window.openSettingsPanel) window.openSettingsPanel(rightS);
  }
});
document.addEventListener('GameSettings:changed', applyUiFromSettings);

/* ---------- Summon Modal ---------- */
btnSummon?.addEventListener('click', ()=>{ if (summonModal) summonModal.hidden = false; });
summonClose?.addEventListener('click', ()=> summonModal.hidden = true);
summonModal?.addEventListener('click', (e)=>{ if(e.target===summonModal) summonModal.hidden = true; });

/* ---------- Logout ---------- */
btnLogout?.addEventListener('click', async ()=>{
  try{ await jpost('/api/auth/logout',{}); }catch{}
  location.href='/index.html';
});

/* ===================== CHAT / WS + HISTÓRICO ===================== */
window.__SeenChatIds = window.__SeenChatIds || new Set();
function markSeenId(id) { if (id == null) return; window.__SeenChatIds.add(String(id)); }
function hasSeenId(id) { if (id == null) return false; return window.__SeenChatIds.has(String(id)); }
function normStr(s){ return String(s||'').trim(); }
function getTs(v){ if (!v) return Date.now(); const d = (v instanceof Date) ? v : new Date(v); const t=d.getTime(); return isFinite(t)?t:Date.now(); }

function findPendingRowFor(msg) {
  const from = normStr(msg.fromName || '');
  const text = normStr(msg.text || '');
  const wantTs = getTs(msg.createdAt || msg.ts || Date.now());
  const chatBox = document.getElementById('chatBox'); if (!chatBox) return null;
  const rows = Array.from(chatBox.querySelectorAll('.chat-row'));
  for (let i = rows.length - 1; i >= 0; i--) {
    const el = rows[i];
    const hasId = !!el.getAttribute('data-chat-id');
    if (hasId) continue;
    const rFrom = normStr(el.getAttribute('data-from'));
    const rText = normStr(el.getAttribute('data-text'));
    const rTs   = Number(el.getAttribute('data-ts')) || 0;
    if (rFrom !== from) continue;
    if (rText !== text) continue;
    if (Math.abs(wantTs - rTs) <= 15_000) return el;
  }
  return null;
}

function appendChatRow(msg){
  const chatBox = document.getElementById('chatBox');
  if (!chatBox) return null;

  const id   = msg?.id ?? msg?.messageId ?? null;
  const ts   = getTs(msg?.createdAt || msg?.ts || Date.now());
  const me   = window._chat_me || {};
  const myId = String(me.id || '');
  const myName = String(me.name || 'Você');
  const fromId = msg?.fromId ? String(msg.fromId) : '';
  const isMe = !!myId && !!fromId && (fromId === myId);

  const fromName = normStr(msg?.fromName || (isMe ? myName : 'Anon'));
  const text     = normStr(msg?.text || '');

  // evita duplicatas
  if (id && hasSeenId(id)) return null;

  const row = document.createElement('div');
  row.className = 'chat-row';
  if (id != null) { row.setAttribute('data-chat-id', String(id)); markSeenId(id); }
  row.setAttribute('data-from', fromName);
  row.setAttribute('data-text', text);
  row.setAttribute('data-ts', String(ts));
  row.classList.add(isMe ? 'me' : 'other');

  const timeStr = new Date(ts).toLocaleTimeString();
  const esc = (s)=> String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const displayName = esc(fromName);
  const extraYou = isMe ? ' <span class="you-tag">(Você)</span>' : '';
  row.innerHTML =
    `<strong class="name">${displayName}</strong>${extraYou}: ${esc(text)}
     <span class="muted" style="opacity:.6;font-size:11px;margin-left:8px">(${timeStr})</span>`;

  chatBox.appendChild(row);
  chatBox.scrollTop = chatBox.scrollHeight;
  return row;
}


window.addEventListener('tick:chat:append', (ev)=>{
  const list = ev.detail || [];
  for (const m of list){
    if (m?.id && !hasSeenId(m.id)) {
      const pending = findPendingRowFor(m);
      if (pending) {
        pending.setAttribute('data-chat-id', String(m.id));
        markSeenId(m.id);
        continue;
      }
    }
    appendChatRow({ id: m.id, fromId: m.fromId, fromName: m.fromName || m.from, text: m.text, createdAt: m.createdAt || m.created_at });
  }
});

// >>>>>>> alteração: também alimenta o HeroState com snapshots do tick
window.addEventListener('tick:hero', (ev)=>{ 
  try { 
    window.ActiveHeroSummary = ev.detail; 
    HeroState.setFromServer(ev.detail);
  } catch {} 
});

/* ===================== Chat: UI + WS (singleton) ===================== */
async function initGlobalChatUI() {
  const btnDefault = document.getElementById('btnDefault');
  const btnGlobal  = document.getElementById('btnGlobal');
  const btnLog     = document.getElementById('btnLog');
  const chatBox    = document.getElementById('chatBox');
  const chatLogBox = document.getElementById('chatLogBox');
  const chatInput  = document.getElementById('chatInput');
  const chatSend   = document.getElementById('chatSend');
  const chatForm   = document.getElementById('chatForm');
  if (!chatBox || !chatLogBox || !chatInput || !chatSend || !btnDefault || !btnGlobal || !btnLog || !chatForm) return;

  getSocket(); // garante conexão

  await authenticate(async () => {
    const raw = await fetch('/api/player/me', { credentials: 'include' }).then(r => r.ok ? r.json() : null);

    // >>>>>>> alteração: atualiza o singleton com o payload bruto
    try { HeroState.setFromServer(raw); } catch {}

    const me = (raw && raw.profile) ? raw.profile : raw;
    const id = String((me && (me.id || me.playerId)) || '');
    const name = (me && (me.name || me.username || me.displayName)) || 'Você';
    try { window._chat_me = { id, name }; } catch {}
    return { id, name };
  });

  if (![...window.__SeenChatIds].length) {
    try {
      const hist = await fetch('/api/chat/global?limit=200', { credentials: 'include' }).then(r => r.ok ? r.json() : []);
      for (const m of hist) {
        appendChatRow({ id: m.id, fromId: m.fromId, fromName: m.fromName || m.from, text: m.text, createdAt: m.createdAt || m.created_at });
      }
    } catch {}
  }

  onMessage('chat', (d) => {
    if (d.scope !== 'global') return;
    appendChatRow({ fromId: d.fromId, fromName: d.fromName, text: d.text, ts: d.ts || Date.now() });
  });

  let chatScope = 'default';
  function setScope(scope) {
    chatScope = scope;
    btnDefault.classList.toggle('active', scope === 'default');
    btnGlobal.classList.toggle('active', scope === 'global');
    btnLog.classList.toggle('active', scope === 'log');

    const showChat = scope !== 'log';
    chatBox.style.display = showChat ? 'block' : 'none';
    chatLogBox.style.display = showChat ? 'none' : 'block';
    chatForm.style.display = showChat ? 'flex' : 'none';

    if (scope === 'log' && window.Chat?.clearLogHighlight) {
      try { window.Chat.clearLogHighlight(); } catch {}
    }
  }

  btnDefault.addEventListener('click', ()=> setScope('default'));
  btnGlobal.addEventListener('click',  ()=> setScope('global'));
  btnLog.addEventListener('click',     ()=> setScope('log'));

  setScope('default');

  function sendChat() {
    const text = (chatInput.value || '').trim(); if (!text) return;
    if (chatScope === 'log') {
      return;
    }
    if (chatScope === 'global') {
      wsSend({ type: 'chat', scope: 'global', text });
      chatInput.value = '';
    } else {
      appendChatRow({ fromName: 'Você', text, ts: Date.now() });
      chatInput.value = '';
    }
  }
  chatSend.addEventListener('click', sendChat);
  chatForm.addEventListener('submit', (e)=>{ e.preventDefault(); sendChat(); });
  chatInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); sendChat(); } });
}

/* ===================== Conteúdo auxiliar (somente se cena modular falhar) ===================== */
/*  Importante: NÃO enviamos posição por aqui. O dono do movimento é play.js (cena).  */
const FALLBACK_LOAD_CONTENT = async () => {
  try {
    // carrega dados passivos p/ UI se quiser (map/monstros/spawns), sem loop/pos
    await jget(`/api/admin/content/map/house/data`).catch(()=>null);
    await jget('/api/admin/content/monsters').catch(()=>null);
  } catch {}
};

/* ---------- Boot ---------- */
(async function boot(){
  beginRetroLoading();

  updateTopbarHeight();
  setLoadingProgress(10);

  await getCsrf().catch(()=>null);
  setLoadingProgress(18);

  try{
    const st = await jget('/api/starter/status');
    if (st?.canSelect){
      finishRetroLoading();
      location.href='/starter.html';
      return;
    }
  }catch{}

  document.addEventListener('GameSettings:changed', applyUiFromSettings);
  applyUiFromSettings();
  setLoadingProgress(30);

  try {
    await mountSceneHouse();        // a cena já publica pos pelo WS via pos-publisher.js
    setLoadingProgress(62);

    await initGlobalChatUI();
    setLoadingProgress(82);

    applyViewport();
    setLoadingProgress(90);

    if (!currentScene) {            // fallback de conteúdo passivo, sem movimento/pos
      await FALLBACK_LOAD_CONTENT();
    }
    setLoadingProgress(96);
  } catch (err) {
    console.error('Falha ao iniciar o cliente do jogo', err);
  } finally {
    finishRetroLoading();
  }
})();
