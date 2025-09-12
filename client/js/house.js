/*
  Substituição/versão ampliada de house.js
  - WASD / setas para mover o player
  - game loop (rAF)
  - câmera que segue o player
  - carrega spawns do endpoint /api/admin/content/map/:map/spawns
  - carrega dados de monsters do endpoint /api/admin/content/monsters
  - tenta conectar WebSocket para sincronizar posições (fallback polling)
  - desenha sprites se spriteKey estiver disponível em monsters_master.lookJSON
*/

/*
  Substituição/versão ampliada de house.js
  - WASD / setas para mover o player
  - game loop (rAF)
  - câmera que segue o player
  - carrega spawns do endpoint /api/admin/content/map/:map/spawns
  - carrega dados de monsters do endpoint /api/admin/content/monsters
  - usa WebSocket singleton para posições e chat (um único WS por aba)
  - desenha sprites com fallback seguro evitando erro de drawImage quando PNG 404
*/

/* client/js/house.js */
import { getSocket, onMessage, wsSend, authenticate } from './ws/singleton.js';

const MAP_KEY = 'house';
const TILE = 32;
const $ = (id) => document.getElementById(id);
const canvas = $('scene');
const ctx = canvas?.getContext?.('2d');
const statusEl = $('status');
const startPosEl = $('startPos');
const spawnListEl = $('spawnList');
const btnReload = $('btnReload');

function setStatus(t) { if (statusEl) statusEl.textContent = t; }
function clearCanvas() { if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height); }

/* ---------------- HTTP helpers (mantive fetch com credentials) ---------------- */
async function jget(url) {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} @GET ${url}`);
  return r.json();
}
async function postWithCsrf(url) {
  const t = await fetch('/api/csrf', { credentials: 'include' }).then(r => r.json());
  const r = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-CSRF-Token': t.csrfToken }
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} @POST ${url}`);
  return r.json();
}

/* ---------------- world / camera / entities ---------------- */
let mapData = null;
let groundLayer = null;
let tileset = null;
let tilesetImg = null;

const player = { id: 'me', type: 'player', x: 160, y: 160, w: 28, h: 40, speed: 140, name: 'Você', hp: 100, maxHp: 100 };
let entities = [];           // monsters + remote players
let monstersByKey = {};      // master de monstros por key

const camera = { x: 0, y: 0, w: canvas?.width || 0, h: canvas?.height || 0, lerp: 0.2, follow: player };
function syncCameraSize() {
  if (!canvas) return;
  camera.w = canvas.width;
  camera.h = canvas.height;
}
window.addEventListener('resize', syncCameraSize);
syncCameraSize();

let keys = {};
window.addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; });
window.addEventListener('keyup',   e => { keys[e.key.toLowerCase()] = false; });

/* ---------------- Sprite loader com fallback seguro ---------------- */
const IMG_CACHE = new Map();

function loadImgWithCandidates(candidates) {
  const key = candidates.join('|');
  if (IMG_CACHE.has(key)) return IMG_CACHE.get(key);

  const img = new Image();
  img.__candidates = candidates.slice();
  img.__idx = 0;
  img.__broken = false;

  img.onload = () => { /* ok */ };
  img.onerror = () => {
    const next = ++img.__idx;
    if (next < img.__candidates.length) {
      img.src = img.__candidates[next];
    } else {
      img.__broken = true;
    }
  };

  // inicia com o primeiro candidato
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

/* ---------------- draw helpers (map + entities) ---------------- */
function drawGrid(cols, rows) {
  if (!ctx) return;
  ctx.save();
  ctx.strokeStyle = '#1f2937';
  ctx.lineWidth = 1;
  for (let x = 0; x <= cols; x++) { ctx.beginPath(); ctx.moveTo(x * TILE + .5, 0); ctx.lineTo(x * TILE + .5, rows * TILE); ctx.stroke(); }
  for (let y = 0; y <= rows; y++) { ctx.beginPath(); ctx.moveTo(0, y * TILE + .5); ctx.lineTo(cols * TILE, y * TILE + .5); ctx.stroke(); }
  ctx.restore();
}

function worldToScreen(wx, wy) {
  return { x: Math.round(wx - camera.x), y: Math.round(wy - camera.y) };
}

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
    // placeholder caso sprite não exista
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

/* ---------------- update loop ---------------- */
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

  // câmera segue o player
  camera.x += (player.x - camera.x - camera.w / 2) * camera.lerp;
  camera.y += (player.y - camera.y - camera.h / 2) * camera.lerp;

  // animação simples de monstros
  for (const e of entities) {
    if (e.type === 'monster') {
      e._tick = (e._tick || 0) + dt;
      e.x += Math.sin(e._tick * 0.5) * 0.4;
    }
  }
}

/* ---------------- Networking (WS singleton): posições ---------------- */
function initPosSync() {
  getSocket(); // garante conexão
  onMessage('pos', (d) => {
    if (!d || !d.id || d.id === player.id) return;
    let p = entities.find(x => x.id === d.id && x.type === 'player_remote');
    if (!p) {
      p = { id: d.id, type: 'player_remote', x: d.x, y: d.y, w: 28, h: 40, name: d.name || 'Player', hp: 100, maxHp: 100 };
      entities.push(p);
    } else { p.x = d.x; p.y = d.y; }
  });
}
function sendMyPos() {
  wsSend({ type: 'pos', id: String(player.id), x: Math.round(player.x), y: Math.round(player.y), name: player.name });
}

/* ---------------- merge helpers ---------------- */
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

/* ---------------- boot / start loop ---------------- */
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

    // Mapa (Tiled JSON embutido)
    try {
      let raw = await jget(`/api/admin/content/map/${MAP_KEY}/data`);
      if (Array.isArray(raw)) raw = raw[0];
      if (typeof raw === 'string') {
        try { raw = JSON.parse(raw); } catch {}
      }
      mapData = raw;

      tileset = (mapData && mapData.tilesets && mapData.tilesets[0]) || null;
      if (tileset && tileset.image) {
        // normaliza caminhos tipo "../../../client/..." ou sem barra
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

    // Monsters master
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

    // Inicia handlers de posição via WS singleton
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

// btn reload on UI
if (btnReload) btnReload.addEventListener('click', async () => {
  try {
    setStatus('Recarregando mapa no servidor…');
    const j = await postWithCsrf(`/api/admin/content/reload-map?map=${MAP_KEY}`);
    console.log('reload response:', j);
    await startHub();
  } catch (e) {
    console.error(e);
    setStatus('Erro: ' + e.message);
  }
});

/* ---------------- chat UI (global) usando singleton ---------------- */
const btnDefault = document.getElementById('btnDefault');
const btnGlobal  = document.getElementById('btnGlobal');
const chatBox    = document.getElementById('chatBox');
const chatInput  = document.getElementById('chatInput');
const chatSend   = document.getElementById('chatSend');

function escapeHtml(s) {
  return (s || '').toString().replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function appendChatRow(msg) {
  if (!chatBox) return;
  const d = document.createElement('div');
  d.className = 'chat-row';
  const time = new Date(msg.ts || Date.now()).toLocaleTimeString();
  d.innerHTML = `<strong>${escapeHtml(msg.fromName || 'Anon')}</strong>: ${escapeHtml(msg.text)} <span class="muted">(${time})</span>`;
  chatBox.appendChild(d);
  chatBox.scrollTop = chatBox.scrollHeight;
}

async function initChat() {
  if (!chatBox || !chatInput || !chatSend || !btnDefault || !btnGlobal) return;

  getSocket(); // garante conexão única

  // autentica e salva identidade (para o servidor vincular mensagens)
  await authenticate(async () => {
    const meRaw = await jget('/api/player/me').catch(()=>null);
    const me = (meRaw && meRaw.profile) ? meRaw.profile : meRaw;
    const id = String((me && (me.id || me.playerId)) || '');
    const name = (me && (me.name || me.username || me.displayName)) || 'Você';
    try { window._chat_me = { id, name }; } catch {}
    return { id, name };
  });

  // histórico (uma vez)
  try {
    const hist = await jget('/api/chat/global?limit=200');
    for (const m of hist) {
      appendChatRow({ fromName: m.fromName || 'Anon', text: m.text, ts: (new Date(m.created_at)).getTime() });
    }
  } catch {}

  // recebe mensagens via WS
  onMessage('chat', (d) => {
    if (d.scope !== 'global') return;
    appendChatRow({ fromName: d.fromName, text: d.text, ts: d.ts || Date.now() });
  });

  // UI
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

/* ---------------- start ---------------- */
(async function start() {
  try {
    await initChat();
  } catch {}
  await startHub();
})();