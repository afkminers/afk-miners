// server/routes/backpack.js
const express = require('express');
const router = express.Router();

const { listBackpack, getBackpackSpec, putInBackpack } = require('../services/backpack');

// GET /api/backpack/:heroId/slots
router.get('/:heroId/slots', async (req, res) => {
  try {
    const heroId = String(req.params.heroId || '').trim(); // <<-- aceitar UUID também
    if (!heroId) return res.status(400).json({ error: 'heroId required' });

    const data = await listBackpack(heroId);
    const spec = await getBackpackSpec(heroId);

    res.json({
      heroId,
      capacity: data.capacity,
      used: data.used,
      items: data.items,
      backpackKey: spec.key,
    });
  } catch (e) {
    console.error('[backpack] list slots:', e?.message);
    res.status(500).json({ error: 'backpack-list-failed' });
  }
});

// POST /api/backpack/:heroId/deposit { itemKey, qty }  (helper opcional p/ teste)
router.post('/:heroId/deposit', express.json(), async (req, res) => {
  try {
    const heroId  = String(req.params.heroId || '').trim(); // <<-- aceitar UUID também
    const itemKey = String(req.body?.itemKey || '').trim();
    const qty     = Number(req.body?.qty || 0) || 0;

    if (!heroId || !itemKey || qty <= 0) {
      return res.status(400).json({ error: 'bad-args' });
    }

    const placed = await putInBackpack(heroId, itemKey, qty);
    res.json({ ok: true, placed });
  } catch (e) {
    console.error('[backpack] deposit:', e?.message);
    res.status(500).json({ error: 'backpack-deposit-failed' });
  }
});

module.exports = router;
