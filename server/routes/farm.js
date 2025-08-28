// server/routes/farm.js
const express = require('express');
const router = express.Router();
const { all, get, run } = require('../models/db'); // PG helpers

// ======= CONFIG DE CULTURAS (MVP) =======
// cada número do array é a duração (em segundos) de um estágio
const CROPS = {
  wheat: {
    name: 'Wheat',
    seed_item: 'seed_wheat',
    stages: [60, 60],
    yield_item: 'grain',
    yield_qty: 3
  },
  carrot: {
    name: 'Carrot',
    seed_item: 'seed_carrot',
    stages: [90, 90],
    yield_item: 'carrot',
    yield_qty: 2
  }
};

// utils de tempo
function toMs(s) {
  if (!s) return NaN;
  // No PG normalmente recebemos ISO (ex.: 2025-08-27T23:59:59.000Z)
  const ms = Date.parse(String(s));
  return Number.isNaN(ms) ? NaN : ms;
}

// calcula estágio atual do plot com base no planted_at e nas durações
function computeStage(plot) {
  if (!plot.crop_key || plot.stage === 0 || !plot.planted_at) {
    return { stage: 0, done: false, nextAt: null, progressPct: 0 };
  }
  const cfg = CROPS[plot.crop_key];
  if (!cfg) return { stage: plot.stage, done: true, nextAt: null, progressPct: 100 };

  const plantedMs = toMs(plot.planted_at);
  if (Number.isNaN(plantedMs)) return { stage: plot.stage, done: false, nextAt: null, progressPct: 0 };

  const now = Date.now();
  let elapsed = Math.max(0, Math.floor((now - plantedMs) / 1000)); // segundos
  let stage = 1; // 1..N, onde N = cfg.stages.length + 1 (maduro)

  for (const dur of cfg.stages) {
    if (elapsed >= dur) { elapsed -= dur; stage++; }
    else break;
  }

  const maxStage = cfg.stages.length + 1;
  const done = stage >= maxStage;
  const currentIdx = Math.min(stage - 1, cfg.stages.length - 1);
  const stageDur = done ? 0 : (cfg.stages[currentIdx] || 0);
  const progressPct = done ? 100 : Math.floor((elapsed / Math.max(1, stageDur)) * 100);

  const nextAt = done ? null
    : new Date(
        toMs(plot.planted_at) +
        (cfg.stages.slice(0, stage - 1).reduce((a, b) => a + b, 0) + stageDur) * 1000
      ).toISOString();

  return { stage: Math.min(stage, maxStage), done, nextAt, progressPct };
}

// ======= ROTAS =======

// estado geral (plots + crops disponíveis)
router.get('/state', async (req, res) => {
  try {
    const playerId = String(req.user.id || req.user.playerId || '');
    const plots = await all(
      `SELECT id, player_id, x, y, crop_key, stage, planted_at, next_at, created_at
         FROM farm_plots
        WHERE player_id=$1
        ORDER BY created_at ASC`,
      [playerId]
    );

    const enhanced = plots.map(p => {
      const s = computeStage(p);
      return {
        ...p,
        stage: s.stage,
        ripe: s.done,
        next_at: s.nextAt,       // ISO string
        progress_pct: s.progressPct
      };
    });

    res.json({ plots: enhanced, crops: Object.keys(CROPS) });
  } catch (e) {
    console.error('[farm/state]', e.message);
    res.status(500).json({ error: 'farm_state_failed' });
  }
});

// criar um terreno (plot)
router.post('/plot/create', async (req, res) => {
  try {
    const playerId = String(req.user.id || req.user.playerId || '');
    const { x = 0, y = 0 } = req.body || {};
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    await run(
      `INSERT INTO farm_plots
         (id, player_id, x, y, crop_key, stage, planted_at, next_at, created_at)
       VALUES ($1, $2, $3, $4, NULL, 0, NULL, NULL, now())`,
      [id, playerId, Number(x), Number(y)]
    );

    res.json({ ok: true, id });
  } catch (e) {
    console.error('[farm/plot/create]', e.message);
    res.status(500).json({ error: 'plot_create_failed' });
  }
});

// plantar semente em um plot vazio
router.post('/plant', async (req, res) => {
  try {
    const playerId = String(req.user.id || req.user.playerId || '');
    const { plot_id, crop_key } = req.body || {};
    if (!plot_id || !crop_key) return res.status(400).json({ error: 'plot_id and crop_key required' });

    const plot = await get(
      `SELECT id, player_id, crop_key, stage, planted_at
         FROM farm_plots
        WHERE id=$1 AND player_id=$2`,
      [plot_id, playerId]
    );
    if (!plot) return res.status(404).json({ error: 'plot_not_found' });
    if (plot.stage && plot.stage !== 0) return res.status(400).json({ error: 'plot_not_empty' });

    const cfg = CROPS[crop_key];
    if (!cfg) return res.status(400).json({ error: 'invalid_crop' });

    // consome 1 semente do inventário AFK
    const inv = await get(
      `SELECT amount FROM afk_inventories WHERE player_id=$1 AND item_type=$2`,
      [playerId, cfg.seed_item]
    );
    if (!inv || inv.amount < 1) return res.status(400).json({ error: 'no_seed' });

    await run(
      `UPDATE afk_inventories SET amount = amount - 1
        WHERE player_id=$1 AND item_type=$2`,
      [playerId, cfg.seed_item]
    );

    const plantedAtSec = Math.floor(Date.now() / 1000);
    const nextAtSec = plantedAtSec + Number((cfg.stages[0] || 60));

    await run(
      `UPDATE farm_plots
          SET crop_key=$1,
              stage=1,
              planted_at=to_timestamp($2),
              next_at=to_timestamp($3)
        WHERE id=$4`,
      [crop_key, plantedAtSec, nextAtSec, plot_id]
    );

    res.json({
      ok: true,
      plot_id,
      crop_key,
      stage: 1,
      planted_at: new Date(plantedAtSec * 1000).toISOString(),
      next_at: new Date(nextAtSec * 1000).toISOString()
    });
  } catch (e) {
    console.error('[farm/plant]', e.message);
    res.status(500).json({ error: 'plant_failed' });
  }
});

// colher (só se estiver maduro)
router.post('/harvest', async (req, res) => {
  try {
    const playerId = String(req.user.id || req.user.playerId || '');
    const { plot_id } = req.body || {};
    if (!plot_id) return res.status(400).json({ error: 'plot_id required' });

    const plot = await get(
      `SELECT * FROM farm_plots WHERE id=$1 AND player_id=$2`,
      [plot_id, playerId]
    );
    if (!plot) return res.status(404).json({ error: 'plot_not_found' });
    if (!plot.crop_key || plot.stage === 0) return res.status(400).json({ error: 'empty_plot' });

    const cfg = CROPS[plot.crop_key];
    if (!cfg) return res.status(400).json({ error: 'invalid_crop' });

    const s = computeStage(plot);
    if (!s.done) {
      return res.status(400).json({ error: 'not_ripe', stage: s.stage, next_at: s.nextAt, progress_pct: s.progressPct });
    }

    // entrega colheita ao inventário AFK (select->update/insert para compat)
    const row = await get(
      `SELECT amount FROM afk_inventories WHERE player_id=$1 AND item_type=$2`,
      [playerId, cfg.yield_item]
    );
    if (row) {
      await run(
        `UPDATE afk_inventories
            SET amount = amount + $1
          WHERE player_id=$2 AND item_type=$3`,
        [cfg.yield_qty, playerId, cfg.yield_item]
      );
    } else {
      await run(
        `INSERT INTO afk_inventories (player_id, item_type, amount)
         VALUES ($1, $2, $3)`,
        [playerId, cfg.yield_item, cfg.yield_qty]
      );
    }

    // limpa o terreno
    await run(
      `UPDATE farm_plots
          SET crop_key=NULL, stage=0, planted_at=NULL, next_at=NULL
        WHERE id=$1`,
      [plot_id]
    );

    res.json({ ok: true, yield_item: cfg.yield_item, amount: cfg.yield_qty });
  } catch (e) {
    console.error('[farm/harvest]', e.message);
    res.status(500).json({ error: 'harvest_failed' });
  }
});

/** DEV ONLY: grant sementes para teste rápido
 *  desabilite em produção!
 */
router.post('/debug/grant-seed', async (req, res) => {
  try {
    if ((process.env.NODE_ENV || 'development') === 'production') {
      return res.status(403).json({ error: 'forbidden' });
    }
    const playerId = String(req.user.id || req.user.playerId || '');
    const { item_type = 'seed_wheat', amount = 5 } = req.body || {};

    const row = await get(
      `SELECT amount FROM afk_inventories WHERE player_id=$1 AND item_type=$2`,
      [playerId, item_type]
    );
    if (row) {
      await run(
        `UPDATE afk_inventories
            SET amount = amount + $1
          WHERE player_id=$2 AND item_type=$3`,
        [Number(amount) || 0, playerId, item_type]
      );
    } else {
      await run(
        `INSERT INTO afk_inventories (player_id, item_type, amount)
         VALUES ($1, $2, $3)`,
        [playerId, item_type, Number(amount) || 0]
      );
    }
    res.json({ ok: true, item_type, amount: Number(amount) || 0 });
  } catch (e) {
    res.status(500).json({ error: 'debug_grant_failed' });
  }
});

module.exports = router;
