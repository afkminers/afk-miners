// server/maps/grid.js
const { get, all } = require('../models/db');
const TILE = 32;
const cache = new Map(); // mapKey -> { grid: Uint8Array, cols, rows }

/**
 * Helper to detect if a map_object row has a "solid" property set.
 * propsJSON may be stored as JSON array or object depending on import.
 */
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

/**
 * Retorna objetos do mapa que são candidatos a "spawns" / pontos de início.
 * - Procura por objetos na tabela map_objects com type/name/class contendo 'start' ou 'spawn'
 * - Se não houver registros na tabela map_objects, tenta ler a camada de objetos em dataJSON (TMX)
 *
 * Retorna array de objetos: { id?, name?, type?, class?, x, y, w, h, props: <parsed props JSON> }
 */
async function getMapSpawns(mapKey) {
  // try table map_objects first
  try {
    const rows = await all(
      `SELECT id, name, type, class, x, y, w, h, "propsJSON"
         FROM map_objects
        WHERE "mapKey" = $1`,
      [mapKey]
    );

    if (rows && rows.length) {
      const candidates = [];
      for (const r of rows) {
        const obj = {
          id: r.id,
          name: r.name || null,
          type: r.type || null,
          class: r.class || null,
          x: Number(r.x || 0),
          y: Number(r.y || 0),
          w: Number(r.w || 0),
          h: Number(r.h || 0),
          props: (r.propsJSON && typeof r.propsJSON === 'object') ? r.propsJSON : r.propsJSON ? r.propsJSON : null
        };
        // Determine if this object is a spawn/start based on type/name/class or props
        const t = String(obj.type || '').toLowerCase();
        const n = String(obj.name || '').toLowerCase();
        const c = String(obj.class || '').toLowerCase();
        let isSpawn = false;
        if (t.includes('start') || t.includes('spawn')) isSpawn = true;
        if (n.includes('start') || n.includes('spawn')) isSpawn = true;
        if (c.includes('start') || c.includes('spawn')) isSpawn = true;
        // check props for a 'type' property equals 'start'/'spawn'
        try {
          const p = obj.props;
          if (p) {
            if (Array.isArray(p)) {
              for (const pp of p) {
                if ((pp?.name || '').toString().toLowerCase() === 'type' && (String(pp?.value || '').toLowerCase() === 'start' || String(pp?.value || '').toLowerCase() === 'spawn')) {
                  isSpawn = true; break;
                }
              }
            } else if (typeof p === 'object') {
              const v = (p.type || p.start || p.spawn);
              if (v === 'start' || v === 'spawn' || v === true || v === 1) isSpawn = true;
            }
          }
        } catch (e) {}
        if (isSpawn) candidates.push(obj);
      }
      // if none explicitly marked as spawn, we will still return some sensible defaults:
      if (candidates.length) return candidates;
      // fallback: return first several objects that are likely actors (non-solid)
      const fallback = rows.slice(0, 8).map(r => ({
        id: r.id,
        name: r.name || null,
        type: r.type || null,
        class: r.class || null,
        x: Number(r.x || 0),
        y: Number(r.y || 0),
        w: Number(r.w || 0),
        h: Number(r.h || 0),
        props: r.propsJSON
      }));
      return fallback;
    }
  } catch (e) {
    // ignore and fallback to map dataJSON parsing
  }

  // fallback: try parsing map JSON TMX stored in maps.dataJSON
  try {
    const mapRow = await get(`SELECT "dataJSON" FROM maps WHERE key=$1`, [mapKey]);
    if (!mapRow?.dataJSON) return [];
    const mapJson = mapRow.dataJSON;
    const objectLayers = (mapJson.layers || []).filter(l => l.type === 'objectgroup' || l.type === 'objects');
    const objs = [];
    for (const layer of objectLayers) {
      for (const o of (layer.objects || [])) {
        const obj = {
          id: o.id || null,
          name: o.name || null,
          type: o.type || null,
          class: o.class || null,
          x: Number(o.x || 0),
          y: Number(o.y || 0),
          w: Number(o.width || o.w || 0),
          h: Number(o.height || o.h || 0),
          props: (o.properties || o.properties || null)
        };
        const t = String(obj.type || '').toLowerCase();
        const n = String(obj.name || '').toLowerCase();
        const c = String(obj.class || '').toLowerCase();
        let isSpawn = false;
        if (t.includes('start') || t.includes('spawn')) isSpawn = true;
        if (n.includes('start') || n.includes('spawn')) isSpawn = true;
        if (c.includes('start') || c.includes('spawn')) isSpawn = true;
        // check properties array for type=start
        try {
          const p = obj.props;
          if (Array.isArray(p)) {
            for (const pp of p) {
              if ((pp?.name || '').toString().toLowerCase() === 'type' && (String(pp?.value || '').toLowerCase() === 'start' || String(pp?.value || '').toLowerCase() === 'spawn')) {
                isSpawn = true; break;
              }
            }
          } else if (typeof p === 'object') {
            const v = (p.type || p.start || p.spawn);
            if (v === 'start' || v === 'spawn' || v === true || v === 1) isSpawn = true;
          }
        } catch (e) {}
        if (isSpawn) objs.push(obj);
      }
    }
    if (objs.length) return objs;
    // final fallback: return empty array
    return [];
  } catch (e) {
    return [];
  }
}

module.exports = { getGrid, TILE, getMapSpawns };