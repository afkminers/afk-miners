const express = require('express');
const { all, run } = require('../models/db');

const router = express.Router();

// GET /api/team - retorna equipe atual (slots 1-3)
router.get('/', async (req, res) => {
  try {
    const rows = await all(
      `SELECT slot, hero_id AS heroId FROM player_team WHERE player_id = ? ORDER BY slot`,
      [req.user.id]
    );
    res.json({ team: rows });
  } catch (err) {
    console.error('team get', err);
    res.status(500).json({ error: 'Falha ao obter team' });
  }
});

// POST /api/team - define equipe
router.post('/', async (req, res) => {
  try {
    const playerId = req.user.id;
    const team = Array.isArray(req.body.team) ? req.body.team : [];

    // valida slots únicos e heróis pertencentes ao jogador
    const heroes = await all(`SELECT id FROM player_heroes WHERE playerId = ?`, [playerId]);
    const validIds = new Set(heroes.map(h => h.id));

    const usedSlots = new Set();
    for (const t of team) {
      if (![1,2,3].includes(Number(t.slot))) return res.status(400).json({ error: 'slot inválido' });
      if (usedSlots.has(t.slot)) return res.status(400).json({ error: 'slot duplicado' });
      usedSlots.add(t.slot);
      if (!validIds.has(Number(t.heroId))) return res.status(400).json({ error: 'herói inválido' });
    }

    await run(`DELETE FROM player_team WHERE player_id = ?`, [playerId]);
    for (const t of team) {
      await run(
        `INSERT INTO player_team (player_id, hero_id, slot) VALUES (?, ?, ?)`,
        [playerId, t.heroId, t.slot]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('team post', err);
    res.status(500).json({ error: 'Falha ao salvar team' });
  }
});

module.exports = router;
