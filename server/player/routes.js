// server/player/routes.js
const express = require('express');
const { all, get } = require('../models/db');
const { requireAuth } = require('../auth/middleware');

const router = express.Router();

/* util: headers anti-cache */
function noStore(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
}

// protege tudo daqui pra baixo
router.use(requireAuth);

// ---- curvas (pode mover para um config depois) ----
function needForSkill(level) {
  // “tries” necessários para upar 1 nível de skill (estilo Tibia, tunável)
  const A = 20, B = 1.18;
  return Math.round(A * Math.pow(B, Math.max(0, level - 1)));
}
function xpNext(level) {
  // XP necessário para o próximo nível do jogador
  const base = 100, exp = 1.45, lin = 10;
  return Math.floor(base * Math.pow(level, exp) + lin * level);
}

/**
 * GET /api/player/me
 * Retorna perfil + heróis + skills + level do jogador autenticado.
 */
router.get('/me', async (req, res) => {
  try {
    noStore(res);
    const playerId = req.user.id;

    // ---- perfil básico ----
    const profile = await get(
      `SELECT id, name, coins, gems, createdAt
         FROM players
        WHERE id = ?`,
      [playerId]
    );
    if (!profile) {
      return res.status(404).json({ error: 'Jogador não encontrado' });
    }

    // ---- heróis do jogador (JOIN com catálogo) ----
    const rows = await all(
      `
      SELECT
        ph.id,
        ph.heroKey,
        ph.name,
        ph.rarity,
        ph.attack,
        ph.defense,
        ph.speed,
        ph.createdAt,
        hm.class,
        hm.role,
        hm.attack_type,
        hm.element,
        hm.weapon_pref
      FROM player_heroes AS ph
      LEFT JOIN heroes_master AS hm ON hm.heroKey = ph.heroKey
      WHERE ph.playerId = ?
      ORDER BY
        CASE ph.rarity
          WHEN 'ULTIMATE'   THEN 1
          WHEN 'MYTHIC'     THEN 2
          WHEN 'LEGENDARY'  THEN 3
          WHEN 'SUPER_RARE' THEN 4
          WHEN 'RARE'       THEN 5
          ELSE 6
        END,
        ph.createdAt DESC
      `,
      [playerId]
    );

    const imageUrlFor = (heroKey) => `/img/heroes/${heroKey}.png`;
    const heroes = rows.map((h) => ({ ...h, imageUrl: imageUrlFor(h.heroKey) }));

    // ---- skills individuais (SWORD/AXE/CLUB/DISTANCE/MAGIC/SHIELDING) ----
    const sk = await all(
      `SELECT skillType, level, tries
         FROM player_skills
        WHERE playerId = ?`,
      [playerId]
    );

    const skills = (sk || []).map((s) => {
      const need = needForSkill(s.level);
      return {
        skillType: s.skillType,         // ex: "SWORD"
        level: s.level,
        tries: s.tries,
        need,
        progress: need ? s.tries / need : 0, // 0–1
      };
    });

    // ---- nível do jogador (XP) ----
    const lv = await get(
      `SELECT level, xp
         FROM player_levels
        WHERE playerId = ?`,
      [playerId]
    );

    const curLevel = lv?.level ?? 1;
    const curXp = lv?.xp ?? 0;
    const needXp = xpNext(curLevel);

    const level = {
      level: curLevel,
      xp: curXp,
      next: needXp,
      progress: needXp ? curXp / needXp : 0, // 0–1
    };

    // resposta unificada
    return res.json({ profile, heroes, skills, level });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Falha ao obter dados do jogador' });
  }
});

module.exports = router;
