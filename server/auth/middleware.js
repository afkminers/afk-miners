require('dotenv').config();
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { get } = require('../models/db');
const { randomBytes } = require('crypto');

const NODE_ENV = process.env.NODE_ENV || 'development';
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_DEV_ONLY';
const COOKIE_NAME = process.env.COOKIE_NAME || 'sid';
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || 'false').toLowerCase() === 'true';
const COOKIE_SAME_SITE = process.env.COOKIE_SAME_SITE || 'Lax';
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined;
const CSRF_COOKIE = process.env.CSRF_COOKIE || 'csrf';

function cookieOpts() {
  const base = {
    httpOnly: true,
    sameSite: COOKIE_SAME_SITE,
    secure: COOKIE_SECURE,
    path: '/',
    maxAge: 1000 * 60 * 60 * 24 * 7,
  };
  if (COOKIE_DOMAIN) base.domain = COOKIE_DOMAIN;
  return base;
}

function setAuthCookie(res, payload) {
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
  res.cookie(COOKIE_NAME, token, cookieOpts());
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

async function requireAuth(req, res, next) {
  try {
    const raw = req.cookies[COOKIE_NAME];
    if (!raw) return res.status(401).json({ error: 'Não autenticado' });
    const decoded = jwt.verify(raw, JWT_SECRET);
    const user = await get(`SELECT id,name,coins,gems FROM players WHERE id=?`, [decoded.id]);
    if (!user) return res.status(401).json({ error: 'Sessão inválida' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Sessão inválida' });
  }
}

// CSRF double submit cookie
function csrfRoute(req, res) {
  const t = req.cookies[CSRF_COOKIE] || randomBytes(24).toString('hex');
  res.cookie(CSRF_COOKIE, t, {
    httpOnly: false,
    sameSite: COOKIE_SAME_SITE,
    secure: COOKIE_SECURE,
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
  if (!hdr || !ck || hdr !== ck) return res.status(403).json({ error: 'CSRF inválido' });
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
