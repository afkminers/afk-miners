// server/combat/routes.js
const express = require('express');
const { requireAuth } = require('../auth/middleware');
const { applyHit } = require('./service');

const router = express.Router();
router.use(requireAuth);

// POST /api/combat/hit
router.post('/hit', async (req, res) => {
  try {
    const { attackerHeroId, targetInstanceId, weaponType } = req.body || {};
    if (!attackerHeroId || !targetInstanceId || !weaponType) {
      return res.status(400).json({
        ok:false,
        message:'attackerHeroId, targetInstanceId, weaponType são obrigatórios'
      });
    }
    const r = await applyHit({ attackerHeroId, targetInstanceId, weaponType });
    res.status(r.ok ? 200 : 400).json(r);
  } catch (e) {
    res.status(500).json({ ok:false, message:e.message });
  }
});

module.exports = router;
