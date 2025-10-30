// server/routes/leaderboard.js
const express = require('express');
const router = express.Router();

const { all } = require('../models/db');

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

const PG_UNDEFINED_TABLE = '42P01';

async function queryWithFallback(primarySql, params, fallbackSql) {
  try {
    return await all(primarySql, params);
  } catch (err) {
    if (err?.code === PG_UNDEFINED_TABLE && fallbackSql) {
      console.warn('[leaderboard] missing table, using fallback query:', err?.message);
      return all(fallbackSql, params);
    }
    throw err;
  }
}

function parsePagination(query = {}) {
  let limit = Number.parseInt(query.limit, 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_LIMIT;
  limit = Math.min(MAX_LIMIT, Math.max(1, limit));

  let offset = Number.parseInt(query.offset, 10);
  const page = Number.parseInt(query.page, 10);
  if (Number.isFinite(page) && page > 0) {
    offset = (page - 1) * limit;
  }
  if (!Number.isFinite(offset) || offset < 0) offset = 0;

  const period = String(query.period || 'all').toLowerCase() === 'weekly' ? 'weekly' : 'all';

  return { limit, offset, period };
}

function normalizeMetric(metric, supported) {
  const value = String(metric || '').trim().toLowerCase() || 'level';
  if (!supported.includes(value)) {
    throw Object.assign(new Error('unsupported-metric'), { status: 400 });
  }
  return value;
}

function sanitizeSkill(skillRaw) {
  const skill = String(skillRaw || '').trim().toUpperCase();
  if (!skill || !/^[A-Z_]+$/.test(skill)) {
    throw Object.assign(new Error('invalid-skill'), { status: 400 });
  }
  return skill;
}

function toIso(value) {
  if (!value && value !== 0) return null;
  if (value instanceof Date) return value.toISOString();

  const num = Number(value);
  if (Number.isFinite(num)) {
    // Assume timestamps in milliseconds; fallback to seconds when plausible
    if (num > 1e12) return new Date(num).toISOString();
    if (num > 1e9) return new Date(num * 1000).toISOString();
  }

  const asDate = new Date(value);
  return Number.isNaN(asDate.getTime()) ? null : asDate.toISOString();
}

function mapRow(row) {
  return {
    rank: Number(row.rank || 0),
    playerId: row.player_id || null,
    playerName: row.player_name || 'Unknown',
    heroId: row.hero_id || null,
    heroName: row.hero_name || null,
    heroKey: row.hero_key || null,
    class: row.class || '',
    rarity: row.rarity || '',
    level: Number(row.level || 0),
    skillType: row.skill_type || null,
    skillValue: row.skill_level != null ? Number(row.skill_level) : null,
    guildName: row.guild_name || null,
    updatedAt: toIso(row.updated_at || row.created_at || null),
  };
}

router.get('/players', async (req, res) => {
  try {
    normalizeMetric(req.query.metric, ['level']);
    const { limit, offset } = parsePagination(req.query);

    const rows = await queryWithFallback(
      `
      WITH best AS (
        SELECT DISTINCT ON (ph."playerId")
          ph."playerId"      AS player_id,
          ph.id               AS hero_id,
          ph.name             AS hero_name,
          ph.rarity           AS rarity,
          COALESCE(hp.level, ph.level, 1) AS level,
          ph."createdAt"      AS created_at,
          COALESCE(
            hp.updated_at,
            to_timestamp(
              CASE
                WHEN ph."createdAt" > 1000000000000 THEN ph."createdAt" / 1000.0
                WHEN ph."createdAt" > 1000000000 THEN ph."createdAt"
                ELSE ph."createdAt"
              END
            )
          )                AS updated_at,
          ph."heroKey"        AS hero_key
        FROM player_heroes ph
        LEFT JOIN hero_progress hp ON hp.hero_id = ph.id
        ORDER BY
          ph."playerId",
          COALESCE(hp.level, ph.level, 1) DESC,
          COALESCE(
            hp.updated_at,
            to_timestamp(
              CASE
                WHEN ph."createdAt" > 1000000000000 THEN ph."createdAt" / 1000.0
                WHEN ph."createdAt" > 1000000000 THEN ph."createdAt"
                ELSE ph."createdAt"
              END
            )
          ) DESC,
          ph."createdAt" ASC
      ), ordered AS (
        SELECT
          p.id                                  AS player_id,
          COALESCE(NULLIF(p.name, ''), 'Unknown') AS player_name,
          b.hero_id,
          b.hero_name,
          b.rarity,
          b.level,
          b.created_at,
          b.updated_at,
          b.hero_key,
          COALESCE(hm.class, '') AS class,
          ROW_NUMBER() OVER (
            ORDER BY
              b.level DESC,
              b.updated_at DESC,
              b.created_at ASC,
              p.id
          ) AS rank
        FROM best b
        JOIN players p ON p.id = b.player_id
        LEFT JOIN heroes_master hm ON hm."heroKey" = b.hero_key
      )
      SELECT *
      FROM ordered
      ORDER BY rank
      LIMIT $1 OFFSET $2
      `,
      [limit, offset],
      `
      WITH best AS (
        SELECT DISTINCT ON (ph."playerId")
          ph."playerId"      AS player_id,
          ph.id               AS hero_id,
          ph.name             AS hero_name,
          ph.rarity           AS rarity,
          COALESCE(ph.level, 1) AS level,
          ph."createdAt"      AS created_at,
          to_timestamp(
            CASE
              WHEN ph."createdAt" > 1000000000000 THEN ph."createdAt" / 1000.0
              WHEN ph."createdAt" > 1000000000 THEN ph."createdAt"
              ELSE ph."createdAt"
            END
          )                AS updated_at,
          ph."heroKey"        AS hero_key
        FROM player_heroes ph
        ORDER BY
          ph."playerId",
          COALESCE(ph.level, 1) DESC,
          ph."createdAt" ASC,
          ph.id
      ), ordered AS (
        SELECT
          p.id                                  AS player_id,
          COALESCE(NULLIF(p.name, ''), 'Unknown') AS player_name,
          b.hero_id,
          b.hero_name,
          b.rarity,
          b.level,
          b.created_at,
          b.updated_at,
          b.hero_key,
          COALESCE(hm.class, '') AS class,
          ROW_NUMBER() OVER (
            ORDER BY
              b.level DESC,
              b.updated_at DESC,
              b.created_at ASC,
              p.id
          ) AS rank
        FROM best b
        JOIN players p ON p.id = b.player_id
        LEFT JOIN heroes_master hm ON hm."heroKey" = b.hero_key
      )
      SELECT *
      FROM ordered
      ORDER BY rank
      LIMIT $1 OFFSET $2
      `
    );

    res.json(rows.map(mapRow));
  } catch (err) {
    const status = err?.status || 500;
    if (status >= 500) {
      console.error('[leaderboard] players failed:', err);
    }
    res.status(status).json({ error: err?.message || 'leaderboard-players-failed' });
  }
});

router.get('/heroes', async (req, res) => {
  try {
    normalizeMetric(req.query.metric, ['level']);
    const { limit, offset } = parsePagination(req.query);

    const rows = await queryWithFallback(
      `
      WITH ordered AS (
        SELECT
          ph.id               AS hero_id,
          ph.name             AS hero_name,
          ph.rarity           AS rarity,
          COALESCE(hp.level, ph.level, 1) AS level,
          ph."createdAt"      AS created_at,
          COALESCE(
            hp.updated_at,
            to_timestamp(
              CASE
                WHEN ph."createdAt" > 1000000000000 THEN ph."createdAt" / 1000.0
                WHEN ph."createdAt" > 1000000000 THEN ph."createdAt"
                ELSE ph."createdAt"
              END
            )
          )                AS updated_at,
          ph."heroKey"        AS hero_key,
          ph."playerId"       AS player_id,
          COALESCE(NULLIF(p.name, ''), 'Unknown') AS player_name,
          COALESCE(hm.class, '') AS class,
          ROW_NUMBER() OVER (
            ORDER BY
              COALESCE(hp.level, ph.level, 1) DESC,
              COALESCE(
                hp.updated_at,
                to_timestamp(
                  CASE
                    WHEN ph."createdAt" > 1000000000000 THEN ph."createdAt" / 1000.0
                    WHEN ph."createdAt" > 1000000000 THEN ph."createdAt"
                    ELSE ph."createdAt"
                  END
                )
              ) DESC,
              ph."createdAt" ASC,
              ph.name ASC
          ) AS rank
        FROM player_heroes ph
        LEFT JOIN hero_progress hp ON hp.hero_id = ph.id
        JOIN players p ON p.id = ph."playerId"
        LEFT JOIN heroes_master hm ON hm."heroKey" = ph."heroKey"
      )
      SELECT *
      FROM ordered
      ORDER BY rank
      LIMIT $1 OFFSET $2
      `,
      [limit, offset],
      `
      WITH ordered AS (
        SELECT
          ph.id               AS hero_id,
          ph.name             AS hero_name,
          ph.rarity           AS rarity,
          COALESCE(ph.level, 1) AS level,
          ph."createdAt"      AS created_at,
          to_timestamp(
            CASE
              WHEN ph."createdAt" > 1000000000000 THEN ph."createdAt" / 1000.0
              WHEN ph."createdAt" > 1000000000 THEN ph."createdAt"
              ELSE ph."createdAt"
            END
          )                AS updated_at,
          ph."heroKey"        AS hero_key,
          ph."playerId"       AS player_id,
          COALESCE(NULLIF(p.name, ''), 'Unknown') AS player_name,
          COALESCE(hm.class, '') AS class,
          ROW_NUMBER() OVER (
            ORDER BY
              COALESCE(ph.level, 1) DESC,
              ph."createdAt" ASC,
              ph.name ASC
          ) AS rank
        FROM player_heroes ph
        JOIN players p ON p.id = ph."playerId"
        LEFT JOIN heroes_master hm ON hm."heroKey" = ph."heroKey"
      )
      SELECT *
      FROM ordered
      ORDER BY rank
      LIMIT $1 OFFSET $2
      `
    );

    res.json(rows.map(mapRow));
  } catch (err) {
    const status = err?.status || 500;
    if (status >= 500) {
      console.error('[leaderboard] heroes failed:', err);
    }
    res.status(status).json({ error: err?.message || 'leaderboard-heroes-failed' });
  }
});

router.get('/skills', async (req, res) => {
  try {
    const skill = sanitizeSkill(req.query.skill);
    const { limit, offset } = parsePagination(req.query);

    const rows = await queryWithFallback(
      `
      WITH filtered AS (
        SELECT
          phs.hero_id,
          phs.skill_type,
          phs.level          AS skill_level,
          ph."playerId"     AS player_id,
          COALESCE(NULLIF(p.name, ''), 'Unknown') AS player_name,
          ph.name            AS hero_name,
          ph.rarity          AS rarity,
          COALESCE(hp.level, ph.level, 1) AS level,
          ph."createdAt"     AS created_at,
          COALESCE(
            hp.updated_at,
            to_timestamp(
              CASE
                WHEN ph."createdAt" > 1000000000000 THEN ph."createdAt" / 1000.0
                WHEN ph."createdAt" > 1000000000 THEN ph."createdAt"
                ELSE ph."createdAt"
              END
            )
          )                AS updated_at,
          ph."heroKey"       AS hero_key,
          COALESCE(hm.class, '') AS class
        FROM player_hero_skills phs
        JOIN player_heroes ph ON ph.id = phs.hero_id
        LEFT JOIN hero_progress hp ON hp.hero_id = ph.id
        JOIN players p ON p.id = ph."playerId"
        LEFT JOIN heroes_master hm ON hm."heroKey" = ph."heroKey"
        WHERE UPPER(phs.skill_type) = $1
      ), ordered AS (
        SELECT *,
          ROW_NUMBER() OVER (
            ORDER BY
              skill_level DESC,
              level DESC,
              updated_at DESC,
              created_at ASC,
              hero_name ASC
          ) AS rank
        FROM filtered
      )
      SELECT *
      FROM ordered
      ORDER BY rank
      LIMIT $2 OFFSET $3
      `,
      [skill, limit, offset],
      `
      WITH filtered AS (
        SELECT
          phs.hero_id,
          phs.skill_type,
          phs.level          AS skill_level,
          ph."playerId"     AS player_id,
          COALESCE(NULLIF(p.name, ''), 'Unknown') AS player_name,
          ph.name            AS hero_name,
          ph.rarity          AS rarity,
          COALESCE(ph.level, 1) AS level,
          ph."createdAt"     AS created_at,
          to_timestamp(
            CASE
              WHEN ph."createdAt" > 1000000000000 THEN ph."createdAt" / 1000.0
              WHEN ph."createdAt" > 1000000000 THEN ph."createdAt"
              ELSE ph."createdAt"
            END
          )                AS updated_at,
          ph."heroKey"       AS hero_key,
          COALESCE(hm.class, '') AS class
        FROM player_hero_skills phs
        JOIN player_heroes ph ON ph.id = phs.hero_id
        JOIN players p ON p.id = ph."playerId"
        LEFT JOIN heroes_master hm ON hm."heroKey" = ph."heroKey"
        WHERE UPPER(phs.skill_type) = $1
      ), ordered AS (
        SELECT *,
          ROW_NUMBER() OVER (
            ORDER BY
              skill_level DESC,
              level DESC,
              updated_at DESC,
              created_at ASC,
              hero_name ASC
          ) AS rank
        FROM filtered
      )
      SELECT *
      FROM ordered
      ORDER BY rank
      LIMIT $2 OFFSET $3
      `
    );

    res.json(rows.map(mapRow));
  } catch (err) {
    const status = err?.status || 500;
    if (status >= 500) {
      console.error('[leaderboard] skills failed:', err);
    }
    res.status(status).json({ error: err?.message || 'leaderboard-skills-failed' });
  }
});

module.exports = router;
