// server/routes/afk.js
const express = require('express');
const router = express.Router();
const { all, get, run } = require('../models/db'); // PG helpers

// Sanity: ping
router.get('/ping', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// Estado agregado: workers, boxes, inventário
router.get('/state', async (req, res) => {
  try {
    const playerId = String(req.user.id || req.user.playerId || req.user.userId || '');
    const workers = await all(
      `SELECT id, name, produce_type, produce_amount, rate_sec, assigned_box, last_collected, created_at
         FROM afk_workers
        WHERE player_id=$1
        ORDER BY created_at ASC`,
      [playerId]
    );
    const boxes = await all(
      `SELECT id, kind, level, capacity, created_at
         FROM afk_boxes
        WHERE player_id=$1
        ORDER BY created_at ASC`,
      [playerId]
    );
    const inv = await all(
      `SELECT item_type, amount
         FROM afk_inventories
        WHERE player_id=$1
        ORDER BY item_type ASC`,
      [playerId]
    );
    res.json({ workers, boxes, inventory: inv });
  } catch (e) {
    console.error('[afk/state] error:', e.message);
    res.status(500).json({ error: 'afk_state_failed' });
  }
});

// Criar worker
router.post('/create-worker', async (req, res) => {
  try {
    const playerId = String(req.user.id || req.user.playerId || req.user.userId || '');
    const { name, produce_type, produce_amount = 1, rate_sec = 10, assigned_box = null } = req.body || {};

    if (!produce_type) return res.status(400).json({ error: 'produce_type required' });

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await run(
      `INSERT INTO afk_workers
         (id, player_id, name, produce_type, produce_amount, rate_sec, assigned_box, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
      [id, playerId, String(name || 'Worker'), String(produce_type), Number(produce_amount), Number(rate_sec), assigned_box]
    );

    res.json({ ok: true, id });
  } catch (e) {
    console.error('[afk/create-worker] error:', e.message);
    res.status(500).json({ error: 'create_worker_failed' });
  }
});

// Atribuir/reatribuir worker a um box
router.post('/assign', async (req, res) => {
  try {
    const playerId = String(req.user.id || req.user.playerId || req.user.userId || '');
    const { worker_id, box_id } = req.body || {};
    if (!worker_id) return res.status(400).json({ error: 'worker_id required' });

    const w = await get(`SELECT id, player_id FROM afk_workers WHERE id=$1`, [worker_id]);
    if (!w || w.player_id !== playerId) return res.status(404).json({ error: 'worker_not_found' });

    if (box_id) {
      const b = await get(`SELECT id, player_id FROM afk_boxes WHERE id=$1`, [box_id]);
      if (!b || b.player_id !== playerId) return res.status(404).json({ error: 'box_not_found' });
    }

    await run(`UPDATE afk_workers SET assigned_box=$1 WHERE id=$2`, [box_id || null, worker_id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[afk/assign] error:', e.message);
    res.status(500).json({ error: 'assign_failed' });
  }
});

// Coletar produção acumulada de todos os workers do jogador
router.post('/collect', async (req, res) => {
  try {
    const playerId = String(req.user.id || req.user.playerId || req.user.userId || '');
    const now = Date.now();

    // last_collected deve ser TIMESTAMPTZ/DATE no PG; Date.parse lida com ISO
    const workers = await all(
      `SELECT id, produce_type, produce_amount, rate_sec, last_collected
         FROM afk_workers
        WHERE player_id=$1`,
      [playerId]
    );

    const total = {};
    for (const w of workers) {
      // se vier null, considera "agora" como base (não acumula nada)
      const lastMs = w.last_collected ? Date.parse(w.last_collected) : NaN;
      const baseLast = Number.isNaN(lastMs) ? now : lastMs;

      let seconds = Math.floor((now - baseLast) / 1000);
      const rate = Number(w.rate_sec || 0);
      const amountPerTick = Number(w.produce_amount || 1);

      if (seconds <= 0 || rate <= 0) {
        continue;
      }

      const ticks = Math.floor(seconds / rate);
      if (ticks <= 0) {
        continue;
      }

      const gained = ticks * amountPerTick;
      if (gained > 0) {
        total[w.produce_type] = (total[w.produce_type] || 0) + gained;
      }

      // avança last_collected exatamente o nº de ticks processados
      const newSec = Math.floor((baseLast + ticks * rate * 1000) / 1000);
      await run(
        `UPDATE afk_workers SET last_collected = to_timestamp($1) WHERE id=$2`,
        [newSec, w.id]
      );
    }

    // aplica no inventário (manter lógica select->update/insert para compatibilidade)
    for (const [type, amount] of Object.entries(total)) {
      const row = await get(
        `SELECT amount FROM afk_inventories WHERE player_id=$1 AND item_type=$2`,
        [playerId, type]
      );
      if (row) {
        await run(
          `UPDATE afk_inventories SET amount = amount + $1 WHERE player_id=$2 AND item_type=$3`,
          [amount, playerId, type]
        );
      } else {
        await run(
          `INSERT INTO afk_inventories (player_id, item_type, amount) VALUES ($1, $2, $3)`,
          [playerId, type, amount]
        );
      }
    }

    return res.json({ ok: true, added: total });
  } catch (e) {
    console.error('[afk/collect] error:', e.message);
    res.status(500).json({ error: 'collect_failed' });
  }
});

module.exports = router;