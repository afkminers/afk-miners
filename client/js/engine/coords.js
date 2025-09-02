// client/js/engine/coords.js
export const TILE = 32;

export function worldToTile(wx, wy) {
  return { tx: Math.floor(wx / TILE), ty: Math.floor(wy / TILE) };
}
export function tileToWorldCenter(tx, ty) {
  return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
}
