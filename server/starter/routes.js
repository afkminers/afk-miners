// server/starter/routes.js
const express = require('express');
const { randomUUID } = require('crypto');
const { get, run } = require('../models/db'); // helpers unificados (PG)

function buildStarterRouter() {
  const router = express.Router();

  // Lista estática de starters (pode migrar para BD quando quiser)
  router.get('/list', async (_req, res) => {
    try {
      const starters = [
        {
          heroKey: 'aric',
          name: 'Aric, the Swordsman',
          rarity: 'COMMON',
          class: 'KNIGHT',
          role: 'DPS',
          element: 'NEUTRAL',
          attack_type: 'MELEE',
          weapon_pref: 'sword',
          spriteKey: 'knight_v1',
        },
        {
          heroKey: 'brokk',
          name: 'Brokk, the Dwarf',
          rarity: 'COMMON',
          class: 'KNIGHT',
          role: 'TANK',
          element: 'EARTH',
          attack_type: 'MELEE',
          weapon_pref: 'hammer_shield',
          spriteKey: 'dwarf_v1',
        },
        {
          heroKey: 'lyria',
          name: 'Lyria, the Archer',
          rarity: 'COMMON',
          class: 'PALADIN',
          role: 'DPS',
          element: 'NATURE',
          attack_type: 'RANGED',
          weapon_pref: 'bow',
          spriteKey: 'archer_v1',
        },
      ];
      res.json(starters);
    } catch (err) {
      console.error('[starter] list error:', err);
      res.status(500).json({ error: 'erro ao listar starters' });
    }
  });

  // Pode escolher starter?
  router.get('/status', async (req, res) => {
    try {
      const playerId = req.user.id;
      const row = await get(
        `SELECT 1
           FROM player_heroes
          WHERE playerId = $1 AND isStarter = TRUE
          LIMIT 1`,
        [playerId]
      );
      res.json({ canSelect: !row });
    } catch (err) {
      console.error('[starter] status error:', err);
      res.status(500).json({ error: 'erro ao checar status do starter' });
    }
  });

  // Escolher starter
  router.post('/select', async (req, res) => {
    try {
      const playerId = req.user.id;
      const { heroKey } = req.body || {};
      if (!heroKey) {
        return res.status(400).json({ error: 'heroKey é obrigatório' });
      }

      // já tem starter?
      const exists = await get(
        `SELECT 1
           FROM player_heroes
          WHERE playerId = $1 AND isStarter = TRUE
          LIMIT 1`,
        [playerId]
      );
      if (exists) {
        return res.status(400).json({ error: 'starter já escolhido' });
      }

      const id = randomUUID();
      const createdAt = Date.now();

      // Insere herói starter com stats básicos
      await run(
        `INSERT INTO player_heroes
           (id, playerId, heroKey, name, rarity, attack, defense, speed, level, createdAt, isStarter)
         VALUES
           ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE)`,
        [
          id,
          playerId,
          heroKey,
          heroKey.toUpperCase(), // nome padrão
          'COMMON',
          1, 1, 1,                // attack, defense, speed
          1,                      // level inicial
          createdAt,
        ]
      );

      res.json({ ok: true, heroKey, id });
    } catch (err) {
      // Conflitos de chave única podem vir com mensagens diferentes em PG
      if (String(err.message || '').toLowerCase().includes('duplicate key')) {
        return res.status(400).json({ error: 'starter já escolhido' });
      }
      console.error('[starter] select error:', err);
      res.status(500).json({ error: 'erro ao selecionar starter' });
    }
  });

  return router;
}

module.exports = buildStarterRouter;