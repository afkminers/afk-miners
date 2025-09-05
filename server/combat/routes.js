// server/combat/routes.js
// Endpoints do combate: /attack/start, /attack/stop, /hit
// Prefixo vem do index.js: app.use('/api/combat', requireAuth, router)

const express = require('express');
const router = express.Router();

const K = require('../balance/config');
const autoloop = require('./autoloop');

const { get } = require('../models/db'); // usado no /hit debug
const { getHeroPos, getMonsterPos } = require('./pos');
const { inReachPx } = require('./geom');
const { hasLineOfSight } = require('./los');
const { getGrid } = require('../maps/grid');

const DEBUG = String(process.env.COMBAT_DEBUG || '').trim() === '1';

router.use((req, _res, next) => {
  if (DEBUG) console.log(`[combat] ${req.method} ${req.originalUrl}`);
  next();
});

router.get('/_ping', (_req, res) => res.json({ ok: true, ts: Date.now() }));
router.get('/_routes', (_req, res) => {
  const list = (router.stack || [])
    .filter(l => l.route)
    .map(l => ({ path: l.route.path, methods: Object.keys(l.route.methods || {}) }));
  res.json({ routes: list });
});

// ====== START/STOP (valida reach + LOS no start) ===========================
router.post('/attack/start', express.json(), async (req, res) => {
  try {
    const { heroId, targetInstanceId, weaponType } = req.body || {};
    if (!heroId || !targetInstanceId) {
      return res.status(400).json({ ok:false, error:'missing-params' });
    }

    const mobPos = await getMonsterPos(targetInstanceId);
    if (!mobPos) return res.status(400).json({ ok:false, error:'mob-pos-missing' });

    const heroPos = await getHeroPos(heroId, mobPos.map_key);
    if (!heroPos) return res.status(400).json({ ok:false, error:'hero-pos-missing' });

    if (heroPos.map_key !== mobPos.map_key) {
      return res.json({ ok:false, error:'map-diff' });
    }

    // pega grid linear e envolve em wrapper p/ LOS
    const { grid, cols } = await getGrid(heroPos.map_key);
    const losGrid = { data: grid, cols };

    if (!inReachPx(heroPos, mobPos, weaponType, K)) {
      return res.json({ ok:false, error:'out_of_range' });
    }
    if (!hasLineOfSight(losGrid, heroPos.x, heroPos.y, mobPos.x, mobPos.y)) {
      return res.json({ ok:false, error:'no_los' });
    }

    autoloop.start(heroId, targetInstanceId, weaponType);
    return res.json({ ok:true });
  } catch (e) {
    console.error('[combat] /attack/start error:', e);
    return res.status(500).json({ ok:false, error:'start-failed' });
  }
});

router.post('/attack/stop', express.json(), async (req, res) => {
  try {
    const { heroId } = req.body || {};
    if (!heroId) return res.status(400).json({ ok:false, error:'missing-hero' });
    autoloop.stop(heroId);
    return res.json({ ok:true });
  } catch (e) {
    console.error('[combat] /attack/stop error:', e);
    return res.status(500).json({ ok:false, error:'stop-failed' });
  }
});

// ====== HIT (debug DB-only; mantenha OFF em prod) =========================
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.post('/hit', express.json(), async (req, res) => {
  try {
    const raw = req.body?.id ?? req.body?.targetInstanceId ?? req.query?.id;
    if (!raw) return res.status(400).json({ ok: false, error: 'missing-id' });

    let mi;

    if (UUID_RE.test(String(raw))) {
      mi = await get(
        `SELECT mi.id, mi.hp, mi.max_hp, mi.spawn_id, s."respawnSec"
           FROM monster_instances mi
           JOIN spawns s ON s.id = mi.spawn_id
          WHERE mi.id = $1
            AND mi.state = 'ALIVE'`,
        [String(raw)]
      );
    } else if (/^\d+$/.test(String(raw))) {
      const asNumber = Number(raw);
      mi = await get(
        `SELECT mi.id, mi.hp, mi.max_hp, mi.spawn_id, s."respawnSec"
           FROM monster_instances mi
           JOIN spawns s ON s.id = mi.spawn_id
           JOIN monsters_master mm ON mm.key = s."monsterKey"
          WHERE mi.state = 'ALIVE'
            AND mm.id = $1
          ORDER BY mi.updated_at DESC
          LIMIT 1`,
        [asNumber]
      ) || null;

      if (!mi) {
        mi = await get(
          `SELECT mi.id, mi.hp, mi.max_hp, mi.spawn_id, s."respawnSec"
             FROM monster_instances mi
             JOIN spawns s ON s.id = mi.spawn_id
            WHERE mi.state = 'ALIVE'
              AND mi.spawn_id = $1
            ORDER BY mi.updated_at DESC
            LIMIT 1`,
          [asNumber]
        ) || null;
      }
    } else {
      return res.status(400).json({ ok: false, error: 'bad-id' });
    }

    if (!mi) return res.status(404).json({ ok: false, error: 'no-such-alive' });

    const DMG = Number.isFinite(+req.body?.damage)
      ? Math.max(1, Math.floor(+req.body.damage))
      : 10;

    let hp = Math.max(0, Number(mi.hp) - DMG);
    let dead = false;

    if (hp <= 0) {
      dead = true;
      hp = 0;
      const secs = Math.max(5, Number(mi.respawnSec) || 30);

      await require('../models/db').run(
        `UPDATE monster_instances
            SET state='DEAD',
                hp=0,
                respawn_at = now() + make_interval(secs => $2),
                updated_at = now()
          WHERE id = $1`,
        [mi.id, secs]
      );
    } else {
      await require('../models/db').run(
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
