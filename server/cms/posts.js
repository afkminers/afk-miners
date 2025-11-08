// server/cms/posts.js
const express = require('express');
const { z } = require('zod');

const { all, run, getPool } = require('../models/db');
const { SUPPORTED_LOCALES, normalizeLocale } = require('./i18n');
const { sanitizePostBody } = require('./sanitize');

const ALLOWED_PAGES = ['index', 'overview', 'roadmap'];

function sanitizeBody(value) {
  return sanitizePostBody(value);
}

const localeSchema = z.enum(SUPPORTED_LOCALES);
const pageSchema = z.enum(ALLOWED_PAGES);

const optionalString = (max) =>
  z
    .preprocess((value) => {
      if (value === undefined || value === null) return undefined;
      return String(value).trim();
    }, z.string().max(max))
    .optional();

const basePostSchema = z.object({
  page: pageSchema,
  locale: localeSchema,
  title: z.string().trim().min(1, 'title_required'),
  summary: z.string().trim().min(1, 'summary_required'),
  body_html: z
    .string()
    .or(z.null())
    .optional(),
  tag: optionalString(64),
  link_href: optionalString(1024),
  link_label: optionalString(255),
  published_at: z
    .preprocess((value) => {
      if (!value && value !== 0) return undefined;
      if (value instanceof Date) return value;
      const str = String(value || '').trim();
      if (!str) return undefined;
      const parsed = new Date(str);
      if (Number.isNaN(parsed.getTime())) {
        return null;
      }
      return parsed;
    }, z.date())
    .optional(),
  sort_index: z.coerce.number().int().optional(),
  is_published: z.coerce.boolean().optional(),
});

const createPostSchema = basePostSchema;
const updatePostSchema = basePostSchema.partial();

const reorderSchema = z.object({
  page: pageSchema,
  locale: localeSchema,
  order: z
    .array(
      z.object({
        id: z.coerce.number().int(),
        sort_index: z.coerce.number().int(),
      })
    )
    .min(1, 'order_required'),
});

function mapPostRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    page: row.page,
    locale: row.locale,
    title: row.title,
    summary: row.summary,
    body_html: row.body_html || null,
    tag: row.tag || null,
    link_href: row.link_href || null,
    link_label: row.link_label || null,
    published_at: row.published_at ? new Date(row.published_at).toISOString() : null,
    sort_index: Number(row.sort_index) || 0,
    is_published: Boolean(row.is_published),
  };
}

const publicRouter = express.Router();

publicRouter.get('/posts', async (req, res) => {
  try {
    const page = Array.isArray(req.query.page) ? req.query.page[0] : req.query.page;
    const localeRaw = Array.isArray(req.query.lang) ? req.query.lang[0] : req.query.lang;
    if (!page || !ALLOWED_PAGES.includes(page)) {
      return res.status(400).json({ error: 'invalid_page' });
    }
    const locale = normalizeLocale(localeRaw, 'en');

    const rows = await all(
      `SELECT id, title, summary, body_html, tag, link_href, link_label, published_at, sort_index
         FROM cms_posts
        WHERE page = $1 AND locale = $2 AND is_published = TRUE
        ORDER BY sort_index DESC, published_at DESC, id DESC`,
      [page, locale]
    );

    res.json(rows.map((row) => ({
      id: Number(row.id),
      title: row.title,
      summary: row.summary,
      body_html: row.body_html || null,
      tag: row.tag || null,
      link_href: row.link_href || null,
      link_label: row.link_label || null,
      published_at: row.published_at ? new Date(row.published_at).toISOString() : null,
      sort_index: Number(row.sort_index) || 0,
    })));
  } catch (err) {
    console.error('[cms][posts][public] list error:', err);
    res.status(500).json({ error: 'failed_to_load_posts' });
  }
});

const adminRouter = express.Router();

adminRouter.get('/posts', async (req, res) => {
  try {
    const page = Array.isArray(req.query.page) ? req.query.page[0] : req.query.page;
    const localeRaw = Array.isArray(req.query.lang) ? req.query.lang[0] : req.query.lang;
    if (!page || !ALLOWED_PAGES.includes(page)) {
      return res.status(400).json({ error: 'invalid_page' });
    }
    const locale = normalizeLocale(localeRaw, 'en');

    const rows = await all(
      `SELECT id, page, locale, title, summary, body_html, tag, link_href, link_label,
              published_at, sort_index, is_published
         FROM cms_posts
        WHERE page = $1 AND locale = $2
        ORDER BY sort_index DESC, published_at DESC, id DESC`,
      [page, locale]
    );

    res.json(rows.map(mapPostRow));
  } catch (err) {
    console.error('[cms][posts][admin] list error:', err);
    res.status(500).json({ error: 'failed_to_list_posts' });
  }
});

adminRouter.post('/posts', async (req, res) => {
  const parsed = createPostSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_payload', details: parsed.error.flatten() });
  }
  const data = parsed.data;

  if (data.published_at === null) {
    return res.status(400).json({ error: 'invalid_date' });
  }

  const bodyHtml = sanitizeBody(data.body_html);
  const tag = data.tag ? data.tag.trim() : null;
  const linkHref = data.link_href ? data.link_href.trim() : null;
  const linkLabel = data.link_label ? data.link_label.trim() : null;
  const publishedAt = data.published_at ? data.published_at.toISOString() : null;
  const sortIndex = Number.isFinite(data.sort_index) ? data.sort_index : 0;
  const isPublished = data.is_published != null ? Boolean(data.is_published) : true;

  try {
    const result = await run(
      `INSERT INTO cms_posts
        (page, locale, title, summary, body_html, tag, link_href, link_label,
         published_at, sort_index, is_published)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, now()), $10, $11)
       RETURNING id, page, locale, title, summary, body_html, tag, link_href, link_label,
                 published_at, sort_index, is_published`,
      [
        data.page,
        data.locale,
        data.title.trim(),
        data.summary.trim(),
        bodyHtml,
        tag,
        linkHref,
        linkLabel,
        publishedAt,
        sortIndex,
        isPublished,
      ]
    );
    res.status(201).json(mapPostRow(result.rows[0]));
  } catch (err) {
    console.error('[cms][posts][admin] create error:', err);
    res.status(500).json({ error: 'failed_to_create_post' });
  }
});

adminRouter.put('/posts/:id', async (req, res) => {
  const parsed = updatePostSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_payload', details: parsed.error.flatten() });
  }
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'invalid_id' });
  }

  const updates = parsed.data;
  if (updates.published_at === null) {
    return res.status(400).json({ error: 'invalid_date' });
  }

  const sets = [];
  const values = [];
  let idx = 1;

  const pushUpdate = (clause, value) => {
    sets.push(`${clause} = $${idx}`);
    values.push(value);
    idx += 1;
  };

  if (updates.page) pushUpdate('page', updates.page);
  if (updates.locale) pushUpdate('locale', updates.locale);
  if (typeof updates.title === 'string') pushUpdate('title', updates.title.trim());
  if (typeof updates.summary === 'string') pushUpdate('summary', updates.summary.trim());
  if ('body_html' in updates) pushUpdate('body_html', sanitizeBody(updates.body_html));
  if ('tag' in updates) pushUpdate('tag', updates.tag ? updates.tag.trim() : null);
  if ('link_href' in updates) pushUpdate('link_href', updates.link_href ? updates.link_href.trim() : null);
  if ('link_label' in updates) pushUpdate('link_label', updates.link_label ? updates.link_label.trim() : null);
  if ('published_at' in updates) {
    const publishedAt = updates.published_at ? updates.published_at.toISOString() : null;
    pushUpdate('published_at', publishedAt);
  }
  if ('sort_index' in updates) {
    const sortIndex = Number.isFinite(updates.sort_index) ? updates.sort_index : 0;
    pushUpdate('sort_index', sortIndex);
  }
  if ('is_published' in updates) {
    pushUpdate('is_published', updates.is_published != null ? Boolean(updates.is_published) : true);
  }

  if (!sets.length) {
    return res.status(400).json({ error: 'no_fields_to_update' });
  }

  try {
    const result = await run(
      `UPDATE cms_posts
          SET ${sets.join(', ')}
        WHERE id = $${idx}
        RETURNING id, page, locale, title, summary, body_html, tag, link_href, link_label,
                  published_at, sort_index, is_published`,
      [...values, id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'post_not_found' });
    }
    res.json(mapPostRow(result.rows[0]));
  } catch (err) {
    console.error('[cms][posts][admin] update error:', err);
    res.status(500).json({ error: 'failed_to_update_post' });
  }
});

adminRouter.delete('/posts/:id', async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'invalid_id' });
  }
  try {
    const result = await run('DELETE FROM cms_posts WHERE id = $1 RETURNING id', [id]);
    if (!result.rowCount) {
      return res.status(404).json({ error: 'post_not_found' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[cms][posts][admin] delete error:', err);
    res.status(500).json({ error: 'failed_to_delete_post' });
  }
});

adminRouter.patch('/posts/reorder', async (req, res) => {
  const parsed = reorderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_payload', details: parsed.error.flatten() });
  }
  const { page, locale, order } = parsed.data;
  const ids = order.map((item) => item.id);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT id FROM cms_posts WHERE id = ANY($1::int[]) AND page = $2 AND locale = $3`,
      [ids, page, locale]
    );
    if (existing.rowCount !== order.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'posts_mismatch' });
    }

    for (const item of order) {
      await client.query(
        `UPDATE cms_posts SET sort_index = $1 WHERE id = $2 AND page = $3 AND locale = $4`,
        [item.sort_index, item.id, page, locale]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[cms][posts][admin] reorder rollback failed:', rollbackErr);
    }
    console.error('[cms][posts][admin] reorder error:', err);
    res.status(500).json({ error: 'failed_to_reorder_posts' });
  } finally {
    client.release();
  }
});

module.exports = { publicRouter, adminRouter, mapPostRow, sanitizeBody, ALLOWED_PAGES };
