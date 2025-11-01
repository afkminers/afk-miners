const { get, run } = require('../models/db');

const DEFAULT_START = {
  mapKey: process.env.START_MAP_KEY || 'house',
  x: Number.isFinite(Number(process.env.START_POS_X)) ? Number(process.env.START_POS_X) : 912,
  y: Number.isFinite(Number(process.env.START_POS_Y)) ? Number(process.env.START_POS_Y) : 880,
};

function toInt(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.round(num) : fallback;
}

function normalizePoint(row, fallback = DEFAULT_START) {
  if (!row) {
    return { ...fallback };
  }

  const mapKey = row.mapKey || row.map_key || fallback.mapKey;
  let x = toInt(row.x, fallback.x);
  let y = toInt(row.y, fallback.y);
  const w = Number(row.w);
  const h = Number(row.h);

  if (Number.isFinite(w) && w > 0) x = toInt(x + w / 2, fallback.x);
  if (Number.isFinite(h) && h > 0) y = toInt(y + h / 2, fallback.y);

  return {
    mapKey: mapKey || fallback.mapKey,
    x: toInt(x, fallback.x),
    y: toInt(y, fallback.y),
  };
}

async function fetchStartRow(mapKey) {
  if (mapKey) {
    const row = await get(
      `SELECT "mapKey" AS "mapKey", x, y, w, h
         FROM map_objects
        WHERE LOWER(type) = 'start'
          AND "mapKey" = $1
        ORDER BY id
        LIMIT 1`,
      [String(mapKey)]
    ).catch(() => null);
    if (row) return row;
  }

  return await get(
    `SELECT "mapKey" AS "mapKey", x, y, w, h
       FROM map_objects
      WHERE LOWER(type) = 'start'
      ORDER BY id
      LIMIT 1`
  ).catch(() => null);
}

async function getStartPoint(mapKey = DEFAULT_START.mapKey) {
  const row = await fetchStartRow(mapKey);
  return normalizePoint(row, DEFAULT_START);
}

async function getHeroRespawnPoint(heroOrId, opts = {}) {
  const fallbackMap =
    (typeof heroOrId === 'object' && heroOrId?.map_key) || opts?.mapKey || DEFAULT_START.mapKey;

  if (!opts?.forceStart) {
    const heroId = typeof heroOrId === 'object' ? heroOrId?.id || heroOrId?.heroId : heroOrId;
    if (heroId) {
      const saved = await get(
        `SELECT map_key, x, y
           FROM hero_last_pos
          WHERE hero_id = $1
          LIMIT 1`,
        [String(heroId)]
      ).catch(() => null);
      if (saved) {
        return normalizePoint(
          { mapKey: saved.map_key, x: saved.x, y: saved.y },
          DEFAULT_START
        );
      }
    }
  }

  return getStartPoint(fallbackMap);
}

async function setHeroRespawnPoint(heroId, mapKey, x, y) {
  const hid = String(heroId || '').trim();
  if (!hid) return null;
  const point = normalizePoint({ mapKey, x, y });
  await run(
    `INSERT INTO hero_last_pos (hero_id, map_key, x, y, updated_at)
     VALUES ($1,$2,$3,$4, now())
     ON CONFLICT (hero_id) DO UPDATE
       SET map_key = EXCLUDED.map_key,
           x = EXCLUDED.x,
           y = EXCLUDED.y,
           updated_at = now()` ,
    [hid, point.mapKey, point.x, point.y]
  );
  return point;
}

async function upsertPlayerLastPos(playerId, mapKey, x, y) {
  const pid = String(playerId || '').trim();
  if (!pid) return;
  const point = normalizePoint({ mapKey, x, y });
  await run(
    `INSERT INTO player_last_pos (player_id, map_key, x, y, last_seq, updated_at)
     VALUES (
       $1,
       $2,
       $3,
       $4,
       COALESCE((SELECT last_seq FROM player_last_pos WHERE player_id=$1 AND map_key=$2), 0) + 1,
       now()
     )
     ON CONFLICT (player_id, map_key)
     DO UPDATE SET
       x = EXCLUDED.x,
       y = EXCLUDED.y,
       last_seq = player_last_pos.last_seq + 1,
       updated_at = now()`,
    [pid, point.mapKey, point.x, point.y]
  );
  return point;
}

module.exports = {
  DEFAULT_START,
  getStartPoint,
  getHeroRespawnPoint,
  setHeroRespawnPoint,
  upsertPlayerLastPos,
};
