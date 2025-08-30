const express = require('express');
const { all } = require('../models/db');
const { requireAuth } = require('../auth/middleware');
const { gainFromHit } = require('./engine');

const router = express.Router();
router.use(requireAuth);

// GET /api/skills/curves?skill=SWORD
router.get('/curves', async (req, res) => {
  try {
    const skill = String(req.query.skill || '').toUpperCase();
    if (!skill) {
      return res.status(400).json({
        error: 'informe ?skill=SWORD|AXE|CLUB|DISTANCE|SHIELD|MAGIC',
      });
    }
    const rows = await all(
      `SELECT level, tries_needed
         FROM skill_curves
        WHERE skill_type = $1
        ORDER BY level`,
      [skill]
    );
    res.json({ skill_type: skill, rows });
  } catch (e) {
    console.error('[skills/curves] error:', e);
    res.status(500).json({ error: 'Falha ao listar curvas' });
  }
});

// GET /api/skills/class-rates
router.get('/class-rates', async (_req, res) => {
  try {
    const rows = await all(
      `SELECT class, skill_type, rate
         FROM class_skill_rates
        ORDER BY class, skill_type`
    );
    res.json(rows);
  } catch (e) {
    console.error('[skills/class-rates] error:', e);
    res.status(500).json({ error: 'Falha ao listar rates' });
  }
});

// GET /api/skills/me?heroId=...
router.get('/me', async (req, res) => {
  try {
    const heroId = req.query.heroId;
    if (!heroId) return res.status(400).json({ error: 'heroId é obrigatório' });

    // garante que o herói pertence ao player
    const owner = await all(
      `SELECT 1
         FROM player_heroes
        WHERE id = $1 AND "playerId" = $2`,
      [heroId, req.user.id]
    );
    if (!owner.length) return res.status(404).json({ error: 'Herói não encontrado' });

    const rows = await all(
      `SELECT
          ps.skill_type,
          ps.level,
          ps.tries_progress,
          sc.tries_needed AS need,
          CASE
            WHEN sc.tries_needed IS NOT NULL AND sc.tries_needed > 0
              THEN ps.tries_progress::float / sc.tries_needed
            ELSE 0
          END AS progress_pct
        FROM player_hero_skills ps
        LEFT JOIN skill_curves sc
          ON sc.skill_type = ps.skill_type
         AND sc.level      = ps.level
       WHERE ps.hero_id = $1
       ORDER BY ps.skill_type`,
      [heroId]
    );

    res.json(rows);
  } catch (e) {
    console.error('[skills/me] error:', e);
    res.status(500).json({ error: 'Falha ao listar skills do herói' });
  }
});

// (Opcional) POST /api/skills/gain/dev  -> força um ganho via engine p/ testar
if (process.env.NODE_ENV !== 'production') {
  router.post('/gain/dev', async (req, res) => {
    try {
      const { heroId, heroClass, skillType } = req.body || {};
      if (!heroId || !skillType) {
        return res.status(400).json({ error: 'heroId e skillType são obrigatórios' });
      }
      const r = await gainFromHit({ heroId, skillType, heroClass, context:'COMBAT' });
      res.json(r);
    } catch (e) {
      console.error('[skills/gain/dev] error:', e);
      res.status(500).json({ error: 'Falha ao aplicar ganho' });
    }
  });
}

module.exports = router;
