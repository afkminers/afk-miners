// client/js/play.js
// Cena jogável genérica: usa ?map=<key> (padrão house), segue o player e instancia mobs.
// Lê posição salva do jogador (GET /api/player/pos?map=...) e salva periodicamente (POST /api/player/pos).
// Se /spawns vier vazio, faz fallback lendo a camada "spawn" direto do JSON do Tiled.

const MAP_KEY = new URLSearchParams(location.search).get('map') || 'house';
const TILE = 32;

// DOM
const $ = (s) => document.querySelector(s);
const canvas = $("#view");
const ctx = canvas.getContext("2d");
const hud = $("#hud");

// --- CSRF para POSTs protegidos ---
let CSRF_TOKEN = null;
async function fetchCsrf() {
  if (CSRF_TOKEN) return CSRF_TOKEN;
  const r = await fetch('/api/csrf', { credentials: 'include' });
  const headerTok = r.headers.get('x-csrf-token') || r.headers.get('X-CSRF-Token');
  let bodyTok = null;
  try { const j = await r.json(); bodyTok = j.token || j.csrf || j.csrfToken || null; } catch {}
  CSRF_TOKEN = headerTok || bodyTok;
  return CSRF_TOKEN;
}

// HTTP helpers
async function jget(url) {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} @ ${url}`);
  return r.json();
}
async function jpost(url, body) {
  const tok = await fetchCsrf().catch(()=>null);
  const r = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: Object.assign(
      { 'Content-Type': 'application/json' },
      tok ? { 'x-csrf-token': tok } : {}
    ),
    body: JSON.stringify(body || {})
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} @ ${url}`);
  return r.json();
}

// Imagens
const IMG_CACHE = new Map();
function loadImg(src) {
  if (IMG_CACHE.has(src)) return IMG_CACHE.get(src);
  const img = new Image();
  img.src = src;
  IMG_CACHE.set(src, img);
  return img;
}
function imgReady(img) {
  return img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
}
async function ensureImgLoaded(img) {
  if (imgReady(img)) return;
  try { await img.decode(); } catch {}
}

// Estado
let mapData = null;
let tileset = null;
let tilesetImg = null;
let groundLayer = null;

let starts = [];
let spawns = [];

const player = { x: 100, y: 100, w: 32, h: 32, speed: 140, img: null, heroKey: null };
const mobs = [];

// Câmera
const cam = { x: 0, y: 0, w: 0, h: 0, lerp: 0.15 };

// Input
const keys = {};
addEventListener("keydown", (e) => (keys[e.key.toLowerCase()] = true));
addEventListener("keyup", (e) => (keys[e.key.toLowerCase()] = false));

// Draw
function clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); }

function drawGround() {
  if (!groundLayer || !tileset || !imgReady(tilesetImg)) return;

  const data = groundLayer.data;
  const cols = mapData.width;
  const rows = mapData.height;
  const first = tileset.firstgid || 1;
  const tw = tileset.tilewidth, th = tileset.tileheight;
  const columnsInImage = tileset.columns;

  // somente tiles visíveis no viewport
  const x0 = Math.max(0, Math.floor(cam.x / TILE));
  const y0 = Math.max(0, Math.floor(cam.y / TILE));
  const x1 = Math.min(cols - 1, Math.ceil((cam.x + cam.w) / TILE));
  const y1 = Math.min(rows - 1, Math.ceil((cam.y + cam.h) / TILE));

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

function drawPlayer() {
  if (imgReady(player.img)) {
    const ox = Math.round(player.x - player.w * 0.5);
    const oy = Math.round(player.y - player.h * 0.9);
    ctx.drawImage(player.img, ox, oy, player.w, player.h);
  } else {
    ctx.save();
    ctx.fillStyle = "#f59e0b";
    ctx.beginPath(); ctx.arc(player.x, player.y, 8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

function drawMob(m) {
  if (imgReady(m.img)) {
    const ox = Math.round(m.x - m.w * 0.5);
    const oy = Math.round(m.y - m.h * 0.9);
    ctx.drawImage(m.img, ox, oy, m.w, m.h);
  } else {
    ctx.save();
    ctx.fillStyle = "#ef4444";
    ctx.beginPath(); ctx.arc(m.x, m.y, 7, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

// Lógica
let lastSentAt = 0;
let lastSentX = 0, lastSentY = 0;

function shouldSyncPos(now) {
  const moved = Math.hypot(player.x - lastSentX, player.y - lastSentY) >= 2;
  const elapsed = (now - lastSentAt) >= 1000; // 1s
  return moved && elapsed;
}

async function syncPos(now) {
  try {
    await jpost('/api/player/pos', {
      mapKey: MAP_KEY,
      x: Math.round(player.x),
      y: Math.round(player.y)
    });
    lastSentAt = now;
    lastSentX = player.x;
    lastSentY = player.y;
  } catch (e) {
    // silencioso para não poluir HUD, só log
    console.warn('pos sync failed:', e.message);
  }
}

function update(dt) {
  let dx = 0, dy = 0;
  if (keys["w"] || keys["arrowup"]) dy -= 1;
  if (keys["s"] || keys["arrowdown"]) dy += 1;
  if (keys["a"] || keys["arrowleft"]) dx -= 1;
  if (keys["d"] || keys["arrowright"]) dx += 1;

  if (dx || dy) {
    const len = Math.hypot(dx, dy) || 1;
    player.x += (dx / len) * player.speed * dt;
    player.y += (dy / len) * player.speed * dt;
  }

  if (mapData) {
    const maxX = mapData.width * TILE, maxY = mapData.height * TILE;
    player.x = Math.max(0, Math.min(maxX, player.x));
    player.y = Math.max(0, Math.min(maxY, player.y));
  }

  const now = performance.now();
  for (const m of mobs) {
    if (now >= m.changeAt) {
      const ang = Math.random() * Math.PI * 2;
      m.dirX = Math.cos(ang);
      m.dirY = Math.sin(ang);
      m.changeAt = now + 700 + Math.random() * 1300;
    }
    m.x += m.dirX * m.speed * dt;
    m.y += m.dirY * m.speed * dt;

    if (m.bound) {
      const { x, y, w, h } = m.bound;
      if (m.x < x)   { m.x = x;   m.dirX *= -1; }
      if (m.y < y)   { m.y = y;   m.dirY *= -1; }
      if (m.x > x+w) { m.x = x+w; m.dirX *= -1; }
      if (m.y > y+h) { m.y = y+h; m.dirY *= -1; }
    }
  }

  // câmera segue player
  cam.x += (player.x - cam.x - cam.w * 0.5) * cam.lerp;
  cam.y += (player.y - cam.y - cam.h * 0.5) * cam.lerp;

  if (mapData) {
    const maxCamX = mapData.width * TILE - cam.w;
    const maxCamY = mapData.height * TILE - cam.h;
    cam.x = Math.max(0, Math.min(maxCamX, cam.x));
    cam.y = Math.max(0, Math.min(maxCamY, cam.y));
  }

  // sync pos (debounced)
  if (shouldSyncPos(now)) syncPos(now);

  if (hud) {
    hud.innerHTML = `
      <div>map: ${MAP_KEY}</div>
      <div>Move: WASD / Setas</div>
      <div>pos: ${Math.round(player.x)}, ${Math.round(player.y)}</div>
    `;
  }
}

function render() {
  clear();
  ctx.save();
  ctx.translate(-Math.floor(cam.x), -Math.floor(cam.y));
  drawGround();
  for (const m of mobs) drawMob(m);
  drawPlayer();
  ctx.restore();
}

// Loop
let last = 0;
function frame(ts) {
  const dt = Math.min(0.05, (ts - last) / 1000);
  last = ts;
  update(dt);
  render();
  requestAnimationFrame(frame);
}

// Fallback: ler spawns direto do JSON do Tiled
function mapSpawnsFromTiledJSON(json) {
  const layer = (json.layers || []).find(
    (l) => l.type === "objectgroup" && l.name && l.name.toLowerCase() === "spawn"
  );
  if (!layer) return [];
  return (layer.objects || [])
    .filter((o) => ((o.class || o.type || "") + "").toLowerCase() === "spawn")
    .map((o) => {
      const p = {};
      (o.properties || []).forEach((kv) => { p[kv.name] = kv.value; });
      const monsterKey = String(p.monsterKey || p.monster || "goblin");
      const count = Number(p.count || 1) || 1;
      const respawnSec = Number(p.respawnSec || p.respawn || 20) || 20;
      const w = o.width  > 0 ? o.width  : TILE;
      const h = o.height > 0 ? o.height : TILE;
      return { monsterKey, count, respawnSec, x: o.x || 0, y: o.y || 0, w, h };
    });
}

// Resolve sprite do player com base no herói (starter ou primeiro da lista)
async function resolvePlayerSprite() {
  try {
    const me = await jget('/api/player/me');
    const heroes = Array.isArray(me.heroes) ? me.heroes : [];
    // prioriza isStarter=1 se existir; senão pega o primeiro
    const starter = heroes.find(h => h.isStarter === 1 || h.isStarter === true) || heroes[0];
    if (starter) {
      player.heroKey = starter.heroKey || starter.key || null;
      // tenta sprites/characters/<heroKey>.png; fallback para imageUrl do /me; fallback final para player.png
      const candidate = player.heroKey ? `/sprites/characters/${player.heroKey}.png` : null;
      if (candidate) {
        player.img = loadImg(candidate);
        await ensureImgLoaded(player.img).catch(()=>{});
        if (imgReady(player.img)) return;
      }
      if (starter.imageUrl) {
        player.img = loadImg(starter.imageUrl);
        await ensureImgLoaded(player.img).catch(()=>{});
        if (imgReady(player.img)) return;
      }
    }
  } catch (e) {
    console.warn('resolvePlayerSprite:', e.message);
  }
  // fallback
  player.img = loadImg("/sprites/characters/player.png");
  ensureImgLoaded(player.img).catch(()=>{});
}

// Bootstrap
async function main() {
  cam.w = canvas.width;
  cam.h = canvas.height;

  // Garante CSRF para futuros POSTs
  await fetchCsrf().catch(()=>{});

  const maps = await jget("/api/admin/content/maps");
  if (!maps.some((m) => m.key === MAP_KEY)) throw new Error(`map ${MAP_KEY} não encontrado`);

  const objs = await jget(`/api/admin/content/map/${MAP_KEY}/objects`);
  starts = objs.filter((o) => (o.type || "").toLowerCase() === "start");

  // tenta carregar posição salva do jogador
  let posLoaded = false;
  try {
    const p = await jget(`/api/player/pos?map=${encodeURIComponent(MAP_KEY)}`);
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      player.x = p.x; player.y = p.y;
      posLoaded = true;
    }
  } catch {
    // se rota não existir, segue para fallback
  }
  if (!posLoaded && starts[0]) {
    player.x = starts[0].x; player.y = starts[0].y;
  }

  mapData = await jget(`/api/admin/content/map/${MAP_KEY}/data`);
  tileset = (mapData.tilesets && mapData.tilesets[0]) || null;

  if (!tileset || !tileset.image) {
    console.warn("Tileset não embedado. No Tiled: 'Embed Tileset' e exporte novamente o JSON.");
  } else {
    // normaliza caminhos tipo "../../client/..." → "/" (servido estático)
    let imgPath = tileset.image.replace(/^(\.\.\/)+/, "/");
    if (!imgPath.startsWith("/")) imgPath = "/" + imgPath;
    imgPath = imgPath.replace(/^\/client\//, "/");
    tilesetImg = loadImg(imgPath);
    await ensureImgLoaded(tilesetImg);
  }

  groundLayer = (mapData.layers || []).find(
    (l) => l.type === "tilelayer" && l.name && l.name.toLowerCase() === "ground"
  );

  // sprite do jogador baseada no herói
  await resolvePlayerSprite();

  // tenta do servidor
  try {
    spawns = await jget(`/api/admin/content/map/${MAP_KEY}/spawns`);
  } catch { spawns = []; }
  if (!Array.isArray(spawns) || spawns.length === 0) {
    spawns = mapSpawnsFromTiledJSON(mapData);
    console.log("spawns fallback (JSON):", spawns);
  } else {
    console.log("spawns do servidor:", spawns);
  }

  mobs.length = 0;
  for (const s of spawns) {
    const count = Math.max(1, Number(s.count || 1));
    for (let i = 0; i < count; i++) {
      const m = {
        kind: s.monsterKey || s.monster || "mob",
        x: (s.x || 0) + Math.random() * (s.w || TILE),
        y: (s.y || 0) + Math.random() * (s.h || TILE),
        w: 28, h: 28, speed: 40 + Math.random() * 20,
        dirX: 0, dirY: 0, changeAt: 0,
        img: null,
        bound: (s.w || s.h) ? { x: s.x || 0, y: s.y || 0, w: s.w || TILE, h: s.h || TILE } : null,
      };
      m.img = loadImg(`/sprites/monsters/${m.kind}.png`); // se não existir, fica o círculo
      ensureImgLoaded(m.img).catch(()=>{});
      mobs.push(m);
    }
  }

  cam.x = Math.max(0, player.x - cam.w * 0.5);
  cam.y = Math.max(0, player.y - cam.h * 0.5);

  requestAnimationFrame((t) => { last = t; frame(t); });
}

main().catch((err) => {
  console.error(err);
  if (hud) hud.textContent = "Erro: " + err.message;
});
