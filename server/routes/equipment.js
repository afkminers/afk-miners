// server/routes/equipment.js
const express = require('express');
const router = express.Router();

const { get, all, run } = require('../models/db');
const { requireAuth } = require('../auth/middleware');

router.use(requireAuth);

/* =========================================================================
   Guardião: ownership + alive=true
   ========================================================================== */
async function assertHeroAliveOwned(playerId, heroId) {
  const row = await get(
    `SELECT "playerId"::text AS player_id, COALESCE(alive, true) AS alive
       FROM player_heroes
      WHERE id = $1`,
    [String(heroId)]
  );
  if (!row) return { ok:false, code:404, error:'hero-not-found' };
  if (String(row.player_id) !== String(playerId)) {
    return { ok:false, code:403, error:'not-owner' };
  }
  if (row.alive === false) {
    return { ok:false, code:409, error:'hero-dead' };
  }
  return { ok:true };
}

// pega equipamento atual de um herói (apenas leitura – sem guardião de alive)
router.get('/:heroId', async (req, res) => {
  try {
    const heroId = String(req.params.heroId);
    const rows = await all(
      `SELECT he.slot, he.item_key, im.name, im.sprite, im.weapon_type, im.atk, im.def
         FROM hero_equipment he
         LEFT JOIN items_master im ON im.key = he.item_key
        WHERE he.hero_id = $1
        ORDER BY he.slot`,
      [heroId]
    );
    res.json({ ok: true, equipment: rows });
  } catch (e) {
    console.error('[equipment] get', e);
    res.status(500).json({ ok:false, error:'equipment-failed' });
  }
});

// equipar/retirar item (atualiza inventário também)
router.post('/equip', express.json(), async (req, res) => {
  const client = { tx: false };

  async function begin() {
    if (!client.tx) { await run('BEGIN'); client.tx = true; }
  }
  async function commit() { if (client.tx) await run('COMMIT'); client.tx = false; }
  async function rollback() { if (client.tx) await run('ROLLBACK'); client.tx = false; }

  try {
    const { heroId, slot, itemKey } = req.body || {};
    if (!heroId || !slot) return res.status(400).json({ ok:false, error:'missing-params' });

    // Guardião: dono + vivo
    const g = await assertHeroAliveOwned(req.user.id, heroId);
    if (!g.ok) return res.status(g.code).json({ ok:false, error:g.error });

    // Normaliza o slot em UMA única forma (MAIÚSCULO)
    const SLOT = String(slot).toUpperCase();
    const SLOTS = new Set(['AMULET','HELMET','BACK','WEAPON','ARMOR','SHIELD','RING','LEGS','BOOTS']);
    if (!SLOTS.has(SLOT)) return res.status(400).json({ ok:false, error:'bad-slot' });

    // descobre o player dono do herói (já validado acima, mas precisamos do id para inventário)
    const heroRow = await get(`SELECT "playerId"::text AS player_id FROM player_heroes WHERE id = $1`, [String(heroId)]);
    if (!heroRow) return res.status(404).json({ ok:false, error:'hero-not-found' });
    const playerId = String(heroRow.player_id);

    // qual item está equipado nesse slot? (tolerante a registros antigos com case diferente)
    const cur = await get(
      `SELECT item_key
         FROM hero_equipment
        WHERE hero_id = $1
          AND LOWER(slot) = LOWER($2)`,
      [String(heroId), SLOT]
    );
    const prevItem = cur?.item_key || null;

    // ======== UNEQUIP ========
    if (!itemKey) {
      if (!prevItem) {
        return res.json({ ok:true }); // nada para retirar
      }
      await begin();

      // limpa slot (sempre gravando SLOT MAIÚSCULO)
      await run(
        `INSERT INTO hero_equipment (hero_id, slot, item_key)
         VALUES ($1,$2,NULL)
         ON CONFLICT (hero_id, slot)
         DO UPDATE SET item_key = NULL, updated_at = now()`,
        [String(heroId), SLOT]
      );

      // devolve 1 ao inventário
      await run(
        `INSERT INTO player_inventories (player_id, item_key, qty)
         VALUES ($1, $2, 1)
         ON CONFLICT (player_id, item_key)
         DO UPDATE SET qty = player_inventories.qty + 1`,
        [playerId, String(prevItem)]
      );

      await commit();
      return res.json({ ok:true, unequipped: prevItem });
    }

    // ======== EQUIP ========
    const desiredKey = String(itemKey);

    // valida se item existe e corresponde ao slot
    const item = await get(`SELECT key, slot FROM items_master WHERE key = $1`, [desiredKey]);
    if (!item) return res.status(404).json({ ok:false, error:'no-such-item' });
    if (String(item.slot).toUpperCase() !== SLOT) {
      return res.status(400).json({ ok:false, error:'slot-mismatch' });
    }

    await begin();

    // precisa ter pelo menos 1 no inventário
    const inv = await get(
      `SELECT qty FROM player_inventories WHERE player_id=$1 AND item_key=$2`,
      [playerId, desiredKey]
    );
    if (!inv || Number(inv.qty) <= 0) {
      await rollback();
      return res.status(400).json({ ok:false, error:'no-stock' });
    }

    // debita 1 da peça que será equipada
    await run(
      `UPDATE player_inventories
          SET qty = qty - 1
        WHERE player_id=$1 AND item_key=$2 AND qty > 0`,
      [playerId, desiredKey]
    );

    // equipa (upsert no slot) — sempre gravando SLOT MAIÚSCULO
    await run(
      `INSERT INTO hero_equipment (hero_id, slot, item_key)
       VALUES ($1,$2,$3)
       ON CONFLICT (hero_id, slot)
       DO UPDATE SET item_key = EXCLUDED.item_key, updated_at = now()`,
      [String(heroId), SLOT, desiredKey]
    );

    // se havia algo equipado, devolve ao inventário
    if (prevItem) {
      await run(
        `INSERT INTO player_inventories (player_id, item_key, qty)
         VALUES ($1, $2, 1)
         ON CONFLICT (player_id, item_key)
         DO UPDATE SET qty = player_inventories.qty + 1`,
        [playerId, String(prevItem)]
      );
    }

    await commit();
    return res.json({ ok:true, equipped: desiredKey, swappedFrom: prevItem || null });
  } catch (e) {
    console.error('[equipment] equip', e);
    try { await run('ROLLBACK'); } catch {}
    return res.status(500).json({ ok:false, error:'equip-failed' });
  }
});

module.exports = router;
