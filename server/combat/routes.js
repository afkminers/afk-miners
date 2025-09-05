// server/combat/routes.js
// Endpoints do combate: /nearest, /attack/start, /attack/stop, /hit
// Prefixo no index.js: app.use('/api/combat', requireAuth, router)

const express = require('express');
const router = express.Router();

const K = require('../balance/config');
// const autoloop = require('./autoloop'); // ← desativado por enquanto

const { get, run } = require('../models/db');
const { getHeroPos, getMonsterPos } = require('./pos');
const { inReachPx } = require('./geom');
const { hasLineOfSight } = require('./los');
const { getGrid } = require('../maps/grid');
const { broadcast } = require('../ws/bus'); // <<-- NECESSÁRIO para enviar updates em tempo real

// deixe true por enquanto; quando LOS/alcance estiverem 100% a gente liga de novo
const PERMISSIVE_START = true;

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

/* =========================================================================
   /nearest — resolve o monstro vivo mais próximo do clique.
   Faz "auto-escala": compara em tiles e em pixels (tiles*32) e usa a menor.
   ========================================================================== */
router.get('/nearest', async (req, res) => {
  try {
    const mapKey = String(req.query.map || 'house');
    const cx = Math.round(+req.query.x || 0);
    const cy = Math.round(+req.query.y || 0);

    const hasPX = Number.isFinite(+req.query.px) && Number.isFinite(+req.query.py);
    const px = hasPX ? Math.round(+req.query.px) : null;
    const py = hasPX ? Math.round(+req.query.py) : null;

    const clickMax = Number(K?.CLICK_MAX_DIST_PX) || 280; // tolerante
    if (hasPX) {
      const dx = cx - px, dy = cy - py;
      if (dx*dx + dy*dy > clickMax*clickMax) {
        return res.status(200).json({ ok:false, error:'too-far-click' });
      }
    }

    const row = await get(
      `WITH cand AS (
         SELECT mi.id, mi.x, mi.y, mi.hp, mi.max_hp, s."monsterKey",
                ((mi.x - $2)*(mi.x - $2) + (mi.y - $3)*(mi.y - $3)) AS d_px,
                (((mi.x*32) - $2)*((mi.x*32) - $2) + ((mi.y*32) - $3)*((mi.y*32) - $3)) AS d_tile
           FROM monster_instances mi
           JOIN spawns s ON s.id = mi.spawn_id
          WHERE mi.state = 'ALIVE'
            AND (mi.map_key = $1 OR s."mapKey" = $1)
       )
       SELECT id, x, y, hp, max_hp, "monsterKey",
              CASE WHEN d_px <= d_tile THEN d_px ELSE d_tile END AS dist2,
              CASE WHEN d_px <= d_tile THEN 1 ELSE 32 END AS scale
         FROM cand
        ORDER BY dist2 ASC
        LIMIT 1`,
      [mapKey, cx, cy]
    );

    if (!row) return res.status(404).json({ ok:false, error:'no-monster' });

    const pickRadius = Number(K?.CLICK_PICK_RADIUS_PX) || 420;
    if (Number(row.dist2) > pickRadius*pickRadius) {
      return res.status(404).json({ ok:false, error:'no-monster-in-radius' });
    }

    const scale = Number(row.scale) || 1;
    const mx = Math.round(Number(row.x) * scale);
    const my = Math.round(Number(row.y) * scale);

    return res.json({
      ok: true,
      id: String(row.id),
      x: mx, y: my,
      hp: Number(row.hp), maxHp: Number(row.max_hp),
      monsterKey: row.monsterKey
    });
  } catch (e) {
    console.error('[combat/nearest] error:', e);
    return res.status(500).json({ ok:false, error:'nearest-failed' });
  }
});

// ====== START/STOP =========================================================
router.post('/attack/start', express.json(), async (req, res) => {
  try {
    const { heroId, targetInstanceId, weaponType } = req.body || {};
    if (!heroId || !targetInstanceId) {
      return res.status(400).json({ ok:false, error:'missing-params' });
    }

    if (!PERMISSIVE_START) {
      const mobPos = await getMonsterPos(targetInstanceId);
      if (!mobPos) return res.status(400).json({ ok:false, error:'mob-pos-missing' });

      const heroPos = await getHeroPos(heroId, mobPos.map_key);
      if (!heroPos) return res.status(400).json({ ok:false, error:'hero-pos-missing' });
      if (heroPos.map_key !== mobPos.map_key) return res.json({ ok:false, error:'map-diff' });

      const { grid, cols } = await getGrid(heroPos.map_key);
      const losGrid = { data: grid, cols };

      if (!inReachPx(heroPos, mobPos, weaponType, K)) return res.json({ ok:false, error:'out_of_range' });
      if (!hasLineOfSight(losGrid, heroPos.x, heroPos.y, mobPos.x, mobPos.y)) return res.json({ ok:false, error:'no_los' });
    }

    // ➜ Não usa autoloop do servidor; o cliente já vai bater /combat/hit em loop
    // autoloop.start(heroId, targetInstanceId, weaponType);

    return res.json({ ok:true });
  } catch (e) {
    console.error('[combat] /attack/start error:', e);
    return res.status(500).json({ ok:false, error:'start-failed' });
  }
});

router.post('/attack/stop', express.json(), async (_req, res) => {
  try {
    // const { heroId } = req.body || {};
    // if (heroId) autoloop.stop(heroId);
    return res.json({ ok:true });
  } catch (e) {
    console.error('[combat] /attack/stop error:', e);
    return res.status(500).json({ ok:false, error:'stop-failed' });
  }
});

// ====== HIT (debug DB-only) ===============================================
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.post('/hit', express.json(), async (req, res) => {
  try {
    const raw = req.body?.id ?? req.body?.targetInstanceId ?? req.query?.id;
    if (!raw) return res.status(400).json({ ok:false, error:'missing-id' });

    let mi;
    if (UUID_RE.test(String(raw))) {
      mi = await get(
        `SELECT mi.id, mi.hp, mi.max_hp, mi.spawn_id, s."respawnSec"
           FROM monster_instances mi
           JOIN spawns s ON s.id = mi.spawn_id
          WHERE mi.id = $1 AND mi.state = 'ALIVE'`,
        [String(raw)]
      );
    } else if (/^\d+$/.test(String(raw))) {
      const n = Number(raw);
      mi = await get(
        `SELECT mi.id, mi.hp, mi.max_hp, mi.spawn_id, s."respawnSec"
           FROM monster_instances mi
           JOIN spawns s ON s.id = mi.spawn_id
           JOIN monsters_master mm ON mm.key = s."monsterKey"
          WHERE mi.state = 'ALIVE' AND mm.id = $1
          ORDER BY mi.updated_at DESC LIMIT 1`, [n]
      ) || await get(
        `SELECT mi.id, mi.hp, mi.max_hp, mi.spawn_id, s."respawnSec"
           FROM monster_instances mi
           JOIN spawns s ON s.id = mi.spawn_id
          WHERE mi.state = 'ALIVE' AND mi.spawn_id = $1
          ORDER BY mi.updated_at DESC LIMIT 1`, [n]
      );
    } else {
      return res.status(400).json({ ok:false, error:'bad-id' });
    }

    if (!mi) return res.status(404).json({ ok:false, error:'no-such-alive' });

    const DMG = Number.isFinite(+req.body?.damage) ? Math.max(1, Math.floor(+req.body.damage)) : 10;

    let hp = Math.max(0, Number(mi.hp) - DMG);
    let dead = false;

    if (hp <= 0) {
      dead = true; hp = 0;
      const secs = Math.max(5, Number(mi.respawnSec) || 30);
      await run(
        `UPDATE monster_instances
            SET state='DEAD', hp=0,
                respawn_at = now() + make_interval(secs => $2),
                updated_at = now()
          WHERE id = $1`,
        [mi.id, secs]
      );
    } else {
      await run(`UPDATE monster_instances SET hp=$2, updated_at=now() WHERE id=$1`, [mi.id, hp]);
    }

    // === Envia atualizações em tempo real pelo WS ===
    const cur = await get(`
      SELECT mi.id,
             mi.hp,
             mi.max_hp,
             mi.state,
             mi.spawn_id        AS "spawnId",
             s."monsterKey"     AS "monsterKey"
        FROM monster_instances mi
        JOIN spawns s ON s.id = mi.spawn_id
       WHERE mi.id = $1
    `, [mi.id]);

    if (cur) {
      // Evento de HP/dano (faz barra descer e mostra floater)
      broadcast({
        type: 'monster_hp',
        id: String(cur.id),
        hp: Number(cur.hp),
        maxHp: Number(cur.max_hp || cur.hp || 1),
        dmg: Number(DMG),
        monsterKey: cur.monsterKey,
        spawnId: Number(cur.spawnId)
      });

      // Se morreu, também notifica
      if (String(cur.state) === 'DEAD' || Number(cur.hp) <= 0) {
        const xp = 0; // se quiser, calcule XP real aqui
        broadcast({ type: 'monster_dead', id: String(cur.id), xp });
      }
    }

    return res.json({ ok:true, id: mi.id, dmg: DMG, hp, maxHp: Number(mi.max_hp)||0, dead });
  } catch (e) {
    console.error('[combat] /hit error:', e);
    return res.status(500).json({ ok:false, error:'hit-failed' });
  }
});

module.exports = router;
