// server/combat/pos.js
const { get, run } = require('../models/db');
const { getLivePlayerPosition } = require('../state/live-positions');


/** Pega playerId dono do herói + classe (útil p/ cálculos) */
async function getHeroOwner(heroId) {
  return await get(
    `SELECT ph.id AS "heroId", ph."playerId" AS "playerId", hm.class AS class
       FROM player_heroes ph
  LEFT JOIN heroes_master hm ON hm."heroKey" = ph."heroKey"
      WHERE ph.id = $1`,
    [heroId]
  );
}

/** Última posição persistida do player (por mapa) — usamos a do mapa atual do alvo/partida */
async function getPlayerLastPos(playerId, mapKey) {
  return await get(
    `SELECT x, y, map_key AS "mapKey", last_seq AS seq, updated_at AS "updatedAt"
       FROM player_last_pos
      WHERE player_id = $1 AND map_key = $2`,
    [playerId, mapKey]
  );
}

/** Posição do herói, inferida pela última posição do player no mesmo mapKey do alvo */
async function getHeroPos(heroId, preferMapKey = null) {
  const owner = await getHeroOwner(heroId);
  if (!owner) return null;
  const heroClass = owner.class ? String(owner.class).toUpperCase() : null;

  const classKey = owner.class || null;
  const live = getLivePlayerPosition(owner.playerId);
  let liveCandidate = null;
  if (live) {
    liveCandidate = {
      x: Number(live.x || 0) | 0,
      y: Number(live.y || 0) | 0,
      map_key: String(live.mapKey || live.map_key || preferMapKey || 'house'),
      class: classKey,
      source: 'live',
      updatedAt: Number(live.ts || Date.now()),
    };
    if (!preferMapKey || liveCandidate.map_key === preferMapKey) {
      return liveCandidate;
    }
  }

  // Se não soubermos o mapa ainda, retorna a última posição global (qualquer mapa)
  if (!preferMapKey) {
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
        x: Number(any.x || 0) | 0,
        y: Number(any.y || 0) | 0,
        map_key: any.mapKey,
        class: classKey,
        source: 'db',
        updatedAt: any.updatedAt ? new Date(any.updatedAt).getTime() : null,
      };
    }
    return liveCandidate;

  }

  // Preferimos a posição já no mapa do alvo
  const row = await getPlayerLastPos(owner.playerId, preferMapKey);

  if (row) {
    return {
      x: Number(row.x || 0) | 0,
      y: Number(row.y || 0) | 0,
      map_key: row.mapKey,
      class: classKey,
      source: 'db',
      updatedAt: row.updatedAt ? new Date(row.updatedAt).getTime() : null,
    };
  }


  // Fallback: última posição em qualquer mapa
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
      x: Number(any.x || 0) | 0,
      y: Number(any.y || 0) | 0,
      map_key: any.mapKey,
      class: classKey,
      source: 'db',
      updatedAt: any.updatedAt ? new Date(any.updatedAt).getTime() : null,
    };
  }

  return liveCandidate;

}

/** Posição do monstro pela instância */
async function getMonsterPos(instanceId) {
  return await get(
    `SELECT x, y, map_key AS "map_key"
       FROM monster_instances
      WHERE id = $1`,
    [instanceId]
  );
}

/** Persiste posição do monstro (e map_key) */
async function setMonsterPos(instanceId, mapKey, x, y) {
  await run(
    `UPDATE monster_instances
        SET map_key = $2, x = $3, y = $4, updated_at = now()
      WHERE id = $1`,
    [String(instanceId), String(mapKey), x|0, y|0]
  );
}


module.exports = { getHeroPos, getMonsterPos, getHeroOwner, getPlayerLastPos, setMonsterPos };

