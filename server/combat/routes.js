// server/combat/routes.js
// Endpoints do combate: /nearest, /attack/start, /attack/stop, /hit, /revive
// Prefixo no index.js: app.use('/api/combat', requireAuth, router)

const express = require('express');
const router = express.Router();

const K = require('../balance/config');
// const autoloop = require('./autoloop'); // ← desativado por enquanto

const { get, run } = require('../models/db');
const { getHeroPos, getMonsterPos } = require('./pos');
const { inReachPx, resolveRangeTiles, chebyPx, chebyshevTiles, TILE } = require('./geom');
const { hasLineOfSight } = require('./los');
const { getGrid } = require('../maps/grid');

// >>> loot service (em memória)
const { createLootFromKill } = require('../services/loot');

const DEBUG = String(process.env.COMBAT_DEBUG || '').trim() === '1';

// ===== SESSÕES DE ATAQUE EM MEMÓRIA =====
// chave: targetInstanceId -> { heroId, weaponType, startedAt }
const attackSessions = new Map();

// quanto cada hit vale (em "tries"), antes de multiplicar pelos rates de classe
const BASE_TRY_PER_HIT = Number(process.env.SKILL_TRY_PER_HIT || 1);

function buildRangeTelemetry(heroPos, mobPos, weaponType) {
  if (!heroPos || !mobPos || !weaponType) return null;
  const rangeTiles = resolveRangeTiles(weaponType, heroPos.class, K);
  const rangePx = rangeTiles * TILE;
  const distTiles = chebyshevTiles(heroPos.x, heroPos.y, mobPos.x, mobPos.y);
  const distPx = chebyPx(heroPos.x, heroPos.y, mobPos.x, mobPos.y);
  return {
    range: { tiles: rangeTiles, px: rangePx },
    distance: { tiles: distTiles, px: distPx },
  };
}

function formatRangeMessage(ctx) {
  if (!ctx) return 'Alvo fora do alcance.';
  const distTiles = Number(ctx?.distance?.tiles);
  const rangeTiles = Number(ctx?.range?.tiles);
  if (Number.isFinite(distTiles) && Number.isFinite(rangeTiles)) {
    return `Você está longe do alvo (${distTiles} > ${rangeTiles} sqm).`;
  }
  const distPx = Number(ctx?.distance?.px);
  const rangePx = Number(ctx?.range?.px);
  if (Number.isFinite(distPx) && Number.isFinite(rangePx)) {
    return `Você está longe do alvo (${Math.round(distPx)} > ${Math.round(rangePx)} px).`;
  }
  return 'Você está longe do alvo.';
}

function buildOutOfRangePayload(ctx) {
  const message = formatRangeMessage(ctx);
  return {
    ok: false,
    error: 'out_of_range',
    inRange: false,
    hasLineOfSight: true,
    range: ctx?.range || null,
    distance: ctx?.distance || null,
    message,
    warnings: [{ code: 'out_of_range', message }],
  };
}

function buildNoLoSPayload(ctx) {
  const message = 'Sem linha de visão com o alvo.';
  return {
    ok: false,
    error: 'no_los',
    inRange: ctx?.inRange ?? null,
    hasLineOfSight: false,
    range: ctx?.range || null,
    distance: ctx?.distance || null,
    message,
    warnings: [{ code: 'no_los', message }],
  };
}

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
   Guardião: ownership + alive
   ========================================================================== */
async function getHeroOwnedBy(playerId, heroId) {
  return await get(
    `SELECT id::text AS id, "playerId"::text AS player_id, COALESCE(alive,true) AS alive,
            COALESCE(max_hp,100) AS max_hp
       FROM player_heroes
      WHERE id = $1 AND "playerId" = $2`,
    [String(heroId), String(playerId)]
  );
}
async function assertHeroAliveOwned(playerId, heroId) {
  const row = await getHeroOwnedBy(playerId, heroId);
  if (!row) return { ok:false, code:404, error:'hero-not-found' };
  if (row.alive === false) return { ok:false, code:409, error:'hero-dead' };
  return { ok:true, hero: row };
}

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
   Combat Routes: /attack/start, /attack/stop, /hit, /revive
   Note: /nearest endpoint moved to routes/combat_nearest.js for better sprite intersection
   ========================================================================== */

// ====== START/STOP =========================================================
router.post('/attack/start', express.json(), async (req, res) => {
  try {
    const { heroId, targetInstanceId } = req.body || {};
    if (!heroId || !targetInstanceId) {
      return res.status(400).json({ ok:false, error:'missing-params' });
    }

    // Guardião: dono + vivo
    const chk = await assertHeroAliveOwned(req.user.id, heroId);
    if (!chk.ok) return res.status(chk.code).json({ ok:false, error:chk.error });

    // Require equipped weapon via getEquippedWeaponType(heroId) - no class fallback
    const resolvedWeaponType = await getEquippedWeaponType(heroId);
    if (!resolvedWeaponType) {
      return res.json({ ok: false, error: 'no-weapon-equipped' });
    }

    const mobPos = await getMonsterPos(targetInstanceId);
    if (!mobPos) return res.status(404).json({ ok:false, error:'mob-pos-missing' });

    const heroPos = await getHeroPos(heroId, mobPos.map_key);
    if (!heroPos) return res.status(400).json({ ok:false, error:'hero-pos-missing' });
    if (heroPos.map_key !== mobPos.map_key) {
      return res.json({ ok:false, error:'map-diff', message: 'Alvo está em outro mapa.' });
    }

    const { grid, cols } = await getGrid(heroPos.map_key);
    const losGrid = { data: grid, cols };

    const inRange = inReachPx(heroPos, mobPos, resolvedWeaponType, K, heroPos.class);
    const hasLos = hasLineOfSight(losGrid, heroPos.x, heroPos.y, mobPos.x, mobPos.y);
    const telemetry = buildRangeTelemetry(heroPos, mobPos, resolvedWeaponType);
    const context = telemetry ? { ...telemetry, inRange } : { inRange };

    attackSessions.set(String(targetInstanceId), {
      heroId: String(heroId),
      weaponType: resolvedWeaponType,
      startedAt: Date.now()
    });

    const warnings = [];
    if (!inRange) warnings.push({ code: 'out_of_range', message: formatRangeMessage(context) });
    if (!hasLos) warnings.push({ code: 'no_los', message: 'Sem linha de visão com o alvo.' });

    const payload = {
      ok: true,
      inRange,
      hasLineOfSight: hasLos,
      range: telemetry?.range || null,
      distance: telemetry?.distance || null,
      warnings,
    };
    if (warnings.length) payload.message = warnings[0].message;

    return res.json(payload);
  } catch (e) {
    console.error('[combat] /attack/start error:', e);
    return res.status(500).json({ ok:false, error:'start-failed' });
  }
});

router.post('/attack/stop', express.json(), async (req, res) => {
  try {
    const { heroId } = req.body || {};

    // Se informou heroId, valida ownership (se estiver morto, só não precisa limpar sessão)
    if (heroId) {
      const chk = await getHeroOwnedBy(req.user.id, heroId);
      if (!chk) return res.status(404).json({ ok:false, error:'hero-not-found' });
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
const { applyHit, respawnHero } = require('./service');

/** Get weapon type fallback based on class (desligado: sem fallback) */
async function getWeaponTypeFallback(_heroId) {
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

    // Guardião: dono + vivo
    const chk = await assertHeroAliveOwned(req.user.id, heroIdFromSess);
    if (!chk.ok) return res.status(chk.code).json({ ok:false, error:chk.error });

    // Require equipped weapon for the hero session - no class fallback
    const weaponType = await getEquippedWeaponType(heroIdFromSess);
    if (!weaponType) {
      return res.json({ ok: false, error: 'no-weapon-equipped' });
    }

    const mobPos = await getMonsterPos(raw);
    if (!mobPos) return res.status(400).json({ ok:false, error:'mob-pos-missing' });

    const heroPos = await getHeroPos(heroIdFromSess, mobPos.map_key);
    if (!heroPos) return res.status(400).json({ ok:false, error:'hero-pos-missing' });
    if (heroPos.map_key !== mobPos.map_key) {
      return res.json({ ok:false, error:'map-diff', message: 'Alvo está em outro mapa.' });
    }

    const { grid, cols } = await getGrid(heroPos.map_key);
    const losGrid = { data: grid, cols };

    const inRange = inReachPx(heroPos, mobPos, weaponType, K, heroPos.class);
    const hasLos = hasLineOfSight(losGrid, heroPos.x, heroPos.y, mobPos.x, mobPos.y);
    const telemetry = buildRangeTelemetry(heroPos, mobPos, weaponType);
    const context = telemetry ? { ...telemetry, inRange } : { inRange };

    if (!inRange) {
      return res.json(buildOutOfRangePayload(context));
    }
    if (!hasLos) {
      return res.json(buildNoLoSPayload({ ...context, hasLineOfSight: false }));
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
      id: String(raw),             // legacy
      dmg: result.damage,          // legacy
      hp: result.hpAfter,          // legacy
      maxHp: maxHp,                // legacy
      damage: result.damage,
      hpAfter: result.hpAfter,
      hpBefore: result.hpAfter + result.damage, // aproximação
      dead: result.dead
    };

    if (telemetry) {
      payload.range = telemetry.range;
      payload.distance = telemetry.distance;
      payload.inRange = true;
      payload.hasLineOfSight = true;
    }

    return res.json(payload);
  } catch (e) {
    console.error('[combat] /hit error:', e);
    return res.status(500).json({ ok:false, error:'hit-failed' });
  }
});

/* =========================================================================
   REVIVE manual (botão no HUD)
   - só permite se: herói é do jogador e está morto
   - usa respawnHero do service (centraliza regra: hp fraction, pos fallback, broadcasts)
   ========================================================================== */
router.post('/revive', express.json(), async (req, res) => {
  try {
    const { heroId } = req.body || {};
    if (!heroId) return res.status(400).json({ ok:false, error:'missing-hero-id' });

    const row = await getHeroOwnedBy(req.user.id, heroId);
    if (!row) return res.status(404).json({ ok:false, error:'hero-not-found' });
    if (row.alive === true) return res.status(409).json({ ok:false, error:'hero-not-dead' });

    // Chama a lógica central de respawn (cura, alive=true, salva pos, broadcasts)
    await respawnHero(String(heroId));

    // Lê última posição salva p/ responder ao HUD
    const last = await get(
      `SELECT map_key, x, y FROM player_last_pos WHERE player_id=$1 ORDER BY updated_at DESC LIMIT 1`,
      [req.user.id]
    );
    const mapKey = last?.map_key || 'house';
    const x = Number(last?.x ?? 0) | 0;
    const y = Number(last?.y ?? 0) | 0;

    // Rebusca HP atual pra retornar
    const h2 = await get(`SELECT hp FROM player_heroes WHERE id=$1`, [String(heroId)]);

    return res.json({
      ok: true,
      heroId: String(heroId),
      hp: Number(h2?.hp || 1),
      mapKey, x, y
    });
  } catch (e) {
    console.error('[combat] /revive error:', e?.message || e);
    return res.status(500).json({ ok:false, error:'revive-failed' });
  }
});

module.exports = router;
