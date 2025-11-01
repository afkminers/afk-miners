// server/combat/los.js
const { toTileCoords, isValidTile } = require('../utils/tile-coords');

/**
 * Suporta:
 *  - grid2D: boolean[][] (true/1 = bloqueia)
 *  - linear: { data: Uint8Array, cols, rows }
 *  - ou diretamente Uint8Array + você passa um wrapper (ver autoloop)
 */
function hasLineOfSightTiles(gridLike, aTx, aTy, bTx, bTy) {
  let x0 = aTx | 0;
  let y0 = aTy | 0;
  let x1 = bTx | 0;
  let y1 = bTy | 0;

  let cols = null, data = null, grid2D = null;

  if (Array.isArray(gridLike)) {
    grid2D = gridLike; // boolean[][]
  } else if (gridLike && gridLike.data instanceof Uint8Array && Number.isFinite(gridLike.cols)) {
    data = gridLike.data;
    cols = gridLike.cols;
  } else if (gridLike instanceof Uint8Array) {
    // caso raro: se te passarem só o Uint8Array, não temos cols/rows -> não conseguimos index linear
    // prefira passar { data: grid, cols, rows }
    throw new Error('LOS: precisa de cols/rows quando usar Uint8Array');
  }

  const blocked = (cx, cy) => {
    if (grid2D) return !!(grid2D[cy]?.[cx]);
    if (data && Number.isFinite(cols)) return !!data[cy * cols + cx];
    return false;
  };

  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;

  while (true) {
    if (blocked(x0, y0)) return false;
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return true;
}

function hasLineOfSight(gridLike, ax, ay, bx, by) {
  const aTile = toTileCoords({ x: ax, y: ay });
  const bTile = toTileCoords({ x: bx, y: by });
  if (!isValidTile(aTile) || !isValidTile(bTile)) return false;
  return hasLineOfSightTiles(gridLike, aTile.tx, aTile.ty, bTile.tx, bTile.ty);
}

module.exports = { hasLineOfSight, hasLineOfSightTiles };
