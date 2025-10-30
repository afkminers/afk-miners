const cors = require('cors');

const DEFAULT_EXPLICIT = [
  'http://localhost:3000',
  'http://localhost:8080',
  'https://afkminers.com',
];

function normalizeOrigin(raw) {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!url.protocol || !url.host) return null;
    return `${url.protocol}//${url.host}`;
  } catch (_) {
    return null;
  }
}

function parseOrigins() {
  const env = process.env.APP_ORIGINS || process.env.APP_ORIGIN || '';
  const parts = env
    .split(',')
    .map((s) => normalizeOrigin(s.trim()))
    .filter(Boolean);
  const merged = new Set([...DEFAULT_EXPLICIT.map(normalizeOrigin).filter(Boolean), ...parts]);
  return Array.from(merged);
}

function isAfkminersHost(hostname) {
  return hostname === 'afkminers.com' || hostname.endsWith('.afkminers.com');
}

function isLocalhostAllowed(url) {
  if (url.hostname !== 'localhost') return false;
  return url.port === '3000' || url.port === '8080';
}

function isOriginAllowed(origin) {
  if (!origin) return true;
  let url;
  try {
    url = new URL(origin);
  } catch (_) {
    return false;
  }

  if (!['http:', 'https:'].includes(url.protocol)) return false;

  if (url.protocol === 'https:' && isAfkminersHost(url.hostname)) {
    return true;
  }

  if (url.protocol === 'http:' && isLocalhostAllowed(url)) {
    return true;
  }

  const normalized = normalizeOrigin(origin);
  return parseOrigins().some((allowed) => allowed === normalized);
}

function buildCors() {
  return cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (isOriginAllowed(origin)) {
        return cb(null, origin);
      }
      console.warn('[cors] blocked origin:', origin);
      return cb(null, false);
    },
    credentials: true,
  });
}

module.exports = { buildCors, parseOrigins, isOriginAllowed };
