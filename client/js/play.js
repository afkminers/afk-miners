// client/js/play.js
// Cena jogável genérica (House/PvP): usa ?map=<key> (padrão house).
// Input (WASD/Numpad/Mouse) + PlayerController + Camera2D + AStarGrid + ClickToMove.
// CSRF robusto, loader tolerante de tileset, sprites via YAML, sync de posição com seq/clientTs.
// AGORA: mobs são 100% dirigidos pelo servidor (eventos WS), sem IA/respawn local.

const QS = new URLSearchParams(location.search);
const MAP_KEY = QS.get('map') || 'house';
const TILE = 32;

// ----------------- namespace público para outros módulos -----------------
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

// expõe cedo
window.GameScene.canvas = canvas;
window.GameScene.ctx = ctx;

// foco para WASD e click-to-move
try { canvas.setAttribute('tabindex', '0'); } catch {}
canvas.addEventListener('mousedown', () => { try { canvas.focus(); } catch {} });
canvas.addEventListener('touchstart', () => { try { canvas.focus(); } catch {} });

// helper DOM
const $ = (s) => document.querySelector(s);

// camera hoisted
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
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': tok },
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
    if (Array.isArray(data?.aliases)) for (const a of data.aliases) SPRITE_INDEX.set(normKey(a), data);
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

/* ========================= Mobs (server-driven) ======================== */
const mobs = [];                           // lista para render
window.GameScene.mobs = mobs;              // (mantido por compatibilidade)
const mobsById = new Map();                // instanceId -> mob

function upsertMobFromServer({ id, monsterKey, x, y }) {
  const key = String(monsterKey || 'goblin');
  let m = mobsById.get(String(id));
  if (!m) {
    const kindNorm = normKey(key);
    const meta = findMetaFor(key);
    m = {
      id: String(id),
      instanceId: String(id),
      kind: kindNorm,
      x: Number(x || 0),
      y: Number(y || 0),
      w: 32, h: 32,
      face: 'south',
      img: null,
      meta: meta || null,
      dead: false,
    };
    loadMonsterImg(kindNorm, meta).then(img => { if (img) m.img = img; });
    mobsById.set(m.id, m);
    mobs.push(m);
  } else {
    if (typeof x === 'number') m.x = x;
    if (typeof y === 'number') m.y = y;
    m.dead = false;
  }
}

// integra com os eventos disparados pelo módulo ws-combat.js
window.addEventListener('combat:monster_respawned', (ev) => {
  upsertMobFromServer(ev.detail || {});
});
window.addEventListener('combat:monster_dead', (ev) => {
  const id = String(ev.detail?.id || '');
  const m = mobsById.get(id);
  if (m) m.dead = true; // opcional: pode remover da lista se preferir
});
// NOVO: aplica movimentos imediatamente
window.addEventListener('combat:monster_move', (ev) => {
  const { id, x, y } = ev.detail || {};
  const m = mobsById.get(String(id));
  if (!m) return;
  if (Number.isFinite(x)) m.x = x;
  if (Number.isFinite(y)) m.y = y;
});

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
let posSeq = 0;

async function postPosThrottled(mapKey, x, y) {
  if (!POS_SYNC_ENABLED) return;
  const now = performance.now();
  if (now - lastSaveAt < 1200) return;
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
      POS_SYNC_ENABLED = false;
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

/* ==================== Colisão e objetos do Tiled ==================== */
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

/* ===================== Resolução de Sprite Player ===================== */
async function resolvePlayerSprite() {
  try {
    const me = await jget('/api/player/me');
    const heroes = Array.isArray(me.heroes) ? me.heroes : [];
    const starter = heroes.find(h => h.isStarter === 1 || h.isStarter === true) || heroes[0];

    // >>> PATCH: salva heroId globalmente <<<
    if (starter) {
      const hid = starter.id ?? starter.heroId ?? null;
      if (hid) {
        window.MyHeroId = String(hid);
        try { localStorage.setItem('myHeroId', String(hid)); } catch {}
      }
    }
    // <<< fim do patch >>>

    if (starter) {
      playerVis.heroKey = starter.heroKey || starter.key || null;
      const candidate = playerVis.heroKey
        ? `/sprites/characters/${playerVis.heroKey}.png`
        : null;
      if (candidate) {
        playerVis.img = loadImg(candidate);
        await ensureImgLoaded(playerVis.img).catch(() => {});
        if (imgReady(playerVis.img)) return;
      }
      if (starter.imageUrl) {
        playerVis.img = loadImg(starter.imageUrl);
        await ensureImgLoaded(playerVis.img).catch(() => {});
        if (imgReady(playerVis.img)) return;
      }
    }
  } catch (e) {
    console.warn('resolvePlayerSprite:', e.message);
  }

  // fallback se não achou nada
  playerVis.img = loadImg("/sprites/characters/player.png");
  ensureImgLoaded(playerVis.img).catch(() => {});
}


/* ================================ Boot ================================ */
(async function main() {
  await fetchCsrf().catch(()=>{});
  await loadSpriteMeta();
  resize();

  const maps = await jget("/api/admin/content/maps");
  if (!maps.some((m) => m.key === MAP_KEY)) throw new Error(`map ${MAP_KEY} não encontrado`);

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
  const starts = objArr.filter(o => (o.type || '').toLowerCase() === 'start');

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

  // Colisão
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

  // Polyfills/zoom
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

  // expõe para módulos
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

  // Sinaliza que a cena está pronta (módulos como CombatUI podem iniciar)
  window.dispatchEvent(new CustomEvent('game:ready', { detail: { canvas, ctx, camera, controller } }));

  // Loop principal
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    // Click-to-move (pula se o ataque consumiu o clique)
    const m = Input.getMouse();
    if (Input.consumeClick()) {
      const now = performance.now();
      if (!window.__suppressClickToMoveUntil || now > window.__suppressClickToMoveUntil) {
        const rect = canvas.getBoundingClientRect();
        clickMove.handleClick(m.x - rect.left, m.y - rect.top);
      }
    }


    // Teclado
    const dir = Input.getDir();
    controller.update(dt, dir);
    camera.update(dt);

    // Render (mundo)
    clear();
    camera.apply(ctx, () => {
      drawGround(camera);
      for (const mob of mobs) {
        if (mob.dead) continue; // opcional: ocultar mortos
        drawMob(mob);
      }
      drawPlayer(controller);
    });

    // Sincroniza POSIÇÃO da sprite com o estado do WS (correção)
    if (window.combatState?.monsters) {
      for (const [id, st] of window.combatState.monsters) {
        const mob = mobsById.get(String(id));
        if (mob) {
          if (Number.isFinite(st.x)) mob.x = st.x;
          if (Number.isFinite(st.y)) mob.y = st.y;
        }
      }
    }

    // UI de combate por cima (hp bars, target, floaters)
    if (window.CombatUI && typeof window.CombatUI.render === 'function') {
      try { window.CombatUI.render(ctx, camera, dt); } catch (e) {}
    }

    // evento por frame (para animações externas)
    window.dispatchEvent(new CustomEvent('game:frame', { detail: { ctx, camera, dt } }));

    // HUD (conta vindo do estado WS; fallback lista local)
    if (hud) {
      const p = controller.getPosition();
      const wsCount = (window.combatState?.monsters?.size) ?? null;
      const mobCount = (typeof wsCount === 'number') ? wsCount : mobs.length;

      hud.innerHTML = `
        <div>map: ${MAP_KEY}</div>
        <div>Move: Click-to-move • WASD/Setas/Numpad</div>
        <div>pos: ${Math.round(p.x)}, ${Math.round(p.y)}</div>
        <div>mobs: ${mobCount}</div>
      `;
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})().catch((err) => {
  console.error(err);
  if (hud) hud.textContent = "Erro: " + err.message;
});
