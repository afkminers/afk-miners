// server/auth/middleware.js
require('dotenv').config();
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { get } = require('../models/db');
const { randomBytes } = require('crypto');
const { isOriginAllowed: isCorsOriginAllowed } = require('../middleware/cors-allowlist');

/* =================== ENV =================== */
const NODE_ENV   = process.env.NODE_ENV || 'development';
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_DEV_ONLY';

// Nome do cookie de sessão

const COOKIE_NAME =
  process.env.SESSION_COOKIE_NAME ||
  process.env.COOKIE_NAME ||
  'sid';

const RAW_COOKIE_DOMAIN = process.env.COOKIE_DOMAIN;
// Em prod, não forçamos mais automaticamente o domínio .afkminers.com.
// - Se COOKIE_DOMAIN estiver definido, usamos esse valor.
// - Caso contrário, o cookie fica "host-only" (sem domain explícito),
//   o que funciona tanto em localhost quanto em afkminers.com.
const COOKIE_DOMAIN = RAW_COOKIE_DOMAIN || undefined;

function normalizeSameSite(value) {
  if (!value) return null;
  const clean = String(value).trim().toLowerCase();
  if (clean === 'none') return 'None';
  if (clean === 'lax') return 'Lax';
  if (clean === 'strict') return 'Strict';
  return null;
}


const COOKIE_SAME_SITE =
  normalizeSameSite(process.env.COOKIE_SAME_SITE) || 'Lax';

const CSRF_COOKIE = process.env.CSRF_COOKIE || 'csrf';

const COOKIE_SECURE_ENV = process.env.COOKIE_SECURE;
let EFFECTIVE_SECURE;
if (COOKIE_SECURE_ENV != null) {
  EFFECTIVE_SECURE = String(COOKIE_SECURE_ENV).toLowerCase() === 'true';
} else {
  EFFECTIVE_SECURE = NODE_ENV === 'production';
}
if (COOKIE_SAME_SITE === 'None' && !EFFECTIVE_SECURE) {
  EFFECTIVE_SECURE = true;
}

/* =================== Cookies =================== */
function cookieOpts() {
  const base = {
    httpOnly: true,
    sameSite: COOKIE_SAME_SITE,
    secure: EFFECTIVE_SECURE,
    path: '/',
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 dias
  };
  if (COOKIE_DOMAIN) base.domain = COOKIE_DOMAIN;
  return base;
}

function setAuthCookie(res, payload) {
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
  res.cookie(COOKIE_NAME, token, cookieOpts());
}

function clearAuthCookie(res) {
  const base = cookieOpts();
  const opts = {
    path: '/',
    sameSite: base.sameSite,
    secure: base.secure,
  };
  if (base.domain) opts.domain = base.domain;
  res.clearCookie(COOKIE_NAME, opts);
}

function isLeaderboardRequest(req) {
  const url = String(req?.originalUrl || req?.baseUrl || req?.url || '');
  return url.startsWith('/api/leaderboard');
}

function logLeaderboardBlock(req, reason) {
  if (!isLeaderboardRequest(req)) return;
  const url = req.originalUrl || req.url || req.baseUrl || '';
  console.warn('[leaderboard][guard-block]', req.method || 'GET', url, '-', reason);
}

/* =================== Auth guard =================== */
async function requireAuth(req, res, next) {
  const raw = req.cookies[COOKIE_NAME];
  if (!raw) {
    logLeaderboardBlock(req, 'missing-session-cookie');
    return res.status(401).json({ error: 'Não autenticado' });
  }

  let decoded;
  try {
    decoded = jwt.verify(raw, JWT_SECRET);
  } catch (err) {
    logLeaderboardBlock(req, 'invalid-session-token');
    return res.status(401).json({ error: 'Sessão inválida' });
  }

  try {
    const user = await get(
      `SELECT id, name, coins, gems FROM players WHERE id = $1`,
      [decoded.id]
    );

    if (!user) {
      logLeaderboardBlock(req, 'session-player-missing');
      return res.status(401).json({ error: 'Sessão inválida' });
    }
    req.user = user;
    return next();
  } catch (err) {
    logLeaderboardBlock(req, 'session-lookup-error');
    return res.status(401).json({ error: 'Sessão inválida' });
  }
}

/* =================== CSRF (double-submit) =================== */
// Emite token e seta cookie legível no client (double-submit)
function csrfRoute(req, res) {
  const t = randomBytes(24).toString('hex');

  // Em localhost, ignoramos qualquer COOKIE_DOMAIN para garantir
  // que o cookie seja aceito pelo navegador.
  const host = String(req.hostname || '').toLowerCase();
  const useDomain =
    COOKIE_DOMAIN &&
    host &&
    host !== 'localhost' &&
    host !== '127.0.0.1' &&
    host !== '::1';

  res.cookie(CSRF_COOKIE, t, {
    httpOnly: false,                // client lê e manda no header
    sameSite: COOKIE_SAME_SITE,
    secure: EFFECTIVE_SECURE,
    path: '/',
    maxAge: 1000 * 60 * 60 * 24 * 7,
    ...(useDomain ? { domain: COOKIE_DOMAIN } : {}),
  });
  res.set('X-CSRF-Token', t);
  res.json({ csrfToken: t });
}


function requireCsrf(req, res, next) {
  const m = (req.method || 'GET').toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return next();

  // 1) valida origem amigavelmente (múltiplas origens)
  const origin = (req.headers.origin || '').trim();
  const referer = (req.headers.referer || '').trim();
  const originOk = !origin || isCorsOriginAllowed(origin);
  const refererOk = !referer || isCorsOriginAllowed(referer);
  if (!originOk || !refererOk) {
    logLeaderboardBlock(req, 'csrf-bad-origin');
    return res.status(403).json({ error: 'Bad origin' });
  }

  // 2) valida token double-submit
  const headerToken = (req.get('x-csrf-token') || req.get('X-CSRF-Token') || req.get('csrf-token') || '').trim();
  const queryToken = (() => {
    const value = req.query?.csrf || req.query?._csrf || req.query?.csrfToken || req.query?.token;
    return typeof value === 'string' ? value.trim() : '';
  })();
  const bodyToken = (() => {
    if (!req.body || typeof req.body !== 'object') return '';
    const value =
      req.body.csrf ||
      req.body._csrf ||
      req.body.csrfToken ||
      req.body.csrf_token ||
      req.body.token ||
      '';
    return typeof value === 'string' ? value.trim() : '';
  })();

  const ck = (req.cookies[CSRF_COOKIE] || '').trim();
  const candidates = [headerToken, bodyToken, queryToken].filter(Boolean);
  const valid = ck && candidates.some((value) => value === ck);

  if (!valid) {
    logLeaderboardBlock(req, 'csrf-token-mismatch');
    return res.status(403).json({ error: 'CSRF inválido' });
  }
  next();
}

/* =================== Exports =================== */
module.exports = {
  cookieParser,
  requireAuth,
  requireCsrf,
  csrfRoute,
  setAuthCookie,
  clearAuthCookie,
};
