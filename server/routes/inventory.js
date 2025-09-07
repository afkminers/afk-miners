// server/routes/inventory.js
const express = require('express');
const router = express.Router();

const { all } = require('../models/db');
const { requireAuth } = require('../auth/middleware');

/**
 * Lista o inventário do player logado DESCONTANDO os itens equipados
 * pelos heróis desse player (saldo virtual).
 *
 * Retorna apenas itens com saldo > 0.
 */
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    // id do player logado (vem como texto/numérico)
    const playerId = String(req.user.id);

    const rows = await all(
      `
      WITH eq AS (
        SELECT he.item_key, COUNT(*)::int AS equipped_cnt
          FROM hero_equipment he
          JOIN player_heroes ph ON ph.id::uuid = he.hero_id
         WHERE ph."playerId" = $1              -- "playerId" em player_heroes é texto
           AND he.item_key IS NOT NULL
         GROUP BY he.item_key
      )
      SELECT
        pi.item_key,
        GREATEST(pi.qty - COALESCE(eq.equipped_cnt,0), 0) AS qty,
        im.name,
        im.slot,
        im.weapon_type,
        im.sprite,
        im.atk,
        im.def
      FROM player_inventories pi
      JOIN items_master im ON im.key = pi.item_key
      LEFT JOIN eq ON eq.item_key = pi.item_key
      WHERE pi.player_id = $1::uuid            -- aqui é UUID → precisa do cast
        AND GREATEST(pi.qty - COALESCE(eq.equipped_cnt,0), 0) > 0
      ORDER BY im.slot, im.name
      `,
      [playerId]
    );

    res.json({ ok: true, items: rows });
  } catch (e) {
    console.error('[inventory] list error:', e);
    res.status(500).json({ ok:false, error: 'inventory-failed', detail: String(e.message || e) });
  }
});

module.exports = router;
