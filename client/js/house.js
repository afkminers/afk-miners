/* client/js/house.js
   Cena “house” com step-by-tile (Tibia-like) e WS sem spam.
   - WASD/setas => 1 passo de 32px
   - Envia WS apenas quando o passo é válido e completado
   - Respeita cooldown ~150ms entre passos (alinha com servidor)
   - Aceita pos_snap do servidor
*/

import { getSocket, onMessage, wsSend, authenticate } from './ws/singleton.js';

const MAP_KEY = 'house';
const TILE = 32;

// ===== DOM refs =====
const $ = (id) => document.getElementById(id);
const canvas = $('scene');
const ctx = canvas?.getContext?.('2d');
const statusEl = $('status');
const btnReload = $('btnReload');

const setStatus = (t) => { if (statusEl) statusEl.textContent = t; };
const clearCanvas = () => { if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height); };

// ===== HTTP helpers =====
async function jget(url) {
  const r = await fetch(url, { credentials: 'include', cache: 'no-store' });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} @GET ${url}`);
  return r.json();
}
async function postWithCsrf(url) {
  const t = await fetch('/api/csrf', { credentials: 'include', cache: 'no-store' }).then(r => r.json()).catch(()=>({}));
  const token = t.csrfToken || t.token || t.csrf;
  const r = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: token ? { 'X-CSRF-Token': token } : {},
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} @POST ${url}`);
  return r.json();
}

// ===== World / Camera / Entities =====
let mapData = null;
let groundLayer = null;
let tileset = null;
let tilesetImg = null;

const player = {
  type: 'player',
  x: 160, y: 160,
  w: 28, h: 40,
  name: 'Você',
  hp: 100, maxHp: 100
};
let entities = [];           // monsters + remote players
let monstersByKey = {};      // catalog

const camera = { x: 0, y: 0, w: canvas?.width || 0, h: canvas?.height || 0, lerp: 0.22, follow: player };
function syncCameraSize() {
  if (!canvas) return;
  camera.w = canvas.width;
  camera.h = canvas.height;
}
window.addEventListener('resize', syncCameraSize);
syncCameraSize();

// ===== Input (WASD/Arrows) -> step intent por tile =====
const keys = Object.create(null);
window.addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; });
window.addEventListener('keyup',   e => { keys[e.key.toLowerCase()] = false; });

function takeStepIntent() {
  // prioridade cardinal N/S/L/O
  if (keys['w'] || keys['arrowup'])    return { dx: 0, dy: -1, face: 'north' };
  if (keys['s'] || keys['arrowdown'])  return { dx: 0, dy:  1, face: 'south' };
  if (keys['a'] || keys['arrowleft'])  return { dx:-1, dy:  0, face: 'west'  };
  if (keys['d'] || keys['arrowright']) return { dx: 1, dy:  0, face: 'east'  };
  return null;
}

// ===== Sprite loader com fallback (sem quebrar drawImage) =====
const IMG_CACHE = new Map();
function loadImgWithCandidates(candidates) {
  const key = candidates.join('|');
  if (IMG_CACHE.has(key)) return IMG_CACHE.get(key);
  const img = new Image();
  img.__candidates = candidates.slice();
  img.__idx = 0;
  img.__broken = false;
  img.onload = () => {};
  img.onerror = () => {
    const next = ++img.__idx;
    if (next < img.__candidates.length) img.src = img.__candidates[next];
    else img.__broken = true;
  };
  img.src = img.__candidates[0];
  IMG_CACHE.set(key, img);
  return img;
}
function resolveSprite(look, monsterKey) {
  const paths = [];
  if (look?.image) paths.push(String(look.image));
  const sk = look?.spriteKey || monsterKey;
  if (sk) {
    paths.push(`/sprites/characters/${sk}.png`);
    paths.push(`/sprites/monsters/${sk}.png`);
    if (monsterKey && monsterKey !== sk) {
      paths.push(`/sprites/monsters/${monsterKey}.png`);
      paths.push(`/sprites/characters/${monsterKey}.png`);
    }
  }
  const candidates = paths.filter(Boolean);
  return candidates.length ? loadImgWithCandidates(candidates) : null;
}

// ===== Draw helpers =====
function drawGrid(cols, rows) {
  if (!ctx) return;
  ctx.save();
  ctx.strokeStyle = '#1f2937';
  ctx.lineWidth = 1;
  for (let x = 0; x <= cols; x++) { ctx.beginPath(); ctx.moveTo(x * TILE + .5, 0); ctx.lineTo(x * TILE + .5, rows * TILE); ctx.stroke(); }
  for (let y = 0; y <= rows; y++) { ctx.beginPath(); ctx.moveTo(0, y * TILE + .5); ctx.lineTo(cols * TILE, y * TILE + .5); ctx.stroke(); }
  ctx.restore();
}
function worldToScreen(wx, wy) { return { x: Math.round(wx - camera.x), y: Math.round(wy - camera.y) }; }

function drawGround() {
  if (!ctx || !groundLayer || !tileset || !tilesetImg || !tilesetImg.complete || tilesetImg.naturalWidth === 0) return;
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
  if (!ctx) return;
  const s = worldToScreen(e.x, e.y);
  ctx.save();
  if (e._img && e._img.complete && !e._img.__broken && e._img.naturalWidth > 0) {
    const dw = e.w || 32, dh = e.h || 32;
    ctx.drawImage(e._img, s.x - dw / 2, s.y - dh, dw, dh);
  } else {
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

// ===== Step-by-tile (cliente) =====
const CLIENT_MIN_STEP_MS = 150;         // ~150ms por tile (alinha com servidor)
let stepState = {
  moving: false,
  tx: 0, ty: 0,
  nextAllowedAt: 0
};

function tryStartStep(now) {
  if (stepState.moving) return false;
  if (now < stepState.nextAllowedAt) return false;

  const intent = takeStepIntent();
  if (!intent) return false;

  const nx = player.x + intent.dx * TILE;
  const ny = player.y + intent.dy * TILE;

  // inicia movimento para o centro do próximo tile
  stepState.moving = true;
  stepState.tx = Math.round(nx);
  stepState.ty = Math.round(ny);
  return true;
}

function updateStep(dt, now) {
  if (!stepState.moving) {
    // tentar começar um novo passo
    tryStartStep(now);
    return;
  }

  // move em velocidade alta até encostar no target do próximo tile
  const spd = 480; // px/s (rápido para “pular” ao próximo tile em ~67ms)
  const dx = stepState.tx - player.x;
  const dy = stepState.ty - player.y;
  const dist = Math.hypot(dx, dy);

  if (dist <= 1.0) {
    player.x = stepState.tx;
    player.y = stepState.ty;
    stepState.moving = false;
    stepState.nextAllowedAt = now + CLIENT_MIN_STEP_MS;

    // envia POS apenas quando conclui o passo
    sendMyPos();
  } else {
    const ux = dx / (dist || 1);
    const uy = dy / (dist || 1);
    player.x += ux * spd * dt;
    player.y += uy * spd * dt;
  }
}

// ===== WS posições (sem spam) =====
function initPosSync() {
  getSocket();

  // recebe outros jogadores
  onMessage('pos', (d) => {
    if (!d || !d.id || d.scope === 'pos_snap') return;
    // opcionalmente render remotos…
  });

  // autoridade do servidor: corrige se necessário
  onMessage('pos_snap', (msg) => {
    // respeita apenas se for o mesmo mapa
    if (msg.mapKey && msg.mapKey !== MAP_KEY) return;
    // aplica snap
    player.x = (msg.x | 0);
    player.y = (msg.y | 0);
    // bloqueia spam de novo passo até o próximo slot
    stepState.moving = false;
    stepState.nextAllowedAt = performance.now() + CLIENT_MIN_STEP_MS;
  });
}
function sendMyPos() {
  // NÃO manda id; servidor usa sessão do cookie
  wsSend({ type: 'pos', x: Math.round(player.x), y: Math.round(player.y), mapKey: MAP_KEY });
}

// ===== Merge spawns =====
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

// ===== Loop =====
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); // clamp 50ms
  last = now;

  updateStep(dt, now);

  // câmera suave
  camera.x += (player.x - camera.x - camera.w / 2) * camera.lerp;
  camera.y += (player.y - camera.y - camera.h / 2) * camera.lerp;

  // render
  clearCanvas();
  if (mapData) drawGround(); else drawGrid(20, 15);
  for (const e of entities) drawEntity(e);
  drawEntity(player);

  requestAnimationFrame(loop);
}

// ===== Chat (igual ao teu) =====
const btnDefault = document.getElementById('btnDefault');
const btnGlobal  = document.getElementById('btnGlobal');
const chatBox    = document.getElementById('chatBox');
const chatInput  = document.getElementById('chatInput');
const chatSend   = document.getElementById('chatSend');

const esc = (s)=> String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function appendChatRow(msg) {
  if (!chatBox) return;
  const d = document.createElement('div');
  d.className = 'chat-row';
  const time = new Date(msg.ts || Date.now()).toLocaleTimeString();
  d.innerHTML = `<strong>${esc(msg.fromName || 'Anon')}</strong>: ${esc(msg.text)} <span class="muted">(${time})</span>`;
  chatBox.appendChild(d);
  chatBox.scrollTop = chatBox.scrollHeight;
}
async function initChat() {
  if (!chatBox || !chatInput || !chatSend || !btnDefault || !btnGlobal) return;

  getSocket();

  await authenticate(async () => {
    const meRaw = await jget('/api/player/me').catch(()=>null);
    const me = (meRaw && meRaw.profile) ? meRaw.profile : meRaw;
    const id = String((me && (me.id || me.playerId)) || '');
    const name = (me && (me.name || me.username || me.displayName)) || 'Você';
    try { window._chat_me = { id, name }; } catch {}
    return { id, name };
  });

  try {
    const hist = await jget('/api/chat/global?limit=200');
    for (const m of hist) {
      appendChatRow({ fromName: m.fromName || 'Anon', text: m.text, ts: (new Date(m.created_at)).getTime() });
    }
  } catch {}

  onMessage('chat', (d) => {
    if (d.scope !== 'global') return;
    appendChatRow({ fromName: d.fromName, text: d.text, ts: d.ts || Date.now() });
  });

  let chatScope = 'default';
  btnDefault.addEventListener('click', ()=>{ chatScope='default'; btnDefault.classList.add('active'); btnGlobal.classList.remove('active'); });
  btnGlobal.addEventListener('click',  ()=>{ chatScope='global';  btnGlobal.classList.add('active');  btnDefault.classList.remove('active'); });

  function sendChat() {
    const text = (chatInput.value || '').trim();
    if (!text) return;
    if (chatScope === 'global') {
      wsSend({ type: 'chat', scope: 'global', text });
      chatInput.value = '';
    } else {
      appendChatRow({ fromName: 'Você', text, ts: Date.now() });
      chatInput.value = '';
    }
  }
  chatSend.addEventListener('click', sendChat);
  chatInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); sendChat(); } });
}

// ===== Boot =====
async function startHub() {
  try {
    setStatus('Carregando mapa e conteúdo…');

    // Mapa (Tiled JSON embed)
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

    // Monsters
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

    // Spawns
    const sp = await jget(`/api/admin/content/map/${MAP_KEY}/spawns`);
    mergeSpawns(sp);

    // WS pos (autoridade do servidor)
    initPosSync();

    // Loop
    last = performance.now();
    requestAnimationFrame(loop);
    setStatus('Pronto');
  } catch (err) {
    console.error(err);
    setStatus('Erro: ' + err.message);
  }
}

// reload do mapa
if (btnReload) btnReload.addEventListener('click', async () => {
  try {
    setStatus('Recarregando mapa no servidor…');
    await postWithCsrf(`/api/admin/content/reload-map?map=${MAP_KEY}`);
    await startHub();
  } catch (e) {
    console.error(e);
    setStatus('Erro: ' + e.message);
  }
});

// start
(async function start() {
  try { await initChat(); } catch {}
  await startHub();
})();
