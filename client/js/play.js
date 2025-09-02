// Cena jogável genérica (House/PvP): usa ?map=<key> (padrão house).
// Input (WASD/Numpad/Mouse) + PlayerController + Camera2D + AStarGrid + ClickToMove.
// CSRF robusto, loader tolerante de tileset, respawn, sprites via YAML, sync de posição com seq/clientTs.

const QS = new URLSearchParams(location.search);
const MAP_KEY = QS.get('map') || 'house';
const TILE = 32;

// ----------------- NOVO: namespace público para outros módulos -----------------
window.GameScene = window.GameScene || {};

// =============== Canvas/HUD flexível (querystring + auto) ===============
function pickElByIds(prefIds = [], fallbackSelectors = []) {
  for (const id of prefIds) { if (!id) continue; const el = document.getElementById(id); if (el) return el; }
  for (const sel of fallbackSelectors) { const el = document.querySelector(sel); if (el) return el; }
  return null;
}
const preferCanvasId = QS.get('canvas'); // ex: ?canvas=scene
const preferHudId    = QS.get('hud');    // ex: ?hud=hud

const canvas = pickElByIds([preferCanvasId, 'view', 'scene'], ['canvas#view', 'canvas#scene', 'canvas']);
const hud    = pickElByIds([preferHudId, 'hud', 'app-hud'],    ['#hud', '#app-hud']);

if (!canvas) {
  console.error('play.js: canvas não encontrado (#view ou #scene).');
  alert('Erro: canvas não encontrado (#view/#scene).');
  throw new Error('Canvas not found');
}
const ctx = canvas.getContext('2d');

// NOVO: expõe cedo para módulos externos
window.GameScene.canvas = canvas;
window.GameScene.ctx = ctx;

// garante foco p/ WASD e click-to-move em todos os navegadores
try { canvas.setAttribute('tabindex', '0'); } catch {}
canvas.addEventListener('mousedown', () => { try { canvas.focus(); } catch {} });
canvas.addEventListener('touchstart', () => { try { canvas.focus(); } catch {} });

// helper DOM
const $ = (s) => document.querySelector(s);

// camera hoisted (evita TDZ)
let camera;

/* =========================== CSRF / HTTP ============================ */
let CSRF_TOKEN = null;
async function fetchCsrf() {
  if (CSRF_TOKEN) return CSRF_TOKEN;
  const r = await fetch('/api/csrf', { credentials: 'include' });
  const headerTok = r.headers.get('x-csrf-token') || r.headers.get('X-CSRF-Token');
  let bodyTok = null;
  try { const j = await r.json(); bodyTok = j.token || j.csrf || j.csrfToken || j.csrf_token || null; } catch {}
  CSRF_TOKEN = headerTok || bodyTok;
  return CSRF_TOKEN;
}

async function jget(url) {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} @ ${url}`);
  return r.json();
}
async function jpost(url, body) {
  const tok = await fetchCsrf().catch(()=>null);
  if (!tok) throw new Error('csrf-missing');
  const r = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    referrerPolicy: 'strict-origin-when-cross-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': tok,
    },
    body: JSON.stringify(body || {})
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} @ ${url}`);
  return r.json();
}

/* ===================== Assets: normalização de paths ===================== */
function assetUrl(p, { asTileset = false } = {}) {
  let s = String(p || '');
  if (!s) return s;
  if (/^https?:\/\//i.test(s)) return s;
  s = s.replace(/^(\.\/)+/, '');
  s = s.replace(/^client\//, '');
  s = s.replace(/^\/client\//, '/');
  if (!s.startsWith('/')) s = asTileset ? '/img/' + s : '/' + s;
  return s;
}

// --- loader de tileset compatível com teu caminho antigo do Tiled
function normalizeTilesetPath(p) {
  let s = String(p || '');
  s = s.replace(/^(\.\.\/)+/, '/');
  if (!s.startsWith('/')) s = '/' + s;
  s = s.replace(/^\/client\//, '/');
  return s;
}

async function loadTilesetImage(rawPath) {
  const primary = normalizeTilesetPath(rawPath);
  const base = primary.split('/').pop();
  const candidates = [
    primary,
    '/sprites/' + base,
    '/sprites/tiles/' + base,
    '/img/tiles/' + base,
    '/img/' + base,
    '/' + base
  ];
  for (const url of candidates) {
    const img = loadImg(url);
    const ok = await ensureImgLoaded(img);
    if (ok) return img;
  }
  console.warn('[tileset] falhou carregar. Tentativas:', candidates);
  return null;
}

/* ============================= Settings (patch mínimo) ============================= */
function applySmoothing(){
  const s = (window.GameSettings?.getState && window.GameSettings.getState()) || {};
  const smooth = !s.pixelArt; // pixelArt=true => smoothing OFF
  try {
    ctx.imageSmoothingEnabled = smooth;
    ctx.mozImageSmoothingEnabled = smooth;
    ctx.webkitImageSmoothingEnabled = smooth;
  } catch {}
}
applySmoothing();
document.addEventListener('settings:changed', () => { applySmoothing(); resize(); });

/* ============================= Resize ============================= */
function resize() {
  const shell = document.querySelector('#clientShell') || canvas.parentElement;
  const rect = shell ? shell.getBoundingClientRect() : { width: window.innerWidth * 0.9, height: window.innerHeight * 0.9 };
  const wCSS = Math.max(320, Math.floor(rect.width  || window.innerWidth  * 0.9));
  const hCSS = Math.max(200, Math.floor(rect.height || window.innerHeight * 0.9));
  const st = (window.GameSettings?.get?.() || window.GameSettings?.getState?.()) || {};
  const dprBase = window.devicePixelRatio || 1;
  const dpr = Math.min(dprBase, Number(st.dprCap || dprBase));
  canvas.style.width  = wCSS + 'px';
  canvas.style.height = hCSS + 'px';
  const w = Math.round(wCSS * dpr);
  const h = Math.round(hCSS * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  if (camera?.resize) camera.resize(canvas.width, canvas.height);
}
window.addEventListener('resize', resize);

/* ============================ Imagens ============================ */
const IMG_CACHE = new Map();
function loadImg(src) {
  const key = assetUrl(src || '');
  if (IMG_CACHE.has(key)) return IMG_CACHE.get(key);
  const img = new Image();
  img.src = key;
  IMG_CACHE.set(key, img);
  return img;
}
function imgReady(img) { return img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0; }
async function ensureImgLoaded(img) {
  if (imgReady(img)) return true;
  try { await img.decode(); return imgReady(img); } catch { return imgReady(img); }
}

/* ======== Índice tolerante para sprites (YAML) + loader robusto ======== */
let SPRITES_META = {};
let SPRITE_INDEX = new Map(); // chave normalizada -> meta

function normKey(s) {
  return String(s || '')
    .replace(/\\/g, '/')
    .replace(/^.*\//, '')
    .replace(/\.(png|jpg|jpeg|gif|webp)$/i, '')
    .replace(/[\s_]+/g, '-')
    .toLowerCase()
    .trim();
}

function indexSpriteMeta(obj) {
  SPRITE_INDEX.clear();
  for (const [key, data] of Object.entries(obj || {})) {
    const nk = normKey(key);
    SPRITE_INDEX.set(nk, data);
    if (data?.image) SPRITE_INDEX.set(normKey(data.image), data);
    if (Array.isArray(data?.aliases)) {
      for (const a of data.aliases) SPRITE_INDEX.set(normKey(a), data);
    }
  }
}

async function loadSpriteMeta() {
  const list = await jget('/api/assets/sprites'); // [{ key, kind, data }]
  SPRITES_META = Object.fromEntries(list.map(e => [e.key, e.data]));
  indexSpriteMeta(SPRITES_META);
}

function findMetaFor(spawnKey) {
  const tries = [spawnKey, String(spawnKey || '').toLowerCase(), String(spawnKey || '').replace(/[\s_]+/g,'-'), normKey(spawnKey)];
  for (const t of tries) {
    const m = SPRITE_INDEX.get(normKey(t));
    if (m) return m;
  }
  const nk = normKey(spawnKey);
  for (const [k, m] of SPRITE_INDEX.entries()) if (k.includes(nk)) return m;
  return null;
}

function buildMonsterCandidates(kindNorm, meta) {
  const base = normKey(kindNorm);
  const fromMeta = meta?.image ? assetUrl(meta.image) : null;
  const metaBase = fromMeta ? fromMeta.replace(/^(\.\/)+/,'') : null;
  return [
    fromMeta,
    metaBase,
    `/sprites/monsters/${base}.png`,
    `/sprites/${base}.png`,
    `/img/monsters/${base}.png`,
    `/img/${base}.png`,
    `/${base}.png`
  ].filter(Boolean);
}

async function loadMonsterImg(kindNorm, meta) {
  const candidates = buildMonsterCandidates(kindNorm, meta);
  for (const url of candidates) {
    const img = loadImg(url);
    const ok = await ensureImgLoaded(img);
    if (ok) return img;
  }
  console.warn(`[mob sprite] falhou carregar: ${kindNorm}. Tentativas:`, candidates);
  return null;
}

/* ========================= Estado do Mapa ========================= */
let mapData = null;
let tileset = null;
let tilesetImg = null;
let groundLayer = null;

let starts = [];
let spawns = [];

/* ========================= Spawners / Mobs ======================== */
const spawners = [];
const mobs = [];
let mobAutoId = 1;

/* ========================= Player Visual ========================== */
const playerVis = { w: 32, h: 32, img: null, heroKey: null };

/* ============================== Render ============================ */
function clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); }

function drawGround(cameraObj) {
  if (!groundLayer || !tileset || !imgReady(tilesetImg)) return;
  const data = groundLayer.data;
  const cols = mapData.width;
  const rows = mapData.height;
  const first = tileset.firstgid || 1;
  const tw = tileset.tilewidth, th = tileset.tileheight;
  const columnsInImage = tileset.columns;

  const x0 = Math.max(0, Math.floor(cameraObj.x / TILE));
  const y0 = Math.max(0, Math.floor(cameraObj.y / TILE));
  const x1 = Math.min(cols - 1, Math.ceil((cameraObj.x + cameraObj.w) / TILE));
  const y1 = Math.min(rows - 1, Math.ceil((cameraObj.y + cameraObj.h) / TILE));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const gid = data[y * cols + x];
      if (!gid || gid < first) continue;
      const id = gid - first;
      const sx = (id % columnsInImage) * tw;
      const sy = Math.floor(id / columnsInImage) * th;
      ctx.drawImage(tilesetImg, sx, sy, tw, th, x * TILE, y * TILE, TILE, TILE);
    }
  }
}

function drawPlayer(controller) {
  const p = controller.getPosition();
  if (imgReady(playerVis.img)) {
    const ox = Math.round(p.x - playerVis.w * 0.5);
    const oy = Math.round(p.y - playerVis.h * 0.9);
    ctx.drawImage(playerVis.img, ox, oy, playerVis.w, playerVis.h);
  } else {
    ctx.save();
    ctx.fillStyle = "#f59e0b";
    ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

function drawMob(m) {
  if (m.meta && imgReady(m.img)) {
    const meta   = m.meta;
    const frameW = meta.frame?.width  ?? 32;
    const frameH = meta.frame?.height ?? 32;
    const cols   = meta.grid?.cols ?? 1;
    const rows   = meta.grid?.rows ?? 1;

    const anim = meta.anims?.walk || { fps: 8, frames: cols, row: 0, startCol: 0 };
    const fps      = anim.fps || 8;
    const frames   = anim.frames || cols;
    const startCol = anim.startCol || 0;

    let row = typeof anim.row === 'number' ? anim.row : 0;
    if (anim.rowByDir && m.face && anim.rowByDir[m.face] != null) row = anim.rowByDir[m.face];

    const t = performance.now() / 1000;
    const f = Math.floor(t * fps) % frames;
    const col = startCol + f;

    const sx = (col % cols) * frameW;
    const sy = (row % rows) * frameH;

    const anchorX = (meta.anchor?.x ?? 0.5);
    const anchorY = (meta.anchor?.y ?? 0.9);
    const dw = frameW, dh = frameH;
    const ox = Math.round(m.x - dw * anchorX);
    const oy = Math.round(m.y - dh * anchorY);

    const canFlipX = !anim.rowByDir && rows === 1 && m.face === 'west';

    ctx.save();
    if (canFlipX) { ctx.translate(ox + dw, oy); ctx.scale(-1, 1); ctx.drawImage(m.img, sx, sy, frameW, frameH, 0, 0, dw, dh); }
    else { ctx.drawImage(m.img, sx, sy, frameW, frameH, ox, oy, dw, dh); }
    ctx.restore();
    return;
  }

  // Fallback: dot vermelho
  ctx.save();
  ctx.fillStyle = "#ef4444";
  ctx.beginPath(); ctx.arc(m.x, m.y, 7, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/* ======================= Posição Persistente ======================= */
let POS_SYNC_ENABLED = true;
let lastSaveAt = 0;
let posSeq = 0; // ajuda o servidor a ordenar e bloquear replay

async function postPosThrottled(mapKey, x, y) {
  if (!POS_SYNC_ENABLED) return;
  const now = performance.now();
  if (now - lastSaveAt < 1200) return; // 1.2s pra reduzir chamadas
  lastSaveAt = now;
  try {
    posSeq += 1;
    await jpost('/api/player/pos', {
      mapKey,
      x: Math.round(x),
      y: Math.round(y),
      seq: posSeq,
      clientTs: Date.now()
    });
  } catch (e) {
    const msg = String(e.message || '');
    if (msg.includes('403') || msg.includes('csrf-missing') ||
        msg.includes('429') || msg.includes('409')) {
      POS_SYNC_ENABLED = false; // desliga após 1a falha de auth/csrf/rate/replay
    } else {
      console.warn('pos sync failed:', msg);
    }
  }
}

async function getSavedPos() {
  try {
    const p = await jget(`/api/player/pos?map=${encodeURIComponent(MAP_KEY)}`);
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return { x: p.x, y: p.y };
  } catch {}
  return null;
}

/* ==================== Colisão e Spawns do Tiled ==================== */
function buildCollisionGridFromObjects(mapW, mapH, objs) {
  const cols = Math.floor(mapW / TILE);
  const rows = Math.floor(mapH / TILE);
  const grid = new Uint8Array(cols * rows);
  for (const o of objs) {
    const oType = String(o.type || '').toLowerCase();
    const isSolid = oType === 'solid' || (o.properties || []).some(p => p.name === 'solid' && (p.value === true || p.value === 1));
    if (!isSolid) continue;
    const x0 = Math.floor(o.x / TILE), y0 = Math.floor(o.y / TILE);
    const x1 = Math.floor((o.x + o.width  - 1) / TILE);
    const y1 = Math.floor((o.y + o.height - 1) / TILE);
    for (let cy=y0; cy<=y1; cy++) for (let cx=x0; cx<=x1; cx++) {
      if (cx>=0 && cy>=0 && cx<cols && cy<rows) grid[cy*cols + cx] = 1;
    }
  }
  return { grid, cols, rows };
}

function buildCollisionGridFromTiled(json) {
  const cols = json.width, rows = json.height;
  const grid = new Uint8Array(cols * rows);
  const collisionLayer = (json.layers || []).find(l => l.type === 'tilelayer' && l.name && l.name.toLowerCase().includes('collision'));
  if (collisionLayer && collisionLayer.data) {
    for (let i=0; i<collisionLayer.data.length; i++) if (i < grid.length && collisionLayer.data[i]) grid[i] = 1;
  }
  return { grid, cols, rows };
}

function mapSpawnsFromTiledJSON(json) {
  const layer = (json.layers || []).find(
    (l) => l.type === "objectgroup" && l.name && l.name.toLowerCase() === "spawn"
  );
  if (!layer) return [];
  return (layer.objects || [])
    .filter((o) => ((o.class || o.type || "") + "").toLowerCase() === "spawn")
    .map((o) => {
      const p = {}; (o.properties || []).forEach((kv) => { p[kv.name] = kv.value; });
      const monsterKey = String(p.monsterKey || p.monster || "goblin");
      const count = Number(p.count || 1) || 1;
      const respawnSec = Number(p.respawnSec || p.respawn || 20) || 20;
      const w = o.width  > 0 ? o.width  : TILE;
      const h = o.height > 0 ? o.height : TILE;
      return { monsterKey, count, respawnSec, x: o.x || 0, y: o.y || 0, w, h };
    });
}

/* ===================== Resolução de Sprite Player ===================== */
async function resolvePlayerSprite() {
  try {
    const me = await jget('/api/player/me');
    const heroes = Array.isArray(me.heroes) ? me.heroes : [];
    const starter = heroes.find(h => h.isStarter === 1 || h.isStarter === true) || heroes[0];
    if (starter) {
      playerVis.heroKey = starter.heroKey || starter.key || null;
      const candidate = playerVis.heroKey ? `/sprites/characters/${playerVis.heroKey}.png` : null;
      if (candidate) {
        playerVis.img = loadImg(candidate);
        await ensureImgLoaded(playerVis.img).catch(()=>{});
        if (imgReady(playerVis.img)) return;
      }
      if (starter.imageUrl) {
        playerVis.img = loadImg(starter.imageUrl);
        await ensureImgLoaded(playerVis.img).catch(()=>{});
        if (imgReady(playerVis.img)) return;
      }
    }
  } catch (e) { console.warn('resolvePlayerSprite:', e.message); }
  playerVis.img = loadImg("/sprites/characters/player.png");
  ensureImgLoaded(playerVis.img).catch(()=>{});
}

/* =========================== Respawn Manager ========================== */
function addMobFromSpawn(spDef) {
  const rawKey  = spDef.monsterKey || spDef.monster || "goblin";
  const kindNorm = normKey(rawKey);
  const meta = findMetaFor(rawKey);

  const m = {
    id: mobAutoId++,
    kind: kindNorm,
    x: (spDef.x || 0) + Math.random() * (spDef.w || TILE),
    y: (spDef.y || 0) + Math.random() * (spDef.h || TILE),
    w: 32, h: 32,
    speed: 40 + Math.random() * 20,
    dirX: 0, dirY: 0, changeAt: 0,
    face: 'east',
    img: null, meta: meta || null,
    bound: (spDef.w || spDef.h) ? { x: spDef.x || 0, y: spDef.y || 0, w: spDef.w || TILE, h: spDef.h || TILE } : null,
  };

  loadMonsterImg(kindNorm, meta).then(img => { if (img) m.img = img; });
  mobs.push(m);
  return m.id;
}

function buildSpawnersFromDefs(defs) {
  spawners.length = 0;
  defs.forEach(d => {
    const want = Math.max(1, Number(d.count || 1));
    const respawnMs = Math.max(1, Number(d.respawnSec || d.respawn || 20)) * 1000;
    spawners.push({
      def: d,
      want,
      respawnMs,
      nextAt: performance.now(),
      area: { x: d.x||0, y: d.y||0, w: d.w||TILE, h: d.h||TILE },
      liveIds: new Set()
    });
  });
}

function updateRespawns(now) {
  for (const sp of spawners) {
    for (const id of Array.from(sp.liveIds)) {
      if (!mobs.some(m => m.id === id)) sp.liveIds.delete(id);
    }
    while (sp.liveIds.size < sp.want && now >= sp.nextAt) {
      const id = addMobFromSpawn(sp.def);
      sp.liveIds.add(id);
      sp.nextAt = now + sp.respawnMs;
    }
  }
}

/* ================================ Boot ================================ */
(async function main() {
  // pega CSRF e cookies antes de qualquer POST
  await fetchCsrf().catch(()=>{});

  await loadSpriteMeta();

  // aplica tamanho inicial
  resize();

  const maps = await jget("/api/admin/content/maps");
  if (!maps.some((m) => m.key === MAP_KEY)) throw new Error(`map ${MAP_KEY} não encontrado`);

  // helper para normalizar payloads que podem vir string/array/obj
  function normalizeApiJson(payload) {
    let v = payload;
    if (Array.isArray(v)) v = v[0];
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch {} }
    return v;
  }

  // Objetos do mapa (starts/solids)
  const rawObjs = await jget(`/api/admin/content/map/${MAP_KEY}/objects`);
  const objsNorm = normalizeApiJson(rawObjs);
  const objArr = Array.isArray(objsNorm)
    ? objsNorm
    : (objsNorm && Array.isArray(objsNorm.objects) ? objsNorm.objects : []);
  starts = objArr.filter(o => (o.type || '').toLowerCase() === 'start');

  // Data (tiles)
  const rawMap = await jget(`/api/admin/content/map/${MAP_KEY}/data`);
  mapData = normalizeApiJson(rawMap);

  tileset = (mapData && mapData.tilesets && mapData.tilesets[0]) || null;

  if (!tileset || !tileset.image) {
    console.warn("Tileset não embedado. No Tiled: 'Embed Tileset' e exporte novamente o JSON.");
  } else {
    tilesetImg = await loadTilesetImage(tileset.image);
  }

  groundLayer = (mapData.layers || []).find(
    (l) => l.type === "tilelayer" && l.name && l.name.toLowerCase() === "ground"
  );

  // Colisão (objetos sólidos preferidos; fallback layer "collision")
  const mapW = (mapData.width || 64) * TILE;
  const mapH = (mapData.height || 64) * TILE;

  function hasSolidProp(o){ return (o.properties || []).some(p => p.name === 'solid' && (p.value === true || p.value === 1)); }
  const collBuild = objArr.some(o => String(o.type||'').toLowerCase()==='solid' || hasSolidProp(o))
    ? buildCollisionGridFromObjects(mapW, mapH, objArr)
    : buildCollisionGridFromTiled(mapData);

  const cols = collBuild.cols || (mapData.width || 64);
  const rows = collBuild.rows || (mapData.height || 64);
  const worldW = cols * TILE;
  const worldH = rows * TILE;
  const grid = collBuild.grid || new Uint8Array(cols * rows);

  // Instâncias centrais
  camera = new Camera2D({
    width: canvas.width,
    height: canvas.height,
    worldWidth: worldW,
    worldHeight: worldH
  });

  // Polyfills e zoom + apply
  if (typeof camera.getZoom !== 'function') camera.getZoom = () => (camera.zoom && Number(camera.zoom)) || 1;
  if (typeof camera.setZoom !== 'function') camera.setZoom = (z) => { camera.zoom = Number(z) || 1; };
  if (typeof camera.screenToWorld !== 'function') camera.screenToWorld = (sx, sy) => {
    const z = camera.getZoom ? Number(camera.getZoom()) || 1 : 1;
    return { x: camera.x + (sx / z), y: camera.y + (sy / z) };
  };
  if (typeof camera.worldToScreen !== 'function') camera.worldToScreen = (wx, wy) => {
    const z = camera.getZoom ? Number(camera.getZoom()) || 1 : 1;
    return { x: (wx - camera.x) * z, y: (wy - camera.y) * z };
  };
  if (typeof camera.apply !== 'function') {
    camera.apply = (ctx, draw) => { ctx.save(); ctx.translate(-camera.x, -camera.y); draw(); ctx.restore(); };
  }

  function applyCameraZoom(){
    const st = (window.GameSettings?.getState && window.GameSettings.getState()) || { zoom: 1 };
    if (typeof camera.setZoom === 'function') camera.setZoom(Number(st.zoom || 1));
  }
  applyCameraZoom();
  document.addEventListener('settings:changed', () => { applyCameraZoom(); resize(); });

  const controller = new PlayerController({
    speed: 140,
    collisionGrid: grid,
    cols, rows,
    onMoved: (x,y) => postPosThrottled(MAP_KEY, x, y)
  });

  // NOVO: expõe câmera e controller
  window.GameScene.camera = camera;
  window.GameScene.controller = controller;
  window.GameScene.mapKey = MAP_KEY;

  const astar = new AStarGrid(grid, cols, rows);
  const clickMove = new ClickToMove({ canvas, camera, controller, grid });
  clickMove.setAStar(astar);

  // Input
  Input.attach(window, canvas);
  resize();

  // Posição inicial
  const saved = await getSavedPos();
  if (saved) controller.setPosition(saved.x, saved.y);
  else if (starts[0]) controller.setPosition(starts[0].x, starts[0].y);
  else controller.setPosition(TILE*2 + TILE/2, TILE*2 + TILE/2);

  camera.follow(controller);
  await resolvePlayerSprite();

  // Spawns de mobs
  try { spawns = await jget(`/api/admin/content/map/${MAP_KEY}/spawns`); } catch { spawns = []; }
  if (!Array.isArray(spawns) || spawns.length === 0) {
    spawns = mapSpawnsFromTiledJSON(mapData);
    console.log("spawns fallback (JSON):", spawns);
  } else {
    console.log("spawns do servidor:", spawns);
  }

  // Monta respawners e popula inicial
  buildSpawnersFromDefs(spawns);
  const now0 = performance.now();
  for (const s of spawners) {
    while (s.liveIds.size < s.want) s.liveIds.add(addMobFromSpawn(s.def));
    s.nextAt = now0 + s.respawnMs;
  }

  // NOVO: sinaliza que a cena está pronta (outros módulos podem iniciar)
  window.dispatchEvent(new CustomEvent('game:ready', { detail: { canvas, ctx, camera, controller } }));

  // Loop principal
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    // Click-to-move
    const m = Input.getMouse();
    if (Input.consumeClick()) {
      const rect = canvas.getBoundingClientRect();
      clickMove.handleClick(m.x - rect.left, m.y - rect.top);
    }

    // Teclado
    const dir = Input.getDir();
    controller.update(dt, dir);
    camera.update(dt);

    // AI placeholder dos mobs
    for (const mob of mobs) {
      if (now >= mob.changeAt) {
        const ang = Math.random() * Math.PI * 2;
        mob.dirX = Math.cos(ang);
        mob.dirY = Math.sin(ang);
        mob.changeAt = now + 700 + Math.random() * 1300;
      }
      mob.x += mob.dirX * mob.speed * dt;
      mob.y += mob.dirY * mob.speed * dt;

      const mag = Math.hypot(mob.dirX, mob.dirY);
      if (mag > 0.1) {
        if (Math.abs(mob.dirX) >= Math.abs(mob.dirY)) mob.face = mob.dirX >= 0 ? 'east' : 'west';
        else mob.face = mob.dirY >= 0 ? 'south' : 'north';
      }
      if (mob.bound) {
        const { x, y, w, h } = mob.bound;
        if (mob.x < x)   { mob.x = x;   mob.dirX *= -1; }
        if (mob.y < y)   { mob.y = y;   mob.dirY *= -1; }
        if (mob.x > x+w) { mob.x = x+w; mob.dirX *= -1; }
        if (mob.y > y+h) { mob.y = y+h; mob.dirY *= -1; }
      }
    }

    // Respawn local (placeholder visual)
    updateRespawns(now);

    // Render (mundo)
    clear();
    camera.apply(ctx, () => {
      drawGround(camera);
      for (const m of mobs) {
        drawMob(m);
      }
      drawPlayer(controller);
    });

    // NOVO: Hook de render do módulo de combate (se existir)
    if (window.CombatUI && typeof window.CombatUI.render === 'function') {
      try { window.CombatUI.render(ctx, camera, dt); } catch (e) { /* silencia para não quebrar o jogo */ }
    }

    // NOVO: evento por frame (útil para animações de dano/floaters)
    window.dispatchEvent(new CustomEvent('game:frame', { detail: { ctx, camera, dt } }));

    // HUD
    if (hud) {
      const p = controller.getPosition();
      hud.innerHTML = `
        <div>map: ${MAP_KEY}</div>
        <div>Move: Click-to-move • WASD/Setas/Numpad</div>
        <div>pos: ${Math.round(p.x)}, ${Math.round(p.y)}</div>
        <div>mobs: ${mobs.length} • spawns: ${spawners.length}</div>
      `;
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})().catch((err) => {
  console.error(err);
  if (hud) hud.textContent = "Erro: " + err.message;
});
  