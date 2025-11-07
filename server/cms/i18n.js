// server/cms/i18n.js
const express = require('express');
const { z } = require('zod');

const { all, run } = require('../models/db');
const { sanitizeOverrideValue } = require('./sanitize');

const SUPPORTED_LOCALES = ['en', 'pt-BR'];

function sanitizeValue(value) {
  return sanitizeOverrideValue(value);
}

const localeSchema = z.enum(SUPPORTED_LOCALES);

function normalizeLocale(raw, fallback = 'en') {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return fallback;
  const candidate = String(value);
  const match = SUPPORTED_LOCALES.find((loc) => loc.toLowerCase() === candidate.toLowerCase());
  return match || fallback;
}

function expandFlatObject(source) {
  const result = {};
  if (!source || typeof source !== 'object') return result;
  for (const [flatKey, rawValue] of Object.entries(source)) {
    if (!flatKey) continue;
    const parts = flatKey.split('.');
    let node = result;
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      if (!part) continue;
      if (i === parts.length - 1) {
        node[part] = rawValue;
      } else {
        if (!node[part] || typeof node[part] !== 'object') {
          node[part] = {};
        }
        node = node[part];
      }
    }
  }
  return result;
}

const publicRouter = express.Router();

publicRouter.get('/i18n-overrides', async (req, res) => {
  try {
    const locale = normalizeLocale(req.query.lang, 'en');
    const rows = await all(
      `SELECT key, value FROM cms_i18n_overrides WHERE locale = $1 ORDER BY key ASC`,
      [locale]
    );
    const payload = {};
    for (const row of rows) {
      payload[row.key] = row.value;
    }
    res.json(payload);
  } catch (err) {
    console.error('[cms][i18n][public] failed to list overrides:', err);
    res.status(500).json({ error: 'failed_to_load_overrides' });
  }
});

const adminRouter = express.Router();

adminRouter.get('/i18n', async (req, res) => {
  try {
    const locale = normalizeLocale(req.query.lang, 'en');
    let prefix = '';
    if (req.query.prefix) {
      const rawPrefix = Array.isArray(req.query.prefix) ? req.query.prefix[0] : req.query.prefix;
      prefix = String(rawPrefix || '').trim();
    }

    const params = [locale];
    let sql = `SELECT id, locale, key, value, updated_at FROM cms_i18n_overrides WHERE locale = $1`;
    if (prefix) {
      sql += ' AND key LIKE $2';
      params.push(`${prefix}%`);
    }
    sql += ' ORDER BY key ASC';

    const rows = await all(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('[cms][i18n][admin] list error:', err);
    res.status(500).json({ error: 'failed_to_list_overrides' });
  }
});

const overrideSchema = z.object({
  locale: localeSchema,
  key: z
    .string()
    .trim()
    .min(1, 'key_required')
    .max(255, 'key_too_long'),
  value: z
    .string()
    .trim()
    .min(1, 'value_required'),
});

adminRouter.post('/i18n', async (req, res) => {
  const parsed = overrideSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_payload', details: parsed.error.flatten() });
  }

  const { locale, key, value } = parsed.data;
  const cleanedValue = sanitizeValue(value);
  if (!cleanedValue) {
    return res.status(400).json({ error: 'value_empty_after_sanitize' });
  }

  try {
    const result = await run(
      `INSERT INTO cms_i18n_overrides (locale, key, value, updated_at)
       VALUES ($1, $2, $3, now())
       RETURNING id, locale, key, value, updated_at`,
      [locale, key, cleanedValue]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'override_exists' });
    }
    console.error('[cms][i18n][admin] create error:', err);
    return res.status(500).json({ error: 'failed_to_create_override' });
  }
});

adminRouter.put('/i18n/:id', async (req, res) => {
  const parsed = overrideSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_payload', details: parsed.error.flatten() });
  }
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'invalid_id' });
  }

  const { locale, key, value } = parsed.data;
  const cleanedValue = sanitizeValue(value);
  if (!cleanedValue) {
    return res.status(400).json({ error: 'value_empty_after_sanitize' });
  }

  try {
    const result = await run(
      `UPDATE cms_i18n_overrides
         SET locale = $1,
             key = $2,
             value = $3,
             updated_at = now()
       WHERE id = $4
       RETURNING id, locale, key, value, updated_at`,
      [locale, key, cleanedValue, id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'override_not_found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'override_exists' });
    }
    console.error('[cms][i18n][admin] update error:', err);
    return res.status(500).json({ error: 'failed_to_update_override' });
  }
});

adminRouter.delete('/i18n/:id', async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'invalid_id' });
  }
  try {
    const result = await run(`DELETE FROM cms_i18n_overrides WHERE id = $1 RETURNING id`, [id]);
    if (!result.rowCount) {
      return res.status(404).json({ error: 'override_not_found' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[cms][i18n][admin] delete error:', err);
    res.status(500).json({ error: 'failed_to_delete_override' });
  }
});

module.exports = {
  publicRouter,
  adminRouter,
  expandFlatObject,
  sanitizeValue,
  SUPPORTED_LOCALES,
  normalizeLocale,
};
