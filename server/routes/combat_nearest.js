// require os helpers que você já usa (auth, db, etc.)
const express = require('express');
const router = express.Router();

// ajuste para o seu middleware de auth, se houver
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  next();
}

// GET /api/combat/nearest?map=house&x=850&y=650
router.get('/api/combat/nearest', requireAuth, async (req, res) => {
  const mapKey = String(req.query.map || '').trim();
  const x = Number(req.query.x), y = Number(req.query.y);
  if (!mapKey || !Number.isFinite(x) || !Number.isFinite(y)) {
    return res.status(400).json({ error: 'bad_request' });
  }

  try {
    // pega a instância viva mais próxima, posicionada pelo spawn
    const row = await req.db.oneOrNone(`
      SELECT mi.id, s.x, s.y
      FROM monster_instances mi
      JOIN spawns s ON s.id = mi.spawn_id
      WHERE mi.state = 'ALIVE' AND mi.map_key = $1
      ORDER BY ((s.x - $2)*(s.x - $2) + (s.y - $3)*(s.y - $3)) ASC
      LIMIT 1
    `, [mapKey, x, y]);

    if (!row) return res.status(404).json({ error: 'no_monsters' });
    res.json({ id: row.id, x: row.x, y: row.y });
  } catch (e) {
    console.error('[combat/nearest]', e);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
