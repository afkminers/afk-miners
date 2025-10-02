// server/combat/pos.js
const { get } = require('../models/db');
const { getLivePlayerPosition, TTL_MS } = require('../player/live_positions');
const { resolveHitboxDimension, TILE } = require('./geom');

async function getHeroOwner(heroId) {
  return await get(
    `SELECT ph.id AS "heroId", ph."playerId" AS "playerId", hm.class AS class
       FROM player_heroes ph
  LEFT JOIN heroes_master hm ON hm."heroKey" = ph."heroKey"
      WHERE ph.id = $1`,
    [heroId]
  );
}

async function getPlayerLastPos(playerId, mapKey) {
  return await get(
    `SELECT x, y, map_key AS "mapKey", last_seq AS seq, updated_at AS "updatedAt"
       FROM player_last_pos
      WHERE player_id = $1 AND map_key = $2`,
    [playerId, mapKey]
  );
}

/**
 * Retorna posição do herói SEMPRE EM PIXELS
 * Prioridade: live > db no mapa preferido > db qualquer mapa
 */
async function getHeroPos(heroId, preferMapKey = null) {
  const owner = await getHeroOwner(heroId);
  if (!owner) return null;

  const classKey = owner.class || null;

  // 1) Live primeiro
  const live = getLivePlayerPosition(owner.playerId, { allowStale: true });
  let fallbackPos = null;
  if (live) {
    const liveMapKey = String(live.mapKey || preferMapKey || 'house');

    const livePos = {
      x: Math.round(Number(live.x || 0)),
      y: Math.round(Number(live.y || 0)),
      map_key: liveMapKey,
      class: classKey,
      source: live.stale ? 'live_stale' : 'live',
      stale: Boolean(live.stale),
      fresh: !Boolean(live.stale),
      updatedAt: Number(live.ts || Date.now()),
    };

    if (Number.isFinite(live.age)) {
      livePos.ageMs = Number(live.age);
    }

    if (!preferMapKey || liveMapKey === preferMapKey) return livePos;
    fallbackPos = livePos;
  }

  // 2) DB no mapa preferido
  if (preferMapKey) {
    const row = await getPlayerLastPos(owner.playerId, preferMapKey);
    if (row) {
      const updatedAtMs = row.updatedAt ? new Date(row.updatedAt).getTime() : null;
      const ageMs = Number.isFinite(updatedAtMs) ? Date.now() - updatedAtMs : null;

      return {
        x: Math.round(Number(row.x || 0)),
        y: Math.round(Number(row.y || 0)),
        map_key: row.mapKey,
        class: classKey,
        source: 'db',
        stale: true,
        fresh: false,
        updatedAt: updatedAtMs,
        ageMs: Number.isFinite(ageMs) ? ageMs : null,
      };
    }
  }

  // 3) DB em qualquer mapa (mais recente)
  const any = await get(
    `SELECT x, y, map_key AS "mapKey", updated_at AS "updatedAt"
       FROM player_last_pos
      WHERE player_id = $1
      ORDER BY updated_at DESC
      LIMIT 1`,
    [owner.playerId]
  );

  if (any) {
    const updatedAtMs = any.updatedAt ? new Date(any.updatedAt).getTime() : null;
    const ageMs = Number.isFinite(updatedAtMs) ? Date.now() - updatedAtMs : null;

    return {
      x: Math.round(Number(any.x || 0)),
      y: Math.round(Number(any.y || 0)),
      map_key: any.mapKey,
      class: classKey,
      source: 'db',
      stale: true,
      fresh: false,
      updatedAt: updatedAtMs,
      ageMs: Number.isFinite(ageMs) ? ageMs : null,
    };
  }

  return fallbackPos;
}

function adjustOrigin(raw, sizePx) {
  const snapped = Math.round(Number(raw ?? 0));
  if (!Number.isFinite(snapped)) return 0;

  const span = (Number.isFinite(sizePx) && sizePx > 0) ? sizePx : TILE;
  const half = Math.round(span / 2);

  const mod = ((snapped % TILE) + TILE) % TILE;
  const near = (value, target, tolerance = 1) => Math.abs(value - target) <= tolerance;

  if (near(mod, TILE / 2)) {
    return snapped;
  }

  if (near(mod, 0) || near(mod, TILE) || near(mod, TILE - 1)) {
    return snapped + half;
  }

  if (span > TILE && !near(mod, TILE / 2)) {
    return snapped + half;
  }

  return snapped;
}

function buildTileCandidate(raw, sizePx) {
  const snapped = Math.round(Number(raw ?? 0));
  if (!Number.isFinite(snapped)) return 0;
  const span = (Number.isFinite(sizePx) && sizePx > 0) ? sizePx : TILE;
  const half = Math.round(span / 2);
  return (snapped * TILE) + half;
}

function resolveCoord(raw, sizePx, spawnCoord, spawnSpan) {
  const originCandidate = adjustOrigin(raw, sizePx);
  const tileCandidate = buildTileCandidate(raw, sizePx);

  const spawnPos = Number(spawnCoord);
  if (Number.isFinite(spawnPos)) {
    const spanRaw = Number(spawnSpan);
    const span = (Number.isFinite(spanRaw) && spanRaw > 0) ? spanRaw : TILE;
    const spawnCenter = spawnPos + (span / 2);
    const originDist = Math.abs(originCandidate - spawnCenter);
    const tileDist = Math.abs(tileCandidate - spawnCenter);
    if ((tileDist + (TILE * 0.75)) < originDist) {
      return Math.round(tileCandidate);
    }
    return Math.round(originCandidate);
  }

  const snapped = Math.round(Number(raw ?? 0));
  const mod = ((snapped % TILE) + TILE) % TILE;
  const nearCenter = Math.abs(mod - (TILE / 2)) <= 1;
  if (!nearCenter) {
    const diff = Math.abs(tileCandidate - originCandidate);
    if (diff > TILE / 2) {
      return Math.round(tileCandidate);
    }
  }

  return Math.round(originCandidate);
}

async function getMonsterPos(instanceId) {
  const row = await get(
    `SELECT mi.x, mi.y, mi.map_key AS "map_key",
            COALESCE(
              NULLIF(((sp."dataJSON")::jsonb ->> 'frame_w'), '')::int,
              NULLIF(((sp."dataJSON")::jsonb ->> 'frameW'), '')::int,
              NULLIF(((sp."dataJSON")::jsonb ->> 'w'), '')::int,
              32
            ) AS frame_w,
            COALESCE(
              NULLIF(((sp."dataJSON")::jsonb ->> 'frame_h'), '')::int,
              NULLIF(((sp."dataJSON")::jsonb ->> 'frameH'), '')::int,
              NULLIF(((sp."dataJSON")::jsonb ->> 'h'), '')::int,
              32
            ) AS frame_h,
            s.x  AS spawn_x,
            s.y  AS spawn_y,
            COALESCE(s.w, 0) AS spawn_w,
            COALESCE(s.h, 0) AS spawn_h
       FROM monster_instances mi
  LEFT JOIN spawns s ON s.id = mi.spawn_id
  LEFT JOIN sprites_master sp ON sp.key = s."monsterKey" AND sp.kind = 'monster'
      WHERE mi.id = $1`,
    [instanceId]
  );

  if (!row) return null;

  const frameW = resolveHitboxDimension(row, 'w');
  const frameH = resolveHitboxDimension(row, 'h');

  const rawX = Number(row.x || 0);
  const rawY = Number(row.y || 0);

  const centerX = resolveCoord(rawX, frameW, row.spawn_x, row.spawn_w);
  const centerY = resolveCoord(rawY, frameH, row.spawn_y, row.spawn_h);

  return {
    x: centerX,
    y: centerY,
    cx: centerX,
    cy: centerY,
    raw_x: Math.round(Number(row.x || 0)),
    raw_y: Math.round(Number(row.y || 0)),
    map_key: row.map_key,
    frame_w: frameW,
    frame_h: frameH,
  };
}

function isHeroPosFresh(heroPos) {
  if (!heroPos) return false;
  if (heroPos.fresh === true) return true;

  const rawAge = Number(heroPos.ageMs ?? heroPos.age_ms ?? heroPos.ageMS);
  let age = Number.isFinite(rawAge) ? rawAge : null;
  if (!Number.isFinite(age) && heroPos.updatedAt) {
    const ts = Number(heroPos.updatedAt);
    if (Number.isFinite(ts)) age = Date.now() - ts;
  }

  const maxAgeEnv = Number(process.env.COMBAT_HERO_POS_MAX_AGE_MS);
  const fallbackMax = Number.isFinite(maxAgeEnv) && maxAgeEnv > 0
    ? maxAgeEnv
    : (Number.isFinite(TTL_MS) ? TTL_MS * 3 : 4500);
  const maxAge = Math.max(300, fallbackMax);

  if (heroPos.source === 'live') {
    if (heroPos.stale === false) return true;
    if (Number.isFinite(age)) return age <= maxAge;
    return false;
  }

  if (heroPos.stale === true && Number.isFinite(age)) {
    return age <= maxAge;
  }

  if (Number.isFinite(age)) {
    return age <= maxAge;
  }

  return heroPos.stale !== true;
}

module.exports = { getHeroPos, getMonsterPos, getHeroOwner, getPlayerLastPos, isHeroPosFresh };
