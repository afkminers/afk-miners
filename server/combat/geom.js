// server/combat/geom.js
// === Geometria de combate (distâncias/alcance) ===
// Mantém compatibilidade com imports existentes:
//   const { inReachPx, resolveRangeTiles, chebyPx, chebyshevTiles, TILE } = require('./geom');

const TILE = 32;
const EPS = 0; // sem margem de erro
const MIN_HITBOX = TILE / 2;       // mobs menores que 1 tile ainda contam como ~16px
const MAX_HITBOX = TILE * 4;       // evita spritesheet gigante virar hitbox infinita

function clamp(v, min, max) {
  if (!Number.isFinite(v)) {
    if (Number.isFinite(min)) return min;
    if (Number.isFinite(max)) return max;
    return 0;
  }
  if (Number.isFinite(min) && v < min) return min;
  if (Number.isFinite(max) && v > max) return max;
  return v;
}

// aliases para mapear tipo de arma -> faixa comum
const DISTANCE_ALIASES = new Set(['BOW', 'CROSSBOW', 'SPEAR', 'JAVELIN', 'THROWING_KNIFE', 'DISTANCE']);
const MAGIC_ALIASES    = new Set(['MAGIC', 'WAND', 'ROD', 'TOME', 'STAFF']);

function toTile(v) {
  return Math.floor(v / TILE);
}

/** Chebyshev em TILES (calcula em px e converte) */
function chebyshevTiles(ax, ay, bx, by) {
  const distPx = chebyPx(ax, ay, bx, by);
  return Math.floor(distPx / TILE);
}

/** Chebyshev em PIXELS (máx de dx, dy) */
function chebyPx(ax, ay, bx, by) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function resolveHitboxDimension(target, axis) {
  if (!target) return TILE;

  const keys = axis === 'w'
    ? ['hitbox_w', 'hitboxW', 'hitboxWidth', 'frame_w', 'frameW', 'w', 'width']
    : ['hitbox_h', 'hitboxH', 'hitboxHeight', 'frame_h', 'frameH', 'h', 'height'];

  for (const key of keys) {
    if (key in target) {
      const raw = Number(target[key]);
      if (Number.isFinite(raw) && raw > 0) {
        return Math.max(MIN_HITBOX, Math.min(raw, MAX_HITBOX));
      }
    }
  }

  return TILE;
}

function pickCoord(source, axis) {
  if (!source) return 0;
  const keys = axis === 'x'
    ? ['cx', 'centerX', 'center_x', 'center', 'x', 'X', 'left']
    : ['cy', 'centerY', 'center_y', 'center', 'y', 'Y', 'top'];

  for (const key of keys) {
    if (key in source) {
      const v = Number(source[key]);
      if (Number.isFinite(v)) return v;
    }
  }

  return 0;
}

function distanceToTargetPx(attacker, target) {
  if (!attacker || !target) return Infinity;

  const ax = pickCoord(attacker, 'x');
  const ay = pickCoord(attacker, 'y');
  if (!Number.isFinite(ax) || !Number.isFinite(ay)) return Infinity;

  const tx = pickCoord(target, 'x');
  const ty = pickCoord(target, 'y');
  if (!Number.isFinite(tx) || !Number.isFinite(ty)) return Infinity;

  const frameW = resolveHitboxDimension(target, 'w');
  const frameH = resolveHitboxDimension(target, 'h');

  if ((Number.isFinite(frameW) && frameW > 0) || (Number.isFinite(frameH) && frameH > 0)) {
    const halfW = Math.max(1, frameW) / 2;
    const halfH = Math.max(1, frameH) / 2;
    const closestX = clamp(ax, tx - halfW, tx + halfW);
    const closestY = clamp(ay, ty - halfH, ty + halfH);
    return chebyPx(ax, ay, closestX, closestY);
  }

  return chebyPx(ax, ay, tx, ty);
}

/** Resolve alcance (em tiles) para o tipo de arma informado */
function resolveRangeTiles(weaponType, heroClass, K) {
  const table = (K && K.WEAPON_RANGE_TILES) || {};
  const rawKey = String(weaponType || '').toUpperCase();
  const key = rawKey || 'SWORD';

  let rangeTiles = Number(table[key]);

  if (!Number.isFinite(rangeTiles)) {
    if (DISTANCE_ALIASES.has(key) && Number.isFinite(table.DISTANCE)) {
      rangeTiles = Number(table.DISTANCE);
    } else if (MAGIC_ALIASES.has(key) && Number.isFinite(table.MAGIC)) {
      rangeTiles = Number(table.MAGIC);
    }
  }

  if (!Number.isFinite(rangeTiles) && Number.isFinite(table.SWORD)) {
    rangeTiles = Number(table.SWORD);
  }

  if (!Number.isFinite(rangeTiles) || rangeTiles <= 0) {
    rangeTiles = 1;
  }

  return Math.max(1, rangeTiles);
}

/**
 * Verifica alcance comparando em PIXELS (estilo Tibia)
 * distPx <= rangeTiles * TILE (sem margem EPS)
 */
function inReachPx(attacker, target, weaponType, K, heroClass = null) {
  if (!attacker || !target) return false;
  const rangeTiles = resolveRangeTiles(weaponType, heroClass, K);
  const rangePx = rangeTiles * TILE;
  const distPx = distanceToTargetPx(attacker, target);
  return Number.isFinite(distPx) && distPx <= (rangePx + EPS);
}

module.exports = {
  TILE,
  EPS,
  toTile,
  chebyshevTiles,
  chebyPx,
  distanceToTargetPx,
  inReachPx,
  resolveRangeTiles,
  resolveHitboxDimension,
};
