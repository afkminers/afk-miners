// server/routes/catalog.js
const express = require('express');
const { all } = require('../models/db');

const router = express.Router();

// Alinha com o pipeline de sprites (ex.: client serve /sprites/characters/<heroKey>.png)
const imageUrlFor = (k) => `/sprites/characters/${k}.png`;

router.get('/heroes/master', async (_req, res) => {
  try {
    const rows = await all(`
      SELECT
        heroKey,
        name,
        rarity,
        base_attack,
        base_defense,
        base_speed,
        class,
        role,
        attack_type,
        element,
        weapon_pref
      FROM heroes_master
      ORDER BY
        CASE UPPER(rarity)
          WHEN 'ULTIMATE'   THEN 1
          WHEN 'MYTHIC'     THEN 2
          WHEN 'LEGENDARY'  THEN 3
          WHEN 'SUPER_RARE' THEN 4
          WHEN 'RARE'       THEN 5
          ELSE 6
        END,
        name ASC
    `);

    // Mantém o contrato esperado no front:
    // - attack_type e weapon_pref (novos nomes do schema)
    // - adiciona os aliases "type" e "weapon" para retrocompatibilidade
    const out = rows.map((h) => ({
      heroKey: h.herokey || h.herokey, // pg pode retornar em minúsculas se não-quoted
      name: h.name,
      rarity: h.rarity,
      base_attack: h.base_attack,
      base_defense: h.base_defense,
      base_speed: h.base_speed,
      class: h.class,
      role: h.role,
      element: h.element,
      attack_type: h.attack_type,
      weapon_pref: h.weapon_pref,
      // aliases legados
      type: h.attack_type,
      weapon: h.weapon_pref,
      // asset
      imageUrl: imageUrlFor(h.herokey || h.heroKey),
    }));

    res.set('Cache-Control', 'no-store');
    res.json(out);
  } catch (e) {
    console.error('[catalog/heroes/master] error:', e);
    res.status(500).json({ error: 'Falha ao listar heróis' });
  }
});

module.exports = router;