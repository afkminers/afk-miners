// server/routes/player.js
const express = require('express');
const router = express.Router();
const { requireAuth, requireCsrf } = require('../auth/middleware');
const { all, get, run } = require('../models/db');

/* ===========================================================
   Helpers
=========================================================== */
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function dist(a, b) { return Math.hypot((a.x - b.x), (a.y - b.y)); }

function norm(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    playerId: String(row.player_id ?? row.playerId ?? ''),
    isStarter: !!(row.is_starter ?? row.isStarter),
    name: row.name ?? null,
    heroKey: row.hero_key ?? row.heroKey ?? null,
    createdAt: row.created_at ?? row.createdAt ?? null,
  };
}

async function queryHeroesFor(playerId) {
  // 1) tenta player_heroes_snake
  try {
    const rows = await all(
      `SELECT id, player_id, is_starter, name, hero_key, created_at
         FROM player_heroes_snake
        WHERE player_id=$1
        ORDER BY created_at DESC`,
      [playerId]
    );
    return rows.map(norm);
  } catch (_) {}

  // 2) fallback player_heroes (camelCase)
  const rows = await all(
    `SELECT id, "playerId", "isStarter", name, "heroKey", "createdAt"
       FROM player_heroes
      WHERE "playerId"=$1
      ORDER BY "createdAt" DESC`,
    [playerId]
  );
  return rows.map(norm);
}

/* ===========================================================
   HERO ROUTES
=========================================================== */

// Lista todos os heróis do jogador
router.get('/heroes', requireAuth, async (req, res) => {
  try {
    const heroes = await queryHeroesFor(req.user.id);
    res.json(heroes);
  } catch (e) {
    console.warn('[api] GET /api/player/heroes failed:', e.message);
    res.status(500).json({ error: 'server-error' });
  }
});

// Herói ativo (starter ou mais recente)
router.get('/hero/active', requireAuth, async (req, res) => {
  try {
    const heroes = await queryHeroesFor(req.user.id);
    const starter = heroes.find(h => h.isStarter) || heroes[0] || null;
    if (!starter) return res.status(404).json({ error: 'no-heroes' });
    res.json(starter);
  } catch (e) {
    console.warn('[api] GET /api/player/hero/active failed:', e.message);
    res.status(500).json({ error: 'server-error' });
  }
});

// Alias para active
router.get('/hero/mine', requireAuth, async (req, res) => {
  try {
    const heroes = await queryHeroesFor(req.user.id);
    const starter = heroes.find(h => h.isStarter) || heroes[0] || null;
    if (!starter) return res.status(404).json({ error: 'no-heroes' });
    res.json(starter);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Alguns clientes esperam /characters/mine
router.get('/characters/mine', requireAuth, async (req, res) => {
  try {
    const heroes = await queryHeroesFor(req.user.id);
    res.json(heroes);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Seleciona qual herói é starter
router.post('/hero/select', requireAuth, requireCsrf, async (req, res) => {
  try {
    const heroId = String(req.body?.heroId || '');
    if (!heroId) return res.status(400).json({ error: 'heroId requerido' });

    // valida ownership no snake
    const ownerSnake = await get(
      `SELECT player_id FROM player_heroes_snake WHERE id=$1`,
      [heroId]
    ).catch(() => null);

    let ownerId = ownerSnake?.player_id ?? null;

    if (!ownerId) {
      const ownerCamel = await get(
        `SELECT "playerId" AS player_id FROM player_heroes WHERE id=$1`,
        [heroId]
      ).catch(() => null);
      ownerId = ownerCamel?.player_id ?? null;
    }

    if (!ownerId || String(ownerId) !== String(req.user.id)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    // Zera starter e seta o novo nas duas variantes
    await run(`UPDATE player_heroes_snake SET is_starter=false WHERE player_id=$1`, [req.user.id]).catch(() => {});
    await run(`UPDATE player_heroes_snake SET is_starter=true  WHERE id=$1`, [heroId]).catch(() => {});

    await run(`UPDATE player_heroes SET "isStarter"=false WHERE "playerId"=$1`, [req.user.id]).catch(() => {});
    await run(`UPDATE player_heroes SET "isStarter"=true  WHERE id=$1`, [heroId]).catch(() => {});

    res.json({ ok: true, heroId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ===========================================================
   POSIÇÃO / MOVIMENTO
=========================================================== */

// última posição
router.get('/pos', requireAuth, async (req, res) => {
  const row = await get(
    `SELECT x, y FROM player_last_pos WHERE player_id=$1 AND map_key=$2`,
    [req.user.id, String(req.query.map || 'house')]
  ).catch(() => null);

  if (row) return res.json({ x: row.x, y: row.y });
  return res.json({ x: 64, y: 64 });
});

// salvar posição
router.post('/pos', requireAuth, requireCsrf, async (req, res) => {
  const { mapKey, x, y } = req.body || {};
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return res.status(400).json({ error: 'coords inválidas' });
  }
  const map = String(mapKey || 'house');

  await run(
    `INSERT INTO player_last_pos(player_id, map_key, x, y, updated_at)
     VALUES ($1,$2,$3,$4, now())
     ON CONFLICT (player_id, map_key) DO UPDATE SET
       x=EXCLUDED.x, y=EXCLUDED.y, updated_at=now()`,
    [req.user.id, map, Math.round(x), Math.round(y)]
  );

  res.json({ ok: true });
});

// movimento simples
router.post('/move', requireAuth, requireCsrf, async (req, res) => {
  const { seq, type, tx, ty, mapKey } = req.body || {};
  const map = String(mapKey || 'house');

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

  const vmax = 160;
  const dt = 0.12;
  const step = vmax * dt;

  if (type === 'click' && Number.isFinite(tx) && Number.isFinite(ty)) {
    const dx = tx - x, dy = ty - y;
    const d = Math.hypot(dx, dy) || 1e-6;
    const nx = x + (dx / d) * step;
    const ny = y + (dy / d) * step;
    x = clamp(nx, 0, 99999);
    y = clamp(ny, 0, 99999);
  }

  if (dist({ x, y }, { x: row?.x ?? 64, y: row?.y ?? 64 }) > step * 1.5) {
    return res.status(400).json({ error: 'too-fast' });
  }

  await run(
    `INSERT INTO player_last_pos(player_id, map_key, x, y, last_seq, updated_at)
     VALUES ($1,$2,$3,$4,$5, now())
     ON CONFLICT (player_id, map_key) DO UPDATE SET
       x=EXCLUDED.x, y=EXCLUDED.y, last_seq=EXCLUDED.last_seq, updated_at=now()`,
    [req.user.id, map, Math.round(x), Math.round(y), seq]
  );

  res.json({ ok: true, x, y, seq });
});

module.exports = router;
