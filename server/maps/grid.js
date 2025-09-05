// server/maps/grid.js
const { get, all } = require('../models/db');
const TILE = 32;
const cache = new Map(); // mapKey -> { grid: Uint8Array, cols, rows }

function hasSolidPropRow(row) {
  try {
    const p = row.propsJSON;
    if (Array.isArray(p)) return p.some(v => v?.name === 'solid' && (v.value === true || v.value === 1));
    if (p && typeof p === 'object') return !!(p.solid === true || p.solid === 1);
  } catch {}
  return false;
}

function buildCollisionFromObjects(mapW, mapH, objs) {
  const cols = Math.floor(mapW / TILE), rows = Math.floor(mapH / TILE);
  const grid = new Uint8Array(cols * rows);
  for (const o of objs) {
    const t = String(o.type || '').toLowerCase();
    const solid = t === 'solid' || hasSolidPropRow(o);
    if (!solid) continue;
    const x0 = Math.floor(o.x / TILE), y0 = Math.floor(o.y / TILE);
    const x1 = Math.floor((o.x + o.w - 1) / TILE);
    const y1 = Math.floor((o.y + o.h - 1) / TILE);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      if (cx>=0 && cy>=0) grid[cy*cols + cx] = 1;
    }
  }
  return { grid, cols, rows };
}

function buildCollisionFromTiled(json) {
  const cols = json.width|0, rows = json.height|0;
  const grid = new Uint8Array(cols * rows);
  const layer = (json.layers || []).find(l => l.type === 'tilelayer' && (l.name||'').toLowerCase().includes('collision'));
  if (layer && Array.isArray(layer.data)) {
    for (let i=0;i<layer.data.length;i++) if (layer.data[i]) grid[i]=1;
  }
  return { grid, cols, rows };
}

async function getGrid(mapKey) {
  if (cache.has(mapKey)) return cache.get(mapKey);

  const mapRow = await get(`SELECT "dataJSON" FROM maps WHERE key=$1`, [mapKey]);
  if (!mapRow?.dataJSON) throw new Error('map-not-found');

  const objs = await all(
    `SELECT type, x, y, w, h, "propsJSON" FROM map_objects WHERE "mapKey"=$1`,
    [mapKey]
  );

  const mapJson = mapRow.dataJSON;
  const mapW = (mapJson.width || 64) * TILE;
  const mapH = (mapJson.height || 64) * TILE;

  const built = (objs && objs.length)
    ? buildCollisionFromObjects(mapW, mapH, objs)
    : buildCollisionFromTiled(mapJson);

  const entry = { grid: built.grid, cols: built.cols, rows: built.rows };
  cache.set(mapKey, entry);
  return entry;
}

module.exports = { getGrid, TILE };
