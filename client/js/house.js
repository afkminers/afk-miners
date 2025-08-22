// client/js/house.js
const MAP_KEY = 'house';
const TILE = 32; // teu mapa atual é 32x32
const CANVAS_W = 640; // 20 * 32
const CANVAS_H = 640;

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const ctx = canvas.getContext('2d');
const statusEl = $('status');
const startPosEl = $('startPos');
const spawnListEl = $('spawnList');
const btnReload = $('btnReload');

// helpers
async function jget(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}
async function jpost(url) {
  const r = await fetch(url, { method:'POST' });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

function clear() {
  ctx.clearRect(0,0,canvas.width, canvas.height);
}

function drawGrid(cols=20, rows=20) {
  ctx.save();
  ctx.strokeStyle = '#1f2937';
  ctx.lineWidth = 1;
  for (let x=0; x<=cols; x++) {
    ctx.beginPath();
    ctx.moveTo(x*TILE + .5, 0);
    ctx.lineTo(x*TILE + .5, rows*TILE);
    ctx.stroke();
  }
  for (let y=0; y<=rows; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y*TILE + .5);
    ctx.lineTo(cols*TILE, y*TILE + .5);
    ctx.stroke();
  }
  ctx.restore();
}

function drawStart(x, y) {
  // x,y já estão em pixels (Tiled)
  ctx.save();
  ctx.fillStyle = '#3b82f6';
  ctx.strokeStyle = '#93c5fd';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI*2);
  ctx.fill();
  ctx.stroke();

  // marca o tile base
  ctx.strokeStyle = '#2563eb';
  ctx.strokeRect(Math.floor(x/TILE)*TILE+0.5, Math.floor(y/TILE)*TILE+0.5, TILE, TILE);
  ctx.restore();
}

function drawSpawnRect(x, y, w, h, label='spawn') {
  // alguns objetos podem vir com w/h zero (ponto). vamos destacar um tile então.
  if (!w && !h) {
    w = TILE;
    h = TILE;
    x = Math.floor(x/TILE)*TILE;
    y = Math.floor(y/TILE)*TILE;
  }
  ctx.save();
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = '#22c55e';
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#16a34a';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);

  // label
  ctx.font = '12px ui-sans-serif, system-ui, Segoe UI, Arial';
  ctx.fillStyle = '#e2e8f0';
  ctx.fillText(label, x + 4, y + 14);
  ctx.restore();
}

function setStatus(text) {
  statusEl.textContent = text;
}

async function reloadMapOnServer() {
  try {
    setStatus('Recarregando mapa no servidor…');
    await jpost(`/api/admin/content/reload-map?map=${MAP_KEY}`);
    setStatus('Mapa recarregado ✔');
  } catch (e) {
    console.error(e);
    setStatus('Erro ao recarregar: ' + e.message);
  }
}

// fluxo principal
async function main() {
  try {
    setStatus('Carregando…');

    // (A) info de mapas — só para confirmar que existe
    const maps = await jget('/api/admin/content/maps');
    const hasHouse = maps.some(m => m.key === MAP_KEY);
    if (!hasHouse) throw new Error(`map ${MAP_KEY} não encontrado`);

    // (B) objetos (start etc.)
    const objs = await jget(`/api/admin/content/map/${MAP_KEY}/objects`);
    const starts = objs.filter(o => (o.type||'').toLowerCase() === 'start');

    // (C) spawns
    const spawns = await jget(`/api/admin/content/map/${MAP_KEY}/spawns`);

    // UI lateral
    if (starts[0]) {
      startPosEl.textContent = `${Math.round(starts[0].x)}, ${Math.round(starts[0].y)}`;
    } else {
      startPosEl.textContent = '— (nenhum "start" no mapa)';
    }

    spawnListEl.innerHTML = '';
    for (const s of spawns) {
      const li = document.createElement('li');
      li.textContent = `${s.monsterKey} ×${s.count} @ (${s.x}, ${s.y})`;
      spawnListEl.appendChild(li);
    }

    // desenha
    clear();

    // fundo “grama” placeholder (só estética do debug)
    ctx.save();
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0,0,canvas.width, canvas.height);
    ctx.restore();

    drawGrid(20, 20);

    for (const s of spawns) {
      drawSpawnRect(s.x, s.y, s.w, s.h, `${s.monsterKey}×${s.count}`);
    }

    if (starts[0]) {
      drawStart(starts[0].x, starts[0].y);
    }

    setStatus('OK');
  } catch (e) {
    console.error(e);
    setStatus('Erro: ' + e.message);
  }
}

btnReload?.addEventListener('click', async () => {
  await reloadMapOnServer();
  await main();
});

main();
