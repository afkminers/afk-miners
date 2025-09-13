const cors = require('cors');

function parseOrigins() {
  const raw = process.env.APP_ORIGINS || 'http://localhost:3000';
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

function sameOrigin(a, b) {
  try { return new URL(a).origin === new URL(b).origin; } catch { return a === b; }
}

function buildCors() {
  const allow = parseOrigins();
  return cors({
    origin(origin, cb) {
      // Sem origin (curl, same-origin) → permite
      if (!origin) return cb(null, true);
      const ok = allow.some(a => sameOrigin(a, origin));
      return cb(null, ok);
    },
    credentials: true,
  });
}

module.exports = { buildCors, parseOrigins };