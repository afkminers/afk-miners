// client/js/scenes/house.js
// Cena LOBBY/HOUSE: renderiza o mapa 'house' com player e mobs (goblins) do pipeline.

const TILE = 32;

async function jget(u){
  const r = await fetch(u, { credentials:'include' });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
function loadImg(src){
  const i = new Image();
  i.src = src;
  return i;
}
function imgReady(img){ return img && img.complete && img.naturalWidth > 0; }
async function ensureImgLoaded(img){ try{ await img.decode(); }catch{} }

export async function mount({ canvas, hud, params }){
  // Sempre padrão 'house' (pode passar outro via params.map)
  const mapKey = (params?.map || 'house') + '';
  const ctx = canvas.getContext('2d');

  // câmera / player
  const cam = { x:0, y:0, w:canvas.width, h:canvas.height, lerp:.15 };
  const keys = {};
  addEventListener('keydown', e => keys[e.key.toLowerCase()] = true);
  addEventListener('keyup',   e => keys[e.key.toLowerCase()] = false);

  const player = {
    x: 100, y: 100, w: 32, h: 32, speed: 140,
    img: loadImg('/sprites/characters/player.png')
  };
  ensureImgLoaded(player.img);

  // Carrega JSON “bruto” do mapa do DB
  const mapData = await jget(`/api/admin/content/map/${mapKey}/data`);
  const groundLayer = (mapData.layers || [])
    .find(l => l.type === 'tilelayer' && (l.name || '').toLowerCase() === 'ground');

  // Tileset (primeiro tileset do Tiled)
  const tileset = (mapData.tilesets && mapData.tilesets[0]) || null;
  let tilesetImg = null, tsCols = 0, first = 1, tw = TILE, th = TILE;
  if (tileset && tileset.image){
    let imgPath = tileset.image.replace(/^(\.\.\/)+/, '/');
    if (!imgPath.startsWith('/')) imgPath = '/' + imgPath;
    imgPath = imgPath.replace(/^\/client\//, '/'); // garante caminho relativo ao site
    tilesetImg = loadImg(imgPath);
    await ensureImgLoaded(tilesetImg);
    tsCols = tileset.columns || 1;
    first  = tileset.firstgid || 1;
    tw     = tileset.tilewidth  || TILE;
    th     = tileset.tileheight || TILE;
  }

  // Posição inicial do player (objeto type="start" no Tiled, em map_objects)
  try{
    const objs = await jget(`/api/admin/content/map/${mapKey}/objects`);
    const start = (objs || []).find(o => (o.type || '').toLowerCase() === 'start');
    if (start){ player.x = start.x; player.y = start.y; }
  }catch{}

  // Spawns do mapa (monsters) — desenha “dummy” pra ambientação
  let spawns = [];
  try{ spawns = await jget(`/api/admin/content/map/${mapKey}/spawns`); }catch{}
  const mobs = [];
  for (const s of spawns){
    const n = Math.max(1, Number(s.count || 1));
    for (let i=0; i<n; i++){
      mobs.push({
        x:(s.x||0)+Math.random()*(s.w||TILE),
        y:(s.y||0)+Math.random()*(s.h||TILE),
        w:28, h:28, speed:40+Math.random()*20,
        dirX:0, dirY:0, changeAt:0,
        img: loadImg(`/sprites/monsters/${s.monsterKey || 'goblin'}.png`),
        bound: (s.w||s.h) ? { x:s.x||0, y:s.y||0, w:s.w||TILE, h:s.h||TILE } : null
      });
    }
  }

  function drawGround(){
    if (!groundLayer || !imgReady(tilesetImg)) return;
    const data = groundLayer.data, cols = mapData.width, rows = mapData.height;
    const x0 = Math.max(0, Math.floor(cam.x/TILE));
    const y0 = Math.max(0, Math.floor(cam.y/TILE));
    const x1 = Math.min(cols-1, Math.ceil((cam.x+cam.w)/TILE));
    const y1 = Math.min(rows-1, Math.ceil((cam.y+cam.h)/TILE));
    for (let y=y0; y<=y1; y++){
      for (let x=x0; x<=x1; x++){
        const gid = data[y*cols + x];
        if (!gid || gid < first) continue;
        const id = gid - first;
        const sx = (id % tsCols) * tw;
        const sy = Math.floor(id / tsCols) * th;
        ctx.drawImage(tilesetImg, sx, sy, tw, th, x*TILE, y*TILE, TILE, TILE);
      }
    }
  }

  function drawUnit(u, color){
    if (imgReady(u.img)){
      const ox = Math.round(u.x - u.w*.5);
      const oy = Math.round(u.y - u.h*.9);
      ctx.drawImage(u.img, ox, oy, u.w, u.h);
    } else {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(u.x,u.y,7,0,Math.PI*2);
      ctx.fill();
    }
  }

  let stop = false, last = 0;
  function loop(ts){
    if (stop) return;
    const dt = Math.min(0.05, (ts - last)/1000);
    last = ts;

    // input
    let dx=0, dy=0;
    if (keys['w'] || keys['arrowup'])    dy -= 1;
    if (keys['s'] || keys['arrowdown'])  dy += 1;
    if (keys['a'] || keys['arrowleft'])  dx -= 1;
    if (keys['d'] || keys['arrowright']) dx += 1;
    if (dx || dy){
      const len = Math.hypot(dx,dy) || 1;
      player.x += (dx/len) * player.speed * dt;
      player.y += (dy/len) * player.speed * dt;
    }

    // limites do mapa
    const maxX = mapData.width * TILE;
    const maxY = mapData.height * TILE;
    player.x = Math.max(0, Math.min(maxX, player.x));
    player.y = Math.max(0, Math.min(maxY, player.y));

    // mobs “passeando”
    const now = performance.now();
    for (const m of mobs){
      if (now >= m.changeAt){
        const ang = Math.random()*Math.PI*2;
        m.dirX = Math.cos(ang); m.dirY = Math.sin(ang);
        m.changeAt = now + 700 + Math.random()*1300;
      }
      m.x += m.dirX * m.speed * dt;
      m.y += m.dirY * m.speed * dt;
      if (m.bound){
        const {x,y,w,h} = m.bound;
        if (m.x < x){ m.x = x;    m.dirX *= -1; }
        if (m.y < y){ m.y = y;    m.dirY *= -1; }
        if (m.x > x+w){ m.x = x+w; m.dirX *= -1; }
        if (m.y > y+h){ m.y = y+h; m.dirY *= -1; }
      }
    }

    // câmera
    cam.x += (player.x - cam.x - cam.w*0.5) * cam.lerp;
    cam.y += (player.y - cam.y - cam.h*0.5) * cam.lerp;
    cam.x  = Math.max(0, Math.min(maxX - cam.w, cam.x));
    cam.y  = Math.max(0, Math.min(maxY - cam.h, cam.y));

    // HUD
    if (hud){
      hud.innerHTML = `map: ${mapKey}\nMove: WASD / Setas\npos: ${Math.round(player.x)}, ${Math.round(player.y)}`;
    }

    // render
    ctx.save();
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.translate(-Math.floor(cam.x), -Math.floor(cam.y));
    drawGround();
    for (const m of mobs) drawUnit(m,'#ef4444'); // goblins
    drawUnit(player,'#f59e0b');                   // player
    ctx.restore();

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(t => { last = t; loop(t); });

  return {
    unmount(){ stop = true; }
  };
}

export default { mount };
