// server/skills/routes.js
const express = require('express');
const { all } = require('../models/db');
const { requireAuth } = require('../auth/middleware');

const router = express.Router();
router.use(requireAuth);

// GET /api/skills/curves?skill=SWORD
router.get('/curves', async (req, res) => {
  try {
    const skill = String(req.query.skill || '').toUpperCase();
    if (!skill) return res.status(400).json({ error: 'informe ?skill=SWORD|AXE|CLUB|DISTANCE|SHIELD|MAGIC' });
    const rows = await all(
      `SELECT level, tries_needed FROM skill_curves WHERE skill_type = ? ORDER BY level`,
      [skill]
    );
    res.json({ skill_type: skill, rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Falha ao listar curvas' });
  }
});

// GET /api/skills/class-rates
router.get('/class-rates', async (_req, res) => {
  try {
    const rows = await all(`SELECT class, skill_type, rate FROM class_skill_rates ORDER BY class, skill_type`);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Falha ao listar rates' });
  }
});

// GET /api/skills/me?heroId=...
router.get('/me', async (req, res) => {
  try {
    const heroId = req.query.heroId;
    if (!heroId) return res.status(400).json({ error: 'heroId é obrigatório' });

    // garante que o herói pertence ao player
    const owner = await all(`SELECT 1 FROM player_heroes WHERE id=? AND playerId=?`, [heroId, req.user.id]);
    if (!owner.length) return res.status(404).json({ error: 'Herói não encontrado' });

    const rows = await all(
      `SELECT skill_type, level, tries_progress
         FROM player_hero_skills
        WHERE hero_id = ?
        ORDER BY skill_type`,
      [heroId]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Falha ao listar skills do herói' });
  }
});

module.exports = router;
