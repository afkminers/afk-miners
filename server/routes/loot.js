// server/routes/loot.js
const express = require('express');
const router = express.Router();

const { requireAuth } = require('../auth/middleware');
// Ajuste este require conforme seu projeto:
// - Se você criou server/db/index.js, mantenha:
const { run, all, get } = require('../db');
// - Se seus helpers ficam em server/models/db.js, use:
// const { run, all, get } = require('../models/db');

const { listBackpack, getBackpackSpec } = require('../services/backpack');
const lootSvc = require('../services/loot');

let broadcastToMap = () => {};
try { ({ broadcastToMap } = require('../ws/bus')); } catch {}

router.use(requireAuth);

// Remoção de itens da mochila (distribui entre slots)
async function takeFromBackpack(heroId, itemKey, qty) {
  const H = String(heroId);
  const K = String(itemKey);
  let left = Number(qty) | 0;
  if (!H || !K || left <= 0) return 0;

  const rows = await all(
    `SELECT slot_index AS "slotIndex", qty
       FROM hero_backpack_slots
      WHERE hero_id=$1 AND item_key=$2 AND qty > 0
      ORDER BY slot_index`,
    [H, K]
  );

  for (const r of rows) {
    if (left <= 0) break;
    const take = Math.min(left, Number(r.qty) || 0);
    const newQty = (Number(r.qty) || 0) - take;

    if (newQty > 0) {
      await run(
        `UPDATE hero_backpack_slots
            SET qty=$3
          WHERE hero_id=$1 AND slot_index=$2`,
        [H, Number(r.slotIndex), newQty]
      );
    } else {
      await run(
        `UPDATE hero_backpack_slots
            SET item_key=NULL, qty=0
          WHERE hero_id=$1 AND slot_index=$2`,
        [H, Number(r.slotIndex)]
      );
    }
    left -= take;
  }

  return (Number(qty) | 0) - left; // quanto foi removido
}

// Lista loots do mapa (seu serviço em memória)
router.get('/map/:mapKey/loot', async (req, res) => {
  try {
    const mapKey = String(req.params.mapKey);
    const rows = await lootSvc.getMapLoot(mapKey);
    res.json(rows);
  } catch (e) {
    console.error('[loot] list', e.message);
    res.status(500).json({ error: 'loot-list-failed' });
  }
});

// Pickup (já existente no seu projeto — mantenha se já tiver)
router.post('/loot/pickup', express.json(), async (req, res) => {
  try {
    const { heroId, lootId } = req.body || {};
    if (!heroId || !lootId) return res.status(400).json({ error: 'bad-args' });

    const spec = await getBackpackSpec(heroId);
    const capacity = Number(spec?.slots || 0);
    if (!capacity) return res.status(400).json({ error: 'no-backpack' });

    const rows = await lootSvc.getMapLoot(spec.mapKey || 'house');
    const loot = rows.find(x => String(x.id) === String(lootId));
    if (!loot) return res.status(404).json({ error: 'loot-not-found' });

    const picked = await lootSvc.pickupLoot(String(lootId), String(heroId));
    if (!picked) return res.status(404).json({ error: 'loot-not-found' });

    const items = (picked.items || []).map(i => ({ key: String(i.key), amount: Number(i.amount) || 0 }));
    const { putLootItemsForHero } = require('../services/backpack');
    const { placed, leftover } = await putLootItemsForHero(heroId, items);

    if (Array.isArray(leftover) && leftover.length > 0) {
      await lootSvc.createLootFromKill({
        mapKey: picked.mapKey, x: picked.x, y: picked.y,
        items: leftover.map(x => ({ key: x.key, amount: x.amount }))
      });
    }

    const data = await listBackpack(heroId);
    const spec2 = await getBackpackSpec(heroId);

    res.json({
      ok: true,
      snapshot: {
        heroId: String(heroId),
        capacity: data.capacity,
        used: data.used,
        items: data.items,
        backpackKey: spec2.key
      },
      placed,
      leftover
    });
  } catch (e) {
    console.error('[loot] pickup', e.message);
    res.status(500).json({ error: 'loot-pickup-failed' });
  }
});

// NOVO: Drop no chão (Fase 1 do DnD)
router.post('/loot/drop', express.json(), async (req, res) => {
  try {
    const heroId  = String(req.body?.heroId || '').trim();
    const itemKey = String(req.body?.itemKey || '').trim();
    const qty     = Number(req.body?.qty || 0) | 0;
    const mapKey  = String(req.body?.mapKey || '').trim();
    const x       = Number(req.body?.x);
    const y       = Number(req.body?.y);

    if (!heroId || !itemKey || !mapKey || !Number.isInteger(x) || !Number.isInteger(y) || qty <= 0) {
      return res.status(400).json({ error: 'bad-args' });
    }

    const removed = await takeFromBackpack(heroId, itemKey, qty);
    if (removed < qty) return res.status(400).json({ error: 'not-enough-qty' });

    await lootSvc.createLootFromKill({
      mapKey, x, y,
      items: [{ key: itemKey, amount: qty }]
    });

    const data = await listBackpack(heroId);
    const spec = await getBackpackSpec(heroId);

    res.json({
      ok: true,
      snapshot: {
        heroId,
        capacity: data.capacity,
        used: data.used,
        items: data.items,
        backpackKey: spec.key
      }
    });
  } catch (e) {
    console.error('[loot] drop', e.message);
    res.status(500).json({ error: 'drop-failed' });
  }
});

module.exports = router;