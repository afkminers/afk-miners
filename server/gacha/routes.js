// server/gacha/routes.js
const express = require('express');
const { randomUUID } = require('crypto');
const { all, get, run } = require('../models/db');
const { requireAuth } = require('../auth/middleware'); // <-- proteje a rota

const router = express.Router();

router.use(requireAuth); // protege tudo abaixo

// Probabilidades por raridade
const RARITY_PROB = [
  { rarity: 'COMMON',      p: 0.72 },
  { rarity: 'RARE',        p: 0.18 },
  { rarity: 'SUPER_RARE',  p: 0.07 },
  { rarity: 'LEGENDARY',   p: 0.025 },
  { rarity: 'MYTHIC',      p: 0.004 },
  { rarity: 'ULTIMATE',    p: 0.001 },
];

// Multiplicadores de status por raridade
const RAR_MULTI = {
  COMMON: 1.0, RARE: 0.9, SUPER_RARE: 1.1, LEGENDARY: 1.25, MYTHIC: 1.4, ULTIMATE: 1.5
};

// Custo do summon (ajuste para o que você quer ver no front)
const SUMMON_COST_COINS = 1;

function pickRarity() {
  const r = Math.random();
  let acc = 0;
  for (const x of RARITY_PROB) { acc += x.p; if (r <= acc) return x.rarity; }
  return 'COMMON';
}

const imageUrlFor = (heroKey) => `/img/heroes/${heroKey}.png`;

router.post('/', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');

    const playerId = req.user.id;
    const player = await get(`SELECT id,coins,gems FROM players WHERE id=?`, [playerId]);
    if (!player) return res.status(404).json({ error: 'Jogador não encontrado' });
    if (player.coins < SUMMON_COST_COINS) return res.status(400).json({ error: 'Moedas insuficientes' });

    // Sorteia raridade e herói do catálogo
    const rarity = pickRarity();
    const pool = await all(`SELECT * FROM heroes_master WHERE rarity=?`, [rarity]);
    if (!pool.length) return res.status(500).json({ error: 'Pool vazia: ' + rarity });

    const chosen = pool[Math.floor(Math.random() * pool.length)];
    const m = RAR_MULTI[rarity] ?? 1;

    const atk = Math.max(1, Math.floor(chosen.base_attack  * m));
    const def = Math.max(1, Math.floor(chosen.base_defense * m));
    const spd = Math.max(1, Math.floor(chosen.base_speed   * m));

    const heroId = randomUUID();

    // --- Transação: debitar moedas + inserir herói
    await run('BEGIN IMMEDIATE');
    try {
      await run(`UPDATE players SET coins = coins - ? WHERE id = ?`, [SUMMON_COST_COINS, playerId]);

      await run(`
        INSERT INTO player_heroes
          (id, playerId, heroKey, name, rarity, attack, defense, speed, createdAt)
        VALUES
          (?,  ?,        ?,       ?,    ?,      ?,      ?,       ?,     ?)
      `, [heroId, playerId, chosen.heroKey, chosen.name, rarity, atk, def, spd, Date.now()]);

      await run('COMMIT');
    } catch (txErr) {
      await run('ROLLBACK');
      throw txErr;
    }

    const updated = await get(`SELECT coins,gems FROM players WHERE id=?`, [playerId]);

    return res.json({
      cost: SUMMON_COST_COINS,
      newBalance: updated,
      hero: {
        id: heroId,
        heroKey: chosen.heroKey,
        name: chosen.name,
        rarity,
        attack: atk,
        defense: def,
        speed: spd,
        imageUrl: imageUrlFor(chosen.heroKey),
        class: chosen.class,
        role: chosen.role,
        attack_type: chosen.attack_type,
        element: chosen.element,
        weapon_pref: chosen.weapon_pref,
      }
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Falha ao girar gacha' });
  }
});

module.exports = router;
