// server/routes/combat_nearest.js
const express = require('express');
const router = express.Router();
const { get } = require('../models/db');

const DEBUG = process.env.COMBAT_DEBUG === '1';

// log simples só para caminhos de combate
router.use((req, _res, next) => {
  if (req.path.startsWith('/api/combat')) {
    console.log('[combat]', req.method, req.originalUrl);
  }
  next();
});

/**
 * GET /api/combat/nearest?map=house&x=..&y=..
 *
 * Regras:
 * - Não cria/reativa nada; só escolhe UMA instância ALIVE mais próxima.
 * - Usa (mi.x, mi.y) se existir; senão, centro do spawn (s.x + s.w/2, s.y + s.h/2).
 * - Se a distância for maior que o raio, retorna 404.
 *
 * 200 => { id, x, y, monsterKey, hp, maxHp }
 * 404 => { error: 'no-alive' | 'no-alive-near' }
 */
router.get('/api/combat/nearest', async (req, res) => {
  try {
    const mapKey = String(req.query.map || 'house');
    const x = Number(req.query.x);
    const y = Number(req.query.y);

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return res.status(400).json({ error: 'bad-coords' });
    }

    // raio de seleção (3 tiles se TILE=32)
    const MAX_PICK = 96;
    const MAX2 = MAX_PICK * MAX_PICK;

    // COALESCE robusto:
    // - posição da instância (mi.x/mi.y)
    // - centro do spawn (s.x + s.w/2) com coalesce de s.w/h e s.x/y
    // - por último, 0 (nunca deixa null)
    const m = await get(
      `
      SELECT
        mi.id,
        mi.hp,
        mi.max_hp       AS "maxHp",
        s."monsterKey"  AS "monsterKey",
        COALESCE(
          mi.x,
          COALESCE(s.x, 0) + COALESCE(NULLIF(s.w, 0), 1) / 2.0,
          0
        ) AS "ix",
        COALESCE(
          mi.y,
          COALESCE(s.y, 0) + COALESCE(NULLIF(s.h, 0), 1) / 2.0,
          0
        ) AS "iy"
      FROM monster_instances mi
      JOIN spawns s ON s.id = mi.spawn_id
      WHERE mi.state = 'ALIVE'
        AND s."mapKey" = $1
      ORDER BY (
        (COALESCE(mi.x, COALESCE(s.x, 0) + COALESCE(NULLIF(s.w,0),1)/2.0) - $2) *
        (COALESCE(mi.x, COALESCE(s.x, 0) + COALESCE(NULLIF(s.w,0),1)/2.0) - $2)
        +
        (COALESCE(mi.y, COALESCE(s.y, 0) + COALESCE(NULLIF(s.h,0),1)/2.0) - $3) *
        (COALESCE(mi.y, COALESCE(s.y, 0) + COALESCE(NULLIF(s.h,0),1)/2.0) - $3)
      ) ASC
      LIMIT 1
      `,
      [mapKey, x, y]
    );

    if (!m) {
      if (DEBUG) console.log('[combat/nearest] nenhum ALIVE no mapa', { mapKey });
      return res.status(404).json({ error: 'no-alive' });
    }

    const at = { x: Number(m.ix) || 0, y: Number(m.iy) || 0 };
    const dx = at.x - x;
    const dy = at.y - y;
    const dist2 = dx * dx + dy * dy;

    if (dist2 > MAX2) {
      if (DEBUG) console.log('[combat/nearest] fora do raio', { click: { x, y }, at, dist2 });
      return res.status(404).json({ error: 'no-alive-near' });
    }

    const payload = {
      id: m.id,
      x: at.x,
      y: at.y,
      monsterKey: m.monsterKey || null,
      hp: Number(m.hp) || 0,
      maxHp: Number(m.maxHp) || 0,
    };

    if (DEBUG) console.log('[combat/nearest] OK', {
      pickedId: m.id,
      click: { x, y },
      at,
      hp: payload.hp,
      maxHp: payload.maxHp
    });

    return res.json(payload);
  } catch (e) {
    console.error('[combat/nearest] error:', e);
    return res.status(500).json({ error: 'nearest-failed' });
  }
});

module.exports = router;
