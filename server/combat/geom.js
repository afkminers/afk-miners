// server/combat/geom.js
const TILE = 32;

function toTile(v) {
  return Math.floor(v / TILE);
}

function chebyshevTiles(ax, ay, bx, by) {
  const dx = Math.abs(toTile(ax) - toTile(bx));
  const dy = Math.abs(toTile(ay) - toTile(by));
  return Math.max(dx, dy);
}

/** Alcance em tiles por arma (melee=1; distance=5; magic=8...) */
function inReachPx(attacker, target, weaponType, K) {
  const key = String(weaponType || 'SWORD').toUpperCase();
  const rangeTiles = (K.WEAPON_RANGE_TILES && K.WEAPON_RANGE_TILES[key]) ?? 1;
  const distTiles = chebyshevTiles(attacker.x, attacker.y, target.x, target.y);
  return distTiles <= rangeTiles;
}

module.exports = { TILE, toTile, chebyshevTiles, inReachPx };
