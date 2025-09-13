// server/routes/combat_nearest.js
const express = require('express');
const router = express.Router();
const { findNearestMonster } = require('../combat/targeting');

const DEBUG = String(process.env.COMBAT_DEBUG || '').trim() === '1';

// log simples para caminhos de combate
router.use((req, _res, next) => {
  if (req.path.startsWith('/api/combat')) {
    console.log('[combat]', req.method, req.originalUrl);
  }
  next();
});

/**
 * GET /api/combat/nearest?map=house&x=..&y=..&px=..&py=..
 *
 * Unified targeting endpoint using shared targeting logic.
 * Supports intersection-first selection with configurable fallback.
 *
 * 200 => { id, x, y, monsterKey, hp, maxHp }
 * 404 => { error: 'no-alive' | 'no-monster-in-radius' | 'no-intersect' | 'too-far-click' }
 */
router.get('/api/combat/nearest', async (req, res) => {
  try {
    const mapKey = String(req.query.map || 'house');
    const clickX = Number(req.query.x);
    const clickY = Number(req.query.y);
    const playerX = Number(req.query.px);
    const playerY = Number(req.query.py);

    const result = await findNearestMonster({
      mapKey,
      clickX,
      clickY,
      playerX: Number.isFinite(playerX) ? playerX : null,
      playerY: Number.isFinite(playerY) ? playerY : null
    });

    if (result.error) {
      const status = result.error === 'too-far-click' ? 200 : 404;
      const payload = { error: result.error };
      
      // Include debug info for certain errors
      if (DEBUG && (result.error === 'no-monster-in-radius') && result.picked) {
        payload.nearest = {
          id: result.picked.id,
          distance: result.distance
        };
      }
      
      return res.status(status).json(payload);
    }

    return res.json(result);
  } catch (e) {
    console.error('[combat/nearest] error:', e);
    return res.status(500).json({ error: 'nearest-failed' });
  }
});

module.exports = router;