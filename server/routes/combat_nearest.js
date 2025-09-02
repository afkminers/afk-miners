// server/routes/combat_nearest.js
const express = require('express');
const router = express.Router();
const { get } = require('../models/db');

// Log simples pra depurar chamadas de combate
router.use((req, _res, next) => {
  if (req.path.startsWith('/api/combat')) {
    console.log('[combat]', req.method, req.originalUrl);
  }
  next();
});

/**
 * GET /api/combat/nearest?map=house&x=..&y=..
 *
 * Regras "Tibia-like":
 * - NUNCA cria/reativa monstro ao clicar.
 * - Retorna UMA instância ALIVE mais próxima, se estiver no raio.
 * - Se não houver bicho vivo perto, retorna 404.
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

    // 3 tiles se TILE = 32px
    const MAX_PICK = 96; // px
    const MAX2 = MAX_PICK * MAX_PICK;

    // Instância viva mais próxima (usa posição do spawn)
    const m = await get(
      `
      SELECT mi.id, mi.hp, mi.max_hp,
             s.x, s.y, s."monsterKey"
        FROM monster_instances mi
        JOIN spawns s ON s.id = mi.spawn_id
       WHERE mi.state = 'ALIVE'
         AND s."mapKey" = $1
       ORDER BY ((s.x - $2)*(s.x - $2) + (s.y - $3)*(s.y - $3)) ASC
       LIMIT 1
      `,
      [mapKey, x, y]
    );

    if (!m) {
      return res.status(404).json({ error: 'no-alive' });
    }

    const dx = Number(m.x) - x;
    const dy = Number(m.y) - y;
    if (dx * dx + dy * dy > MAX2) {
      return res.status(404).json({ error: 'no-alive-near' });
    }

    return res.json({
      id: m.id,
      x: Number(m.x) || 0,
      y: Number(m.y) || 0,
      monsterKey: m.monsterKey || null,
      hp: Number(m.hp) || 0,
      maxHp: Number(m.max_hp) || 0,
    });
  } catch (e) {
    console.error('[combat/nearest] error:', e);
    return res.status(500).json({ error: 'nearest-failed' });
  }
});

module.exports = router;
