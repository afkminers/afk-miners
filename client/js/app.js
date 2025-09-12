// Layout “Tibia”: stacks laterais, chat fixo, viewport central com prioridade.
import './tick.js';
import { openSkills, openHeroes, openInventory, openSummonPanel } from './app_panels.js';
import { getSocket, onMessage, wsSend, authenticate } from './ws/singleton.js';

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
btnSettings?.addEventListener('click', ()=>{
  if (window.openSettingsPanel) window.openSettingsPanel(rightS);
});
window.addEventListener('keydown', (e)=>{
  if (e.key === 'F10'){
    e.preventDefault();
    if (window.openSettingsPanel) window.openSettingsPanel(rightS);
  }
});

/* ---------- UI Settings -> Layout ---------- */
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

/* ===================== CHAT / WS + INCREMENTAL TICK ===================== */
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
  const id  = msg.id ?? msg.messageId ?? null;
  const ts  = getTs(msg.createdAt || msg.ts || Date.now());
  const me  = window._chat_me || {};
  const myId = String(me.id || '');
  const myName = String(me.name || 'Você');
  const fromId = msg.fromId ? String(msg.fromId) : '';
  const isMe = !!myId && fromId && (fromId === myId);

  const fromName = normStr(msg.fromName || (isMe ? myName : 'Anon'));
  const text = normStr(msg.text || '');

  if (id && hasSeenId(id)) return null;

  const d = document.createElement('div');
  d.className = 'chat-row';
  if (id != null) { d.setAttribute('data-chat-id', String(id)); markSeenId(id); }
  d.setAttribute('data-from', fromName);
  d.setAttribute('data-text', text);
  d.setAttribute('data-ts', String(ts));
  d.classList.add(isMe ? 'me' : 'other');

  const time = new Date(ts).toLocaleTimeString();
  const esc = (s)=> String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const displayName = esc(fromName);
  const extraYou = isMe ? ' <span class="you-tag">(Você)</span>' : '';
  d.innerHTML = `<strong class="name">${displayName}</strong>${extraYou}: ${esc(text)}
    <span class="muted" style="opacity:.6;font-size:11px;margin-left:8px">(${time})</span>`;
  chatBox.appendChild(d);
  chatBox.scrollTop = chatBox.scrollHeight;
  return d;
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
    appendChatRow({ id: m.id, fromId: m.fromId, fromName: m.fromName, text: m.text, createdAt: m.createdAt });
  }
});
window.addEventListener('tick:hero', (ev)=>{ try { window.ActiveHeroSummary = ev.detail; } catch {} });

/* ===================== Chat: UI + WS (singleton) ===================== */
async function initGlobalChatUI() {
  const btnDefault = document.getElementById('btnDefault');
  const btnGlobal  = document.getElementById('btnGlobal');
  const chatBox    = document.getElementById('chatBox');
  const chatInput  = document.getElementById('chatInput');
  const chatSend   = document.getElementById('chatSend');
  const chatForm   = document.getElementById('chatForm');
  if (!chatBox || !chatInput || !chatSend || !btnDefault || !btnGlobal || !chatForm) return;

  getSocket(); // garante conexão

  await authenticate(async () => {
    const raw = await fetch('/api/player/me', { credentials: 'include' }).then(r => r.ok ? r.json() : null);
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
        appendChatRow({ id: m.id, fromId: m.fromId, fromName: m.fromName || m.from, text: m.text, createdAt: m.created_at });
      }
    } catch {}
  }

  onMessage('chat', (d) => {
    if (d.scope !== 'global') return;
    appendChatRow({ fromId: d.fromId, fromName: d.fromName, text: d.text, ts: d.ts || Date.now() });
  });

  let chatScope = 'default';
  btnDefault.addEventListener('click', ()=>{ chatScope='default'; btnDefault.classList.add('active'); btnGlobal.classList.remove('active'); });
  btnGlobal.addEventListener('click',  ()=>{ chatScope='global';  btnGlobal.classList.add('active');  btnDefault.classList.remove('active'); });

  function sendChat() {
    const text = (chatInput.value || '').trim(); if (!text) return;
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

/* ===================== Mapa/Render/Networking (posições) ===================== */
const MAP_KEY = 'house';
const TILE = 32;
const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const startPosEl = $('startPos');
const spawnListEl = $('spawnList');
const btnReload = $('btnReload');

function setStatus(t) { if (statusEl) statusEl.textContent = t; }
function clearCanvas() { canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height); }

const IMG_CACHE = new Map();

function loadImgWithCandidates(candidates) {
  const key = candidates.join('|');
  if (IMG_CACHE.has(key)) return IMG_CACHE.get(key);

  const img = new Image();
  img.__candidates = candidates.slice();
  img.__idx = 0;
  img.__broken = false;

  img.onload = () => {
    // ok
  };
  img.onerror = () => {
    const next = ++img.__idx;
    if (next < img.__candidates.length) {
      img.src = img.__candidates[next];
    } else {
      img.__broken = true;
    }
  };

  // inicia
  img.src = img.__candidates[0];
  IMG_CACHE.set(key, img);
  return img;
}

function resolveSprite(look, monsterKey) {
  const paths = [];
  if (look?.image) {
    paths.push(String(look.image));
  }
  const sk = look?.spriteKey || monsterKey;
  if (sk) {
    paths.push(`/sprites/characters/${sk}.png`);
    paths.push(`/sprites/monsters/${sk}.png`);
    // fallback final por key exata do monster
    if (monsterKey && monsterKey !== sk) {
      paths.push(`/sprites/monsters/${monsterKey}.png`);
      paths.push(`/sprites/characters/${monsterKey}.png`);
    }
  }
  return loadImgWithCandidates(paths.filter(Boolean));
}

// --- world / camera / entities ---
let mapData = null;
let groundLayer = null;
let tileset = null;
let tilesetImg = null;

const player = { id: 'me', type: 'player', x: 160, y: 160, w: 28, h: 40, speed: 140, name: 'Você', hp: 100, maxHp: 100 };
let entities = [];           // monsters + remote players
let monstersByKey = {};      // master de monstros por key

const camera = { x: 0, y: 0, w: canvas.width, h: canvas.height, lerp: 0.2, follow: player };
function syncCameraSize() { camera.w = canvas.width; camera.h = canvas.height; }
window.addEventListener('resize', syncCameraSize);
syncCameraSize();

let keys = {};
window.addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; });
window.addEventListener('keyup',   e => { keys[e.key.toLowerCase()] = false; });

// --- draw helpers (map + entities) ---
const ctx = canvas.getContext('2d');
function drawGrid(cols, rows) {
  ctx.save();
  ctx.strokeStyle = '#1f2937';
  ctx.lineWidth = 1;
  for (let x = 0; x <= cols; x++) { ctx.beginPath(); ctx.moveTo(x * TILE + .5, 0); ctx.lineTo(x * TILE + .5, rows * TILE); ctx.stroke(); }
  for (let y = 0; y <= rows; y++) { ctx.beginPath(); ctx.moveTo(0, y * TILE + .5); ctx.lineTo(cols * TILE, y * TILE + .5); ctx.stroke(); }
  ctx.restore();
}
function worldToScreen(wx, wy) { return { x: Math.round(wx - camera.x), y: Math.round(wy - camera.y) }; }

function drawGround() {
  if (!groundLayer || !tileset || !tilesetImg || !tilesetImg.complete || tilesetImg.naturalWidth === 0) return;
  const data = groundLayer.data;
  const cols = mapData.width, rows = mapData.height;
  const first = tileset.firstgid || 1;
  const tw = tileset.tilewidth, th = tileset.tileheight;
  const columnsInImage = tileset.columns;

  const startCol = Math.max(0, Math.floor(camera.x / TILE));
  const endCol   = Math.min(cols - 1, Math.ceil((camera.x + camera.w) / TILE));
  const startRow = Math.max(0, Math.floor(camera.y / TILE));
  const endRow   = Math.min(rows - 1, Math.ceil((camera.y + camera.h) / TILE));

  for (let y = startRow; y <= endRow; y++) {
    for (let x = startCol; x <= endCol; x++) {
      const gid = data[y * cols + x];
      if (!gid || gid < first) continue;
      const id = gid - first;
      const sx = (id % columnsInImage) * tw;
      const sy = Math.floor(id / columnsInImage) * th;
      const dx = Math.round(x * TILE - camera.x);
      const dy = Math.round(y * TILE - camera.y);
      ctx.drawImage(tilesetImg, sx, sy, tw, th, dx, dy, TILE, TILE);
    }
  }
}

function drawEntity(e) {
  const s = worldToScreen(e.x, e.y);
  ctx.save();
  if (e._img && e._img.complete && !e._img.__broken && e._img.naturalWidth > 0) {
    const dw = e.w || 32, dh = e.h || 32;
    ctx.drawImage(e._img, s.x - dw / 2, s.y - dh, dw, dh);
  } else {
    // placeholder caso sprite não exista/tenha 404
    ctx.fillStyle = e.type === 'player' ? '#3b82f6' : '#f97316';
    ctx.fillRect(s.x - (e.w || 28) / 2, s.y - (e.h || 36), e.w || 28, e.h || 36);
  }
  ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif';
  ctx.fillText(e.name || '', s.x - (e.w || 28) / 2, s.y - (e.h || 36) - 6);

  const bw = Math.max(20, e.w || 28), bh = 5;
  const bx = s.x - bw / 2, by = s.y - (e.h || 36) - 18;
  ctx.fillStyle = '#111'; ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = '#ef4444';
  const perc = ((e.hp || 0) / (e.maxHp || 1));
  ctx.fillRect(bx, by, Math.round(bw * Math.max(0, Math.min(1, perc))), bh);
  ctx.restore();
}

/* ---- POSIÇÃO: usando WS singleton ---- */
function initPosSync() {
  getSocket();
  onMessage('pos', (d) => {
    if (!d || !d.id || d.id === player.id) return;
    let p = entities.find(x => x.id === d.id && x.type === 'player_remote');
    if (!p) {
      p = { id: d.id, type: 'player_remote', x: d.x, y: d.y, w: 28, h: 40, name: d.name || 'Player', hp: 100, maxHp: 100 };
      entities.push(p);
    } else {
      p.x = d.x; p.y = d.y;
    }
  });
}
function sendMyPos() {
  wsSend({ type: 'pos', id: String(player.id), x: Math.round(player.x), y: Math.round(player.y), name: player.name });
}

/* --- update loop --- */
function update(dt) {
  let vx = 0, vy = 0;
  if (keys['w'] || keys['arrowup'])    vy -= 1;
  if (keys['s'] || keys['arrowdown'])  vy += 1;
  if (keys['a'] || keys['arrowleft'])  vx -= 1;
  if (keys['d'] || keys['arrowright']) vx += 1;

  if (vx !== 0 || vy !== 0) {
    const mag = Math.hypot(vx, vy) || 1;
    player.x += (vx / mag) * player.speed * dt;
    player.y += (vy / mag) * player.speed * dt;
    sendMyPos();
  }

  camera.x += (player.x - camera.x - camera.w / 2) * camera.lerp;
  camera.y += (player.y - camera.y - camera.h / 2) * camera.lerp;

  for (const e of entities) {
    if (e.type === 'monster') {
      e._tick = (e._tick || 0) + dt;
      e.x += Math.sin(e._tick * 0.5) * 0.4;
    }
  }
}

/* --- merge helpers --- */
function mergeSpawns(spawnsRows) {
  const existing = new Map(entities.filter(e => e.type === 'monster').map(e => [e._spawnId, e]));
  for (const s of spawnsRows) {
    const spawnId = s.id;
    if (existing.has(spawnId)) continue;
    const monsterKey = s.monsterKey || 'unknown';
    const monData = monstersByKey[monsterKey] || {};
    const look = monData.look || {};
    const e = {
      id: `spawn-${spawnId}`,
      _spawnId: spawnId,
      type: 'monster',
      x: (s.x || 0) + ((s.w || 0) / 2),
      y: (s.y || 0) + ((s.h || 0) / 2),
      w: monData.width || 28,
      h: monData.height || 36,
      name: monData.name || monsterKey,
      hp: monData.healthMax || 50,
      maxHp: monData.healthMax || 50,
      _img: resolveSprite(look, monsterKey)
    };
    entities.push(e);
  }
}

/* --- boot / start loop --- */
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  clearCanvas();
  if (mapData) drawGround(); else drawGrid(20, 15);
  for (const e of entities) drawEntity(e);
  drawEntity(player);
  requestAnimationFrame(loop);
}

async function startHub() {
  try {
    setStatus('Carregando mapa e conteúdo…');

    try {
      let raw = await jget(`/api/admin/content/map/${MAP_KEY}/data`);
      if (Array.isArray(raw)) raw = raw[0];
      if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch {} }
      mapData = raw;

      tileset = (mapData && mapData.tilesets && mapData.tilesets[0]) || null;
      if (tileset && tileset.image) {
        const imgPath = tileset.image
          .replace(/^(\.\.\/)+/, '/')
          .replace(/^client\//, '')
          .replace(/^\/client\//, '/');
        const finalPath = imgPath.startsWith('/') ? imgPath : '/' + imgPath;

        const tsImg = new Image();
        tsImg.onload = () => {};
        tsImg.onerror = () => {};
        tsImg.src = finalPath;
        tilesetImg = tsImg;

        groundLayer = (mapData.layers || []).find(
          l => l.type === 'tilelayer' && String(l.name || '').toLowerCase() === 'ground'
        );
      }
    } catch (e) {
      console.warn('map data not available', e.message);
    }

    try {
      const mons = await jget('/api/admin/content/monsters');
      monstersByKey = {};
      for (const m of mons) {
        monstersByKey[m.key] = {
          key: m.key, name: m.name, healthMax: m.healthMax,
          width: (m.look && m.look.width) || 28,
          height: (m.look && m.look.height) || 36,
          look: m.look || {}
        };
      }
    } catch (e) { console.warn('failed to load monsters', e.message); }

    const sp = await jget(`/api/admin/content/map/${MAP_KEY}/spawns`);
    mergeSpawns(sp);

    initPosSync();

    last = performance.now();
    requestAnimationFrame(loop);
    setStatus('Pronto');
  } catch (err) {
    console.error(err);
    setStatus('Erro: ' + err.message);
  }
}

/* ---------- Boot ---------- */
(async function boot(){
  updateTopbarHeight();
  await getCsrf().catch(()=>null);
  try{
    const st = await jget('/api/starter/status');
    if (st?.canSelect){ location.href='/starter.html'; return; }
  }catch{}
  const applyUiFromSettings = () => {
    const st = (window.GameSettings?.getState && window.GameSettings.getState()) || {};
    const ui = Number(st.uiScale || 1);
    setRootVar('--ui-scale', ui);
    document.body.classList.toggle('immersive', !!st.immersive);
    document.body.classList.toggle('overlay-chat', !!st.overlayChat);
    updateTopbarHeight();
    applyViewport();
    document.dispatchEvent(new Event('settings:changed'));
  };
  window.addEventListener('GameSettings:changed', applyUiFromSettings);
  applyUiFromSettings();

  await mountSceneHouse();
  await initGlobalChatUI();
  applyViewport();
  startHub();
})();