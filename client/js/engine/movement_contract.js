// client/js/engine/movement_contract.js
// Camada de adaptação para experimentos de movimento em grid 32x32.

const globalScope = typeof window !== 'undefined' ? window : globalThis;

export const TILE = 32;

if (globalScope && typeof globalScope.FEATURE_MOVEMENT_GRID_V1 !== 'boolean') {
  globalScope.FEATURE_MOVEMENT_GRID_V1 = false;
}

if (globalScope && typeof globalScope.DEBUG_MOVEMENT !== 'boolean') {
  globalScope.DEBUG_MOVEMENT = false;
}

export const toTile = (px) => {
  const value = Number(px);
  if (!Number.isFinite(value)) return 0;
  return Math.floor(value / TILE);
};

export const tileCenter = (tileIndex) => {
  const value = Number(tileIndex) || 0;
  return value * TILE + TILE / 2;
};

export function cheby(a, b) {
  const ax = Number(a?.x) || 0;
  const ay = Number(a?.y) || 0;
  const bx = Number(b?.x) || 0;
  const by = Number(b?.y) || 0;
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

export function normalizeStep(dx, dy, speedPxPerSec, dt) {
  const deltaTime = Number(dt);
  const speed = Number(speedPxPerSec);
  if (!Number.isFinite(deltaTime) || deltaTime <= 0 || !Number.isFinite(speed) || speed <= 0) {
    return { vx: 0, vy: 0, nx: 0, ny: 0, diagonal: false };
  }

  const length = Math.hypot(dx || 0, dy || 0);
  if (!Number.isFinite(length) || length === 0) {
    return { vx: 0, vy: 0, nx: 0, ny: 0, diagonal: false };
  }

  const nx = (dx || 0) / length;
  const ny = (dy || 0) / length;
  const diagonal = !!(nx && ny);
  const scale = speed * deltaTime * (diagonal ? Math.SQRT1_2 : 1);
  return { vx: nx * scale, vy: ny * scale, nx, ny, diagonal };
}

function resolveBlocked(map, cx, cy) {
  if (!map) return false;
  if (typeof map.isBlocked === 'function') {
    return !!map.isBlocked(cx, cy);
  }
  if (typeof map === 'function') {
    return !!map(cx, cy);
  }
  if (map.grid && Number.isFinite(map.cols) && Number.isFinite(map.rows)) {
    if (cx < 0 || cy < 0 || cx >= map.cols || cy >= map.rows) return true;
    const idx = cy * map.cols + cx;
    return map.grid[idx] === 1;
  }
  return false;
}

export function canCutCorner(map, tx, ty, sdx, sdy) {
  const stepX = Number(sdx) || 0;
  const stepY = Number(sdy) || 0;
  if (!stepX || !stepY) return true;
  const baseX = Number(tx) || 0;
  const baseY = Number(ty) || 0;

  if (resolveBlocked(map, baseX + stepX, baseY)) return false;
  if (resolveBlocked(map, baseX, baseY + stepY)) return false;
  return true;
}

export function footColliderPx(x, y) {
  const cx = Number(x);
  const cy = Number(y);
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
    return { x: 0, y: 0, w: TILE, h: TILE };
  }
  const half = TILE / 2;
  return { x: cx - half, y: cy - half, w: TILE, h: TILE };
}

if (globalScope) {
  const api = {
    TILE,
    toTile,
    tileCenter,
    cheby,
    normalizeStep,
    canCutCorner,
    footColliderPx,
  };
  globalScope.MovementContract = Object.freeze({ ...api });
}

