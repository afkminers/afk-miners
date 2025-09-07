// server/skills/routes.js
const express = require('express');
const { all } = require('../models/db');
const { requireAuth } = require('../auth/middleware');
const { gainFromHit } = require('./engine');

const router = express.Router();
router.use(requireAuth);

/**
 * GET /api/skills/curves?skill=SWORD
 * Lista a curva (tries_needed por level) de uma skill.
 */
router.get('/curves', async (req, res) => {
  try {
    const skill = String(req.query.skill || '').toUpperCase();
    if (!skill) {
      return res.status(400).json({
        error: 'informe ?skill=SWORD|AXE|CLUB|DISTANCE|SHIELD|MAGIC',
      });
    }
    const rows = await all(
      `SELECT level, tries_needed
         FROM skill_curves
        WHERE skill_type = $1
        ORDER BY level`,
      [skill]
    );
    res.json({ skill_type: skill, rows });
  } catch (e) {
    console.error('[skills/curves] error:', e);
    res.status(500).json({ error: 'Falha ao listar curvas' });
  }
});

/**
 * GET /api/skills/class-rates
 * Tabela de rates por classe x skill.
 */
router.get('/class-rates', async (_req, res) => {
  try {
    const rows = await all(
      `SELECT class, skill_type, rate
         FROM class_skill_rates
        ORDER BY class, skill_type`
    );
    res.json(rows);
  } catch (e) {
    console.error('[skills/class-rates] error:', e);
    res.status(500).json({ error: 'Falha ao listar rates' });
  }
});

/**
 * Core: retorna TODAS as skills do herói (mesmo as que ainda não têm linha),
 * garantindo antes que existam registros em player_hero_skills.
 *
 * Responde com campos: skill_type, level, tries_progress, tries_needed (e need).
 */
async function fetchAllHeroSkills(heroId) {
  // Garante/insere linhas faltantes via função do Postgres (que você já criou)
  await all(`SELECT ensure_hero_skill_rows($1)`, [heroId]);

  // Base de skills "oficiais" vem de skill_curves
  const rows = await all(
    `WITH base AS (
       SELECT DISTINCT skill_type FROM skill_curves
     )
     SELECT
       b.skill_type,
       COALESCE(phs.level, 1)          AS level,
       COALESCE(phs.tries_progress, 0) AS tries_progress,
       COALESCE(sc.tries_needed, 0)    AS tries_needed,
       COALESCE(sc.tries_needed, 0)    AS need  -- compatibilidade com front antigo
     FROM base b
     LEFT JOIN player_hero_skills phs
            ON phs.hero_id    = $1
           AND phs.skill_type = b.skill_type
     LEFT JOIN skill_curves sc
            ON sc.skill_type = b.skill_type
           AND sc.level      = COALESCE(phs.level, 1)
     ORDER BY b.skill_type`,
    [heroId]
  );

  return rows;
}

/**
 * GET /api/skills/me?heroId=...
 * - Confere dono do herói
 * - Garante e retorna TODAS as skills (com tries_needed preenchido)
 */
router.get('/me', async (req, res) => {
  try {
    const heroId = String(req.query.heroId || '');
    if (!heroId) return res.status(400).json({ error: 'heroId é obrigatório' });

    // garante que o herói pertence ao player logado
    const owner = await all(
      `SELECT 1
         FROM player_heroes
        WHERE id = $1 AND "playerId" = $2`,
      [heroId, req.user.id]
    );
    if (!owner.length) return res.status(404).json({ error: 'Herói não encontrado' });

    const rows = await fetchAllHeroSkills(heroId);
    // Pode devolver array direto (seu front suporta). Se preferir: res.json({ skills: rows })
    res.json(rows);
  } catch (e) {
    console.error('[skills/me] error:', e);
    res.status(500).json({ error: 'Falha ao listar skills do herói' });
  }
});

/**
 * GET /api/skills/hero/:id
 * Alias da rota acima, só muda o formato do parâmetro (path param).
 */
router.get('/hero/:id', async (req, res) => {
  try {
    const heroId = String(req.params.id || '');
    if (!heroId) return res.status(400).json({ error: 'heroId é obrigatório' });

    // dono
    const owner = await all(
      `SELECT 1
         FROM player_heroes
        WHERE id = $1 AND "playerId" = $2`,
      [heroId, req.user.id]
    );
    if (!owner.length) return res.status(404).json({ error: 'Herói não encontrado' });

    const rows = await fetchAllHeroSkills(heroId);
    res.json(rows);
  } catch (e) {
    console.error('[skills/hero/:id] error:', e);
    res.status(500).json({ error: 'Falha ao listar skills do herói' });
  }
});

/**
 * (Opcional, DEV) POST /api/skills/gain/dev
 * Força um ganho via engine pra testar comportamento.
 */
if (process.env.NODE_ENV !== 'production') {
  router.post('/gain/dev', async (req, res) => {
    try {
      const { heroId, heroClass, skillType } = req.body || {};
      if (!heroId || !skillType) {
        return res.status(400).json({ error: 'heroId e skillType são obrigatórios' });
      }
      const r = await gainFromHit({ heroId, skillType, heroClass, context: 'COMBAT' });
      res.json(r);
    } catch (e) {
      console.error('[skills/gain/dev] error:', e);
      res.status(500).json({ error: 'Falha ao aplicar ganho' });
    }
  });
}

module.exports = router;
