// server/middleware/requireAdmin.js
const ADMIN_ENV = 'ADMIN_NAMES';
let missingAdminWarningShown = false;

function parseAdmins(raw) {
  return String(raw || '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

module.exports = function requireAdmin(req, res, next) {
  const sessionUser = req.session?.player || req.user || null;
  if (!sessionUser) {
    return res.status(401).json({ error: 'unauthenticated' });
  }

  const admins = parseAdmins(process.env[ADMIN_ENV]);
  if (!admins.length && !missingAdminWarningShown) {
    console.warn('[admin] ADMIN_NAMES env not configured');
    missingAdminWarningShown = true;
  }

  const name = String(sessionUser.name || '').toLowerCase();
  if (!name || !admins.includes(name)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  return next();
};
