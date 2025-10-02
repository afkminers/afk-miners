// server/combat/geom.js
// === Geometria de combate (distâncias/alcance) ===
// Mantém compatibilidade com imports existentes:
//   const { inReachPx, resolveRangeTiles, chebyPx, chebyshevTiles, TILE } = require('./geom');

const TILE = 32;
const EPS = 0; // sem margem de erro

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

function distanceToTargetPx(attacker, target) {
  if (!attacker || !target) return Infinity;

  const ax = Number(attacker.x ?? attacker.X ?? attacker.left ?? attacker.cx ?? 0);
  const ay = Number(attacker.y ?? attacker.Y ?? attacker.top ?? attacker.cy ?? 0);
  if (!Number.isFinite(ax) || !Number.isFinite(ay)) return Infinity;

  const tx = Number(target.x ?? target.X ?? target.cx ?? 0);
  const ty = Number(target.y ?? target.Y ?? target.cy ?? 0);
  if (!Number.isFinite(tx) || !Number.isFinite(ty)) return Infinity;

  const frameW = Number(target.frame_w ?? target.frameW ?? target.w ?? target.width ?? 0);
  const frameH = Number(target.frame_h ?? target.frameH ?? target.h ?? target.height ?? 0);

  if ((Number.isFinite(frameW) && frameW > 0) || (Number.isFinite(frameH) && frameH > 0)) {
    const safeW = (Number.isFinite(frameW) && frameW > 0) ? frameW : TILE;
    const safeH = (Number.isFinite(frameH) && frameH > 0) ? frameH : TILE;
    const halfW = Math.max(1, safeW) / 2;
    const halfH = Math.max(1, safeH) / 2;
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
};
