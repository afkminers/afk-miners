// server/player/routes.js
const express = require('express');
const { all, get } = require('../models/db');
const { requireAuth } = require('../auth/middleware');

const router = express.Router();

/* util: headers anti-cache */
function noStore(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
}

// tudo aqui é protegido
router.use(requireAuth);

/**
 * GET /api/player/me
 * Retorna perfil + heróis do jogador autenticado (sem skills/level global).
 */
router.get('/me', async (req, res) => {
  try {
    noStore(res);
    const playerId = req.user.id;

    // perfil
    const profile = await get(
      `SELECT id, name, coins, gems, createdAt
         FROM players
        WHERE id = ?`,
      [playerId]
    );
    if (!profile) return res.status(404).json({ error: 'Jogador não encontrado' });

    // heróis (join com o catálogo atual: attack_type/weapon_pref)
    const rows = await all(`
      SELECT
        ph.id,
        ph.heroKey,
        ph.name,
        ph.rarity,
        ph.attack,
        ph.defense,
        ph.speed,
        ph.createdAt,
        hm.class,
        hm.role,
        hm.attack_type,
        hm.element,
        hm.weapon_pref
      FROM player_heroes AS ph
      LEFT JOIN heroes_master AS hm ON hm.heroKey = ph.heroKey
      WHERE ph.playerId = ?
      ORDER BY
        CASE ph.rarity
          WHEN 'ULTIMATE'   THEN 1
          WHEN 'MYTHIC'     THEN 2
          WHEN 'LEGENDARY'  THEN 3
          WHEN 'SUPER_RARE' THEN 4
          WHEN 'RARE'       THEN 5
          ELSE 6
        END,
        ph.createdAt DESC
    `, [playerId]);

    const imageUrlFor = (heroKey) => `/img/heroes/${heroKey}.png`;
    const heroes = rows.map(h => ({ ...h, imageUrl: imageUrlFor(h.heroKey) }));

    return res.json({ profile, heroes });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Falha ao obter dados do jogador' });
  }
});

module.exports = router;
