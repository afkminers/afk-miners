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
   Combat Routes: /attack/start, /attack/stop, /hit
   Note: /nearest endpoint moved to routes/combat_nearest.js for better sprite intersection
   ========================================================================== */

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

    if (!PERMISSIVE_START) {
      const mobPos = await getMonsterPos(targetInstanceId);
      if (!mobPos) return res.status(400).json({ ok:false, error:'mob-pos-missing' });

      const heroPos = await getHeroPos(heroId, mobPos.map_key);
      if (!heroPos) return res.status(400).json({ ok:false, error:'hero-pos-missing' });
      if (heroPos.map_key !== mobPos.map_key) return res.json({ ok:false, error:'map-diff' });

      const { grid, cols } = await getGrid(heroPos.map_key);
      const losGrid = { data: grid, cols };

      if (!inReachPx(heroPos, mobPos, resolvedWeaponType, K)) return res.json({ ok:false, error:'out_of_range' });
      if (!hasLineOfSight(losGrid, heroPos.x, heroPos.y, mobPos.x, mobPos.y)) return res.json({ ok:false, error:'no_los' });
    }

    attackSessions.set(String(targetInstanceId), {
      heroId: String(heroId),
      weaponType: resolvedWeaponType,
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
    
    if (!heroIdFromSess) {
      return res.status(400).json({ ok:false, error:'missing-hero-id' });
    }

    // Require equipped weapon for the hero session - no class fallback
    const weaponType = await getEquippedWeaponType(heroIdFromSess);
    if (!weaponType) {
      return res.json({ ok: false, error: 'no-weapon-equipped' });
    }

    // Validate range/LOS first if not permissive
    if (!PERMISSIVE_START) {
      const mobPos = await getMonsterPos(raw);
      if (!mobPos) return res.status(400).json({ ok:false, error:'mob-pos-missing' });

      const heroPos = await getHeroPos(heroIdFromSess, mobPos.map_key);
      if (!heroPos) return res.status(400).json({ ok:false, error:'hero-pos-missing' });
      if (heroPos.map_key !== mobPos.map_key) return res.json({ ok:false, error:'map-diff' });

      const { grid, cols } = await getGrid(heroPos.map_key);
      const losGrid = { data: grid, cols };

      if (!inReachPx(heroPos, mobPos, weaponTypeToUse, K)) return res.json({ ok:false, error:'out_of_range' });
      if (!hasLineOfSight(losGrid, heroPos.x, heroPos.y, mobPos.x, mobPos.y)) return res.json({ ok:false, error:'no_los' });
    }
    
    // Call the service to apply hit
    const result = await applyHit({ 
      attackerHeroId: heroIdFromSess, 
      targetInstanceId: String(raw), 
      weaponType 
    });

    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.message });
    }

    // Get maxHp from instance
    const instance = await get(
      `SELECT mi.max_hp, s."monsterKey"
         FROM monster_instances mi
         JOIN spawns s ON s.id = mi.spawn_id  
        WHERE mi.id = $1`,
      [String(raw)]
    );
    const maxHp = instance?.max_hp || 100;

    // Build client-compatible payload with both legacy and new fields
    const payload = {
      ok: true,
      // Legacy fields expected by client
      id: String(raw),
      dmg: result.damage,
      hp: result.hpAfter,
      maxHp: maxHp,
      // New fields
      damage: result.damage,
      hpAfter: result.hpAfter,
      hpBefore: result.hpAfter + result.damage, // approximation
      dead: result.dead
    };

    return res.json(payload);
  } catch (e) {
    console.error('[combat] /hit error:', e);
    return res.status(500).json({ ok:false, error:'hit-failed' });
  }
});

module.exports = router;
