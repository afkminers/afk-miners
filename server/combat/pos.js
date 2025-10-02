// server/combat/pos.js
const { get } = require('../models/db');
const { getLivePlayerPosition } = require('../player/live_positions');

const { resolveHitboxDimension } = require('./geom');


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
      return {
        x: Math.round(Number(row.x || 0)),
        y: Math.round(Number(row.y || 0)),
        map_key: row.mapKey,
        class: classKey,
        source: 'db',
        stale: false,
        updatedAt: row.updatedAt ? new Date(row.updatedAt).getTime() : null,
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
    return {
      x: Math.round(Number(any.x || 0)),
      y: Math.round(Number(any.y || 0)),
      map_key: any.mapKey,
      class: classKey,
      source: 'db',
      stale: false,
      updatedAt: any.updatedAt ? new Date(any.updatedAt).getTime() : null,
    };
  }

  return fallbackPos;
}

/**
 * Retorna posição do monstro SEMPRE EM PIXELS
 */
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
            ) AS frame_h
       FROM monster_instances mi
  LEFT JOIN spawns s ON s.id = mi.spawn_id
  LEFT JOIN sprites_master sp ON sp.key = s."monsterKey" AND sp.kind = 'monster'
      WHERE mi.id = $1`,
    [instanceId]
  );

  if (!row) return null;


  const frameW = resolveHitboxDimension(row, 'w');
  const frameH = resolveHitboxDimension(row, 'h');


  return {
    x: Math.round(Number(row.x || 0)),
    y: Math.round(Number(row.y || 0)),
    map_key: row.map_key,
    frame_w: frameW,
    frame_h: frameH,
  };
}

module.exports = { getHeroPos, getMonsterPos, getHeroOwner, getPlayerLastPos };
