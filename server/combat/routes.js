// server/combat/routes.js
// Endpoints do combate: /attack/start, /attack/stop, /hit
// Prefixo vem do index.js: app.use('/api/combat', requireAuth, router)

const express = require('express');
const router = express.Router();
const { get, run } = require('../models/db');

router.use((req, _res, next) => {
  console.log(`[combat] ${req.method} ${req.originalUrl}`);
  next();
});

router.get('/_ping', (_req, res) => res.json({ ok: true, ts: Date.now() }));
router.get('/_routes', (_req, res) => {
  const list = (router.stack || [])
    .filter(l => l.route)
    .map(l => ({ path: l.route.path, methods: Object.keys(l.route.methods || {}) }));
  res.json({ routes: list });
});

router.post('/attack/start', (_req, res) => res.json({ ok: true }));
router.post('/attack/stop', (_req, res) => res.json({ ok: true }));

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ====== HIT (DB-only, tolerante a id numérico) ==============================
router.post('/hit', express.json(), async (req, res) => {
  try {
    const raw =
      req.body?.id ??
      req.body?.targetInstanceId ??
      req.query?.id;

    if (!raw) return res.status(400).json({ ok: false, error: 'missing-id' });

    let mi;

    if (UUID_RE.test(String(raw))) {
      // id é UUID -> monster_instances.id
      mi = await get(
        `
        SELECT mi.id, mi.hp, mi.max_hp, mi.spawn_id, s."respawnSec"
          FROM monster_instances mi
          JOIN spawns s ON s.id = mi.spawn_id
         WHERE mi.id = $1
           AND mi.state = 'ALIVE'
        `,
        [String(raw)]
      );
    } else if (/^\d+$/.test(String(raw))) {
      const asNumber = Number(raw);
      // 1) tentar por monsters_master.id (ex.: goblin=2)
      mi = await get(
        `
        SELECT mi.id, mi.hp, mi.max_hp, mi.spawn_id, s."respawnSec"
          FROM monster_instances mi
          JOIN spawns s ON s.id = mi.spawn_id
          JOIN monsters_master mm ON mm.key = s."monsterKey"
         WHERE mi.state = 'ALIVE'
           AND mm.id = $1
         ORDER BY mi.updated_at DESC
         LIMIT 1
        `,
        [asNumber]
      ) || null;

      // 2) fallback: tentar por spawn_id (se o número for um spawn válido)
      if (!mi) {
        mi = await get(
          `
          SELECT mi.id, mi.hp, mi.max_hp, mi.spawn_id, s."respawnSec"
            FROM monster_instances mi
            JOIN spawns s ON s.id = mi.spawn_id
           WHERE mi.state = 'ALIVE'
             AND mi.spawn_id = $1
           ORDER BY mi.updated_at DESC
           LIMIT 1
          `,
          [asNumber]
        ) || null;
      }
    } else {
      return res.status(400).json({ ok: false, error: 'bad-id' });
    }

    if (!mi) {
      return res.status(404).json({ ok: false, error: 'no-such-alive' });
    }

    const DMG = Number.isFinite(+req.body?.damage)
      ? Math.max(1, Math.floor(+req.body.damage))
      : 10;

    let hp = Math.max(0, Number(mi.hp) - DMG);
    let dead = false;

    if (hp <= 0) {
      dead = true;
      hp = 0;
      const secs = Math.max(5, Number(mi.respawnSec) || 30);

      await run(
        `
        UPDATE monster_instances
           SET state='DEAD',
               hp=0,
               respawn_at = now() + make_interval(secs => $2),
               updated_at = now()
         WHERE id = $1
        `,
        [mi.id, secs]
      );
    } else {
      await run(
        `UPDATE monster_instances SET hp=$2, updated_at=now() WHERE id=$1`,
        [mi.id, hp]
      );
    }

    return res.json({
      ok: true,
      id: mi.id,
      dmg: DMG,
      hp,
      maxHp: Number(mi.max_hp) || 0,
      dead,
    });
  } catch (e) {
    console.error('[combat] /hit error:', e);
    return res.status(500).json({ ok: false, error: 'hit-failed' });
  }
});

module.exports = router;
