// server/routes/combat_nearest.js
const express = require('express');
const router = express.Router();
const { get, run } = require('../models/db');

// Log simples para depurar chamadas de combate
router.use((req, _res, next) => {
  if (req.path.startsWith('/api/combat')) {
    console.log('[combat]', req.method, req.originalUrl);
  }
  next();
});

/**
 * GET /api/combat/nearest?map=house&x=..&y=..
 *
 * Fluxo:
 * 1) Procura UMA monster_instance ALIVE mais próxima (distância baseada no spawn).
 * 2) Se não houver, escolhe o spawn mais próximo com monsterKey válida e:
 *    2.1) Se já existir instância para esse spawn, reativa (ALIVE, hp=max_hp).
 *    2.2) Caso contrário, cria nova instância (hp = healthMax do monsters_master).
 *
 * Sem requireAuth de propósito: só seleção de alvo.
 */
router.get('/api/combat/nearest', async (req, res) => {
  try {
    const mapKey = String(req.query.map || 'house');
    const x = Number(req.query.x || 0);
    const y = Number(req.query.y || 0);

    // 1) Tenta achar uma instância viva mais próxima (posição herdada do spawn)
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
      [mapKey, x, y]
    );

    if (alive) {
      return res.json({
        id: alive.id,
        x: Number(alive.x) || 0,
        y: Number(alive.y) || 0,
        monsterKey: alive.monsterKey || null,
      });
    }

    // 2) Pega o spawn mais próximo com monsterKey válida + healthMax do catálogo
    const spawn = await get(
      `
      SELECT s.id,
             s.x, s.y,
             s."monsterKey",
             COALESCE(mm."healthMax", 1) AS hp_full
        FROM spawns s
   LEFT JOIN monsters_master mm
          ON mm.key = s."monsterKey"
       WHERE s."mapKey" = $1
         AND NULLIF(s."monsterKey",'') IS NOT NULL
       ORDER BY ((s.x - $2)*(s.x - $2) + (s.y - $3)*(s.y - $3)) ASC
       LIMIT 1
      `,
      [mapKey, x, y]
    );

    if (!spawn) {
      return res.status(404).json({ error: 'no-spawns' });
    }

    // Já existe alguma instância (mesmo que morta) desse spawn?
    const anyInst = await get(
      `SELECT id, state, COALESCE(max_hp,0) AS max_hp
         FROM monster_instances
        WHERE spawn_id = $1
        ORDER BY id ASC
        LIMIT 1`,
      [spawn.id]
    );

    const fullHp = Math.max(Number(spawn.hp_full) || 1, 1);
    let instanceId;

    if (anyInst) {
      // Reativar a instância reaproveitada desse spawn
      const hp = Math.max(Number(anyInst.max_hp) || 0, fullHp);
      await run(
        `UPDATE monster_instances
            SET state='ALIVE',
                hp=$2,
                max_hp=$2,
                respawn_at=NULL,
                last_hit_hero_id=NULL,
                last_hit_at=NULL,
                updated_at=now()
          WHERE id=$1`,
        [anyInst.id, hp]
      );
      instanceId = anyInst.id;
    } else {
      // Criar nova instância; tenta com monster_id (se o schema exigir), senão sem
      // Primeiro: com monster_id (compatível com NOT NULL)
      try {
        const created = await get(
          `
          INSERT INTO monster_instances
            (spawn_id, monster_id, map_key, state, hp, max_hp, created_at, updated_at)
          VALUES (
            $1,
            (SELECT id FROM monsters_master WHERE key = $2),
            $3,
            'ALIVE',
            $4, $4,
            now(), now()
          )
          RETURNING id
          `,
          [spawn.id, spawn.monsterKey, mapKey, fullHp]
        );
        instanceId = created.id;
      } catch (err) {
        // Se a coluna monster_id não existir no schema, faz INSERT sem ela
        if (/column\s+"?monster_id"?\s+does not exist/i.test(err.message)) {
          const createdNoMonsterId = await get(
            `
            INSERT INTO monster_instances
              (spawn_id, map_key, state, hp, max_hp, created_at, updated_at)
            VALUES ($1, $2, 'ALIVE', $3, $3, now(), now())
            RETURNING id
            `,
            [spawn.id, mapKey, fullHp]
          );
          instanceId = createdNoMonsterId.id;
        } else {
          throw err;
        }
      }
    }

    // Responde com a posição do spawn (onde o mob nasce)
    return res.json({
      id: instanceId,
      x: Number(spawn.x) || 0,
      y: Number(spawn.y) || 0,
      monsterKey: spawn.monsterKey || null,
    });
  } catch (e) {
    console.error('[combat/nearest] error:', e.message);
    return res.status(500).json({ error: 'nearest-failed' });
  }
});

module.exports = router;
