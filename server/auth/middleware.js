// server/auth/middleware.js
require('dotenv').config();
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { get } = require('../models/db');
const { randomBytes } = require('crypto');

/* =================== ENV =================== */
const NODE_ENV   = process.env.NODE_ENV || 'development';
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_DEV_ONLY';

// Nome do cookie de sessão (mantém compatibilidade)
const COOKIE_NAME =
  process.env.SESSION_COOKIE_NAME ||
  process.env.COOKIE_NAME ||
  'sid';

// CSRF + origem
const COOKIE_SAME_SITE = process.env.COOKIE_SAME_SITE || 'Lax';
const COOKIE_DOMAIN    = process.env.COOKIE_DOMAIN || undefined;
const CSRF_COOKIE      = process.env.CSRF_COOKIE || 'csrf';
const APP_ORIGIN       = process.env.APP_ORIGIN || 'http://localhost:3000';

// Em DEV (http://localhost), não usar Secure
const COOKIE_SECURE_ENV =
  String(process.env.COOKIE_SECURE || 'false').toLowerCase() === 'true';
const EFFECTIVE_SECURE = NODE_ENV === 'production' ? COOKIE_SECURE_ENV : false;

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
  res.clearCookie(COOKIE_NAME, {
    path: '/',
    sameSite: base.sameSite,
    secure: base.secure,
    domain: base.domain,
  });
}

/* =================== Auth guard =================== */
async function requireAuth(req, res, next) {
  try {
    const raw = req.cookies[COOKIE_NAME];
    if (!raw) return res.status(401).json({ error: 'Não autenticado' });

    const decoded = jwt.verify(raw, JWT_SECRET);
    const user = await get(
      `SELECT id, name, coins, gems FROM players WHERE id = $1`,
      [decoded.id]
    );

    if (!user) return res.status(401).json({ error: 'Sessão inválida' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Sessão inválida' });
  }
}

/* =================== CSRF (double-submit) =================== */
// Envia o token no cookie (client lê e manda no header) e também como header/resposta JSON.
function csrfRoute(_req, res) {
  const t = randomBytes(24).toString('hex');
  res.cookie(CSRF_COOKIE, t, {
    httpOnly: false, // client lê e manda no header
    sameSite: COOKIE_SAME_SITE,
    secure: EFFECTIVE_SECURE,
    path: '/',
    maxAge: 1000 * 60 * 60 * 24 * 7,
  });
  res.set('X-CSRF-Token', t);
  res.json({ csrfToken: t });
}

// Bloqueia apenas se o navegador INFORMAR uma origem inválida.
// Se Origin/Referer não vierem (p.ex. política no-referrer), não bloqueia aqui;
// a proteção real continua pelo token CSRF de double-submit.
function isBadCrossOrigin(req) {
  const origin  = req.headers.origin  || '';
  const referer = req.headers.referer || '';
  const app = String(APP_ORIGIN || '').replace(/\/+$/, ''); // sem barra final

  if (origin && !origin.startsWith(app))   return true;
  if (referer && !referer.startsWith(app)) return true;
  return false;
}

function requireCsrf(req, res, next) {
  const m = (req.method || 'GET').toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return next();

  if (isBadCrossOrigin(req)) {
    return res.status(403).json({ error: 'Bad origin' });
  }

  const hdr = req.get('x-csrf-token') || req.get('X-CSRF-Token') || '';
  const ck  = req.cookies[CSRF_COOKIE] || '';
  if (!hdr || !ck || hdr !== ck) {
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
