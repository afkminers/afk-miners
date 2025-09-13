// server/combat/targeting.js
// Shared targeting logic for consistent monster selection

const { get, all } = require('../models/db');
const K = require('../balance/config');

const DEBUG = String(process.env.COMBAT_DEBUG || '').trim() === '1';

/**
 * Point-to-rectangle distance squared calculation
 */
function pointRectDist2(px, py, rx, ry, rw, rh) {
  const cx = Math.max(rx, Math.min(px, rx + rw));
  const cy = Math.max(ry, Math.min(py, ry + rh));
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy;
}

/**
 * Check if point is contained within rectangle
 */
function containsPoint(px, py, rx, ry, rw, rh) {
  return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
}

/**
 * Find the best monster target based on click coordinates and player position
 * Implements intersection-first selection with configurable fallback
 */
async function findNearestMonster({ mapKey, clickX, clickY, playerX, playerY }) {
  if (!Number.isFinite(clickX) || !Number.isFinite(clickY)) {
    throw new Error('Invalid click coordinates');
  }

  // Get configuration flags
  const requireIntersect = K.CLICK_REQUIRE_INTERSECT;
  const fallbackRadius = K.CLICK_PICK_RADIUS_PX;
  const maxDistFromPlayer = K.CLICK_MAX_DIST_PX;

  // Validate click distance from player if player position is provided
  if (Number.isFinite(playerX) && Number.isFinite(playerY)) {
    const dx = clickX - playerX;
    const dy = clickY - playerY;
    if (dx * dx + dy * dy > maxDistFromPlayer * maxDistFromPlayer) {
      return { error: 'too-far-click' };
    }
  }

  // Fetch all alive monster instances on the map
  const rows = await all(
    `SELECT
      mi.id,
      mi.hp,
      mi.max_hp          AS "maxHp",
      mi.x               AS "ix",
      mi.y               AS "iy",
      s.x                AS "sx",
      s.y                AS "sy",
      COALESCE(NULLIF(s.w,0), 1) AS "sw",
      COALESCE(NULLIF(s.h,0), 1) AS "sh",
      s."monsterKey"     AS "monsterKey"
    FROM monster_instances mi
    JOIN spawns s ON s.id = mi.spawn_id
    WHERE mi.state = 'ALIVE'
      AND s."mapKey" = $1`,
    [mapKey]
  );

  if (!rows || rows.length === 0) {
    if (DEBUG) console.log('[targeting] no alive monsters on map', { mapKey });
    return { error: 'no-alive' };
  }

  // 1) First try: find monsters whose rectangles contain the click point
  const inside = [];
  for (const m of rows) {
    const rx = Number(m.sx) || 0;
    const ry = Number(m.sy) || 0;
    const rw = Number(m.sw) || 1;
    const rh = Number(m.sh) || 1;
    if (containsPoint(clickX, clickY, rx, ry, rw, rh)) {
      inside.push(m);
    }
  }

  let picked = null;
  let bestD2 = Infinity;

  if (inside.length > 0) {
    // Multiple monsters contain the click point - choose the closest to click center
    for (const m of inside) {
      const cx = Number.isFinite(m.ix) ? Number(m.ix) : (Number(m.sx) + Number(m.sw) / 2);
      const cy = Number.isFinite(m.iy) ? Number(m.iy) : (Number(m.sy) + Number(m.sh) / 2);
      const dx = clickX - cx;
      const dy = clickY - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; picked = m; }
    }
    // Since click is inside, effective distance is 0
    bestD2 = 0;
  } else if (!requireIntersect) {
    // 2) Fallback: find closest monster rectangle considering both click and player position
    for (const m of rows) {
      const rx = Number(m.sx) || 0;
      const ry = Number(m.sy) || 0;
      const rw = Number(m.sw) || 1;
      const rh = Number(m.sh) || 1;

      let d2 = pointRectDist2(clickX, clickY, rx, ry, rw, rh);
      if (Number.isFinite(playerX) && Number.isFinite(playerY)) {
        const d2Player = pointRectDist2(playerX, playerY, rx, ry, rw, rh);
        d2 = Math.min(d2, d2Player);
      }
      if (d2 < bestD2) { bestD2 = d2; picked = m; }
    }
  }

  if (!picked) {
    if (DEBUG) console.log('[targeting] no viable candidate found');
    return { error: requireIntersect ? 'no-intersect' : 'no-alive' };
  }

  // Check fallback radius for non-intersecting selections
  if (bestD2 > 0 && bestD2 > fallbackRadius * fallbackRadius) {
    if (DEBUG) {
      const rx = Number(picked.sx) || 0;
      const ry = Number(picked.sy) || 0;
      const rw = Number(picked.sw) || 1;
      const rh = Number(picked.sh) || 1;
      console.log('[targeting] no-monster-in-radius', {
        click: { x: clickX, y: clickY },
        player: { x: playerX, y: playerY },
        rect: { x: rx, y: ry, w: rw, h: rh },
        dist: Math.sqrt(bestD2)
      });
    }
    return { error: 'no-monster-in-radius', picked, distance: Math.sqrt(bestD2) };
  }

  // Return position for UI (use instance position if available, otherwise spawn center)
  const retX = Number.isFinite(picked.ix)
    ? Number(picked.ix)
    : (Number(picked.sx) + Number(picked.sw) / 2);
  const retY = Number.isFinite(picked.iy)
    ? Number(picked.iy)
    : (Number(picked.sy) + Number(picked.sh) / 2);

  const result = {
    id: picked.id,
    x: retX,
    y: retY,
    monsterKey: picked.monsterKey || null,
    hp: Number(picked.hp) || 0,
    maxHp: Number(picked.maxHp) || 0,
  };

  if (DEBUG) {
    const rx = Number(picked.sx) || 0;
    const ry = Number(picked.sy) || 0;
    const rw = Number(picked.sw) || 1;
    const rh = Number(picked.sh) || 1;
    console.log('[targeting] target found', {
      pickedId: picked.id,
      click: { x: clickX, y: clickY },
      player: { x: playerX, y: playerY },
      ret: { x: result.x, y: result.y },
      rect: { x: rx, y: ry, w: rw, h: rh },
      hp: result.hp, maxHp: result.maxHp,
      distance: Math.sqrt(bestD2)
    });
  }

  return result;
}

module.exports = {
  findNearestMonster,
  pointRectDist2,
  containsPoint
};