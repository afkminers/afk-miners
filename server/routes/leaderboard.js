// server/routes/leaderboard.js
const express = require('express');
const router = express.Router();

const { all, run } = require('../models/db');

async function queryWithFallback(sql, params = [], fallbackSql = null) {
  try {
    return await all(sql, params);
  } catch (err) {
    if ((err?.code === '42P01' || err?.code === '42703') && fallbackSql) {
      console.warn('[leaderboard] missing relation, executing fallback query');
      return all(fallbackSql, params);
    }
    throw err;
  }
}

const VALID_LIMITS = new Set([25, 50, 100]);
const DEFAULT_LIMIT = 25;

const SKILL_MAP = {
  distance: 'DISTANCE',
  magic: 'MAGIC',
  shielding: 'SHIELD',
  sword: 'SWORD',
  axe: 'AXE',
  club: 'CLUB',
  spear: 'DISTANCE',
};

const INDEX_QUERIES = [
  'CREATE INDEX IF NOT EXISTS idx_ph_level ON player_heroes(level DESC, COALESCE(updated_at, "updatedAt") DESC)',
  'CREATE INDEX IF NOT EXISTS idx_ph_player ON player_heroes("playerId")',
  'CREATE INDEX IF NOT EXISTS idx_ph_key ON player_heroes((COALESCE("heroKey", herokey)))',
  'CREATE INDEX IF NOT EXISTS idx_hm_key ON heroes_master((COALESCE("heroKey", herokey)))',
  'CREATE INDEX IF NOT EXISTS idx_phs_skill ON player_hero_skills(skill_type, level DESC)',
  'CREATE INDEX IF NOT EXISTS idx_phs_hero ON player_hero_skills(hero_id)',
];

async function ensureIndexes() {
  for (const sql of INDEX_QUERIES) {
    try {
      await run(sql);
    } catch (err) {
      console.warn('[leaderboard] failed to ensure index:', err?.message || err);
    }
  }
}

ensureIndexes().catch((err) => {
  console.warn('[leaderboard] index bootstrap error:', err?.message || err);
});

router.get('/health', (_req, res) => {
  res.json({ ok: true });
});

function parseLimit(raw) {
  const value = Number.parseInt(raw, 10);
  if (VALID_LIMITS.has(value)) return value;
  return DEFAULT_LIMIT;
}

function parseOffset(raw) {
  const value = Number.parseInt(raw, 10);
  if (Number.isFinite(value) && value >= 0) return value;
  return 0;
}

function sanitizeQuery(raw) {
  if (raw == null) return null;
  const value = String(raw).trim();
  return value.length ? value : null;
}

function toIso(value) {
  if (!value && value !== 0) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildResponse(rows, limit, offset, total = null) {
  const nextOffset = rows.length === limit ? offset + limit : null;
  return { rows, limit, offset, nextOffset, total };
}

function mapPlayerRow(row, offset, index) {
  return {
    rank: offset + index + 1,
    playerId: row.player_id,
    playerName: row.player_name,
    heroId: row.hero_id,
    heroName: row.hero_name,
    heroKey: row.hero_key,
    class: row.class,
    rarity: row.rarity,
    level: row.level,
    updatedAt: toIso(row.updated_at),
  };
}

function mapHeroRow(row, offset, index) {
  return {
    rank: offset + index + 1,
    heroId: row.hero_id,
    heroName: row.hero_name,
    heroKey: row.hero_key,
    class: row.class,
    rarity: row.rarity,
    level: row.level,
    updatedAt: toIso(row.updated_at),
    playerId: row.player_id,
    playerName: row.player_name,
  };
}

function mapSkillRow(row, offset, index) {
  return {
    rank: offset + index + 1,
    heroId: row.hero_id,
    heroName: row.hero_name,
    heroKey: row.hero_key,
    class: row.class,
    playerId: row.player_id,
    playerName: row.player_name,
    skillType: row.skill_type,
    skillValue: row.skill_value,
    triesProgress: row.tries_progress,
    updatedAt: toIso(row.updated_at),
  };
}

router.get('/players', async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const offset = parseOffset(req.query.offset);
    const search = sanitizeQuery(req.query.query);

    const rows = await queryWithFallback(
      `
      WITH ranked AS (
        SELECT
          ph."playerId",
          ph.id  AS hero_id,
          ph.name AS hero_name,
          ph.rarity,
          ph.level,
          COALESCE(ph.updated_at, ph."updatedAt") AS up_at,
          COALESCE(ph."heroKey", ph.herokey) AS hero_key,
          ROW_NUMBER() OVER (PARTITION BY ph."playerId" ORDER BY ph.level DESC, COALESCE(ph.updated_at, ph."updatedAt") DESC) AS rn
        FROM player_heroes ph
      )
      SELECT
        p.id   AS player_id,
        p.name AS player_name,
        r.hero_id,
        r.hero_name,
        COALESCE(hm.class, 'Unknown') AS class,
        COALESCE(r.rarity, hm.rarity) AS rarity,
        r.level,
        r.up_at AS updated_at,
        r.hero_key
      FROM ranked r
      JOIN players p ON p.id = r."playerId"
      LEFT JOIN heroes_master hm ON COALESCE(hm."heroKey", hm.herokey) = r.hero_key
      WHERE r.rn = 1
        AND (COALESCE($3,'') = '' OR p.name ILIKE '%'||$3||'%' OR r.hero_name ILIKE '%'||$3||'%')
      ORDER BY r.level DESC, r.up_at DESC
      LIMIT $1 OFFSET $2;
      `,
      [limit, offset, search],
      `
      WITH ranked AS (
        SELECT
          ph."playerId",
          ph.id  AS hero_id,
          ph.name AS hero_name,
          ph.rarity,
          ph.level,
          COALESCE(ph.updated_at, ph."updatedAt") AS up_at,
          COALESCE(ph."heroKey", ph.herokey) AS hero_key,
          ROW_NUMBER() OVER (PARTITION BY ph."playerId" ORDER BY ph.level DESC, COALESCE(ph.updated_at, ph."updatedAt") DESC) AS rn
        FROM player_heroes ph
      )
      SELECT
        p.id   AS player_id,
        p.name AS player_name,
        r.hero_id,
        r.hero_name,
        'Unknown' AS class,
        r.rarity,
        r.level,
        r.up_at AS updated_at,
        r.hero_key
      FROM ranked r
      JOIN players p ON p.id = r."playerId"
      WHERE r.rn = 1
        AND (COALESCE($3,'') = '' OR p.name ILIKE '%'||$3||'%' OR r.hero_name ILIKE '%'||$3||'%')
      ORDER BY r.level DESC, r.up_at DESC
      LIMIT $1 OFFSET $2;
      `
    );

    console.info(`[lb] players ok rows=${rows.length}`);

    const payload = rows.map((row, index) => mapPlayerRow(row, offset, index));
    res.json(buildResponse(payload, limit, offset));
  } catch (err) {
    console.error('[leaderboard] players failed:', err);
    res.status(500).json({ error: 'unable to load players leaderboard' });
  }
});

router.get('/heroes', async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const offset = parseOffset(req.query.offset);
    const search = sanitizeQuery(req.query.query);

    const rows = await queryWithFallback(
      `
      SELECT
        ph.id   AS hero_id,
        ph.name AS hero_name,
        COALESCE(hm.class, 'Unknown') AS class,
        COALESCE(ph.rarity, hm.rarity) AS rarity,
        ph.level,
        COALESCE(ph.updated_at, ph."updatedAt") AS updated_at,
        p.id    AS player_id,
        p.name  AS player_name,
        COALESCE(ph."heroKey", ph.herokey) AS hero_key
      FROM player_heroes ph
      JOIN players p ON p.id = ph."playerId"
      LEFT JOIN heroes_master hm ON COALESCE(hm."heroKey", hm.herokey) = COALESCE(ph."heroKey", ph.herokey)
      WHERE (COALESCE($3,'') = '' OR p.name ILIKE '%'||$3||'%' OR ph.name ILIKE '%'||$3||'%')
      ORDER BY ph.level DESC, COALESCE(ph.updated_at, ph."updatedAt") DESC
      LIMIT $1 OFFSET $2;
      `,
      [limit, offset, search],
      `
      SELECT
        ph.id   AS hero_id,
        ph.name AS hero_name,
        'Unknown' AS class,
        ph.rarity,
        ph.level,
        COALESCE(ph.updated_at, ph."updatedAt") AS updated_at,
        p.id    AS player_id,
        p.name  AS player_name,
        COALESCE(ph."heroKey", ph.herokey) AS hero_key
      FROM player_heroes ph
      JOIN players p ON p.id = ph."playerId"
      WHERE (COALESCE($3,'') = '' OR p.name ILIKE '%'||$3||'%' OR ph.name ILIKE '%'||$3||'%')
      ORDER BY ph.level DESC, COALESCE(ph.updated_at, ph."updatedAt") DESC
      LIMIT $1 OFFSET $2;
      `
    );

    console.info(`[lb] heroes ok rows=${rows.length}`);

    const payload = rows.map((row, index) => mapHeroRow(row, offset, index));
    res.json(buildResponse(payload, limit, offset));
  } catch (err) {
    console.error('[leaderboard] heroes failed:', err);
    res.status(500).json({ error: 'unable to load heroes leaderboard' });
  }
});

router.get('/skills', async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const offset = parseOffset(req.query.offset);
    const search = sanitizeQuery(req.query.query);
    const skillKey = String(req.query.skill || '').toLowerCase();
    const skillType = SKILL_MAP[skillKey];

    if (!skillType) {
      return res.status(400).json({ error: 'skill not available' });
    }

    if (skillKey === 'spear') {
      console.warn('[lb] skills alias: spear→DISTANCE');
    }

    const rows = await queryWithFallback(
      `
      WITH base AS (
        SELECT
          s.hero_id,
          s.level AS skill_value,
          s.tries_progress,
          s.skill_type,
          NOW() AS up_at,
          ph.name AS hero_name,
          COALESCE(ph.updated_at, ph."updatedAt") AS hero_updated_at,
          COALESCE(ph."heroKey", ph.herokey) AS hero_key,
          ph."playerId" AS player_id
        FROM player_hero_skills s
        JOIN player_heroes ph ON ph.id = s.hero_id
        WHERE s.skill_type = $1
      )
      SELECT
        b.hero_id,
        b.hero_name,
        COALESCE(hm.class, 'Unknown') AS class,
        p.id    AS player_id,
        p.name  AS player_name,
        b.skill_value,
        b.tries_progress,
        GREATEST(COALESCE(b.hero_updated_at, NOW()), b.up_at) AS updated_at,
        b.skill_type,
        b.hero_key
      FROM base b
      JOIN players p ON p.id = b.player_id
      LEFT JOIN heroes_master hm ON COALESCE(hm."heroKey", hm.herokey) = b.hero_key
      WHERE (COALESCE($4,'') = '' OR p.name ILIKE '%'||$4||'%' OR b.hero_name ILIKE '%'||$4||'%')
      ORDER BY b.skill_value DESC, GREATEST(COALESCE(b.hero_updated_at, NOW()), b.up_at) DESC
      LIMIT $2 OFFSET $3;
      `,
      [skillType, limit, offset, search],
      `
      WITH base AS (
        SELECT
          s.hero_id,
          s.level AS skill_value,
          s.tries_progress,
          s.skill_type,
          NOW() AS up_at,
          ph.name AS hero_name,
          COALESCE(ph.updated_at, ph."updatedAt") AS hero_updated_at,
          COALESCE(ph."heroKey", ph.herokey) AS hero_key,
          ph."playerId" AS player_id
        FROM player_hero_skills s
        JOIN player_heroes ph ON ph.id = s.hero_id
        WHERE s.skill_type = $1
      )
      SELECT
        b.hero_id,
        b.hero_name,
        'Unknown' AS class,
        p.id    AS player_id,
        p.name  AS player_name,
        b.skill_value,
        b.tries_progress,
        GREATEST(COALESCE(b.hero_updated_at, NOW()), b.up_at) AS updated_at,
        b.skill_type,
        b.hero_key
      FROM base b
      JOIN players p ON p.id = b.player_id
      WHERE (COALESCE($4,'') = '' OR p.name ILIKE '%'||$4||'%' OR b.hero_name ILIKE '%'||$4||'%')
      ORDER BY b.skill_value DESC, GREATEST(COALESCE(b.hero_updated_at, NOW()), b.up_at) DESC
      LIMIT $2 OFFSET $3;
      `
    );

    console.info(`[lb] skills ok rows=${rows.length} skill=${skillType}`);

    const payload = rows.map((row, index) => mapSkillRow(row, offset, index));
    res.json(buildResponse(payload, limit, offset));
  } catch (err) {
    if (err?.code === '42P01') {
      console.error('[leaderboard] skills missing table player_hero_skills');
    } else {
      console.error('[leaderboard] skills failed:', err);
    }
    res.status(500).json({ error: 'unable to load skills leaderboard' });
  }
});

module.exports = router;
