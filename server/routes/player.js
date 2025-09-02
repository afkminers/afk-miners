// server/routes/player.js
const express = require('express');
const router = express.Router();
const { requireAuth, requireCsrf } = require('../auth/middleware');
const { get, run } = require('../models/db');

// Helpers
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function dist(a, b) { return Math.hypot((a.x - b.x), (a.y - b.y)); }

// ---- Posição (persistência simples; segura via CSRF + auth)
router.get('/pos', requireAuth, async (req, res) => {
  const row = await get(
    `SELECT x, y FROM player_last_pos WHERE player_id = $1 AND map_key = $2`,
    [req.user.id, String(req.query.map || 'house')]
  ).catch(() => null);

  if (row) return res.json({ x: row.x, y: row.y });
  // default
  return res.json({ x: 64, y: 64 });
});

router.post('/pos', requireAuth, requireCsrf, async (req, res) => {
  const { mapKey, x, y } = req.body || {};
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return res.status(400).json({ error: 'coords inválidas' });
  }
  const map = String(mapKey || 'house');

  await run(
    `
    INSERT INTO player_last_pos(player_id, map_key, x, y, updated_at)
    VALUES ($1,$2,$3,$4, now())
    ON CONFLICT (player_id, map_key) DO UPDATE SET
      x=EXCLUDED.x, y=EXCLUDED.y, updated_at=now()
    `,
    [req.user.id, map, Math.round(x), Math.round(y)]
  );

  res.json({ ok: true });
});

// ---- Movimento servidor-autoridade básico (opcional, para evoluir)
router.post('/move', requireAuth, requireCsrf, async (req, res) => {
  const { seq, type, tx, ty, mapKey } = req.body || {};
  const map = String(mapKey || 'house');

  // carrega última pos / seq
  const row = await get(
    `SELECT x, y, COALESCE(last_seq,0) AS last_seq
       FROM player_last_pos WHERE player_id=$1 AND map_key=$2`,
    [req.user.id, map]
  ).catch(() => null);

  let x = row?.x ?? 64;
  let y = row?.y ?? 64;
  const lastSeq = row?.last_seq ?? 0;

  if (!Number.isFinite(seq) || seq <= lastSeq) {
    return res.status(409).json({ error: 'old-seq' });
  }

  // regras simples
  const vmax = 160; // px/s (ajuste pelo herói)
  const dt = 0.12;  // janela simulada (120 ms)
  const step = vmax * dt;

  if (type === 'click' && Number.isFinite(tx) && Number.isFinite(ty)) {
    const dx = tx - x, dy = ty - y;
    const d = Math.hypot(dx, dy) || 1e-6;
    const nx = x + (dx / d) * step;
    const ny = y + (dy / d) * step;

    // aqui você pode consultar grid de colisão do mapa no servidor
    x = clamp(nx, 0, 99999);
    y = clamp(ny, 0, 99999);
  }

  // anti-teleporte simples: no máximo 1.5x step
  if (dist({ x, y }, { x: row?.x ?? 64, y: row?.y ?? 64 }) > step * 1.5) {
    return res.status(400).json({ error: 'too-fast' });
  }

  await run(
    `
    INSERT INTO player_last_pos(player_id, map_key, x, y, last_seq, updated_at)
    VALUES ($1,$2,$3,$4,$5, now())
    ON CONFLICT (player_id, map_key) DO UPDATE SET
      x=EXCLUDED.x, y=EXCLUDED.y, last_seq=EXCLUDED.last_seq, updated_at=now()
    `,
    [req.user.id, map, Math.round(x), Math.round(y), seq]
  );

  res.json({ ok: true, x, y, seq });
});

module.exports = router;
