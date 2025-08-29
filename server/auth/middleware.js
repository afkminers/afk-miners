// server/auth/middleware.js
require('dotenv').config();
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { get } = require('../models/db');
const { randomBytes } = require('crypto');

const NODE_ENV = process.env.NODE_ENV || 'development';
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_DEV_ONLY';

// Aceita ambos os nomes de var, padroniza para 'sid' por default
const COOKIE_NAME =
  process.env.SESSION_COOKIE_NAME ||
  process.env.COOKIE_NAME ||
  'sid';

// Flags vindas do .env
const COOKIE_SAME_SITE = process.env.COOKIE_SAME_SITE || 'Lax';
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined;
const CSRF_COOKIE = process.env.CSRF_COOKIE || 'csrf';

// Em DEV (localhost/http), NUNCA usar Secure. Em PROD, obedece .env.
const COOKIE_SECURE_ENV =
  String(process.env.COOKIE_SECURE || 'false').toLowerCase() === 'true';
const EFFECTIVE_SECURE = NODE_ENV === 'production' ? COOKIE_SECURE_ENV : false;

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

async function requireAuth(req, res, next) {
  try {
    const raw = req.cookies[COOKIE_NAME];
    if (!raw) return res.status(401).json({ error: 'Não autenticado' });

    const decoded = jwt.verify(raw, JWT_SECRET);

    // Postgres usa $1, $2...
    const user = await get(
      `SELECT id, name, coins, gems FROM players WHERE id = $1`,
      [decoded.id]
    );

    if (!user) return res.status(401).json({ error: 'Sessão inválida' });

    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Sessão inválida' });
  }
}

// CSRF double-submit cookie
function csrfRoute(_req, res) {
  const t = randomBytes(24).toString('hex');
  res.cookie(CSRF_COOKIE, t, {
    httpOnly: false,            // client lê e manda no header
    sameSite: COOKIE_SAME_SITE,
    secure: EFFECTIVE_SECURE,
    path: '/',
    maxAge: 1000 * 60 * 60 * 24 * 7,
  });
  res.json({ csrfToken: t });
}

function requireCsrf(req, res, next) {
  const m = (req.method || 'GET').toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return next();

  const hdr = req.get('x-csrf-token') || '';
  const ck = req.cookies[CSRF_COOKIE] || '';
  if (!hdr || !ck || hdr !== ck) {
    return res.status(403).json({ error: 'CSRF inválido' });
  }
  next();
}

module.exports = {
  cookieParser,
  requireAuth,
  requireCsrf,
  csrfRoute,
  setAuthCookie,
  clearAuthCookie,
};
