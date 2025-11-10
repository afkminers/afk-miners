// server/starter/routes.js
const express = require('express');
const { randomUUID } = require('crypto');
const { get, run } = require('../models/db');
const { requireAuth } = require('../auth/middleware');
const { ensureHeroSkills } = require('../models/hero_extra');
const { computeHeroStats } = require('../services/heroStats'); // <- NOVO: importa cálculo dinâmico
const { getStartPoint } = require('../services/spawnPoint');

async function isHeroKeyGenerated() {
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

async function hasHpColumns() {
  try {
    const row = await get(`
      SELECT COUNT(*) AS ct
        FROM information_schema.columns
       WHERE table_name = 'player_heroes'
         AND column_name IN ('hp','max_hp')
    `);
    return Number(row?.ct || 0) >= 2;
  } catch {
    return false;
  }
}

function buildStarterRouter() {
  const router = express.Router();
  router.use(requireAuth);

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
          // arte grande do card 400x600
          cardImage: 'img/heroes/cards/aric_card_400x600.png',
          // lore curtinha
          story: 'Aric cresceu defendendo as entradas das minas. É um espadachim equilibrado, ótimo para quem está começando.',
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
          cardImage: 'img/heroes/cards/brokk_card_400x600.png',
          story: 'Brokk é um anão teimoso que não recua. Ele segura a linha de frente enquanto o resto da party faz o estrago.',
        },
        {
          heroKey: 'lyria',
          name: 'Lyria, the Archer',
          rarity: 'COMMON',
          class: 'ARCHER',
          role: 'DPS',
          element: 'NATURE',
          attack_type: 'RANGED',
          weapon_pref: 'bow',
          spriteKey: 'archer_v1',
          cardImage: 'img/heroes/cards/lyria_card_400x600.png',
          story: 'Lyria aprendeu a atirar em alvos nas florestas ao redor das minas. Causa muito dano à distância, mas precisa se manter segura.',
        },
      ];

      res.json(starters);
    } catch (err) {
      console.error('[starter] list error:', err);
      res.status(500).json({ error: 'erro ao listar starters' });
    }
  });

  router.get('/status', async (req, res) => {
    try {
      const playerId = req.user.id;
      const row = await get(
        `SELECT 1
           FROM player_heroes
          WHERE "playerId" = $1
            AND "isStarter" = TRUE
          LIMIT 1`,
        [playerId]
      );
      res.json({ canSelect: !row });
    } catch (err) {
      console.error('[starter] status error:', err);
      res.status(500).json({ error: 'erro ao checar status do starter' });
    }
  });

  router.post('/select', async (req, res) => {
    const playerId = req.user.id;

    try {
      const { heroKey } = req.body || {};
      if (!heroKey) {
        return res.status(400).json({ error: 'heroKey é obrigatório' });
      }

      const exists = await get(
        `SELECT 1
           FROM player_heroes
          WHERE "playerId" = $1
            AND "isStarter" = TRUE
          LIMIT 1`,
        [playerId]
      );
      if (exists) {
        return res.status(400).json({ error: 'starter já escolhido' });
      }

      const master = await get(
        `SELECT "heroKey", name, rarity, class, role, element, attack_type, weapon_pref
           FROM heroes_master
          WHERE "heroKey" = $1`,
        [heroKey]
      );
      if (!master) {
        return res.status(400).json({ error: 'heroKey inválido' });
      }

      const baseAttack = 1;
      const baseDefense = 1;
      const baseSpeed = 1;
      const level = 1;
      const rarity = master.rarity || 'COMMON';

      // NOVO: Cálculo dinâmico de status máximo via computeHeroStats
      let maxHp = null, maxMana = null, maxCap = null;
      try {
        const stats = await computeHeroStats({
          level,
          heroKey,
          class: master.class
        });
        maxHp = stats.maxHp;
        maxMana = stats.maxMana;
        maxCap = stats.maxCap;
      } catch (e) {
        // fallback de segurança para nunca quebrar o fluxo
        maxHp = 100 + (level - 1) * 5 + baseDefense * 2;
        maxMana = 50;
        maxCap = 470;
        console.warn('[starter] computeHeroStats falhou, usando fallback:', e?.message);
      }

      const id = randomUUID();

      const heroKeyIsGenerated = await isHeroKeyGenerated();
      const hpCols = await hasHpColumns();

      // === INÍCIO DA TRANSAÇÃO ===
      await run("BEGIN");
      try {
        // INSERT HERO
        if (heroKeyIsGenerated) {
          if (hpCols) {
            await run(
              `INSERT INTO player_heroes
                 (id, "playerId", name, rarity, attack, defense, speed, level,
                  "createdAt", "updatedAt", "isStarter", hp, max_hp, mana, max_mana)
               VALUES
                 ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW(),TRUE,$9,$10,$11,$12)`,
              [
                id,
                playerId,
                heroKey,
                rarity,
                baseAttack,
                baseDefense,
                baseSpeed,
                level,
                maxHp,
                maxHp,
                maxMana,
                maxMana
              ]
            );
          } else {
            await run(
              `INSERT INTO player_heroes
                 (id, "playerId", name, rarity, attack, defense, speed, level,
                  "createdAt", "updatedAt", "isStarter")
               VALUES
                 ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW(),TRUE)`,
              [
                id,
                playerId,
                heroKey,
                rarity,
                baseAttack,
                baseDefense,
                baseSpeed,
                level
              ]
            );
          }
        } else {
          if (hpCols) {
            await run(
              `INSERT INTO player_heroes
                 (id, "playerId", "heroKey", name, rarity, attack, defense, speed, level,
                  "createdAt", "updatedAt", "isStarter", hp, max_hp, mana, max_mana)
               VALUES
                 ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW(),TRUE,$10,$11,$12,$13)`,
              [
                id,
                playerId,
                heroKey,
                master.name || heroKey,
                rarity,
                baseAttack,
                baseDefense,
                baseSpeed,
                level,
                maxHp,
                maxHp,
                maxMana,
                maxMana
              ]
            );
          } else {
            await run(
              `INSERT INTO player_heroes
                 (id, "playerId", "heroKey", name, rarity, attack, defense, speed, level,
                  "createdAt", "updatedAt", "isStarter")
               VALUES
                 ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW(),TRUE)`,
              [
                id,
                playerId,
                heroKey,
                master.name || heroKey,
                rarity,
                baseAttack,
                baseDefense,
                baseSpeed,
                level
              ]
            );
          }
        }

        // GARANTE SKILLS BASE
        await ensureHeroSkills(id);

        // AUTO-EQUIP ARMA
        const weaponByHeroKey = {
          lyria: 'starter_bow',
          aric: 'starter_sword',
          brokk: 'starter_sword'
        };
        const starterItem = weaponByHeroKey[String(heroKey).toLowerCase()] || null;

        if (starterItem) {
          try {
            await run(
              `INSERT INTO player_inventories (player_id, item_key, qty)
               VALUES ($1,$2,1)
               ON CONFLICT (player_id, item_key) DO NOTHING`,
              [playerId, starterItem]
            );

            await run(
              `INSERT INTO hero_equipment (hero_id, slot, item_key)
               VALUES ($1,'WEAPON',$2)
               ON CONFLICT (hero_id, slot)
               DO UPDATE SET item_key = EXCLUDED.item_key, updated_at = now()`,
              [id, starterItem]
            );
          } catch (e) {
            console.warn('[starter] auto-equip weapon falhou:', e?.message);
          }
        }

        // AUTO-EQUIP BAG
        const STARTER_BAG_KEY = 'bag_brown';
        try {
          await run(
            `INSERT INTO player_inventories (player_id, item_key, qty)
             VALUES ($1,$2,1)
             ON CONFLICT (player_id, item_key) DO NOTHING`,
            [playerId, STARTER_BAG_KEY]
          );

          await run(
            `INSERT INTO hero_equipment (hero_id, slot, item_key)
             VALUES ($1,'BACK',$2)
             ON CONFLICT (hero_id, slot)
             DO UPDATE SET item_key = EXCLUDED.item_key, updated_at = now()`,
            [id, STARTER_BAG_KEY]
          );
        } catch (e) {
          console.warn('[starter] auto-equip bag falhou:', e?.message);
        }

        try {
          const spawnPoint = await getStartPoint();

          await run(
            `
            INSERT INTO hero_last_pos (hero_id, map_key, x, y, updated_at)
            VALUES ($1,$2,$3,$4, NOW())
            ON CONFLICT (hero_id) DO UPDATE
              SET map_key = EXCLUDED.map_key,
                  x = EXCLUDED.x,
                  y = EXCLUDED.y,
                  updated_at = NOW()
            `,
            [id, spawnPoint.mapKey, spawnPoint.x, spawnPoint.y]
          );

          await run(
            `
            INSERT INTO player_last_pos (player_id, map_key, x, y, last_seq, updated_at)
            VALUES (
              $1,
              $2,
              $3,
              $4,
              COALESCE((SELECT last_seq FROM player_last_pos WHERE player_id=$1 AND map_key=$2), 0) + 1,
              NOW()
            )
            ON CONFLICT (player_id, map_key)
            DO UPDATE SET
              x = EXCLUDED.x,
              y = EXCLUDED.y,
              last_seq = player_last_pos.last_seq + 1,
              updated_at = NOW()
            `,
            [playerId, spawnPoint.mapKey, spawnPoint.x, spawnPoint.y]
          );
        } catch (e) {
          console.warn('[starter] failed to persist start point:', e?.message);
        }

        await run("COMMIT");
        return res.json({ ok: true, id, heroKey });

      } catch (err) {
        await run("ROLLBACK");
        const msg = String(err?.message || '').toLowerCase();
        if (msg.includes('duplicate key') || msg.includes('unique')) {
          return res.status(400).json({ error: 'starter já escolhido' });
        }
        if (msg.includes('generated column') || msg.includes('428c9')) {
          return res.status(400).json({
            error: 'schema indica heroKey gerada — tente novamente; já ajustamos para não inserir nela.'
          });
        }
        console.error('[starter] select error:', err);
        return res.status(500).json({ error: 'erro ao selecionar starter' });
      }
      // === FIM TRANSAÇÃO ===

    } catch (err) {
      // Falha fora da transação
      console.error('[starter] select error:', err);
      return res.status(500).json({ error: 'erro ao selecionar starter' });
    }
  });

  return router;
}

module.exports = buildStarterRouter;