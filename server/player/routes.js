// server/player/routes.js
const express = require('express');
const { all, get } = require('../models/db');

const router = express.Router();

/* util: headers anti-cache */
function noStore(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
}

// GET /api/player/me
router.get('/me', async (req, res) => {
  try {
    noStore(res);

    const playerId = req.user.id;

    const profile = await get(
      `SELECT id,name,coins,gems,createdAt
         FROM players
        WHERE id=?`,
      [playerId]
    );

    // LEFT JOIN para não “sumir” itens se faltar meta no master
    const rows = await all(`
      SELECT
        inv.id, inv.heroKey, inv.name, inv.rarity, inv.attack, inv.defense, inv.speed, inv.createdAt,
        hm.class, hm.role, hm.attack_type, hm.element, hm.weapon_pref
      FROM inventory AS inv
      LEFT JOIN heroes_master AS hm ON hm.heroKey = inv.heroKey
      WHERE inv.playerId = ?
      ORDER BY
        CASE inv.rarity
          WHEN 'ULTIMATE' THEN 1
          WHEN 'MYTHIC' THEN 2
          WHEN 'LEGENDARY' THEN 3
          WHEN 'SUPER_RARE' THEN 4
          WHEN 'RARE' THEN 5
          ELSE 6
        END, inv.createdAt DESC
    `, [playerId]);

    const imageUrlFor = (heroKey) => `/img/heroes/${heroKey}.png`;
    const inventory = rows.map(h => ({ ...h, imageUrl: imageUrlFor(h.heroKey) }));

    return res.json({ profile, inventory });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Falha ao obter dados do jogador' });
  }
});

module.exports = router;
