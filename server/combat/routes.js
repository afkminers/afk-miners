// server/combat/routes.js
// Endpoints do combate: /nearest, /attack/start, /attack/stop, /hit, /revive
// Prefixo no index.js: app.use('/api/combat', requireAuth, router)

const express = require('express');
const router = express.Router();

const K = require('../balance/config');
// const autoloop = require('./autoloop'); // ← desativado por enquanto

const { get, run } = require('../models/db');

const { getHeroPos, getMonsterPos } = require('./pos');

const { inReachPx, resolveRangeTiles, distanceToTargetPx, TILE } = require('./geom');
const { hasLineOfSight } = require('./los');
const { getGrid } = require('../maps/grid');
const { applyHit, respawnHero } = require('./service');
const { listFreshHeroesByMap } = require('../player/live_positions');

let simpleAi = null;
let legacyAi = null;
try { simpleAi = require('./monster_atk_simple'); } catch {}
try { legacyAi = require('./ai-mobs'); } catch {}

// >>> loot service (em memória) — ok manter import mesmo sem uso agora
const { createLootFromKill } = require('../services/loot');

const DEBUG = String(process.env.COMBAT_DEBUG || '').trim() === '1';
// Strict por padrão: quando ATTACK_STRICT_MODE=1 o /attack/start não inicia fora de alcance/LOS
const PERMISSIVE_START = !Boolean(K.ATTACK_STRICT_MODE);

// ===== SESSÕES DE ATAQUE EM MEMÓRIA =====
// chave: targetInstanceId -> { heroId, weaponType, startedAt }
const attackSessions = new Map();

/* =========================================================================
   Telemetria / mensagens
   ========================================================================== */
// ✅ CORREÇÃO: buildRangeTelemetry() em server/combat/routes.js
// Substitua APENAS esta função no arquivo routes.js

function buildRangeTelemetry(heroPos, mobPos, weaponType) {
  if (!heroPos || !mobPos || !weaponType) return null;

  const hx = Number(heroPos.x || 0) | 0;
  const hy = Number(heroPos.y || 0) | 0;
  const mx = Number(mobPos.x || 0) | 0;
  const my = Number(mobPos.y || 0) | 0;

  const rangeTiles = resolveRangeTiles(weaponType, heroPos.class, K);
  const rangePx = rangeTiles * TILE;

  // ✅ mede em PX (Chebyshev), depois converte pra tiles
  const distPx = distanceToTargetPx({ x: hx, y: hy }, mobPos);
  const distTiles = Math.floor(distPx / TILE);

  return {
    range: { tiles: rangeTiles, px: rangePx },
    distance: { tiles: distTiles, px: distPx },
    hero: {
      x: hx,
      y: hy,
      mapKey: heroPos.map_key || heroPos.mapKey || null,
      updatedAt: Number(heroPos.updatedAt || 0) || null,
      source: heroPos.source || null,
      stale: heroPos.stale === true,
      ageMs: Number.isFinite(heroPos.ageMs) ? Number(heroPos.ageMs) : null,
    },
    monster: {
      x: mx,
      y: my,
      mapKey: mobPos.map_key || mobPos.mapKey || null,
    },
    computedAt: Date.now(),
  };
}


function formatRangeMessage(ctx) {
  if (!ctx) return 'Você está longe do alvo.';
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
    hasLineOfSight: ctx?.hasLineOfSight ?? true,
    range: ctx?.range || null,
    distance: ctx?.distance || null,
    hero: ctx?.hero || null,
    monster: ctx?.monster || null,
    computedAt: ctx?.computedAt || Date.now(),
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
    hero: ctx?.hero || null,
    monster: ctx?.monster || null,
    computedAt: ctx?.computedAt || Date.now(),
    message,
    warnings: [{ code: 'no_los', message }],
  };
}

/* =========================================================================
   Logging básico
   ========================================================================== */
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
   ========================================================================== */

// ====== START ==============================================================
router.post('/attack/start', express.json(), async (req, res) => {
  try {
    const { heroId, targetInstanceId } = req.body || {};
    if (!heroId || !targetInstanceId) {
      return res.status(400).json({ ok:false, error:'missing-params' });
    }

    // Guardião: dono + vivo
    const chk = await assertHeroAliveOwned(req.user.id, heroId);
    if (!chk.ok) return res.status(chk.code).json({ ok:false, error:chk.error });

    // Require equipped weapon
    const weaponType = await getEquippedWeaponType(heroId);
    if (!weaponType) {
      return res.json({ ok:false, error:'no-weapon-equipped' });
    }

    const mobPos = await getMonsterPos(targetInstanceId);
    if (!mobPos) return res.status(400).json({ ok:false, error:'mob-pos-missing' });

    const heroPos = await getHeroPos(heroId, mobPos.map_key);
    if (!heroPos) return res.status(400).json({ ok:false, error:'hero-pos-missing' });
    if (heroPos.map_key !== mobPos.map_key) {
      return res.json({ ok:false, error:'map-diff', message:'Alvo está em outro mapa.' });
    }

    const telemetry = buildRangeTelemetry(heroPos, mobPos, weaponType);
    const { grid, cols } = await getGrid(heroPos.map_key);
    const losGrid = { data: grid, cols };

    const inRange = inReachPx(heroPos, mobPos, weaponType, K, heroPos.class);
    const hasLos = hasLineOfSight(losGrid, heroPos.x, heroPos.y, mobPos.x, mobPos.y);
    const warnings = [];
    if (!inRange) warnings.push({ code:'out_of_range', message: formatRangeMessage({ ...telemetry, inRange }) });
    if (!hasLos) warnings.push({ code:'no_los', message: 'Sem linha de visão com o alvo.' });

    // Modo estrito: não inicia sessão se inválido; Modo permissivo: inicia e apenas avisa
    if (!PERMISSIVE_START && warnings.length > 0) {
      return res.json({
        ok: true,
        inRange,
        hasLineOfSight: hasLos,
        range: telemetry?.range || null,
        distance: telemetry?.distance || null,
        hero: telemetry?.hero || null,
        monster: telemetry?.monster || null,
        computedAt: telemetry?.computedAt || Date.now(),
        warnings,
        message: warnings[0]?.message,
      });
    }

    // Registra sessão
    attackSessions.set(String(targetInstanceId), {
      heroId: String(heroId),
      weaponType,
      startedAt: Date.now(),
    });

    const payload = {
      ok: true,
      inRange,
      hasLineOfSight: hasLos,
      range: telemetry?.range || null,
      distance: telemetry?.distance || null,
      hero: telemetry?.hero || null,
      monster: telemetry?.monster || null,
      computedAt: telemetry?.computedAt || Date.now(),
      warnings,
    };
    if (warnings.length) payload.message = warnings[0].message;

    return res.json(payload);
  } catch (e) {
    console.error('[combat] /attack/start error:', e);
    return res.status(500).json({ ok:false, error:'start-failed' });
  }
});

function normalizeBool(value, fallback = true) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  const str = String(value).trim().toLowerCase();
  if (str === 'true' || str === '1' || str === 'yes') return true;
  if (str === 'false' || str === '0' || str === 'no') return false;
  return fallback;
}

router.post('/push', express.json(), async (req, res) => {
  const { heroId, targetInstanceId } = req.body || {};
  const monsterId = targetInstanceId != null ? String(targetInstanceId) : null;
  const heroIdStr = heroId != null ? String(heroId) : null;

  if (!heroIdStr || !monsterId) {
    return res.status(400).json({ ok: false, error: 'missing-params', message: 'Herói e monstro são obrigatórios.' });
  }

  const guard = await assertHeroAliveOwned(req.user.id, heroIdStr);
  if (!guard.ok) return res.status(guard.code).json({ ok: false, error: guard.error });

  const monsterPos = await getMonsterPos(monsterId).catch(() => null);
  if (!monsterPos || !Number.isFinite(monsterPos.x) || !Number.isFinite(monsterPos.y)) {
    return res.status(404).json({ ok: false, error: 'monster-not-found', message: 'Monstro não encontrado.' });
  }

  let monsterMeta = null;
  try {
    monsterMeta = await get(`
      SELECT
        COALESCE(mi.map_key, s."mapKey") AS map_key,
        mi.state,
        mi.alive,
        (m."flagsJSON"->>'pushable') AS pushable_raw
      FROM monster_instances mi
      LEFT JOIN spawns s ON s.id = mi.spawn_id
      LEFT JOIN monsters_master m ON m.id = mi.monster_id
      WHERE mi.id = $1
    `, [monsterId]);
  } catch {}

  const mapKey = String(monsterMeta?.map_key ?? monsterPos.map_key ?? 'house');
  const pushable = normalizeBool(monsterMeta?.pushable_raw, true);
  if (!pushable) {
    return res.json({ ok: false, error: 'monster-not-pushable', message: 'Este monstro não pode ser empurrado.' });
  }

  const stateRaw = monsterMeta?.state ? String(monsterMeta.state).toUpperCase() : null;
  const aliveColumn = monsterMeta?.alive;
  const alive = stateRaw
    ? stateRaw === 'ALIVE'
    : (aliveColumn === undefined || aliveColumn === null ? true : aliveColumn !== false);
  if (!alive) {
    return res.status(409).json({ ok: false, error: 'monster-dead', message: 'O monstro não está ativo.' });
  }

  const heroPos = await getHeroPos(heroIdStr, mapKey);
  if (!heroPos || !Number.isFinite(heroPos.x) || !Number.isFinite(heroPos.y)) {
    return res.status(400).json({ ok: false, error: 'hero-pos-missing', message: 'Posição do herói indisponível.' });
  }

  if (heroPos.map_key && heroPos.map_key !== mapKey) {
    return res.status(400).json({ ok: false, error: 'map-diff', message: 'Você está em outro mapa.' });
  }

  const monsterTileX = Math.floor(Number(monsterPos.x) / TILE);
  const monsterTileY = Math.floor(Number(monsterPos.y) / TILE);
  const heroTileX = Math.floor(Number(heroPos.x) / TILE);
  const heroTileY = Math.floor(Number(heroPos.y) / TILE);

  const heroCheby = Math.max(Math.abs(heroTileX - monsterTileX), Math.abs(heroTileY - monsterTileY));
  if (heroCheby > 1) {
    return res.status(409).json({ ok: false, error: 'hero-too-far', message: 'Você está longe demais do monstro.' });
  }

  let destTileX = Number.isFinite(Number(req.body?.toTileX)) ? Number(req.body.toTileX) | 0 : null;
  let destTileY = Number.isFinite(Number(req.body?.toTileY)) ? Number(req.body.toTileY) | 0 : null;

  if (!Number.isInteger(destTileX) || !Number.isInteger(destTileY)) {
    const toX = Number(req.body?.toX);
    const toY = Number(req.body?.toY);
    if (!Number.isFinite(toX) || !Number.isFinite(toY)) {
      return res.status(400).json({ ok: false, error: 'invalid-target', message: 'Destino inválido para o empurrão.' });
    }
    destTileX = Math.floor(toX / TILE);
    destTileY = Math.floor(toY / TILE);
  }

  const dx = destTileX - monsterTileX;
  const dy = destTileY - monsterTileY;
  const manhattan = Math.abs(dx) + Math.abs(dy);
  if (manhattan !== 1) {
    return res.status(400).json({ ok: false, error: 'invalid-target', message: 'Escolha um SQM adjacente.' });
  }

  if (destTileX === monsterTileX && destTileY === monsterTileY) {
    return res.status(409).json({ ok: false, error: 'same-tile', message: 'O monstro já está nesse local.' });
  }

  if (destTileX === heroTileX && destTileY === heroTileY) {
    return res.status(409).json({ ok: false, error: 'tile-occupied-hero', message: 'Você está bloqueando esse SQM.' });
  }

  let gridInfo = null;
  try { gridInfo = await getGrid(mapKey); } catch {}

  if (gridInfo) {
    const { cols, rows, grid } = gridInfo;
    if (destTileX < 0 || destTileY < 0 || destTileX >= cols || destTileY >= rows) {
      return res.status(409).json({ ok: false, error: 'tile-out-of-bounds', message: 'Destino fora do mapa.' });
    }
    if (grid) {
      const idx = destTileY * cols + destTileX;
      if (grid[idx] === 1) {
        return res.status(409).json({ ok: false, error: 'tile-solid', message: 'Esse SQM está bloqueado.' });
      }
    }
  }

  const minX = destTileX * TILE;
  const maxX = minX + TILE;
  const minY = destTileY * TILE;
  const maxY = minY + TILE;

  let otherMonster = null;
  try {
    otherMonster = await get(`
      SELECT mi.id
      FROM monster_instances mi
      LEFT JOIN spawns s ON s.id = mi.spawn_id
      WHERE mi.id <> $1
        AND COALESCE(mi.map_key, s."mapKey") = $2
        AND (mi.state = 'ALIVE' OR mi.state IS NULL OR mi.alive IS TRUE)
        AND mi.x >= $3 AND mi.x < $4
        AND mi.y >= $5 AND mi.y < $6
      LIMIT 1
    `, [monsterId, mapKey, minX, maxX, minY, maxY]);
  } catch (err) {
    otherMonster = await get(`
      SELECT id
      FROM monster_instances
      WHERE id <> $1
        AND (alive IS NULL OR alive = TRUE)
        AND x >= $2 AND x < $3
        AND y >= $4 AND y < $5
      LIMIT 1
    `, [monsterId, minX, maxX, minY, maxY]).catch(() => null);
  }

  if (otherMonster) {
    return res.status(409).json({ ok: false, error: 'tile-occupied-monster', message: 'Outro monstro bloqueia esse SQM.' });
  }

  let heroesBlocking = false;
  try {
    const freshHeroes = listFreshHeroesByMap(mapKey, 2500) || [];
    for (const hero of freshHeroes) {
      if (!Number.isFinite(hero?.x) || !Number.isFinite(hero?.y)) continue;
      const hx = Math.floor(Number(hero.x) / TILE);
      const hy = Math.floor(Number(hero.y) / TILE);
      if (hx === destTileX && hy === destTileY) {
        if (!hero.heroId || String(hero.heroId) !== heroIdStr) {
          heroesBlocking = true;
          break;
        }
      }
    }
  } catch {}

  if (heroesBlocking) {
    return res.status(409).json({ ok: false, error: 'tile-occupied-hero', message: 'Outro herói está nesse SQM.' });
  }

  const destPx = Math.round(destTileX * TILE + TILE / 2);
  const destPy = Math.round(destTileY * TILE + TILE / 2);

  try {
    await run(`UPDATE monster_instances SET x=$2, y=$3, updated_at=now() WHERE id=$1`, [monsterId, destPx, destPy]);
  } catch (err) {
    try {
      await run(`UPDATE monster_instances SET x=$2, y=$3 WHERE id=$1`, [monsterId, destPx, destPy]);
    } catch (err2) {
      console.warn('[combat:push] persist error:', err2?.message || err2);
      return res.status(500).json({ ok: false, error: 'persist-failed', message: 'Falha ao atualizar a posição do monstro.' });
    }
  }

  try { simpleAi?.resetInstanceState?.(monsterId); } catch {}
  try { legacyAi?.seedPosition?.({ id: monsterId, x: destPx, y: destPy, mapKey }); } catch {}

  if (typeof global._sendToMap === 'function') {
    const payload = { type: 'monster_move', id: monsterId, x: destPx, y: destPy };
    if (dx === 1) payload.face = 'east';
    else if (dx === -1) payload.face = 'west';
    else if (dy === 1) payload.face = 'south';
    else if (dy === -1) payload.face = 'north';
    try { global._sendToMap(mapKey, payload); } catch {}
  }

  return res.json({ ok: true, id: monsterId, x: destPx, y: destPy });
});

// ====== STOP ===============================================================
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

// ====== HIT ================================================================
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

    // Require equipped weapon for the hero session
    const weaponType = await getEquippedWeaponType(heroIdFromSess);
    if (!weaponType) {
      return res.json({ ok:false, error:'no-weapon-equipped' });
    }

    const mobPos = await getMonsterPos(raw);
    if (!mobPos) return res.status(400).json({ ok:false, error:'mob-pos-missing' });

    const heroPos = await getHeroPos(heroIdFromSess, mobPos.map_key);
    if (!heroPos) return res.status(400).json({ ok:false, error:'hero-pos-missing' });
    if (heroPos.map_key !== mobPos.map_key) {
      return res.json({ ok:false, error:'map-diff', message:'Alvo está em outro mapa.' });
    }

    const telemetry = buildRangeTelemetry(heroPos, mobPos, weaponType);
    const { grid, cols } = await getGrid(heroPos.map_key);
    const losGrid = { data: grid, cols };

    const inRange = inReachPx(heroPos, mobPos, weaponType, K, heroPos.class);
    const hasLos = hasLineOfSight(losGrid, heroPos.x, heroPos.y, mobPos.x, mobPos.y);
    const context = telemetry
      ? { ...telemetry, inRange, hasLineOfSight: hasLos }
      : { inRange, hasLineOfSight: hasLos };

    if (!inRange) return res.json(buildOutOfRangePayload(context));
    if (!hasLos) return res.json(buildNoLoSPayload(context));

    // Aplica o hit
    const result = await applyHit({
      attackerHeroId: heroIdFromSess,
      targetInstanceId: String(raw),
      weaponType,
    });

    if (!result.ok) {
      return res.status(400).json({ ok:false, error: result.message });
    }

    // Max HP da instância (pra HUD legacy)
    const instance = await get(
      `SELECT mi.max_hp, s."monsterKey"
         FROM monster_instances mi
         JOIN spawns s ON s.id = mi.spawn_id
        WHERE mi.id = $1`,
      [String(raw)]
    );
    const maxHp = instance?.max_hp || 100;

    // Payload compatível (legacy + novo)
    const payload = {
      ok: true,
      id: String(raw),             // legacy
      dmg: result.damage,          // legacy
      hp: result.hpAfter,          // legacy
      maxHp: maxHp,                // legacy
      damage: result.damage,
      hpAfter: result.hpAfter,
      hpBefore: result.hpAfter + result.damage, // aproximação
      dead: result.dead,
    };

    if (telemetry) {
      payload.range = telemetry.range;
      payload.distance = telemetry.distance;
      payload.inRange = true;
      payload.hasLineOfSight = true;
      payload.hero = telemetry.hero;
      payload.monster = telemetry.monster;
      payload.computedAt = telemetry.computedAt;
    }

    return res.json(payload);
  } catch (e) {
    console.error('[combat] /hit error:', e);
    return res.status(500).json({ ok:false, error:'hit-failed' });
  }
});

/* =========================================================================
   REVIVE manual (botão no HUD)
   ========================================================================== */
router.post('/revive', express.json(), async (req, res) => {
  try {
    const { heroId } = req.body || {};
    if (!heroId) return res.status(400).json({ ok:false, error:'missing-hero-id' });

    const row = await getHeroOwnedBy(req.user.id, heroId);
    if (!row) return res.status(404).json({ ok:false, error:'hero-not-found' });
    if (row.alive === true) return res.status(409).json({ ok:false, error:'hero-not-dead' });

    // Lógica central de respawn (cura, alive=true, salva pos, broadcasts)
    await respawnHero(String(heroId));

    // Última posição salva p/ responder ao HUD
    const last = await get(
      `SELECT map_key, x, y FROM player_last_pos
        WHERE player_id=$1 ORDER BY updated_at DESC LIMIT 1`,
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
      mapKey, x, y,
    });
  } catch (e) {
    console.error('[combat] /revive error:', e?.message || e);
    return res.status(500).json({ ok:false, error:'revive-failed' });
  }
});

module.exports = router;
