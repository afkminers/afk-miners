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

/** Resolve o skill_type usado para ganhar skill:
 *  1) Se veio weaponType do cliente, mapeia via weapon_skill_map.
 *  2) Senão, tenta a arma EQUIPADA do herói (slot WEAPON) e mapeia.
 *  3) Senão, faz fallback pela classe do herói.
 *  4) Se nada encontrado, retorna null (não conta skill).
 */
async function resolveSkillTypeOrClass({ weaponType, heroId }) {
  async function mapWeaponToSkill(wtype) {
    if (!wtype) return null;
    const row = await get(
      `SELECT skill_type
         FROM weapon_skill_map
        WHERE lower(weapon_type) = lower($1)
        LIMIT 1`,
      [String(wtype)]
    );
    return row?.skill_type ? String(row.skill_type).toUpperCase() : null;
  }

  if (weaponType) {
    const s = await mapWeaponToSkill(weaponType);
    if (s) return s;
  }

  if (heroId) {
    const equippedWeaponType = await getEquippedWeaponType(heroId);
    const s2 = await mapWeaponToSkill(equippedWeaponType);
    if (s2) return s2;

    const c = await get(
      `SELECT hm.class
         FROM player_heroes ph
         JOIN heroes_master hm ON hm."heroKey" = ph."heroKey"
        WHERE ph.id = $1`,
      [String(heroId)]
    );
    const heroClass = (c?.class || '').toUpperCase();

    if (heroClass === 'RANGER' || heroClass === 'PALADIN') return 'DISTANCE';
    if (heroClass === 'MAGE' || heroClass === 'WIZARD')   return 'MAGIC';
    if (heroClass === 'KNIGHT' || heroClass === 'GUARDIAN') return 'SWORD';
  }
  return null;
}

/** Aplica ganho de skill no banco. */
async function gainSkillFromHit({ heroId, weaponType }) {
  const skillType = await resolveSkillTypeOrClass({ weaponType, heroId });
  if (!skillType) return { ok: false, reason: 'no-skill-type' };

  await run(
    `INSERT INTO player_hero_skills (hero_id, skill_type, level, tries_progress)
     VALUES ($1, $2, 1, 0)
     ON CONFLICT (hero_id, skill_type) DO NOTHING`,
    [String(heroId), skillType]
  );

  const cur = await get(
    `SELECT level, tries_progress FROM player_hero_skills
      WHERE hero_id=$1 AND skill_type=$2`,
    [String(heroId), skillType]
  );
  if (!cur) return { ok: false };

  let level = Number(cur.level) || 1;
  let progress = Number(cur.tries_progress) || 0;

  const klass = await get(
    `SELECT hm.class
       FROM player_heroes ph
       JOIN heroes_master hm ON hm."heroKey" = ph."heroKey"
      WHERE ph.id = $1`,
    [String(heroId)]
  );
  const heroClass = (klass?.class || '').toUpperCase();

  const rateRow = await get(
    `SELECT rate FROM class_skill_rates
      WHERE class=$1 AND skill_type=$2`,
    [heroClass, skillType]
  );
  const rate = Number(rateRow?.rate) || 1.0;

  const inc = BASE_TRY_PER_HIT * rate;
  progress += inc;

  let needRow = await get(
    `SELECT tries_needed FROM skill_curves WHERE skill_type=$1 AND level=$2`,
    [skillType, level]
  );
  let need = Number(needRow?.tries_needed) || 999999;

  let ups = 0;
  while (progress >= need) {
    progress -= need;
    level += 1;
    ups += 1;
    needRow = await get(
      `SELECT tries_needed FROM skill_curves WHERE skill_type=$1 AND level=$2`,
      [skillType, level]
    );
    need = Number(needRow?.tries_needed) || 999999;
  }

  await run(
    `UPDATE player_hero_skills
        SET level=$3, tries_progress=$4
      WHERE hero_id=$1 AND skill_type=$2`,
    [String(heroId), skillType, level, progress]
  );

  if (DEBUG) {
    console.log('[skill] hero', heroId, 'skill', skillType, 'inc', inc.toFixed(2), 'lvl', level, 'prog', progress.toFixed(2));
    if (ups) console.log(`[skill] level up +${ups} (${skillType})`);
  }

  return { ok: true, heroId, skillType, level, progress, inc };
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

    // Resolve weapon type with class fallback  
    const resolvedWeaponType = await getWeaponTypeFallback(heroId);

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
  
  // Class-based fallback
  const hero = await get(
    `SELECT hm.class
       FROM player_heroes ph
       JOIN heroes_master hm ON hm."heroKey" = ph."heroKey"
      WHERE ph.id = $1`,
    [String(heroId)]
  );
  const heroClass = (hero?.class || '').toUpperCase();
  
  if (heroClass === 'ARCHER') return 'BOW';
  if (heroClass === 'MAGE' || heroClass === 'WIZARD' || heroClass === 'DRUID') return 'STAFF';
  return 'SWORD';
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

    // Validate range/LOS first if not permissive
    if (!PERMISSIVE_START) {
      const mobPos = await getMonsterPos(raw);
      if (!mobPos) return res.status(400).json({ ok:false, error:'mob-pos-missing' });

      const heroPos = await getHeroPos(heroIdFromSess, mobPos.map_key);
      if (!heroPos) return res.status(400).json({ ok:false, error:'hero-pos-missing' });
      if (heroPos.map_key !== mobPos.map_key) return res.json({ ok:false, error:'map-diff' });

      const weaponType = await getWeaponTypeFallback(heroIdFromSess);
      const { grid, cols } = await getGrid(heroPos.map_key);
      const losGrid = { data: grid, cols };

      if (!inReachPx(heroPos, mobPos, weaponType, K)) return res.json({ ok:false, error:'out_of_range' });
      if (!hasLineOfSight(losGrid, heroPos.x, heroPos.y, mobPos.x, mobPos.y)) return res.json({ ok:false, error:'no_los' });
    }

    // Get weapon type with class fallback
    const weaponType = await getWeaponTypeFallback(heroIdFromSess);
    
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
