// server/combat/geom.js
// === Geometria de combate (distâncias/alcance) ===
// Mantém compatibilidade com imports existentes:
//   const { inReachPx, resolveRangeTiles, chebyPx, chebyshevTiles, TILE } = require('./geom');

const TILE = 32;
const EPS = 0; // sem margem de erro

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
  const rangeTiles = resolveRangeTiles(weaponType, heroClass, K);
  const rangePx = rangeTiles * TILE;
  const distPx = chebyPx(attacker.x, attacker.y, target.x, target.y);
  return distPx <= rangePx;
}

module.exports = {
  TILE,
  EPS,
  toTile,
  chebyshevTiles,
  chebyPx,
  inReachPx,
  resolveRangeTiles,
};
