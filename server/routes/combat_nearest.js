// server/routes/combat_nearest.js
const express = require('express');
const router = express.Router();
const { get, all } = require('../models/db');

const DEBUG = String(process.env.COMBAT_DEBUG || '').trim() === '1';
const CLICK_REQUIRE_INTERSECT = Number(process.env.CLICK_REQUIRE_INTERSECT || '1') === 1;
const CLICK_PICK_RADIUS_PX = Number(process.env.CLICK_PICK_RADIUS_PX || '192'); // 6 tiles

// log simples para caminhos de combate
router.use((req, _res, next) => {
  if (req.path.startsWith('/api/combat')) {
    console.log('[combat]', req.method, req.originalUrl);
  }
  next();
});

/**
 * GET /api/combat/nearest?map=house&x=..&y=..&px=..&py=..&debug=1
 *
 * Robust sprite-based intersection mirroring client logic:
 * - Uses sprite metadata (frame width/height) with anchor ay≈0.9 for footbox
 * - Fallback sizes for missing metadata: 64px default, with 48px/32px detection
 * - Tolerance inflation (+2px) for better UX
 * - Strict intersection if CLICK_REQUIRE_INTERSECT=1, else radius fallback
 *
 * 200 => { id, x, y, monsterKey, hp, maxHp }
 * 404 => { error: 'no-intersect' | 'no-monster-in-radius', ...(DEBUG extra) }
 */
router.get('/api/combat/nearest', async (req, res) => {
  try {
    const mapKey = String(req.query.map || 'house');
    const x = Number(req.query.x);
    const y = Number(req.query.y);
    const px = Number(req.query.px);
    const py = Number(req.query.py);
    const debug = String(req.query.debug || '0') === '1' || DEBUG;

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return res.status(400).json({ error: 'bad-coords' });
    }

    // Get all alive monster instances with spawn and sprite metadata
    const rows = await all(
      `
      SELECT
        mi.id,
        mi.hp,
        mi.max_hp          AS "maxHp",
        mi.x               AS "ix",
        mi.y               AS "iy",
        s.x                AS "sx",
        s.y                AS "sy", 
        COALESCE(NULLIF(s.w,0), 1) AS "sw",
        COALESCE(NULLIF(s.h,0), 1) AS "sh",
        s."monsterKey"     AS "monsterKey",
        sp."dataJSON"      AS "spriteData"
      FROM monster_instances mi
      JOIN spawns s ON s.id = mi.spawn_id
      LEFT JOIN sprites_master sp ON sp.key = s."monsterKey" AND sp.kind = 'monster'
      WHERE mi.state = 'ALIVE'
        AND s."mapKey" = $1
      `,
      [mapKey]
    );

    if (!rows || rows.length === 0) {
      if (debug) console.log('[combat/nearest] no alive monsters on map', { mapKey });
      return res.status(404).json({ error: 'no-alive' });
    }

    // Helper to get sprite dimensions with fallbacks
    function getSpriteRect(m) {
      let sw = 64, sh = 64; // default size
      
      // Try sprite metadata first
      if (m.spriteData?.frame) {
        sw = Number(m.spriteData.frame.width) || sw;
        sh = Number(m.spriteData.frame.height) || sh;
      } else {
        // Fallback detection based on monster key patterns
        const key = String(m.monsterKey || '').toLowerCase();
        if (key.includes('32') || key.includes('small')) {
          sw = sh = 32;
        } else if (key.includes('48') || key.includes('medium')) {
          sw = sh = 48;
        }
        // else keep 64x64 default
      }
      
      // Mirror client logic: anchor at (0.5, 0.9) for footbox positioning
      const ax = 0.5, ay = 0.9;
      const sx = Number.isFinite(m.ix) ? Number(m.ix) : Number(m.sx);
      const sy = Number.isFinite(m.iy) ? Number(m.iy) : Number(m.sy);
      
      const ox = Math.round(sx - sw * ax);
      const oy = Math.round(sy - sh * ay);
      
      // Add tolerance for better UX
      const tolerance = 2;
      return {
        x: ox - tolerance,
        y: oy - tolerance, 
        w: sw + 2 * tolerance,
        h: sh + 2 * tolerance,
        centerX: sx,
        centerY: sy
      };
    }

    // Helper to check if point is in rectangle
    function pointInRect(px, py, rect) {
      return px >= rect.x && px <= rect.x + rect.w && 
             py >= rect.y && py <= rect.y + rect.h;
    }

    // Helper to get distance from point to rectangle
    function pointRectDist2(px, py, rect) {
      const cx = Math.max(rect.x, Math.min(px, rect.x + rect.w));
      const cy = Math.max(rect.y, Math.min(py, rect.y + rect.h));
      const dx = px - cx;
      const dy = py - cy;
      return dx * dx + dy * dy;
    }

    let bestCandidate = null;
    let bestScore = Infinity;
    let intersectingCandidates = [];

    // Process all monsters
    for (const m of rows) {
      const rect = getSpriteRect(m);
      
      // Check click intersection
      const clickIntersects = pointInRect(x, y, rect);
      // Check player position intersection if provided
      const playerIntersects = Number.isFinite(px) && Number.isFinite(py) ? 
        pointInRect(px, py, rect) : false;
      
      if (clickIntersects || playerIntersects) {
        // Direct intersection - prefer by distance to center
        const dx = x - rect.centerX;
        const dy = y - rect.centerY;
        const centerDist2 = dx * dx + dy * dy;
        
        intersectingCandidates.push({ monster: m, rect, centerDist2 });
        
        if (centerDist2 < bestScore) {
          bestScore = centerDist2;
          bestCandidate = { monster: m, rect, intersected: true };
        }
      } else if (!CLICK_REQUIRE_INTERSECT) {
        // Fallback to distance-based selection
        let dist2 = pointRectDist2(x, y, rect);
        if (Number.isFinite(px) && Number.isFinite(py)) {
          const playerDist2 = pointRectDist2(px, py, rect);
          dist2 = Math.min(dist2, playerDist2);
        }
        
        if (dist2 < bestScore) {
          bestScore = dist2;
          bestCandidate = { monster: m, rect, intersected: false, dist2 };
        }
      }
    }

    // Check if we found a candidate within limits
    if (!bestCandidate) {
      if (debug) console.log('[combat/nearest] no viable candidates');
      return res.status(404).json({ error: 'no-intersect' });
    }

    // For non-intersecting candidates, check radius limit
    if (!bestCandidate.intersected) {
      const maxDist2 = CLICK_PICK_RADIUS_PX * CLICK_PICK_RADIUS_PX;
      if (bestCandidate.dist2 > maxDist2) {
        if (debug) {
          console.log('[combat/nearest] no-monster-in-radius', {
            click: { x, y }, 
            player: { px, py },
            bestDist: Math.sqrt(bestCandidate.dist2),
            maxRadius: CLICK_PICK_RADIUS_PX
          });
        }
        return res.status(404).json({ error: 'no-monster-in-radius' });
      }
    }

    const m = bestCandidate.monster;
    const rect = bestCandidate.rect;

    const payload = {
      id: m.id,
      x: rect.centerX,
      y: rect.centerY,
      monsterKey: m.monsterKey || null,
      hp: Number(m.hp) || 0,
      maxHp: Number(m.maxHp) || 0,
    };

    if (debug) {
      console.log('[combat/nearest] selected', {
        id: m.id,
        click: { x, y },
        player: { px, py },
        rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
        intersected: bestCandidate.intersected,
        intersectingCount: intersectingCandidates.length
      });
    }

    return res.json(payload);
  } catch (e) {
    console.error('[combat/nearest] error:', e);
    return res.status(500).json({ error: 'nearest-failed' });
  }
});

module.exports = router;