// server/routes/combat_nearest.js
const express = require('express');
const router = express.Router();
const { get, run } = require('../models/db');

// log simples p/ debug
router.use((req, _res, next) => {
  if (req.path.startsWith('/api/combat')) {
    console.log('[combat]', req.method, req.originalUrl);
  }
  next();
});

const n = v => (Number.isFinite(+v) ? +v : null);

/**
 * GET /api/combat/nearest?map=house&x=..&y=..
 * - Procura uma instância ALIVE mais próxima; se não existir, usa o spawn mais perto
 *   e cria/reativa garantindo monster_id e HP cheio.
 * - Retorna { id, x, y, monsterKey }
 */
router.get('/api/combat/nearest', async (req, res) => {
  const mapKey = String(req.query.map || 'house');
  const px = n(req.query.x), py = n(req.query.y);
  if (px == null || py == null) {
    return res.status(400).json({ error: 'bad-coord' });
  }

  try {
    // 1) Tenta uma instância ALIVE existente (posição vem do spawn)
    const alive = await get(
      `
      SELECT mi.id, s.x, s.y, s."monsterKey"
        FROM monster_instances mi
        JOIN spawns s ON s.id = mi.spawn_id
       WHERE mi.state = 'ALIVE'
         AND s."mapKey" = $1
       ORDER BY ((s.x - $2)*(s.x - $2) + (s.y - $3)*(s.y - $3)) ASC
       LIMIT 1
      `,
      [mapKey, px, py]
    );

    if (alive) {
      return res.json({
        id: alive.id,
        x: Number(alive.x) || 0,
        y: Number(alive.y) || 0,
        monsterKey: alive.monsterKey || null,
      });
    }

    // 2) Spawn mais perto (precisa ter monsterKey válido e existir na master)
    const spawn = await get(
      `
      SELECT s.id,
             s.x, s.y,
             s."monsterKey",
             mm.id  AS monster_id,
             COALESCE(mm."healthMax", 1) AS hp_full
        FROM spawns s
   LEFT JOIN monsters_master mm
          ON mm.key = s."monsterKey"
       WHERE s."mapKey" = $1
         AND NULLIF(s."monsterKey",'') IS NOT NULL
       ORDER BY ((s.x - $2)*(s.x - $2) + (s.y - $3)*(s.y - $3)) ASC
       LIMIT 1
      `,
      [mapKey, px, py]
    );

    if (!spawn) return res.status(404).json({ error: 'no-spawns' });
    if (!spawn.monster_id) {
      // Spawn aponta pra um monsterKey que não existe na master
      return res.status(500).json({ error: 'monster-master-missing', monsterKey: spawn.monsterKey });
    }

    // Existe alguma instância desse spawn (mesmo antiga)?
    const anyInst = await get(
      `
      SELECT id, state,
             COALESCE(max_hp, 0) AS max_hp,  -- não referencia "hpMax"
             monster_id
        FROM monster_instances
       WHERE spawn_id = $1
       ORDER BY id ASC
       LIMIT 1
      `,
      [spawn.id]
    );

    const fullHp = Math.max(Number(spawn.hp_full) || 1, 1);
    let instanceId;

    if (anyInst) {
      // Reativar/normalizar: garante monster_id e HP cheio
      const hp = Math.max(Number(anyInst.max_hp) || 0, fullHp);
      await run(
        `
        UPDATE monster_instances
           SET state='ALIVE',
               hp=$2,
               max_hp=$2,
               map_key=$3,
               monster_id = COALESCE(monster_id, $4),
               updated_at=now()
         WHERE id=$1
        `,
        [anyInst.id, hp, mapKey, spawn.monster_id]
      );
      instanceId = anyInst.id;
    } else {
      // Criar nova instância (com monster_id obrigatório)
      const created = await get(
        `
        INSERT INTO monster_instances
          (monster_id, spawn_id, map_key, state, hp, max_hp, created_at, updated_at)
        VALUES
          ($1,         $2,       $3,      'ALIVE', $4, $4,   now(),     now())
        RETURNING id
        `,
        [spawn.monster_id, spawn.id, mapKey, fullHp]
      );
      instanceId = created.id;
    }

    return res.json({
      id: instanceId,
      x: Number(spawn.x) || 0,
      y: Number(spawn.y) || 0,
      monsterKey: spawn.monsterKey || null,
    });
  } catch (e) {
    console.error('[combat/nearest] error:', e?.message || e);
    return res.status(500).json({ error: 'nearest-failed' });
  }
});

module.exports = router;
