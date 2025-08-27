// server/routes/afk.js
const express = require('express');
const router = express.Router();
const { db } = require('../models/db');

// Helpers Promises
const dbGet = (sql, p=[]) => new Promise((res, rej)=> db.get(sql, p, (e, r)=> e?rej(e):res(r)));
const dbAll = (sql, p=[]) => new Promise((res, rej)=> db.all(sql, p, (e, r)=> e?rej(e):res(r)));
const dbRun = (sql, p=[]) => new Promise((res, rej)=> db.run(sql, p, function(e){ e?rej(e):res(this) }));

// Sanity: ping
router.get('/ping', (_req, res) => res.json({ ok:true, ts: Date.now() }));

// Estado agregado: workers, boxes, inventário
router.get('/state', async (req, res) => {
  try {
    const playerId = String(req.user.id || req.user.playerId || req.user.userId || '');
    const workers = await dbAll(
      `SELECT id, name, produce_type, produce_amount, rate_sec, assigned_box, last_collected, created_at
         FROM afk_workers
        WHERE player_id=? ORDER BY created_at ASC`, [playerId]
    );
    const boxes = await dbAll(
      `SELECT id, kind, level, capacity, created_at
         FROM afk_boxes WHERE player_id=? ORDER BY created_at ASC`, [playerId]
    );
    const inv = await dbAll(
      `SELECT item_type, amount
         FROM afk_inventories WHERE player_id=? ORDER BY item_type ASC`, [playerId]
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

    const id = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    await dbRun(
      `INSERT INTO afk_workers (id, player_id, name, produce_type, produce_amount, rate_sec, assigned_box)
       VALUES (?,?,?,?,?,?,?)`,
      [id, playerId, String(name||'Worker'), String(produce_type), Number(produce_amount), Number(rate_sec), assigned_box]
    );

    res.json({ ok:true, id });
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

    const w = await dbGet(`SELECT id, player_id FROM afk_workers WHERE id=?`, [worker_id]);
    if (!w || w.player_id !== playerId) return res.status(404).json({ error: 'worker_not_found' });

    if (box_id) {
      const b = await dbGet(`SELECT id, player_id FROM afk_boxes WHERE id=?`, [box_id]);
      if (!b || b.player_id !== playerId) return res.status(404).json({ error: 'box_not_found' });
    }

    await dbRun(`UPDATE afk_workers SET assigned_box=? WHERE id=?`, [box_id || null, worker_id]);
    res.json({ ok:true });
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

    // helper para converter "YYYY-MM-DD HH:MM:SS" -> epoch
    function tsToMs(s) {
      if (!s) return NaN;
      // transforma em ISO: "YYYY-MM-DDTHH:MM:SSZ"
      const iso = String(s).replace(' ', 'T') + 'Z';
      const ms = Date.parse(iso);
      return Number.isNaN(ms) ? NaN : ms;
    }

    const workers = await dbAll(
      `SELECT id, produce_type, produce_amount, rate_sec, last_collected
         FROM afk_workers WHERE player_id=?`, [playerId]
    );

    const total = {};
    for (const w of workers) {
      const lastMs = tsToMs(w.last_collected);
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
      await dbRun(
        `UPDATE afk_workers SET last_collected = datetime(?, 'unixepoch') WHERE id=?`,
        [Math.floor((baseLast + ticks * rate * 1000) / 1000), w.id]
      );
    }

    // aplica no inventário
    for (const [type, amount] of Object.entries(total)) {
      const row = await dbGet(
        `SELECT amount FROM afk_inventories WHERE player_id=? AND item_type=?`,
        [playerId, type]
      );
      if (row) {
        await dbRun(
          `UPDATE afk_inventories SET amount=amount+? WHERE player_id=? AND item_type=?`,
          [amount, playerId, type]
        );
      } else {
        await dbRun(
          `INSERT INTO afk_inventories (player_id, item_type, amount) VALUES (?,?,?)`,
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
