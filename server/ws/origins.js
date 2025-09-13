const { parseOrigins } = require('../middleware/cors-allowlist');

function isOriginAllowed(origin) {
  if (!origin) return true; // clientes nativos/sem origin
  const allow = parseOrigins();
  try {
    const o = new URL(origin).origin;
    return allow.some(a => {
      try { return new URL(a).origin === o; } catch { return a === origin; }
    });
  } catch {
    return false;
  }
}

module.exports = { isOriginAllowed };