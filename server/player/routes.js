// server/player/routes.js
const express = require('express');
const router = express.Router();

const { all, get } = require('../models/db');
const { computeHeroStats } = require('../services/heroStats');
const { getXpNeededForHero } = require('../services/heroProgress');

/**
 * GET /api/player/me
 * -> retorna o usuário + lista de heróis com stats calculados
 */
router.get('/me', async (req, res) => {
  try {
    const userId = req.user.id;

    // heróis do jogador + classe a partir do catálogo
    const heroes = await all(
      `
      SELECT
        ph.id,
        ph."heroKey"           AS "heroKey",
        ph."isStarter"         AS "isStarter",
        ph.name                AS "displayName",
        ph.level,
        ph.rarity,
        ph.attack,
        ph.defense,
        ph.speed,
        ph.xp,
        COALESCE(hm.class, '') AS class
      FROM player_heroes ph
      LEFT JOIN heroes_master hm
             ON hm."heroKey" = ph."heroKey"
      WHERE ph."playerId" = $1
      ORDER BY ph."createdAt" ASC
      `,
      [userId]
    );

    // calcula status máximos dinâmicos e xp para próximo nível
    const heroesWithStats = await Promise.all(
      heroes.map(async (h) => {
        let stats = {};
        try {
          stats = await computeHeroStats({
            level: h.level,
            heroKey: h.heroKey,
            class: h.class,
          });
        } catch (e) {
          // fallback seguro caso computeHeroStats falhe
          stats = {
            maxHp: 100 + (h.level - 1) * 5 + (h.defense || 0) * 2,
            maxMana: 50,
            maxCap: 470,
          };
          console.warn('[player/me] computeHeroStats falhou, usando fallback:', e?.message);
        }

        const xp_needed_next_level = await getXpNeededForHero(h);

        return {
          id: String(h.id),
          heroKey: h.heroKey,
          class: h.class,
          isStarter: !!h.isStarter,
          name: h.displayName || h.heroKey,
          level: Number(h.level || 1),
          rarity: h.rarity || 'COMMON',
          attack: Number(h.attack || 1),
          defense: Number(h.defense || 1),
          speed: Number(h.speed || 1),
          xp: Number(h.xp || 0),
          maxHp: stats.maxHp,
          maxMana: stats.maxMana,
          maxCap: stats.maxCap,
          xp_needed_next_level,
        };
      })
    );

    const me = {
      id: userId,
      name: req.user?.name || req.user?.username || 'player',
      heroes: heroesWithStats,
    };

    res.json(me);
  } catch (e) {
    console.error('[player/me] error:', e);
    res.status(500).json({ error: 'me-failed' });
  }
});

module.exports = router;
