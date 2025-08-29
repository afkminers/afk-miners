// server/starter/routes.js
const express = require('express');
const { randomUUID } = require('crypto');
const { get, all, run } = require('../models/db');
const { requireAuth } = require('../auth/middleware');

async function isHeroKeyGenerated() {
  // Detecta se a coluna "heroKey" é gerada (ALWAYS) no Postgres
  // Retorna true/false
  try {
    const row = await get(`
      SELECT is_generated
        FROM information_schema.columns
       WHERE table_name = 'player_heroes'
         AND column_name = 'heroKey'
       LIMIT 1
    `);
    return String(row?.is_generated || '').toUpperCase() === 'ALWAYS';
  } catch {
    return false;
  }
}

function buildStarterRouter() {
  const router = express.Router();
  router.use(requireAuth);

  /* ---------------- Lista de starters (pode migrar p/ BD depois) ---------------- */
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

  /* ---------------- Checar se já tem starter ---------------- */
  router.get('/status', async (req, res) => {
    try {
      const playerId = req.user.id;
      const row = await get(
        `SELECT 1
           FROM player_heroes
          WHERE "playerId" = $1 AND "isStarter" = TRUE
          LIMIT 1`,
        [playerId]
      );
      res.json({ canSelect: !row });
    } catch (err) {
      console.error('[starter] status error:', err);
      res.status(500).json({ error: 'erro ao checar status do starter' });
    }
  });

  /* ---------------- Selecionar starter ---------------- */
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
          WHERE "playerId" = $1 AND "isStarter" = TRUE
          LIMIT 1`,
        [playerId]
      );
      if (exists) {
        return res.status(400).json({ error: 'starter já escolhido' });
      }

      // valida heroKey no catálogo (heroes_master)
      const master = await get(
        `SELECT "heroKey", name, rarity, class, role, element, attack_type, weapon_pref
           FROM heroes_master
          WHERE "heroKey" = $1`,
        [heroKey]
      );
      if (!master) {
        return res.status(400).json({ error: 'heroKey inválido' });
      }

      // Stats iniciais básicos (ajuste como quiser)
      const baseAttack = 1;
      const baseDefense = 1;
      const baseSpeed = 1;
      const level = 1;

      const id = randomUUID();

      // Detecta se "heroKey" é coluna gerada
      const heroKeyIsGenerated = await isHeroKeyGenerated();

      if (heroKeyIsGenerated) {
        // Caso "heroKey" seja GERADA (ALWAYS), NÃO podemos inserir nela.
        // Estratégia: salvar name = heroKey curto, para a coluna gerada casar.
        await run(
          `INSERT INTO player_heroes
             (id, "playerId", name,     rarity,     attack,     defense,     speed,     level, "createdAt", "updatedAt", "isStarter")
           VALUES
             ($1,  $2,        $3,       $4,         $5,         $6,          $7,        $8,    NOW(),       NOW(),       TRUE)`,
          [
            id,
            playerId,
            heroKey,                 // name curto
            master.rarity || 'COMMON',
            baseAttack,
            baseDefense,
            baseSpeed,
            level,
          ]
        );
      } else {
        // heroKey normal (não gerada): inserir explicitamente "heroKey"
        await run(
          `INSERT INTO player_heroes
             (id, "playerId", "heroKey", name,   rarity,     attack,     defense,     speed,     level, "createdAt", "updatedAt", "isStarter")
           VALUES
             ($1,  $2,        $3,        $4,     $5,         $6,         $7,          $8,        $9,    NOW(),       NOW(),       TRUE)`,
          [
            id,
            playerId,
            heroKey,
            master.name || heroKey,  // fallback pro nome do catálogo
            master.rarity || 'COMMON',
            baseAttack,
            baseDefense,
            baseSpeed,
            level,
          ]
        );
      }

      // Retorno básico
      res.json({ ok: true, id, heroKey });
    } catch (err) {
      // Duplicado (já escolheu starter) ou conflito de unique
      const msg = String(err?.message || '').toLowerCase();
      if (msg.includes('duplicate key') || msg.includes('unique')) {
        return res.status(400).json({ error: 'starter já escolhido' });
      }
      if (msg.includes('generated column') || msg.includes('428c9')) {
        return res.status(400).json({ error: 'schema indica heroKey gerada — tente novamente; já ajustamos para não inserir nela.' });
      }
      console.error('[starter] select error:', err);
      res.status(500).json({ error: 'erro ao selecionar starter' });
    }
  });

  return router;
}

module.exports = buildStarterRouter;
