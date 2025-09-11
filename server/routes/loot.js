// server/routes/loot.js
const express = require('express');
const router = express.Router();

const { requireAuth } = require('../auth/middleware');
const { listBackpack, getBackpackSpec, putLootItemsForHero } = require('../services/backpack');
const lootSvc = require('../services/loot');

// Opcional: se existir bus para notificar os clientes do mapa
let broadcastToMap = () => {};
try {
  ({ broadcastToMap } = require('../ws/bus'));
} catch {
  // segue sem broadcast se o módulo não existir
}

router.use(requireAuth);

// Helpers
function findLootInMemory(lootId) {
  const id = String(lootId);
  if (!lootSvc || !lootSvc._memory) return null;
  for (const [mapKey, lootMap] of lootSvc._memory.entries()) {
    if (lootMap.has(id)) {
      const entry = lootMap.get(id);
      return { mapKey: String(mapKey), lootMap, entry };
    }
  }
  return null;
}

/**
 * Lista loots ativos no mapa a partir da memória (MAP_LOOT).
 */
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

/**
 * Pickup de loot (Tibia-like)
 * Regras:
 *  - Sem BACK (capacidade 0) => 400 { error: 'no-backpack' }
 *  - Tenta colocar tudo na mochila do herói
 *  - Se sobrar (sem espaço), atualiza o loot em memória com o leftover
 *  - Senão, remove o loot do mapa
 *  - Retorna snapshot da mochila para atualização instantânea do front
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

    // 2) localiza loot EM MEMÓRIA (MAP_LOOT)
    const found = findLootInMemory(lootId);
    if (!found) return res.status(404).json({ error: 'loot-not-found' });

    const { mapKey, lootMap, entry } = found;
    const srcItems = Array.isArray(entry.items) ? entry.items : [];

    // normaliza para { key, amount }
    const items = srcItems.map((it) => ({
      key: String(it.key || it.itemKey || '').trim(),
      amount: Number(it.amount ?? it.qty ?? 0),
    })).filter((x) => x.key && x.amount > 0);

    // 3) tenta depositar tudo na mochila
    const { placed, leftover } = await putLootItemsForHero(heroId, items);

    // 4) se sobrou algo, atualiza o loot em memória; senão, remove
    if (Array.isArray(leftover) && leftover.length > 0) {
      entry.items = leftover.map((x) => ({ key: x.key, amount: x.amount }));
      lootMap.set(String(lootId), entry);
      try { broadcastToMap(mapKey, { type: 'loot_updated', id: String(lootId) }); } catch {}
    } else {
      lootMap.delete(String(lootId));
      try { broadcastToMap(mapKey, { type: 'loot_removed', id: String(lootId) }); } catch {}
    }

    // 5) resposta com snapshot da mochila para atualização instantânea
    const snapshot = await listBackpack(heroId);
    res.json({
      ok: true,
      placed,
      leftover,
      backpack: snapshot,
    });
  } catch (e) {
    console.error('[loot] pickup', e.message);
    res.status(500).json({ error: 'loot-pickup-failed' });
  }
});

module.exports = router;