// server/combat/geom.js
const TILE = 32;
const EPS  = 1; // margem mínima anti-oscilação para comparações em PX

const DISTANCE_ALIASES = new Set(['BOW', 'CROSSBOW', 'SPEAR', 'JAVELIN', 'THROWING_KNIFE', 'DISTANCE']);
const MAGIC_ALIASES = new Set(['MAGIC', 'WAND', 'ROD', 'TOME', 'STAFF']);
const CLASS_RANGE_CAP = { KNIGHT: 1, RANGER: 4, MAGE: 4 };

function toTile(v) {
  return Math.floor(v / TILE);
}

/** Chebyshev em TILES (mantido p/ compatibilidade) */
function chebyshevTiles(ax, ay, bx, by) {
  const dx = Math.abs(toTile(ax) - toTile(bx));
  const dy = Math.abs(toTile(ay) - toTile(by));
  return Math.max(dx, dy);
}

/** Chebyshev em PIXELS (padrão p/ AI e guards no servidor) */
function chebyPx(ax, ay, bx, by) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

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

  const classKey = String(heroClass || '').toUpperCase();
  if (classKey && CLASS_RANGE_CAP[classKey]) {
    rangeTiles = Math.min(rangeTiles, CLASS_RANGE_CAP[classKey]);
  }

  return Math.max(1, rangeTiles);
}

/** Alcance por arma comparando em PIXELS (usa tabela em tiles -> px) */
function inReachPx(attacker, target, weaponType, K, heroClass = null) {
  const rangeTiles = resolveRangeTiles(weaponType, heroClass, K);
  const rangePx = rangeTiles * TILE;
  const distPx = chebyPx(attacker.x, attacker.y, target.x, target.y);
  return distPx <= (rangePx + EPS);
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
