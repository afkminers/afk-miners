const express = require('express');
const { randomUUID } = require('crypto');
const { all, get, run } = require('../models/db');
const { requireAuth } = require('../auth/middleware');
const { ensureHeroSkills } = require('../models/hero_extra');

const router = express.Router();
router.use(requireAuth);

// Probabilidades por raridade (soma 1.0)
const RARITY_ORDER = ['COMMON', 'RARE', 'SUPER_RARE', 'LEGENDARY', 'MYTHIC', 'ULTIMATE'];
const RARITY_PROB = [
  { rarity: 'COMMON',      p: 0.74962 },
  { rarity: 'RARE',        p: 0.17991 },
  { rarity: 'SUPER_RARE',  p: 0.05997 },
  { rarity: 'LEGENDARY',   p: 0.009 },
  { rarity: 'MYTHIC',      p: 0.001 },
  { rarity: 'ULTIMATE',    p: 0.0005 },
];

// Multiplicadores de status por raridade
const RAR_MULTI = {
  COMMON: 1.0,
  RARE: 0.9,
  SUPER_RARE: 1.1,
  LEGENDARY: 1.25,
  MYTHIC: 1.4,
  ULTIMATE: 1.5,
};

// Custo do summon
const SUMMON_COST_COINS = 1;

const imageUrlFor = (heroKey) => `/img/heroes/${heroKey}.png`;

function pickRarity() {
  const r = Math.random();
  let acc = 0;
  for (const x of RARITY_PROB) {
    acc += x.p;
    if (r <= acc) return x.rarity;
  }
  return 'COMMON';
}

async function chooseHeroFromPool(rarity) {
  let idx = RARITY_ORDER.indexOf((rarity || 'COMMON').toUpperCase());
  if (idx < 0) idx = 0;

  while (idx >= 0) {
    const pool = await all(
      `SELECT herokey AS "heroKey", name, rarity, base_attack, base_defense, base_speed,
              class, role, attack_type, element, weapon_pref, type, weapon
         FROM heroes_master
        WHERE UPPER(TRIM(rarity)) = $1`,
      [RARITY_ORDER[idx]]
    );
    if (pool.length) {
      const chosen = pool[Math.floor(Math.random() * pool.length)];
      return {
        ...chosen,
        class: chosen.class || null,
        role: chosen.role || null,
        attack_type: chosen.attack_type || null,
        element: chosen.element || null,
        weapon_pref: chosen.weapon_pref || chosen.weapon || null,
      };
    }
    idx--;
  }
  return null;
}

async function doSingleSummon(playerId) {
  const player = await get(`SELECT id, coins, gems FROM players WHERE id = $1`, [playerId]);
  if (!player) return { error: 'Jogador não encontrado' };
  if (player.coins < SUMMON_COST_COINS) return { error: 'Moedas insuficientes' };

  const rarity = pickRarity();
  const chosen = await chooseHeroFromPool(rarity);
  if (!chosen) return { error: 'Pools de heróis vazias. Popule o catálogo.' };

  const r = (chosen.rarity || rarity || 'COMMON').toUpperCase();
  const m = RAR_MULTI[r] ?? 1;

  const atk = Math.max(1, Math.floor((chosen.base_attack  || 1) * m));
  const def = Math.max(1, Math.floor((chosen.base_defense || 1) * m));
  const spd = Math.max(1, Math.floor((chosen.base_speed   || 1) * m));

  const heroId = randomUUID();

  await run('BEGIN');
  try {
    await run(`UPDATE players SET coins = coins - $1 WHERE id = $2`, [SUMMON_COST_COINS, playerId]);

    await run(
      `INSERT INTO player_heroes
         (id, playerid, herokey, name, rarity, attack, defense, speed, createdat)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        heroId,
        playerId,
        chosen.heroKey,
        chosen.name,
        r,
        atk,
        def,
        spd,
        Date.now(),
      ]
    );

    // === GARANTE SKILLS BASE ===
    await ensureHeroSkills(heroId);

    await run('COMMIT');
  } catch (e) {
    await run('ROLLBACK');
    throw e;
  }

  const updated = await get(`SELECT coins, gems FROM players WHERE id = $1`, [playerId]);

  return {
    cost: SUMMON_COST_COINS,
    newBalance: updated,
    hero: {
      id: heroId,
      heroKey: chosen.heroKey,
      name: chosen.name,
      rarity: r,
      attack: atk,
      defense: def,
      speed: spd,
      imageUrl: imageUrlFor(chosen.heroKey),
      class: chosen.class,
      role: chosen.role,
      attack_type: chosen.attack_type,
      element: chosen.element,
      weapon_pref: chosen.weapon_pref,
    },
  };
}

// POST /api/gacha           -> 1 summon
// POST /api/gacha?count=10  -> multi summon
router.post('/', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const playerId = req.user.id;
    const count = Math.max(1, Math.min(50, parseInt(req.query.count || '1', 10)));

    if (count === 1) {
      const result = await doSingleSummon(playerId);
      if (result.error) return res.status(400).json({ error: result.error, cost: SUMMON_COST_COINS });
      return res.json(result);
    }

    const pulls = [];
    for (let i = 0; i < count; i++) {
      const r = await doSingleSummon(playerId);
      if (r.error) {
        return res.status(400).json({ error: r.error, cost: SUMMON_COST_COINS, pulls });
      }
      pulls.push(r.hero);
    }
    const updated = await get(`SELECT coins, gems FROM players WHERE id = $1`, [playerId]);
    return res.json({ cost: SUMMON_COST_COINS, pulls, newBalance: updated });
  } catch (e) {
    console.error('[gacha] error:', e);
    return res.status(500).json({ error: 'Falha ao girar gacha' });
  }
});

module.exports = router;