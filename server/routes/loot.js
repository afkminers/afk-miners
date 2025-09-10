// server/routes/loot.js
const express = require('express');
const router = express.Router();

const { all, get, run } = require('../models/db');
const { requireAuth } = require('../auth/middleware');
const { listBackpack, getBackpackSpec, putLootItemsForHero } = require('../services/backpack');

router.use(requireAuth);

/**
 * Lista loots ativos no mapa (inalterado; mantenha como já estava se você tiver outro formato)
 */
router.get('/map/:mapKey/loot', async (req, res) => {
  try {
    const mapKey = String(req.params.mapKey);
    const rows = await all(
      `SELECT id, "mapKey" AS "mapKey", x, y, "itemsJSON" AS "items", expires_at
         FROM map_loot
        WHERE "mapKey" = $1
        ORDER BY id`,
      [mapKey]
    );
    res.json(rows.map(r => ({ ...r, items: r.items || [] })));
  } catch (e) {
    console.error('[loot] list', e.message);
    res.status(500).json({ error: 'loot-list-failed' });
  }
});

/**
 * Pickup de loot
 * Regras:
 *  - Sem BACK (capacidade 0) => 400 { error: 'no-backpack' }
 *  - Tenta colocar tudo na mochila do herói
 *  - Se sobrar (sem espaço), retorna leftover; o loot permanece/é atualizado
 */
router.post('/loot/pickup', express.json(), async (req, res) => {
  try {
    const { heroId, lootId } = req.body || {};
    if (!heroId || !lootId) return res.status(400).json({ error: 'bad-args' });

    // 1) checa se há bag/backpack equipada
    const spec = await getBackpackSpec(heroId);
    const capacity = Number(spec?.slots || 0);
    if (!capacity) {
      return res.status(400).json({ error: 'no-backpack' });
    }

    // 2) carrega o loot
    const loot = await get(`SELECT id, "itemsJSON" AS items FROM map_loot WHERE id = $1`, [lootId]);
    if (!loot) return res.status(404).json({ error: 'loot-not-found' });
    const items = Array.isArray(loot.items) ? loot.items : [];

    // 3) tenta depositar tudo na mochila
    const { placed, leftover } = await putLootItemsForHero(heroId, items);

    // 4) se sobrou algo, atualiza o loot; senão, remove o loot
    if (leftover.length > 0) {
      await run(
        `UPDATE map_loot SET "itemsJSON" = $2 WHERE id = $1`,
        [lootId, JSON.stringify(leftover)]
      );
    } else {
      await run(`DELETE FROM map_loot WHERE id = $1`, [lootId]);
    }

    // 5) resposta
    const snapshot = await listBackpack(heroId);
    res.json({
      ok: true,
      placed,
      leftover,
      backpack: snapshot
    });
  } catch (e) {
    console.error('[loot] pickup', e.message);
    res.status(500).json({ error: 'loot-pickup-failed' });
  }
});

module.exports = router;
