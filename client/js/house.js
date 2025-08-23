// client/js/house.js
const MAP_KEY = 'house';
const TILE = 32;
const $ = (id) => document.getElementById(id);

const canvas = $('view');
const ctx = canvas.getContext('2d');
const statusEl = $('status');
const startPosEl = $('startPos');
const spawnListEl = $('spawnList');
const btnReload = $('btnReload');

// --- HTTP helpers ---
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

// --- draw helpers ---
function clear() { ctx.clearRect(0,0,canvas.width, canvas.height); }
function setStatus(t) { if (statusEl) statusEl.textContent = t; }

function drawGrid(cols, rows) {
  ctx.save();
  ctx.strokeStyle = '#1f2937';
  ctx.lineWidth = 1;
  for (let x=0; x<=cols; x++) {
    ctx.beginPath(); ctx.moveTo(x*TILE + .5, 0); ctx.lineTo(x*TILE + .5, rows*TILE); ctx.stroke();
  }
  for (let y=0; y<=rows; y++) {
    ctx.beginPath(); ctx.moveTo(0, y*TILE + .5); ctx.lineTo(cols*TILE, y*TILE + .5); ctx.stroke();
  }
  ctx.restore();
}

function drawStart(x, y) {
  ctx.save();
  ctx.fillStyle = '#3b82f6';
  ctx.strokeStyle = '#93c5fd';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#2563eb';
  ctx.strokeRect(Math.floor(x/TILE)*TILE+0.5, Math.floor(y/TILE)*TILE+0.5, TILE, TILE);
  ctx.restore();
}

function drawSpawnRect(x, y, w, h, label='spawn') {
  if (!w && !h) { w=TILE; h=TILE; x=Math.floor(x/TILE)*TILE; y=Math.floor(y/TILE)*TILE; }
  ctx.save();
  ctx.globalAlpha = .15;
  ctx.fillStyle = '#22c55e';
  ctx.fillRect(x,y,w,h);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#16a34a';
  ctx.lineWidth = 2;
  ctx.strokeRect(x+.5,y+.5,w,h);
  ctx.font = '12px ui-sans-serif,system-ui,Segoe UI,Arial';
  ctx.fillStyle = '#e2e8f0';
  ctx.fillText(label, x+4, y+14);
  ctx.restore();
}

// --- tileset render (opcional) ---
const IMG_CACHE = new Map();
function loadImg(src) {
  if (IMG_CACHE.has(src)) return IMG_CACHE.get(src);
  const img = new Image();
  img.src = src;
  IMG_CACHE.set(src, img);
  return img;
}
function normalizeTilesetPath(p) {
  if (!p) return null;
  // troca anti-slash, remove ../ e remove "client/" se existir em qualquer lugar
  let s = p.replace(/\\/g,'/').replace(/^(\.\.\/)+/,'');
  s = s.replace(/^client\//,'');
  if (!s.startsWith('/')) s = '/' + s;
  return s; // ex: "/sprites/tiles/kenney_map.png"
}

let mapData = null, tileset = null, tilesetImg = null, groundLayer = null;

function drawGround() {
  if (!groundLayer || !tileset || !tilesetImg || !tilesetImg.complete) return;
  const data = groundLayer.data;
  const cols = mapData.width, rows = mapData.height;
  const first = tileset.firstgid || 1;
  const tw = tileset.tilewidth, th = tileset.tileheight;
  const columnsInImage = tileset.columns;

  for (let y=0; y<rows; y++) {
    for (let x=0; x<cols; x++) {
      const gid = data[y*cols + x];
      if (!gid || gid < first) continue;
      const id = gid - first;
      const sx = (id % columnsInImage) * tw;
      const sy = Math.floor(id / columnsInImage) * th;
      ctx.drawImage(tilesetImg, sx, sy, tw, th, x*TILE, y*TILE, TILE, TILE);
    }
  }
}

// --- reload no servidor ---
async function reloadMapOnServer() {
  try {
    setStatus('Recarregando mapa no servidor…');
    const j = await postWithCsrf(`/api/admin/content/reload-map?map=${MAP_KEY}`);
    console.log('reload response:', j);
    setStatus('OK');
  } catch (e) {
    console.error(e);
    setStatus('Erro: ' + e.message);
  }
}

// --- fluxo principal ---
async function main() {
  try {
    setStatus('Carregando…');

    // 1) confirma mapa existe
    const maps = await jget('/api/admin/content/maps');
    if (!maps.some(m => m.key === MAP_KEY)) throw new Error(`map ${MAP_KEY} não encontrado`);

    // 2) objetos e spawns
    const objs   = await jget(`/api/admin/content/map/${MAP_KEY}/objects`);
    const spawns = await jget(`/api/admin/content/map/${MAP_KEY}/spawns`);

    const starts = objs.filter(o => (o.type||'').toLowerCase() === 'start');

    // 3) JSON bruto do mapa para desenhar tiles (se tiver embed)
    try {
      mapData = await jget(`/api/admin/content/map/${MAP_KEY}/data`);
      tileset = (mapData.tilesets && mapData.tilesets[0]) || null;
      if (tileset && tileset.image) {
        tilesetImg = loadImg(normalizeTilesetPath(tileset.image));
        groundLayer = (mapData.layers||[]).find(l => l.type==='tilelayer' && l.name.toLowerCase()==='ground');
      } else {
        console.warn('Tileset não embedado no JSON. No Tiled: clique no ícone "Embed Tileset" e exporte o .json.');
      }
    } catch (e) {
      // Se não existir a rota/registro, segue só com grid/shapes
      console.warn('Falha ao carregar /data do mapa (seguindo sem tiles):', e.message);
    }

    // UI lateral
    if (starts[0]) {
      if (startPosEl) startPosEl.textContent = `${Math.round(starts[0].x)}, ${Math.round(starts[0].y)}`;
    } else {
      if (startPosEl) startPosEl.textContent = '—';
    }
    if (spawnListEl) {
      spawnListEl.innerHTML = '';
      for (const s of spawns) {
        const li = document.createElement('li');
        li.textContent = `${s.monsterKey} ×${s.count} @ (${s.x}, ${s.y})`;
        spawnListEl.appendChild(li);
      }
    }

    // desenhar
    clear();
    // fundo
    ctx.save(); ctx.fillStyle = '#0f172a'; ctx.fillRect(0,0,canvas.width, canvas.height); ctx.restore();

    // tiles do ground (se disponíveis)
    if (groundLayer && tilesetImg && tilesetImg.complete) {
      drawGround();
    }

    // grid e shapes
    const cols = (mapData?.width)  || Math.floor(canvas.width  / TILE);
    const rows = (mapData?.height) || Math.floor(canvas.height / TILE);
    drawGrid(cols, rows);
    for (const s of spawns) drawSpawnRect(s.x, s.y, s.w, s.h, `${s.monsterKey}×${s.count}`);
    if (starts[0]) drawStart(starts[0].x, starts[0].y);

    setStatus('OK');
  } catch (e) {
    console.error(e);
    setStatus('Erro: ' + e.message);
  }
}

btnReload?.addEventListener('click', async () => { await reloadMapOnServer(); await main(); });
main();
