// server/routes/leaderboard.js
const express = require('express');
const router = express.Router();

const { all, run } = require('../models/db');

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
    class: row.class,
    playerId: row.player_id,
    playerName: row.player_name,
    skillType: row.skill_type,
    skillValue: row.value,
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
          ph.class, ph.rarity, ph.level,
          COALESCE(ph.updated_at, ph."updatedAt") AS up_at,
          ROW_NUMBER() OVER (PARTITION BY ph."playerId" ORDER BY ph.level DESC, COALESCE(ph.updated_at, ph."updatedAt") DESC) AS rn
        FROM player_heroes ph
      )
      SELECT
        p.id   AS player_id,
        p.name AS player_name,
        r.hero_id, r.hero_name, r.class, r.rarity, r.level,
        r.up_at AS updated_at
      FROM ranked r
      JOIN players p ON p.id = r."playerId"
      WHERE r.rn = 1
        AND (COALESCE($3,'') = '' OR p.name ILIKE '%'||$3||'%' OR r.hero_name ILIKE '%'||$3||'%')
      ORDER BY r.level DESC, r.up_at DESC
      LIMIT $1 OFFSET $2;
      `,
      [limit, offset, search]
    );

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
        ph.class, ph.rarity, ph.level,
        COALESCE(ph.updated_at, ph."updatedAt") AS updated_at,
        p.id    AS player_id,
        p.name  AS player_name
      FROM player_heroes ph
      JOIN players p ON p.id = ph."playerId"
      WHERE (COALESCE($3,'') = '' OR p.name ILIKE '%'||$3||'%' OR ph.name ILIKE '%'||$3||'%')
      ORDER BY ph.level DESC, COALESCE(ph.updated_at, ph."updatedAt") DESC
      LIMIT $1 OFFSET $2;
      `,
      [limit, offset, search]
    );

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

    const rows = await queryWithFallback(
      `
      WITH s AS (
        SELECT hero_id, level AS value, tries_progress, skill_type, COALESCE(updated_at, NOW()) AS up_at
        FROM player_hero_skills
        WHERE skill_type = $1
      )
      SELECT
        ph.id   AS hero_id,
        ph.name AS hero_name,
        ph.class,
        p.id    AS player_id,
        p.name  AS player_name,
        s.value,
        s.tries_progress,
        GREATEST(COALESCE(ph.updated_at, ph."updatedAt"), s.up_at) AS updated_at,
        s.skill_type
      FROM s
      JOIN player_heroes ph ON ph.id = s.hero_id
      JOIN players p       ON p.id  = ph."playerId"
      WHERE (COALESCE($4,'') = '' OR p.name ILIKE '%'||$4||'%' OR ph.name ILIKE '%'||$4||'%')
      ORDER BY s.value DESC, updated_at DESC
      LIMIT $2 OFFSET $3;
      `,
      [skillType, limit, offset, search]
    );

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
