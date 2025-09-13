// Burst limiter por usuário (req.user.id) ou IP.
// Ex.: app.use('/api/player/pos', makeLimiter({ windowMs: 1000, max: 10 }))
const rateLimit = require('express-rate-limit');

module.exports = function makeLimiter({ windowMs = 1000, max = 10, message = 'Too many requests' } = {}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => (req.user?.id ? `u:${req.user.id}` : req.ip),
    message,
  });
};