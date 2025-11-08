// server/maps/grid.js
const { get, all } = require('../models/db');

const TILE = 32;
const cache = new Map(); // mapKey -> { grid: Uint8Array, cols, rows }

/** propsJSON pode vir como array [{name,value}], objeto {solid:true} ou string JSON */
function hasSolidPropRow(row) {
  try {
    let p = row.propsJSON;

    // Se vier como string (TEXT), tenta fazer parse
    if (typeof p === 'string') {
      try {
        p = JSON.parse(p);
      } catch {
        // se não der parse, ignora e cai no return false
      }
    }

    if (Array.isArray(p)) {
      return p.some(
        (v) => v?.name === 'solid' && (v.value === true || v.value === 1)
      );
    }

    if (p && typeof p === 'object') {
      return p.solid === true || p.solid === 1;
    }
  } catch {}
  return false;
}

function markSolidRect(grid, cols, rows, x, y, w, h) {
  const x0 = Math.floor(x / TILE);
  const y0 = Math.floor(y / TILE);
  const x1 = Math.floor((x + w - 1) / TILE);
  const y1 = Math.floor((y + h - 1) / TILE);
  for (let cy = y0; cy <= y1; cy++) {
    if (cy < 0 || cy >= rows) continue;
    for (let cx = x0; cx <= x1; cx++) {
      if (cx < 0 || cx >= cols) continue;
      grid[cy * cols + cx] = 1;
    }
  }
}

/**
 * Constrói colisão a partir de objetos (retângulos) marcados como sólidos.
 * Isso é a fonte de verdade preferida.
 */
function buildCollisionFromObjects(cols, rows, objs) {
  const grid = new Uint8Array(cols * rows);
  if (!Array.isArray(objs)) return { grid, cols, rows };

  for (const o of objs) {
    const t = String(o.type || '').toLowerCase();
    const solid = t === 'solid' || hasSolidPropRow(o);
    if (!solid) continue;

    const x = Number(o.x) || 0;
    const y = Number(o.y) || 0;
    const w = Number(o.w) || 0;
    const h = Number(o.h) || 0;
    if (w <= 0 || h <= 0) continue;

    markSolidRect(grid, cols, rows, x, y, w, h);
  }
  return { grid, cols, rows };
}

/**
 * Fallback minimalista para mapas do Tiled: cria grid vazia do tamanho certo.
 * (Se você quiser, dá pra enriquecer lendo layers/tiles com flag de colisão,
 * mas manter vazio evita colisões fantasmas e mantém a IA fiel ao mapa.)
 */
function buildCollisionFromTiled(json) {
  const cols = (json && Number(json.width)) | 0;
  const rows = (json && Number(json.height)) | 0;
  if (!cols || !rows) {
    throw new Error(
      `[maps/grid] invalid tiled dims width=${json?.width} height=${json?.height}`
    );
  }
  const grid = new Uint8Array(cols * rows); // tudo walkable por padrão
  return { grid, cols, rows };
}

async function getGrid(mapKey) {
  if (!mapKey) throw new Error('[maps/grid] missing mapKey');

  // cache
  const cached = cache.get(mapKey);
  if (cached) return cached;

  // mapa (JSON do Tiled) — a fonte do tamanho correto
  const mapRow = await get(
    // ⚠️ SEM aspas: usa a coluna datajson (criada como dataJSON sem aspas)
    `SELECT key, dataJSON AS "dataJSON" FROM maps WHERE key = $1`,
    [mapKey]
  );
  if (!mapRow || !mapRow.dataJSON) {
    throw new Error(`[maps/grid] map not found: ${mapKey}`);
  }

  const mapJson =
    typeof mapRow.dataJSON === 'string'
      ? JSON.parse(mapRow.dataJSON)
      : mapRow.dataJSON;

  const cols = Number(mapJson.width) | 0;
  const rows = Number(mapJson.height) | 0;
  if (!cols || !rows) {
    throw new Error(
      `[maps/grid] invalid map size (no fallbacks): key=${mapKey} width=${mapJson.width} height=${mapJson.height}`
    );
  }

  // objetos sólidos (preferência) – usa "propsJSON", que bate com o schema
  const objs = await all(
    `
    SELECT x, y, w, h, type, "propsJSON" AS "propsJSON"
      FROM map_objects
     WHERE "mapKey" = $1
  `,
    [mapKey]
  );

  const built =
    objs && objs.length
      ? buildCollisionFromObjects(cols, rows, objs)
      : buildCollisionFromTiled(mapJson);

  const entry = { grid: built.grid, cols: built.cols, rows: built.rows };
  cache.set(mapKey, entry);
  return entry;
}

module.exports = { getGrid, TILE };
