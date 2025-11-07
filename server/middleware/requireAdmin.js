// server/middleware/requireAdmin.js
const { requireAuth } = require('../auth/middleware');

const ADMIN_ENV = 'ADMIN_NAMES';
let missingAdminWarningShown = false;

function parseAdmins(raw) {
  return String(raw || '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function getAdminNames() {
  const admins = parseAdmins(process.env[ADMIN_ENV]);
  if (!admins.length && !missingAdminWarningShown) {
    console.warn('[admin] ADMIN_NAMES env not configured');
    missingAdminWarningShown = true;
  }
  return admins;
}

function isAdminName(name) {
  const normalized = String(name || '').toLowerCase();
  if (!normalized) return false;
  const admins = getAdminNames();
  return admins.includes(normalized);
}

function enforceAdmin(req, res, next) {
  const sessionUser = req.session?.player || req.user || null;
  if (!sessionUser) {
    if (!res.headersSent) {
      res.status(401).json({ error: 'unauthenticated' });
    }
    return;
  }

  if (!isAdminName(sessionUser.name)) {
    if (!res.headersSent) {
      res.status(403).json({ error: 'forbidden' });
    }
    return;
  }

  return next();
}

function requireAdmin(req, res, next) {
  if (req.session?.player || req.user) {
    return enforceAdmin(req, res, next);
  }

  const maybePromise = requireAuth(req, res, (err) => {
    if (err) return next(err);
    return enforceAdmin(req, res, next);
  });

  if (maybePromise && typeof maybePromise.then === 'function') {
    maybePromise.catch((err) => {
      if (!res.headersSent) next(err);
    });
    return maybePromise;
  }

  return undefined;
}

module.exports = Object.assign(requireAdmin, {
  isAdminName,
  getAdminNames,
});
