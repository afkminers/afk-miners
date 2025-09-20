// server/player/routes.js
const express = require('express');
const router = express.Router();

const { all } = require('../models/db');
const { computeHeroStats, syncVitalsIfOutdated } = require('../services/heroStats');
const { getXpNeededForHero } = require('../services/heroProgress');

/**
 * GET /api/player/me
 * -> retorna o usuário + lista de heróis com stats calculados
 *    e HP/MAXHP alinhados com o banco
 */
router.get('/me', async (req, res) => {
  try {
    const userId = req.user.id;

    // Heróis do jogador, já trazendo hp/max_hp do DB e classe do catálogo
    const heroes = await all(
      `
      SELECT
        ph.id,
        ph."heroKey"            AS "heroKey",
        ph."isStarter"          AS "isStarter",
        ph.name                 AS "displayName",
        ph.level,
        ph.rarity,
        ph.attack,
        ph.defense,
        ph.speed,
        ph.xp,
        ph.hp,                  -- HP atual no banco
        ph.max_hp,              -- Max HP persistido (pode estar desatualizado)
        COALESCE(hm.class, '')  AS class
      FROM player_heroes ph
      LEFT JOIN heroes_master hm
             ON hm."heroKey" = ph."heroKey"
      WHERE ph."playerId" = $1
      ORDER BY ph."createdAt" ASC
      `,
      [userId]
    );

    // Monta payload + garante que hp/maxHp estejam sincronizados com a fórmula atual
    const heroesWithStats = await Promise.all(
      heroes.map(async (h) => {
        // 1) Calcula máximos "teóricos" (caso precise exibir no front)
        let dyn = {};
        try {
          dyn = await computeHeroStats({
            level: h.level,
            heroKey: h.heroKey,
            class: h.class,
          });
        } catch (e) {
          // fallback seguro caso computeHeroStats falhe
          dyn = {
            maxHp: 100 + Math.max(0, (Number(h.level || 1) - 1)) * 5 + (Number(h.defense || 0) * 2),
            maxMana: 50,
            maxCap: 470,
          };
          console.warn('[player/me] computeHeroStats falhou, usando fallback:', e?.message);
        }

        // 2) Sincroniza vitais no DB (atualiza max_hp e ajusta hp se necessário)
        //    -> retorna os valores finais persistidos
        let syncedHp = Number(h.hp || 0);
        let syncedMaxHp = Number(h.max_hp || dyn.maxHp || 0);
        try {
          const sync = await syncVitalsIfOutdated(String(h.id));
          if (sync && Number.isFinite(sync.hp)) syncedHp = Number(sync.hp);
          if (sync && Number.isFinite(sync.maxHp)) syncedMaxHp = Number(sync.maxHp);
        } catch (e) {
          // se der erro na sync, usa o que veio do banco; se max_hp estiver vazio, usa cálculo dinâmico
          if (!Number.isFinite(syncedMaxHp) || syncedMaxHp <= 0) {
            syncedMaxHp = Number(dyn.maxHp || 0);
          }
          console.warn('[player/me] syncVitalsIfOutdated falhou; usando valores atuais do DB/dinâmicos:', e?.message);
        }

        // 3) Calcula XP necessário para o próximo nível
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

          // vitais que o HUD deve usar (alinhados com o banco)
          hp: syncedHp,
          maxHp: syncedMaxHp,

          // extras dinâmicos (se o front usar)
          maxMana: Number(dyn.maxMana || 0),
          maxCap: Number(dyn.maxCap || 0),

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
