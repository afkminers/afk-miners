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
const { broadcast } = require('../ws/bus'); // <- necessário p/ atualizar UI em tempo real
const { applyHit } = require('./service'); // <- combat service for server-authoritative hits

// >>> loot service (em memória)
const { createLootFromKill } = require('../services/loot');

// deixe true por enquanto; quando LOS/alcance estiverem 100% a gente liga de novo
const PERMISSIVE_START = true;

const DEBUG = String(process.env.COMBAT_DEBUG || '').trim() === '1';

// ===== SESSÕES DE ATAQUE EM MEMÓRIA =====
// chave: targetInstanceId -> { heroId, weaponType, startedAt }
const attackSessions = new Map();

// quanto cada hit vale (em "tries"), antes de multiplicar pelos rates de classe
const BASE_TRY_PER_HIT = Number(process.env.SKILL_TRY_PER_HIT || 1);

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
   Helpers de Skill
   ========================================================================== */

/** Resolve weapon_type a partir do equipamento atual do herói (slot WEAPON). */
async function getEquippedWeaponType(heroId) {
  const row = await get(
    `SELECT im.weapon_type
       FROM hero_equipment he
       JOIN items_master im ON im.key = he.item_key
      WHERE he.hero_id = $1 AND he.slot = 'WEAPON'`,
    [String(heroId)]
  );
  return row?.weapon_type ? String(row.weapon_type).toUpperCase() : null;
}

/* =========================================================================
   /nearest
   ========================================================================== */
router.get('/nearest', async (req, res) => {
  try {
    const mapKey = String(req.query.map || 'house');
    const cx = Math.round(+req.query.x || 0);
    const cy = Math.round(+req.query.y || 0);

    const hasPX = Number.isFinite(+req.query.px) && Number.isFinite(+req.query.py);
    const px = hasPX ? Math.round(+req.query.px) : null;
    const py = hasPX ? Math.round(+req.query.py) : null;

    const clickMax = Number(K?.CLICK_MAX_DIST_PX) || 280;
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
                (((mi.x*32) - $2)*((mi.x*32) - $3)*1 + ((mi.y*32) - $3)*((mi.y*32) - $3)) AS d_tile
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

    // Require equipped weapon via getEquippedWeaponType(heroId) - no class fallback
    const resolvedWeaponType = await getEquippedWeaponType(heroId);
    if (!resolvedWeaponType) {
      return res.json({ ok: false, error: 'no-weapon-equipped' });
    }

    // Get strict mode configuration
    const strictMode = K.ATTACK_STRICT_MODE;
    
    if (strictMode) {
      // Get monster position and state
      const mobPos = await getMonsterPos(targetInstanceId);
      if (!mobPos) return res.status(400).json({ ok:false, error:'mob-pos-missing' });

      // Verify monster is alive and on same map
      const mobState = await get(
        `SELECT state FROM monster_instances WHERE id = $1`,
        [targetInstanceId]
      );
      if (!mobState || mobState.state !== 'ALIVE') {
        return res.status(400).json({ ok:false, error:'target-not-alive' });
      }

      // Get hero position
      const heroPos = await getHeroPos(heroId, mobPos.map_key);
      if (!heroPos) return res.status(400).json({ ok:false, error:'hero-pos-missing' });
      if (heroPos.map_key !== mobPos.map_key) return res.json({ ok:false, error:'different-maps' });

      // Get equipped weapon type (server-authoritative)
      const equippedWeaponType = await getEquippedWeaponType(heroId);
      const weaponTypeToUse = equippedWeaponType || weaponType || 'SWORD';

      // Validate range using equipped weapon
      if (!inReachPx(heroPos, mobPos, weaponTypeToUse, K)) {
        return res.json({ ok:false, error:'out_of_range' });
      }

      // Validate line of sight
      const { grid, cols } = await getGrid(heroPos.map_key);
      const losGrid = { data: grid, cols };

      if (!inReachPx(heroPos, mobPos, weaponType, K)) return res.json({ ok:false, error:'out_of_range' });
      if (!hasLineOfSight(losGrid, heroPos.x, heroPos.y, mobPos.x, mobPos.y)) return res.json({ ok:false, error:'no_los' });
    }

    attackSessions.set(String(targetInstanceId), {
      heroId: String(heroId),
      weaponType: weaponType ? String(weaponType) : null,
      startedAt: Date.now()
    });

    return res.json({ ok:true });
  } catch (e) {
    console.error('[combat] /attack/start error:', e);
    return res.status(500).json({ ok:false, error:'start-failed' });
  }
});

router.post('/attack/stop', express.json(), async (req, res) => {
  try {
    const { heroId } = req.body || {};
    if (heroId) {
      for (const [instId, sess] of attackSessions.entries()) {
        if (sess.heroId === String(heroId)) attackSessions.delete(instId);
      }
    }
    return res.json({ ok:true });
  } catch (e) {
    console.error('[combat] /attack/stop error:', e);
    return res.status(500).json({ ok:false, error:'stop-failed' });
  }
});

// ====== HIT ===============================================
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Import the combat service
const { applyHit } = require('./service');

/** Get weapon type fallback based on class */
async function getWeaponTypeFallback(heroId) {
  const weaponTypeEquipped = await getEquippedWeaponType(heroId);
  if (weaponTypeEquipped) return weaponTypeEquipped;
  
  // NO class-based fallback - return null if no weapon equipped
  return null;
}

router.post('/hit', express.json(), async (req, res) => {
  try {
    // pode vir como id, targetInstanceId, ou query ?id
    const raw = req.body?.id ?? req.body?.targetInstanceId ?? req.query?.id;
    if (!raw) return res.status(400).json({ ok:false, error:'missing-id' });

    // tenta descobrir heroId/weaponType da sessão iniciada em /attack/start
    const sess = attackSessions.get(String(raw)) || null;
    const heroIdFromSess = sess?.heroId || (req.body?.heroId ? String(req.body.heroId) : null);
    const weaponTypeFromSess = sess?.weaponType || (req.body?.weaponType ? String(req.body.weaponType) : null);

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
      // morreu: limpa sessão desse alvo
      attackSessions.delete(String(mi.id));
    } else {
      await run(`UPDATE monster_instances SET hp=$2, updated_at=now() WHERE id=$1`, [mi.id, hp]);
    }

    // === Envia atualizações em tempo real pelo WS (barra de HP + floater de dano) ===
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
      broadcast({
        type: 'monster_hp',
        id: String(cur.id),
        hp: Number(cur.hp),
        maxHp: Number(cur.max_hp || cur.hp || 1),
        dmg: Number(DMG),
        monsterKey: cur.monsterKey,
        spawnId: Number(cur.spawnId)
      });

      if (String(cur.state) === 'DEAD' || Number(cur.hp) <= 0) {
        const xp = 0; // calcule XP real se quiser
        broadcast({ type: 'monster_dead', id: String(cur.id), xp });

        // >>>>>>>>>>>>> DROP DE LOOT <<<<<<<<<<<<<<
        try {
          // posição atual do monstro em PX + map
          const pos = await getMonsterPos(cur.id);
          // rolagem simples por tipo
          const items = rollSimpleLoot(cur.monsterKey);
          if (pos && items && items.length > 0) {
            await createLootFromKill({
              mapKey: pos.map_key || pos.mapKey || 'house',
              x: Math.round(pos.x),
              y: Math.round(pos.y),
              items
            });
          }
        } catch (e) {
          console.warn('[loot] drop failed:', e?.message);
        }
      }
    }

    // >>>>>>>>>>>> GANHO DE SKILL POR HIT (armas equipadas) <<<<<<<<<<<<<
    if (heroIdFromSess) {
      try {
        const weaponTypeEquipped = await getEquippedWeaponType(heroIdFromSess);
        await gainSkillFromHit({ heroId: heroIdFromSess, weaponType: weaponTypeEquipped });
      } catch (e) {
        console.warn('[combat] skill gain failed:', e?.message);
      }
    }

    return res.json({ ok:true, id: mi.id, dmg: DMG, hp, maxHp: Number(mi.max_hp)||0, dead });
  } catch (e) {
    console.error('[combat] /hit error:', e);
    return res.status(500).json({ ok:false, error:'hit-failed' });
  }
});

module.exports = router;
