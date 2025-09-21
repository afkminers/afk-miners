// server/combat/geom.js
const TILE = 32;
const EPS  = 1; // margem mínima anti-oscilação para comparações em PX

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

/** Alcance por arma comparando em PIXELS (usa tabela em tiles -> px) */
function inReachPx(attacker, target, weaponType, K) {
  const key = String(weaponType || 'SWORD').toUpperCase();
  const rangeTiles = (K.WEAPON_RANGE_TILES && K.WEAPON_RANGE_TILES[key]) ?? 1;
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
};
