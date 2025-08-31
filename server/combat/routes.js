// server/combat/routes.js
const express = require('express');
const router = express.Router();

const { requireAuth } = require('../auth/middleware');
const { applyHit } = require('./service');
const { start: startLoop, stop: stopLoop } = require('./autoloop');

router.use(requireAuth);

/**
 * Golpe único imediato (para testes/cliques isolados)
 * POST /api/combat/hit
 * body: { attackerHeroId, targetInstanceId, weaponType? }
 */
router.post('/hit', async (req, res) => {
  try {
    const { attackerHeroId, targetInstanceId, weaponType } = req.body || {};
    if (!attackerHeroId || !targetInstanceId) {
      return res.status(400).json({
        ok: false,
        message: 'attackerHeroId e targetInstanceId são obrigatórios'
      });
    }

    const r = await applyHit({
      attackerHeroId: String(attackerHeroId),
      targetInstanceId: String(targetInstanceId),
      weaponType: String(weaponType || 'SWORD')
    });

    return res.status(r?.ok ? 200 : 400).json(r);
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
});

/**
 * Inicia auto-attack no servidor (repetido no cooldown da arma)
 * POST /api/combat/attack/start
 * body: { heroId | attackerHeroId, targetInstanceId | targetId, weaponType? }
 */
router.post('/attack/start', async (req, res) => {
  try {
    const heroId =
      (req.body && (req.body.heroId || req.body.attackerHeroId)) ? String(req.body.heroId || req.body.attackerHeroId) : '';
    const targetInstanceId =
      (req.body && (req.body.targetInstanceId || req.body.targetId)) ? String(req.body.targetInstanceId || req.body.targetId) : '';
    const weaponType = String((req.body && req.body.weaponType) || 'SWORD');

    if (!heroId || !targetInstanceId) {
      return res.status(400).json({
        ok: false,
        message: 'heroId e targetInstanceId são obrigatórios'
      });
    }

    startLoop(heroId, targetInstanceId, weaponType);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
});

/**
 * Para o auto-attack do herói
 * POST /api/combat/attack/stop
 * body: { heroId | attackerHeroId }
 */
router.post('/attack/stop', async (req, res) => {
  try {
    const heroId =
      (req.body && (req.body.heroId || req.body.attackerHeroId)) ? String(req.body.heroId || req.body.attackerHeroId) : '';

    if (!heroId) {
      return res.status(400).json({
        ok: false,
        message: 'heroId é obrigatório'
      });
    }

    stopLoop(heroId);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
});

module.exports = router;
