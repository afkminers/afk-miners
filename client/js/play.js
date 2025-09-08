// Cena jogável genérica (House/PvP): usa ?map=<key> (padrão house).
// Input (WASD/Numpad/Mouse) + PlayerController + Camera2D + AStarGrid + ClickToMove.
// Requests HTTP centralizadas em client/js/api.js (CSRF automático).

import { getCsrf, apiGet, apiPost } from './api.js';
import { CombatActions } from './combat/actions.js';


const QS = new URLSearchParams(location.search);
const MAP_KEY = QS.get('map') || 'house';
const TILE = 32;

// ----------------- namespace público p/ outros módulos -----------------
window.GameScene = window.GameScene || {};

// ==== BINDING ESTÁVEL (sem gambiarra): instanceId <-> sprite; spawnId -> Set<sprites> ====
const MOB_BY_INSTANCE = new Map();        // instanceId (UUID) -> sprite (obj do array mobs)
const MOB_SPRITES_BY_SPAWN = new Map();   // spawnId (int) -> Set<sprite>

window.GameScene.getMobByInstanceId = (id) => MOB_BY_INSTANCE.get(String(id)) || null;

// === bind por monsterKey quando não tiver spawnId do servidor ===
window.GameScene.bindInstanceToAnySpriteByKey = (instanceId, monsterKey) => {
  const want = String(monsterKey || '').trim().toLowerCase();
  let best = null;
  for (const s of window.GameScene.mobs || []) {
    const sameKind =
      (String(s.kind || s.key || '').toLowerCase() === want) ||
      (String(s.meta?.image || '').toLowerCase().includes(want));
    if (!sameKind) continue;
    if (!s.instanceId) { best = s; break; }           // preferir livre
    if (!best && (s.dead || s.hidden)) best = s;      // senão, reaproveitar
  }
  if (!best) return null;

  best.instanceId = String(instanceId);
  best.dead = false;
  best.hidden = false;
  best._animFrozen = false;
  best._animFrozenFrame = 0;

  // garantir lookup
  MOB_BY_INSTANCE.set(String(instanceId), best);
  return best;
};

window.GameScene.registerMobSprite = (sprite, meta = {}) => {
  if (!sprite) return;
  if (Number.isFinite(meta.spawnId)) {
    sprite.spawnId = Number(meta.spawnId);
    if (!MOB_SPRITES_BY_SPAWN.has(sprite.spawnId)) MOB_SPRITES_BY_SPAWN.set(sprite.spawnId, new Set());
    MOB_SPRITES_BY_SPAWN.get(sprite.spawnId).add(sprite);
  }
  if (meta.instanceId) {
    sprite.instanceId = String(meta.instanceId);
    MOB_BY_INSTANCE.set(sprite.instanceId, sprite);
  }
};

// escolhe uma sprite “livre” daquele spawn (sem instanceId ou marcada morta/oculta)
function pickFreeSpriteForSpawn(spawnId) {
  const set = MOB_SPRITES_BY_SPAWN.get(Number(spawnId));
  if (!set || set.size === 0) return null;
  // preferência: sem vínculo; depois mortas; depois qualquer uma
  let candidate = null;
  for (const s of set) { if (!s.instanceId) return s; if (!candidate && (s.dead || s.hidden)) candidate = s; }
  return candidate || [...set][0];
}

window.GameScene.bindInstanceToSpawn = (instanceId, spawnId) => {
  const s = pickFreeSpriteForSpawn(spawnId);
  if (!s) return null;
  // limpa estado de morte/oculto e congelações
  s.instanceId = String(instanceId);
  s.dead = false;
  s.hidden = false;
  s._animFrozen = false;
  s._animFrozenFrame = 0;
  MOB_BY_INSTANCE.set(String(instanceId), s);
  return s;
};

window.GameScene.onMonsterDead = (instanceId) => {
  const s = MOB_BY_INSTANCE.get(String(instanceId));
  if (!s) return;
  s.dead = true;            // congela AI/movimento
  s._animFrozen = true;     // congela animação no 1º frame
  s._animFrozenFrame = 0;
  MOB_BY_INSTANCE.delete(String(instanceId)); // solta vínculo da instância (respawn reusa a sprite)
};

// =============== Canvas/HUD flexível (querystring + auto) ===============
function pickElByIds(prefIds = [], fallbackSelectors = []) {
  for (const id of prefIds) { if (!id) continue; const el = document.getElementById(id); if (el) return el; }
  for (const sel of fallbackSelectors) { const el = document.querySelector(sel); if (el) return el; }
  return null;
}
const preferCanvasId = QS.get('canvas'); // ex: ?canvas=scene
const preferHudId = QS.get('hud');    // ex: ?hud=hud

const canvas = pickElByIds([preferCanvasId, 'view', 'scene'], ['canvas#view', 'canvas#scene', 'canvas']);
const hud = pickElByIds([preferHudId, 'hud', 'app-hud'], ['#hud', '#app-hud']);

if (!canvas) {
  console.error('play.js: canvas não encontrado (#view ou #scene).');
  alert('Erro: canvas não encontrado (#view/#scene).');
  throw new Error('Canvas not found');
}
const ctx = canvas.getContext('2d');

// expõe cedo para módulos externos
window.GameScene.canvas = canvas;
window.GameScene.ctx = ctx;

// garante foco p/ WASD e click-to-move
try { canvas.setAttribute('tabindex', '0'); } catch { }
canvas.addEventListener('mousedown', () => { try { canvas.focus(); } catch { } });
canvas.addEventListener('touchstart', () => { try { canvas.focus(); } catch { } });

// helper DOM
const $ = (s) => document.querySelector(s);

// camera hoisted (evita TDZ)
let camera;

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

/* ============================= Settings (pixel art global) ============================= */
function applySmoothing() {
  try {
    // suavização off
    ctx.imageSmoothingEnabled = false;
    ctx.mozImageSmoothingEnabled = false;
    ctx.webkitImageSmoothingEnabled = false;
  } catch {}
  try {
    // CSS: pixelado nativo pra todos
    canvas.style.imageRendering = 'pixelated';       // Chrome/Firefox
    canvas.style.setProperty('image-rendering', 'pixelated');
  } catch {}
}
applySmoothing();
document.addEventListener('settings:changed', () => { applySmoothing(); resize(); });

/* ============================= Resize + Zoom por tiles ============================= */
function resize() {
  const shell = document.querySelector('#clientShell') || canvas.parentElement;
  const rect = shell ? shell.getBoundingClientRect() : { width: window.innerWidth * 0.9, height: window.innerHeight * 0.9 };
  const wCSS = Math.max(320, Math.floor(rect.width || window.innerWidth * 0.9));
  const hCSS = Math.max(200, Math.floor(rect.height || window.innerHeight * 0.9));
  const st = (window.GameSettings?.get?.() || window.GameSettings?.getState?.()) || {};
  const dprBase = window.devicePixelRatio || 1;
  const dpr = Math.min(dprBase, Number(st.dprCap || dprBase));

  // tamanho CSS (aparência) + tamanho real (resolução)
  canvas.style.width = wCSS + 'px';
  canvas.style.height = hCSS + 'px';
  const w = Math.round(wCSS * dpr);
  const h = Math.round(hCSS * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  if (camera?.resize) camera.resize(canvas.width, canvas.height);

  // recalcula zoom baseado na altura do canvas e tiles visíveis
  applyCameraZoom();
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
    // indexa por key normalizada
    SPRITE_INDEX.set(nk, data);

    // indexa também por caminho da imagem do YAML
    if (data?.image) SPRITE_INDEX.set(normKey(data.image), data);

    // apelidos opcionais
    if (Array.isArray(data?.aliases)) {
      for (const a of data.aliases) SPRITE_INDEX.set(normKey(a), data);
    }
  }
}

function asObj(v) {
  if (!v) return null;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return null; }
  }
  return v;
}

async function loadSpriteMeta() {
  const list = await apiGet('/api/assets/sprites'); // [{ key, kind, data }]
  SPRITES_META = Object.fromEntries(
    (list || []).map(e => [e.key, asObj(e.data)])
  );
  indexSpriteMeta(SPRITES_META);
}

function findMetaFor(spawnKey) {
  const k = String(spawnKey || '').trim();
  if (!k) return null;
  const tries = [
    k,
    k.toLowerCase(),
    k.replace(/[\s_]+/g, '-'),
    k.replace(/[\s\-]+/g, '_'),
  ];
  for (const t of tries) {
    const m = SPRITE_INDEX.get(normKey(t));
    if (m) return m;
  }
  const nk = normKey(k);
  for (const [idx, m] of SPRITE_INDEX.entries()) {
    if (idx.includes(nk)) return m;
  }
  return null;
}

function buildMonsterCandidates(kindNorm, meta, rawKey) {
  const list = [];

  // 1) Caminho explícito do YAML (prioritário)
  if (meta?.image) {
    const p = meta.image.replace(/^(\.\/)+/, '');
    list.push('/' + p); // ex: /sprites/monsters/cave_rat.png
    list.push(p);       // ex: sprites/monsters/cave_rat.png
  }

  // 2) Fallbacks: gera variações de nome
  const vKebab = String(kindNorm || '').trim();                 // ex: cave-rat
  const vRaw = String(rawKey || '').trim();                     // ex: cave_rat
  const vUnder = vRaw.toLowerCase().replace(/[\s\-]+/g, '_');   // ex: cave_rat
  const vKebabFromRaw = vRaw.toLowerCase().replace(/[\s_]+/g, '-'); // ex: cave-rat

  const variants = [...new Set([vKebab, vUnder, vKebabFromRaw])];

  for (const v of variants) {
    list.push(`/sprites/monsters/${v}.png`);
    list.push(`/sprites/${v}.png`);
    list.push(`/img/monsters/${v}.png`);
    list.push(`/img/${v}.png`);
    list.push(`/${v}.png`);
  }

  // remove duplicatas mantendo a ordem
  return [...new Set(list)];
}

async function loadMonsterImg(kindNorm, meta, rawKey) {
  const candidates = buildMonsterCandidates(kindNorm, meta, rawKey);
  for (const url of candidates) {
    const img = loadImg(url);
    const ok = await ensureImgLoaded(img);
    if (ok) return img;
  }
  console.warn(`[mob sprite] falhou carregar: ${kindNorm}. Tentativas:`, candidates);
  return null;
}

// Auto-meta: tenta 64x64 → 48x32 → 32x32 e define animações padrão
function inferMetaFromImage(img, rawKey) {
  if (!img || !img.naturalWidth || !img.naturalHeight) return null;

  // ordem de tentativa de frame size
  const candidates = [
    { w: 64, h: 64 },
    { w: 48, h: 32 },
    { w: 32, h: 32 },
  ];

  // escolhe o 1º que divide exatamente a imagem
  let fw = 32, fh = 32;
  for (const c of candidates) {
    if (img.naturalWidth % c.w === 0 && img.naturalHeight % c.h === 0) {
      fw = c.w; fh = c.h; break;
    }
  }

  const cols = Math.max(1, Math.floor(img.naturalWidth / fw));
  const rows = Math.max(1, Math.floor(img.naturalHeight / fh));

  return {
    key: String(rawKey || '').trim(),
    kind: 'monster',
    image: img.src.replace(location.origin, ''),
    frame: { width: fw, height: fh, margin: 0, spacing: 0, bleedFix: 0.25 },
    grid: { cols, rows },
    anchor: { x: 0.5, y: fw === 64 && fh === 64 ? 0.85 : 0.9 },
    anims: {
      walk: {
        fps: 8,
        frames: Math.min(4, cols),
        startCol: 0,
        rowByDir:
          (rows >= 5)
            ? { south: 1, west: 2, east: 3, north: 4 }
            : (rows >= 4) ? { south: 0, west: 1, east: 2, north: 3 } : null,
        row: 0,
        loop: true
      },
      dead: (rows >= 6)
        ? { row: 5, frames: Math.min(4, cols), startCol: 0, loop: false }
        : null
    }
  };
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
window.GameScene.mobs = mobs;
let mobAutoId = 1;

/* ========================= Loot (estado) ========================== */
const loots = new Map(); // id -> { id, x, y, items:[...] }
window.GameScene.loots = loots;

function lootAtWorld(x, y) {
  for (const l of loots.values()) {
    if (Math.abs(x - l.x) <= 16 && Math.abs(y - l.y) <= 16) return l;
  }
  return null;
}

function drawLoot(l) {
  // desenho simples (você pode trocar por sprite/baú depois)
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#d97706'; // âmbar
  ctx.fillRect(l.x - 6, l.y - 10, 12, 10);
  ctx.fillStyle = '#92400e';
  ctx.fillRect(l.x - 6, l.y - 6, 12, 6);
  ctx.restore();
}

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
  if (m.hidden) return;

  // Auto-meta se só a imagem carregou
  if ((!m.meta || !m.meta.frame || !m.meta.grid) && imgReady(m.img)) {
    const auto = inferMetaFromImage(m.img, m.rawKey || m.kind);
    if (auto) m.meta = auto;
  }

  if (!(m.meta && imgReady(m.img))) {
    if (!m.dead) {
      ctx.save();
      ctx.fillStyle = "#ef4444";
      ctx.beginPath(); ctx.arc(m.x, m.y, 7, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    return;
  }

  const meta = m.meta;

  // frame & grid
  const frameW  = Number(meta.frame?.width)  || 32;
  const frameH  = Number(meta.frame?.height) || 32;
  const margin  = Number(meta.frame?.margin)  || 0;
  const spacing = Number(meta.frame?.spacing) || 0;
  const cols    = Math.max(1, Number(meta.grid?.cols) || 1);
  const rows    = Math.max(1, Number(meta.grid?.rows) || 1);
  const EPS     = Number.isFinite(Number(meta.frame?.bleedFix)) ? Number(meta.frame?.bleedFix) : 0.25;

  // animações
  const animIdle = meta.anims?.idle || null;
  const animWalk = meta.anims?.walk || { fps: 8, frames: cols, row: 0, startCol: 0, loop: true };
  const animDead = meta.anims?.dead || null;

  // escolher anima
  let anim = m.dead && animDead ? animDead : (animIdle && m._animFrozen ? animIdle : animWalk);

  // parâmetros base
  let fps = Number(anim.fps); if (!Number.isFinite(fps) || fps < 0) fps = 8;

  let seq = Array.isArray(anim.seq) ? anim.seq.slice() : null;
  let frames = Number(anim.frames);
  let startCol = Number(anim.startCol);
  if (!Number.isFinite(frames) || frames <= 0) frames = cols;
  if (!Number.isFinite(startCol) || startCol < 0) startCol = 0;

  // direção (linha/frames/startCol/seq)
  const face = m.face || 'south';
  let row = Number(anim.row); if (!Number.isFinite(row)) row = 0;

  if (anim.rowByDir && anim.rowByDir[face] != null) {
    const r = Number(anim.rowByDir[face]); if (Number.isFinite(r)) row = r;
  }
  if (anim.framesByDir && anim.framesByDir[face] != null) {
    const fd = Number(anim.framesByDir[face]); if (Number.isFinite(fd) && fd > 0) frames = fd;
  }
  if (anim.startColByDir && anim.startColByDir[face] != null) {
    const sd = Number(anim.startColByDir[face]); if (Number.isFinite(sd) && sd >= 0) startCol = sd;
  }
  if (!seq && anim.seqByDir && Array.isArray(anim.seqByDir[face])) {
    seq = anim.seqByDir[face].slice();
  }

  // clamp do row ao grid
  row = Math.max(0, Math.min(rows - 1, row));

  // estado morto: congelar 1º frame
  if (m.dead && animDead) {
    fps = 0;
    frames = 1;
    if (Number.isFinite(animDead.startCol)) startCol = Number(animDead.startCol);
    if (Number.isFinite(animDead.row)) row = Math.max(0, Math.min(rows - 1, Number(animDead.row)));
    seq = null;
    m._animFrozen = true;
    m._animFrozenFrame = 0;
  }

  // calcular frame atual
  const t = performance.now() / 1000;
  const baseLen = Math.max(1, seq ? seq.length : frames);
  let f;
  if (anim.loop === false) {
    const idx = Math.floor(t * Math.max(0, fps));
    f = Math.min(idx, baseLen - 1);
  } else {
    f = m._animFrozen ? m._animFrozenFrame : Math.floor(t * Math.max(0, fps)) % baseLen;
  }

  // coluna
  let col;
  if (seq && seq.length > 0) {
    const pick = Number(seq[f]);
    col = Number.isFinite(pick) ? Math.max(0, Math.min(cols - 1, pick)) : 0;
  } else {
    const rowCols = cols;
    if (startCol < 0) startCol = 0;
    if (startCol >= rowCols) startCol = Math.max(0, rowCols - 1);
    const maxFromStart = Math.max(1, rowCols - startCol);
    frames = Math.min(Math.max(1, frames), maxFromStart);
    col = startCol + f;
    if (col >= rowCols) col = rowCols - 1;
    if (col < 0) col = 0;
  }

  // recorte
  const sx = margin + col * (frameW + spacing) + 0.25;
  const sy = margin + row * (frameH + spacing) + 0.25;
  const sw = frameW - 0.5;
  const sh = frameH - 0.5;

  // âncora
  const anchorX = (meta.anchor?.x ?? 0.5);
  const anchorY = (meta.anchor?.y ?? 0.9);
  const dw = frameW, dh = frameH;
  const ox = Math.round(m.x - dw * anchorX);
  const oy = Math.round(m.y - dh * anchorY);

  // flipX (1 linha, sem rowByDir)
  const canFlipX = !anim.rowByDir && rows === 1 && face === 'west';

  ctx.save();
  if (m.dead) ctx.globalAlpha = 0.55;

  if (canFlipX) {
    ctx.translate(ox + dw, oy);
    ctx.scale(-1, 1);
    ctx.drawImage(m.img, sx, sy, sw, sh, 0, 0, dw, dh);
  } else {
    ctx.drawImage(m.img, sx, sy, sw, sh, ox, oy, dw, dh);
  }
  ctx.restore();
}

/* ======================= Posição Persistente ======================= */
let POS_SYNC_ENABLED = true;
let lastPostAt = 0;

// contador de sequência enviado ao servidor
let posSeq = 0;
// marca se já sincronizamos o contador com o servidor
let posSeqReady = false;
// evita posts concorrentes
let posInFlight = false;
// evita post quando não mudou
let lastSent = { x: null, y: null };

/** Lê posição salva do servidor e já sincroniza o seq local */
async function getSavedPos() {
  try {
    const p = await apiGet(`/api/player/pos?map=${encodeURIComponent(MAP_KEY)}`);
    if (p && Number.isFinite(p.seq)) {
      posSeq = Number(p.seq);
      posSeqReady = true;
    }
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      return { x: p.x, y: p.y };
    }
  } catch {
    // ok, começa do default
  }
  return null;
}

/** Envia posição com rate-limit, dedupe e seq sincronizado com o servidor */
async function postPosThrottled(mapKey, x, y) {
  if (!POS_SYNC_ENABLED) return;

  // tenta sincronizar seq uma única vez no 1º envio
  if (!posSeqReady) {
    try {
      const chk = await apiGet(`/api/player/pos?map=${encodeURIComponent(mapKey)}`);
      if (chk && Number.isFinite(chk.seq)) {
        posSeq = Number(chk.seq);
        posSeqReady = true;
      }
    } catch { /* segue mesmo assim */ }
  }

  // sem flooding: servidor aceita ~12 vezes por 5s → ~1 a cada ~500ms
  const now = performance.now();
  if ((now - lastPostAt) < 500) return;

  // não reenvia se não mudou nada
  const nx = Math.round(x), ny = Math.round(y);
  if (lastSent.x === nx && lastSent.y === ny) return;

  // sem concorrência
  if (posInFlight) return;
  posInFlight = true;

  const doSend = async () => {
    posSeq += 1;
    lastPostAt = now;
    await apiPost('/api/player/pos', {
      mapKey,
      x: nx,
      y: ny,
      seq: posSeq,
      clientTs: Date.now()
    });
    lastSent = { x: nx, y: ny };
  };

  try {
    await doSend();
  } catch (e) {
    const msg = String(e?.message || '');
    // conflito de sequência: rebaseia e tenta UMA vez
    if (msg.includes('409') || /stale-seq/i.test(msg)) {
      try {
        const chk = await apiGet(`/api/player/pos?map=${encodeURIComponent(mapKey)}`);
        if (chk && Number.isFinite(chk.seq)) {
          posSeq = Number(chk.seq);
          posSeqReady = true;
          await doSend();
        }
      } catch { /* ignorar - próxima iteração tenta de novo */ }
    } else if (/429/.test(msg)) {
      // rate limited: apenas ignore; próxima janela envia
    } else if (/202/.test(msg)) {
      // too-fast do anti-speed: não desliga; apenas ignore este tick
    } else if (/403|csrf/i.test(msg)) {
      // auth/csrf: desliga para não poluir
      POS_SYNC_ENABLED = false;
      console.warn('[pos] desabilitado (auth/csrf):', msg);
    } else {
      console.warn('pos sync failed:', msg);
    }
  } finally {
    posInFlight = false;
  }
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
    const x1 = Math.floor((o.x + o.width - 1) / TILE);
    const y1 = Math.floor((o.y + o.height - 1) / TILE);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      if (cx >= 0 && cy >= 0 && cx < cols && cy < rows) grid[cy * cols + cx] = 1;
    }
  }
  return { grid, cols, rows };
}

function buildCollisionGridFromTiled(json) {
  const cols = json.width, rows = json.height;
  const grid = new Uint8Array(cols * rows);
  const collisionLayer = (json.layers || []).find(l => l.type === 'tilelayer' && l.name && l.name.toLowerCase().includes('collision'));
  if (collisionLayer && collisionLayer.data) {
    for (let i = 0; i < collisionLayer.data.length; i++) if (i < grid.length && collisionLayer.data[i]) grid[i] = 1;
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
      const w = o.width > 0 ? o.width : TILE;
      const h = o.height > 0 ? o.height : TILE;
      return {
        id: Number(o.id),
        monsterKey, count, respawnSec,
        x: o.x || 0, y: o.y || 0, w, h
      };
    });
}

/* ===================== Resolução de Sprite Player ===================== */
async function resolvePlayerSprite() {
  try {
    const me = await apiGet('/api/player/me');
    const heroes = Array.isArray(me.heroes) ? me.heroes : [];
    const starter = heroes.find(h => h.isStarter === 1 || h.isStarter === true) || heroes[0];
    if (starter) {
      playerVis.heroKey = starter.heroKey || starter.key || null;
      const candidate = playerVis.heroKey ? `/sprites/characters/${playerVis.heroKey}.png` : null;
      if (candidate) {
        playerVis.img = loadImg(candidate);
        await ensureImgLoaded(playerVis.img).catch(() => { });
        if (imgReady(playerVis.img)) return;
      }
      if (starter.imageUrl) {
        playerVis.img = loadImg(starter.imageUrl);
        await ensureImgLoaded(playerVis.img).catch(() => { });
        if (imgReady(playerVis.img)) return;
      }
    }
  } catch (e) { console.warn('resolvePlayerSprite:', e.message); }
  playerVis.img = loadImg("/sprites/characters/player.png");
  ensureImgLoaded(playerVis.img).catch(() => { });
}

/* =========================== Respawn Manager ========================== */
function addMobFromSpawn(spDef) {
  const rawKey = spDef.monsterKey || spDef.monster || "goblin";
  const kindNorm = normKey(rawKey);

  // <<< AQUI: meta sempre como OBJETO (se vier string, fazemos JSON.parse)
  const meta = asObj(findMetaFor(rawKey)) || null;

  const m = {
    id: mobAutoId++,
    kind: kindNorm,
    rawKey,
    x: (spDef.x || 0) + Math.random() * (spDef.w || TILE),
    y: (spDef.y || 0) + Math.random() * (spDef.h || TILE),
    w: 32, h: 32,                              // tamanho visual padrão; o draw usa meta.frame.*
    speed: 40 + Math.random() * 20,
    dirX: 0, dirY: 0, changeAt: 0,
    face: 'east',
    img: null,
    meta,                                      // meta já parseado
    bound: (spDef.w || spDef.h)
      ? { x: spDef.x || 0, y: spDef.y || 0, w: spDef.w || TILE, h: spDef.h || TILE }
      : null,
    spawnId: Number(spDef.id || spDef.spawn_id || spDef.spawnId || 0) || null,
    instanceId: null,
    dead: false,
    hidden: false,
    _animFrozen: false,
    _animFrozenFrame: 0,
  };

  // carrega a imagem usando o meta (que pode ter .image correto do YAML)
  loadMonsterImg(kindNorm, meta, rawKey).then(img => {
    if (!img) return;
    m.img = img;

    // Só infere automaticamente se NÃO veio meta válido do YAML
    if (!m.meta || !m.meta.frame || !m.meta.grid) {
      const auto = inferMetaFromImage(img, rawKey);
      if (auto) m.meta = auto;
    }
  });

  mobs.push(m);

  if (m.spawnId != null) {
    window.GameScene.registerMobSprite(m, { spawnId: m.spawnId });
  }

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
      area: { x: d.x || 0, y: d.y || 0, w: d.w || TILE, h: d.h || TILE },
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
  // 1) garante CSRF/cookies antes de qualquer POST
  await getCsrf().catch(() => {});

  await loadSpriteMeta();

  // cria a câmera
  const maps = await apiGet("/api/admin/content/maps");
  if (!maps.some((m) => m.key === MAP_KEY)) throw new Error(`map ${MAP_KEY} não encontrado`);

  // helper para normalizar payloads que podem vir string/array/obj
  function normalizeApiJson(payload) {
    let v = payload;
    if (Array.isArray(v)) v = v[0];
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { } }
    return v;
  }

  // Objetos do mapa (starts/solids)
  const rawObjs = await apiGet(`/api/admin/content/map/${MAP_KEY}/objects`);
  const objsNorm = normalizeApiJson(rawObjs);
  const objArr = Array.isArray(objsNorm)
    ? objsNorm
    : (objsNorm && Array.isArray(objsNorm.objects) ? objsNorm.objects : []);
  starts = objArr.filter(o => (o.type || '').toLowerCase() === 'start');

  // Data (tiles)
  const rawMap = await apiGet(`/api/admin/content/map/${MAP_KEY}/data`);
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

  function hasSolidProp(o) { return (o.properties || []).some(p => p.name === 'solid' && (p.value === true || p.value === 1)); }
  const collBuild = objArr.some(o => String(o.type || '').toLowerCase() === 'solid' || hasSolidProp(o))
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

  // Polyfills úteis na câmera
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
    // IMPORTANTE: aplica translate depois scale para obter (p - cam) * z (pixel art real)
    camera.apply = (ctx, draw) => {
      ctx.save();
      const z = (typeof camera.getZoom === 'function') ? Number(camera.getZoom()) || 1 : 1;
      ctx.translate(-camera.x, -camera.y);
      ctx.scale(z, z);
      draw();
      ctx.restore();
    };
  }

  function applyCameraZoom() {
    const st = (window.GameSettings?.getState && window.GameSettings.getState()) || {};

    // Zoom por quantidade de tiles na altura da tela (estilo Tibia)
    if (st.zoomByTiles) {
      const tilesY = Math.max(6, Number(st.tilesY || 13)); // 13 ≈ Tibia clássico
      const zRaw = canvas.height / (tilesY * TILE);
      const zMin = Number.isFinite(st.zoomMin) ? st.zoomMin : 0.5;
      const zMax = Number.isFinite(st.zoomMax) ? st.zoomMax : 4;
      const zClamped = Math.max(zMin, Math.min(zMax, zRaw));
      if (typeof camera.setZoom === 'function') camera.setZoom(zClamped);
    } else {
      // Modo antigo: zoom numérico direto
      const zRaw = Number(st.zoom || 1);
      const zMin = Number.isFinite(st.zoomMin) ? st.zoomMin : 0.5;
      const zMax = Number.isFinite(st.zoomMax) ? st.zoomMax : 4;
      const zClamped = Math.max(zMin, Math.min(zMax, zRaw));
      if (typeof camera.setZoom === 'function') camera.setZoom(zClamped);
    }
  }

  // recalcula tamanho do canvas e zoom já no boot
  resize();

  const controller = new PlayerController({
    speed: 140,
    collisionGrid: grid,
    cols, rows,
    onMoved: (x, y) => postPosThrottled(MAP_KEY, x, y)
  });

  // expõe camera/controller/mapKey p/ outros módulos (combate, etc.)
  window.GameScene.camera = camera;
  window.GameScene.controller = controller;
  window.GameScene.mapKey = MAP_KEY;

  const astar = new AStarGrid(grid, cols, rows);
  const clickMove = new ClickToMove({ canvas, camera, controller, grid });
  clickMove.setAStar(astar);

  // Input
  Input.attach(window, canvas);

  // Posição inicial
  const saved = await getSavedPos();
  if (saved) controller.setPosition(saved.x, saved.y);
  else if (starts[0]) controller.setPosition(starts[0].x, starts[0].y);
  else controller.setPosition(TILE * 2 + TILE / 2, TILE * 2 + TILE / 2);

  camera.follow(controller);
  await resolvePlayerSprite();

  // Spawns de mobs
  let spawnsList;
  try { spawnsList = await apiGet(`/api/admin/content/map/${MAP_KEY}/spawns`); } catch { spawnsList = []; }
  if (!Array.isArray(spawnsList) || spawnsList.length === 0) {
    spawns = mapSpawnsFromTiledJSON(mapData);
    console.log("spawns fallback (JSON):", spawns);
  } else {
    spawns = spawnsList;
    console.log("spawns do servidor:", spawns);
  }

  // Monta respawners e popula inicial
  buildSpawnersFromDefs(spawns);
  const now0 = performance.now();
  for (const s of spawners) {
    while (s.liveIds.size < s.want) s.liveIds.add(addMobFromSpawn(s.def));
    s.nextAt = now0 + s.respawnMs;
  }

  // === WS → loot (o seu ws-combat.js deve disparar 'ws:message' com {detail:{msg}})
  window.addEventListener('ws:message', (ev) => {
    const msg = ev.detail?.msg;
    if (!msg || !msg.type) return;
    if (msg.type === 'loot_spawned') {
      loots.set(String(msg.id), { id: String(msg.id), x: msg.x, y: msg.y, items: msg.items || [] });
    } else if (msg.type === 'loot_removed') {
      loots.delete(String(msg.id));
    }
  });

  // sinaliza que a cena está pronta (outros módulos podem iniciar)
  window.dispatchEvent(new CustomEvent('game:ready', { detail: { canvas, ctx, camera, controller } }));
  // >>> avisa o overlay de combate para re-vincular barras imediatamente <<<
  window.dispatchEvent(new Event('gamescene:ready'));

  // Loop principal
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    // Click-to-move (PRIORIZA LOOT)
    const m = Input.getMouse();
    if (Input.consumeClick()) {
      const rect = canvas.getBoundingClientRect();
      const sx = m.x - rect.left, sy = m.y - rect.top;
      const w = camera.screenToWorld(sx, sy);
      const loot = lootAtWorld(w.x, w.y);
      if (loot) {
        try { CombatActions?.pickupLoot?.(loot.id); } catch {}
      } else {
        clickMove.handleClick(sx, sy);
      }
    }

    // Teclado: 1 passo de 32x32 por tecla (N/S/L/O)
    const step = Input.getStepIntent && Input.getStepIntent();
    if (step) window.GameScene?.controller?.requestStep?.(step);
    window.GameScene?.controller?.update?.(dt, null);

    // Camera
    camera.update(dt);

    // ===== IA dos mobs em passos de 32x32 (apenas N/S/L/O) =====
    const TILE = 32;
    const hasGrid = !!grid && Number.isFinite(cols) && Number.isFinite(rows);
    const cellOf   = (wx, wy) => ({ cx: Math.floor(wx / TILE), cy: Math.floor(wy / TILE) });
    const centerOf = (cx, cy) => ({ x: cx * TILE + TILE / 2, y: cy * TILE + TILE / 2 });
    const isBlocked = (cx, cy) => {
      if (!hasGrid) return false;
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return true;
      return grid[cy * cols + cx] === 1;
    };
    // Bound inteligente: área <= 1 SQM => não limita o mob
    const inBound = (mob, cx, cy) => {
      if (!mob.bound) return true;
      const { x, y, w, h } = mob.bound;
      if (w <= TILE && h <= TILE) return true;
      const wx = cx * TILE + TILE / 2;
      const wy = cy * TILE + TILE / 2;
      return (wx >= x && wy >= y && wx <= x + w && wy <= y + h);
    };
    const faceFrom = (dx, dy) => (dx === 1 ? 'east' : dx === -1 ? 'west' : dy === 1 ? 'south' : 'north');

    for (const mob of mobs) {
      if (mob.hidden || mob.dead) continue;

      // estado interno do passo
      if (!mob._step) mob._step = { moving: false, tx: 0, ty: 0, nextAt: 0 };
      const st = mob._step;

      if (!st.moving) {
        // congela animação quando parado
        mob._animFrozen = true;
        mob._animFrozenFrame = 0;

        if (now >= st.nextAt) {
          // tenta uma direção válida entre N/S/L/O
          const dirs = [
            { dx: 0, dy: -1 }, // N
            { dx: 0, dy:  1 }, // S
            { dx: -1, dy: 0 }, // L
            { dx:  1, dy: 0 }, // O
          ];
          // embaralhar (Fisher–Yates simples)
          for (let i = dirs.length - 1; i > 0; i--) {
            const j = (Math.random() * (i + 1)) | 0;
            [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
          }
          const c = cellOf(mob.x, mob.y);
          let pick = null;
          for (const d of dirs) {
            const nx = c.cx + d.dx, ny = c.cy + d.dy;
            if (isBlocked(nx, ny)) continue;
            if (!inBound(mob, nx, ny)) continue;
            pick = d; break;
          }
          if (pick) {
            const tgt = centerOf(c.cx + pick.dx, c.cy + pick.dy);
            st.tx = tgt.x; st.ty = tgt.y; st.moving = true;
            mob.face = faceFrom(pick.dx, pick.dy);
            // destrava anima para “walk”
            mob._animFrozen = false;
          } else {
            // sem passo válido agora: espera um pouco e tenta de novo
            st.nextAt = now + 400 + Math.random() * 400;
          }
        }
      } else {
        // movendo: destrava anima
        mob._animFrozen = false;

        const vx = st.tx - mob.x, vy = st.ty - mob.y;
        const dist = Math.hypot(vx, vy);
        const spd = Math.max(60, Number(mob.speed) || 60);
        if (dist <= 1.0) {
          // chegou no centro do tile
          mob.x = Math.round(st.tx);
          mob.y = Math.round(st.ty);
          st.moving = false;
          st.nextAt = now + 120 + Math.random() * 120;
          // após chegar, congela até escolher o próximo passo
          mob._animFrozen = true;
          mob._animFrozenFrame = 0;
        } else {
          const ux = vx / (dist || 1), uy = vy / (dist || 1);
          mob.x += ux * spd * dt;
          mob.y += uy * spd * dt;
        }
      }
    }

    // Respawn local (placeholder visual)
    updateRespawns(now);

    // Render (mundo)
    clear();
    camera.apply(ctx, () => {
      drawGround(camera);
      // desenha loots antes dos mobs
      for (const l of loots.values()) drawLoot(l);
      for (const m of mobs) drawMob(m);
      drawPlayer(controller);
    });

    // Overlay de combate
    if (window.CombatUI && typeof window.CombatUI.render === 'function') {
      try { window.CombatUI.render(ctx, camera, dt); } catch (e) { /* não quebrar jogo */ }
    }

    // evento por frame
    window.dispatchEvent(new CustomEvent('game:frame', { detail: { ctx, camera, dt } }));

    // HUD
    if (hud) {
      const p = controller.getPosition();
      hud.innerHTML = `
        <div>map: ${MAP_KEY}</div>
        <div>Move: Click-to-move • WASD/Setas/Numpad (1 SQM)</div>
        <div>pos: ${Math.round(p.x)}, ${Math.round(p.y)}</div>
        <div>mobs: ${mobs.length} • spawns: ${spawners.length} • loots: ${loots.size}</div>
      `;
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);

  // listeners finais (settings/resize já ligados no topo)
  document.addEventListener('settings:changed', () => { resize(); });
})().catch((err) => {
  console.error(err);
  if (hud) hud.textContent = "Erro: " + err.message;
});

/* ============================ util local ============================ */
// Aplica zoom por tiles sempre que o canvas mudar de tamanho.
// (Definição repetida aqui para o resize() do topo poder chamá-la)
function applyCameraZoom() {
  if (!camera) return;
  const st = (window.GameSettings?.getState && window.GameSettings.getState()) || {};
  if (st.zoomByTiles) {
    const tilesY = Math.max(6, Number(st.tilesY || 13));
    const zRaw = canvas.height / (tilesY * TILE);
    const zMin = Number.isFinite(st.zoomMin) ? st.zoomMin : 0.5;
    const zMax = Number.isFinite(st.zoomMax) ? st.zoomMax : 4;
    const zClamped = Math.max(zMin, Math.min(zMax, zRaw));
    camera.setZoom?.(zClamped);
  } else {
    const zRaw = Number(st.zoom || 1);
    const zMin = Number.isFinite(st.zoomMin) ? st.zoomMin : 0.5;
    const zMax = Number.isFinite(st.zoomMax) ? st.zoomMax : 4;
    const zClamped = Math.max(zMin, Math.min(zMax, zRaw));
    camera.setZoom?.(zClamped);
  }
}
