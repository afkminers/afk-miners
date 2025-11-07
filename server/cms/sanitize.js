// server/cms/sanitize.js
const sanitizeHtml = require('sanitize-html');

const CMS_SANITIZE_OPTIONS = {
  allowedTags: ['strong', 'em', 'b', 'i', 'u', 'br', 'p', 'ul', 'ol', 'li', 'a', 'small', 'span'],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    span: ['class'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  transformTags: {
    a: (tagName, attribs) => {
      const next = { ...attribs };
      if (next.target && typeof next.target === 'string') {
        next.target = next.target.trim();
      }
      const relTokens = String(next.rel || '')
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean);
      const relSet = new Set(relTokens);
      relSet.add('noopener');
      relSet.add('noreferrer');
      next.rel = Array.from(relSet).join(' ');
      return { tagName, attribs: next };
    },
  },
};

function sanitizeRichText(value) {
  if (value == null) return '';
  return sanitizeHtml(String(value), CMS_SANITIZE_OPTIONS).trim();
}

function sanitizeOverrideValue(value) {
  return sanitizeRichText(value);
}

function sanitizePostBody(value) {
  if (value == null) return null;
  const cleaned = sanitizeRichText(value);
  return cleaned || null;
}

module.exports = {
  CMS_SANITIZE_OPTIONS,
  sanitizeOverrideValue,
  sanitizePostBody,
  sanitizeRichText,
};
