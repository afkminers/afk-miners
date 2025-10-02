// server/combat/pos.js
const { get } = require('../models/db');
const { getLivePlayerPosition } = require('../player/live_positions');

const TILE = 32;

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

  // 1. SEMPRE tenta posição live primeiro (já em pixels)
  const live = getLivePlayerPosition(owner.playerId);
  if (live) {
    const liveMapKey = String(live.mapKey || preferMapKey || 'house');
    
    // Normaliza para pixels se vier em tiles (< 1000 geralmente)
    let px = Number(live.x || 0);
    let py = Number(live.y || 0);
    
    if (px < 1000 && py < 1000) {
      px = (px * TILE) + (TILE / 2);
      py = (py * TILE) + (TILE / 2);
    }
    
    const livePos = {
      x: px | 0,
      y: py | 0,
      map_key: liveMapKey,
      class: classKey,
      source: 'live',
      updatedAt: Number(live.ts || Date.now()),
    };
    
    // Se não exigiram mapa específico, ou já bateu, retorna
    if (!preferMapKey || liveMapKey === preferMapKey) {
      return livePos;
    }
  }

  // 2. Se exigiu mapa específico, busca no banco
  if (preferMapKey) {
    const row = await getPlayerLastPos(owner.playerId, preferMapKey);
    if (row) {
      let px = Number(row.x || 0);
      let py = Number(row.y || 0);
      
      // Converte tiles -> pixels se necessário
      if (px < 1000 && py < 1000) {
        px = (px * TILE) + (TILE / 2);
        py = (py * TILE) + (TILE / 2);
      }
      
      return {
        x: px | 0,
        y: py | 0,
        map_key: row.mapKey,
        class: classKey,
        source: 'db',
        updatedAt: row.updatedAt ? new Date(row.updatedAt).getTime() : null,
      };
    }
  }

  // 3. Fallback: qualquer mapa no banco
  const any = await get(
    `SELECT x, y, map_key AS "mapKey", updated_at AS "updatedAt"
       FROM player_last_pos
      WHERE player_id = $1
      ORDER BY updated_at DESC
      LIMIT 1`,
    [owner.playerId]
  );

  if (any) {
    let px = Number(any.x || 0);
    let py = Number(any.y || 0);
    
    if (px < 1000 && py < 1000) {
      px = (px * TILE) + (TILE / 2);
      py = (py * TILE) + (TILE / 2);
    }
    
    return {
      x: px | 0,
      y: py | 0,
      map_key: any.mapKey,
      class: classKey,
      source: 'db',
      updatedAt: any.updatedAt ? new Date(any.updatedAt).getTime() : null,
    };
  }

  return null;
}

/**
 * Retorna posição do monstro SEMPRE EM PIXELS
 */
async function getMonsterPos(instanceId) {
  const row = await get(
    `SELECT mi.x, mi.y, mi.map_key AS "map_key",
            COALESCE(sp.frame_w, 32) AS frame_w,
            COALESCE(sp.frame_h, 32) AS frame_h
       FROM monster_instances mi
  LEFT JOIN spawns s ON s.id = mi.spawn_id
  LEFT JOIN sprites_master sp ON sp.key = s."monsterKey" AND sp.kind = 'monster'
      WHERE mi.id = $1`,
    [instanceId]
  );
  
  if (!row) return null;
  
  let px = Number(row.x || 0);
  let py = Number(row.y || 0);
  
  // Converte tiles -> pixels se necessário
  if (px < 1000 && py < 1000) {
    px = (px * TILE) + (TILE / 2);
    py = (py * TILE) + (TILE / 2);
  }
  
  return {
    x: px | 0,
    y: py | 0,
    map_key: row.map_key,
    frame_w: Number(row.frame_w || 32),
    frame_h: Number(row.frame_h || 32)
  };
}

module.exports = { getHeroPos, getMonsterPos, getHeroOwner, getPlayerLastPos };
