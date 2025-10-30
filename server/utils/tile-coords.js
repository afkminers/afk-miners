const TILE = 32;

function coerceNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function resolveFeetPosition(source) {
  if (!source) return { x: NaN, y: NaN };

  // Accept already normalized tile coordinates
  if (Number.isFinite(source.feetX) || Number.isFinite(source.feetY)) {
    const fx = coerceNumber(source.feetX);
    const fy = coerceNumber(source.feetY);
    return {
      x: fx != null ? fx : NaN,
      y: fy != null ? fy : NaN,
    };
  }

  const explicitTileX = coerceNumber(source.tx ?? source.tileX ?? source.cx ?? source.col);
  const explicitTileY = coerceNumber(source.ty ?? source.tileY ?? source.cy ?? source.row);
  const hasExplicitTile = explicitTileX != null && explicitTileY != null;

  let x = coerceNumber(source.x ?? source.cx ?? source.centerX ?? source.left);
  let y = coerceNumber(source.y ?? source.cy ?? source.centerY ?? source.top);

  if (x == null && hasExplicitTile) x = (explicitTileX * TILE) + TILE / 2;
  if (y == null && hasExplicitTile) y = (explicitTileY * TILE) + TILE / 2;

  // Secondary fallbacks for data persisted as integers (tile coordinates)
  if (x == null && coerceNumber(source.ix) != null) x = coerceNumber(source.ix);
  if (y == null && coerceNumber(source.iy) != null) y = coerceNumber(source.iy);

  if (x == null) x = NaN;
  if (y == null) y = NaN;

  const offsetX = coerceNumber(source.feetOffsetX ?? source.feet_offset_x ?? 0) || 0;
  const offsetY = coerceNumber(source.feetOffsetY ?? source.feet_offset_y ?? 0) || 0;

  return {
    x: x + offsetX,
    y: y + offsetY,
  };
}

function toTileCoords(source) {
  if (!source) return { tx: NaN, ty: NaN };
  if (Number.isFinite(source.tx) && Number.isFinite(source.ty)) {
    return { tx: source.tx | 0, ty: source.ty | 0 };
  }
  if (Number.isFinite(source.tileX) && Number.isFinite(source.tileY)) {
    return { tx: source.tileX | 0, ty: source.tileY | 0 };
  }
  const feet = resolveFeetPosition(source);
  const tx = Number.isFinite(feet.x) ? Math.floor(feet.x / TILE) : NaN;
  const ty = Number.isFinite(feet.y) ? Math.floor(feet.y / TILE) : NaN;
  return { tx, ty };
}

function chebyshevTiles(a, b) {
  if (!a || !b) return Infinity;
  const atx = Number(a.tx);
  const aty = Number(a.ty);
  const btx = Number(b.tx);
  const bty = Number(b.ty);
  if (!Number.isFinite(atx) || !Number.isFinite(aty) || !Number.isFinite(btx) || !Number.isFinite(bty)) {
    return Infinity;
  }
  return Math.max(Math.abs(atx - btx), Math.abs(aty - bty));
}

function isValidTile(tile) {
  return tile && Number.isInteger(tile.tx) && Number.isInteger(tile.ty);
}

function tileToCenter(tile) {
  if (!isValidTile(tile)) return { x: NaN, y: NaN };
  return {
    x: tile.tx * TILE + TILE / 2,
    y: tile.ty * TILE + TILE / 2,
  };
}

module.exports = {
  TILE,
  resolveFeetPosition,
  toTileCoords,
  chebyshevTiles,
  isValidTile,
  tileToCenter,
};
