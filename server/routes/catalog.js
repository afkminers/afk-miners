// server/routes/catalog.js
const express = require('express');
const { all } = require('../models/db');

const router = express.Router();
const imageUrlFor = (k) => `/img/heroes/${k}.png`;

router.get('/heroes/master', async (_req, res) => {
  try {
    const rows = await all(`
      SELECT heroKey, name, rarity,
             base_attack, base_defense, base_speed,
             class, role, type, element, weapon
        FROM heroes_master
    `);
    // mantém chaves esperadas no front (attack_type/weapon_pref) sem quebrar o schema atual
    res.json(rows.map(h => ({
      ...h,
      attack_type: h.type,
      weapon_pref: h.weapon,
      imageUrl: imageUrlFor(h.heroKey),
    })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Falha ao listar heróis' });
  }
});

module.exports = router;
