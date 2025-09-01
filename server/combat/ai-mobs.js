// server/combat/ai-mobs.js
// AI extremamente simples: “passeio” com agro básico ao player mais próximo.
// Mantém os monstros dentro do retângulo do spawn e publica a cada passo a posição.

const { get } = require('../models/db');
const bus = require('../ws/bus'); // { broadcast }

const TICK_MS      = 250;  // ms entre passos
const WANDER_SPEED = 40;   // px/s quando à toa
const CHASE_SPEED  = 60;   // px/s quando em agro
const AGGRO_RANGE  = 160;  // px

let timer = null;

// Cache: id -> { x, y, mapKey, spawnRect:{x,y,w,h} }
const INST = new Map();

/**
 * Usado pelo respawn/loader para injetar a posição inicial.
 * spawnRect é opcional; se não vier, usa caixa 96x96 centrada.
 */
function seedPosition({ id, x, y, mapKey, spawnRect }) {
  const sr = (spawnRect && Number.isFinite(spawnRect.w) && Number.isFinite(spawnRect.h))
    ? { x: Number(spawnRect.x) || 0, y: Number(spawnRect.y) || 0, w: Number(spawnRect.w), h: Number(spawnRect.h) }
    : { x: Math.max(0, (Number(x)||0) - 48), y: Math.max(0, (Number(y)||0) - 48), w: 96, h: 96 };

  INST.set(String(id), {
    x: Math.round(Number(x)||0),
    y: Math.round(Number(y)||0),
    mapKey: String(mapKey || 'house'),
    spawnRect: sr
  });
}

/** Remover do cache quando morrer/despawnar (caso queira ligar em outro ponto do código) */
function forget(id) { INST.delete(String(id)); }

function clampToRect(x, y, r) {
  const cx = Math.min(Math.max(x, r.x), r.x + r.w);
  const cy = Math.min(Math.max(y, r.y), r.y + r.h);
  return { x: cx, y: cy };
}

// “cheiro” do player mais próximo pela última posição conhecida
async function nearestPlayerPos(mapKey, x, y) {
  const row = await get(
    `SELECT x, y
       FROM player_last_pos
      WHERE map_key = $1
      ORDER BY ((x-$2)*(x-$2) + (y-$3)*(y-$3)) ASC
      LIMIT 1`,
    [mapKey, x, y]
  ).catch(() => null);
  return row ? { x: Number(row.x), y: Number(row.y) } : null;
}

async function tick() {
  const dt = TICK_MS / 1000;

  for (const [id, m] of INST.entries()) {
    let dx = 0, dy = 0, speed = WANDER_SPEED;

    // agro simples
    const p = await nearestPlayerPos(m.mapKey, m.x, m.y);
    if (p) {
      const dist = Math.hypot(p.x - m.x, p.y - m.y);
      if (dist <= AGGRO_RANGE) {
        speed = CHASE_SPEED;
        dx = (p.x - m.x) / (dist || 1);
        dy = (p.y - m.y) / (dist || 1);
      }
    }

    // passeio aleatório
    if (dx === 0 && dy === 0) {
      const ang = Math.random() * Math.PI * 2;
      dx = Math.cos(ang);
      dy = Math.sin(ang);
    }

    let nx = m.x + dx * speed * dt;
    let ny = m.y + dy * speed * dt;

    // mantém dentro do retângulo do spawn
    const cl = clampToRect(nx, ny, m.spawnRect);
    nx = Math.round(cl.x);
    ny = Math.round(cl.y);

    // atualiza cache
    m.x = nx; m.y = ny; INST.set(id, m);

    // avisa clientes para mover sprite + barra
    bus.broadcast({ type: 'monster_move', id: String(id), x: nx, y: ny });
  }
}

function start() {
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
  console.log(`[ai] mob AI started (${TICK_MS}ms)`);
}
function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  console.log('[ai] mob AI stopped');
}

module.exports = { start, stop, seedPosition, forget };
