// server/combat/ai-mobs.js
// IA server-authoritative estilo Tibia/Ragnarok:
// - Capta alvos via player_online (presença real) + player_last_pos (última posição conhecida).
// - Threat/Agro com decaimento + histerese (troca de alvo “natural” entre heróis).
// - Chase cardinal com colisão no servidor.
// - Ataque com alcance (px) + LOS (Bresenham).
// - Sem targeting.js e sem dependências no cliente.

const K = require('../balance/config');
const { all, run } = require('../models/db');
const { getGrid } = require('../maps/grid');
const { hasLineOfSightTiles } = require('./los');
// const { inReachPx } = require('./geom');
const { applyMobHit } = require('./service');
const battleState = require('./battle-state');
const { toTileCoords, chebyshevTiles, isValidTile } = require('../utils/tile-coords');
const { resolveMonsterAttackProfile } = require('./monster_attack_profile');
const {
  listFreshHeroesByMap,
  TTL_MS: LIVE_POS_TTL_MS = 1500,
} = require('../player/live_positions');

const PX_PER_TILE = 32;
const HOME_TOLERANCE_PX = PX_PER_TILE / 2;

let broadcast = () => {};
try {
  // se existir, usamos para notificar clientes da posição do mob
  ({ broadcast } = require('../ws/bus'));
} catch {}

// --------- Tuning ----------
const TICK_MS = 100;                  // 10 tps
const STEP_PX = 32;                   // 1 tile
const DEFAULT_CHASE_SPEED_PX_S = 90;  // px/s
const MIN_CHASE_SPEED_PX_S = 32;      // px/s (≈1 tile/s)
const MAX_CHASE_SPEED_PX_S = 420;     // px/s (~Tibia haste early game)
const GIVEUP_MS = 8000;               // desiste se perder o alvo por muito tempo
const ONLINE_RECENT_MS = 4000;        // presença considerada “viva” nos últimos 4s
const STUCK_RECHECK_MS = 2000;        // tempo em agro antes de forçar alternativa
const ALT_PATH_WINDOW_MS = 1200;      // quanto tempo mantém modo alternativo
const ALT_PATH_MAX_DEPTH = 16;        // profundidade máxima da busca alternativa
const COMBAT_DANCE_COOLDOWN_MS = 950; // intervalo para o "passinho" em combate
const COMBAT_DANCE_RETURN_DELAY_MS = 180; // espera mínima antes de tentar voltar
const COMBAT_DANCE_STAGE_TIMEOUT_MS = 850; // cancela se ficar travado em uma etapa
const LAST_KNOWN_HERO_GRACE_MS = Math.max(GIVEUP_MS * 2, 16000);
const LEASH_COOLDOWN_MS = 1800;

// Anti-hit fantasma (idades máximas aceitáveis das posições)
const STALE_HERO_MS = Math.max(900, Number(LIVE_POS_TTL_MS) + 350);
// ⚠️ Antes: STALE_MOB_MS era usado para barrar hit de mob parado. Não usamos mais para gate.

// Threat / Aggro
const THREAT_ON_SIGHT = 2.5;          // ganho por tick quando vê
const THREAT_ON_HIT   = 7;            // ganho quando herói bate no mob
const THREAT_DECAY    = 0.9;          // decaimento por segundo
const SWITCH_HYSTERESIS = 5;          // delta para trocar de alvo

// Depuração
const DEBUG_AI = process.env.AI_MOBS_DEBUG === '1';
// toggles de teste – úteis para diagnosticar LOS/colisão
const IGNORE_LOS = process.env.AI_MOBS_IGNORE_LOS === '1';
const IGNORE_COLLISION = process.env.AI_MOBS_IGNORE_COLLISION === '1';

const HERO_MEMORY_TTL_MS = 15000;
const HERO_PREDICTION_MAX_TILES = 2;
const CROWD_PENALTY_SCALE = 0.35;
const SURROUND_PENALTY = 0.9;
const FLANK_BONUS = 0.8;

// --------- Estado ----------
const mobs = new Map(); // instanceId -> state
const heroMemory = new Map(); // heroId -> { cx, cy, lastCx, lastCy, heading, updatedAt, mapKey }
let loopTimer = null;
let lastTickAt = 0;

// --------- Helpers ----------
/** Converte coordenadas em pixels para tiles antes de checar LOS. */
function hasLoSpx(losGrid, ax, ay, bx, by) {
  const aTile = toTileCoords({ x: ax, y: ay });
  const bTile = toTileCoords({ x: bx, y: by });
  if (!isValidTile(aTile) || !isValidTile(bTile)) return false;
  return hasLineOfSightTiles(losGrid, aTile.tx, aTile.ty, bTile.tx, bTile.ty);
}

function normalizeMonsterPos({ x, y, spawnRect }) {
  let rawX = Number(x ?? 0);
  let rawY = Number(y ?? 0);
  if (!Number.isFinite(rawX)) rawX = 0;
  if (!Number.isFinite(rawY)) rawY = 0;

  let px = Math.round(rawX);
  let py = Math.round(rawY);

  if (spawnRect && Number.isFinite(spawnRect.x) && Number.isFinite(spawnRect.y)) {
    const sx = Number(spawnRect.x);
    const sy = Number(spawnRect.y);
    const rawW = Number(spawnRect.w);
    const rawH = Number(spawnRect.h);
    const sw = Number.isFinite(rawW) && rawW > 0 ? rawW : PX_PER_TILE;
    const sh = Number.isFinite(rawH) && rawH > 0 ? rawH : PX_PER_TILE;

    const centerX = sx + sw / 2;
    const centerY = sy + sh / 2;

    const rawDist = Math.hypot(px - centerX, py - centerY);

    const tilePx = Math.round(rawX) * PX_PER_TILE + PX_PER_TILE / 2;
    const tilePy = Math.round(rawY) * PX_PER_TILE + PX_PER_TILE / 2;
    const tileDist = Math.hypot(tilePx - centerX, tilePy - centerY);

    if (tileDist + (PX_PER_TILE * 0.75) < rawDist) {
      px = Math.round(tilePx);
      py = Math.round(tilePy);
    }
  }

  return { x: px, y: py };
}

function computeSpawnCenterPx(spawnRect, fallbackPos = null) {
  if (spawnRect && Number.isFinite(spawnRect.x) && Number.isFinite(spawnRect.y)) {
    const sx = Number(spawnRect.x);
    const sy = Number(spawnRect.y);
    const rawW = Number(spawnRect.w);
    const rawH = Number(spawnRect.h);
    const sw = Number.isFinite(rawW) && rawW > 0 ? rawW : PX_PER_TILE;
    const sh = Number.isFinite(rawH) && rawH > 0 ? rawH : PX_PER_TILE;
    return {
      x: Math.round(sx + sw / 2),
      y: Math.round(sy + sh / 2),
    };
  }

  if (fallbackPos && Number.isFinite(fallbackPos.x) && Number.isFinite(fallbackPos.y)) {
    return { x: fallbackPos.x | 0, y: fallbackPos.y | 0 };
  }

  return { x: 0, y: 0 };
}

function canMobHitNow({ now, mob, tgtPos, losGrid }) {
  const mx = mob.x, my = mob.y;
  let hx = tgtPos?.x;
  let hy = tgtPos?.y;

  if (hx == null || hy == null || mx == null || my == null) {
    return { ok: false, reason: 'no_pos' };
  }

  let heroAge = now - (tgtPos.updatedMs ?? 0);

  if (heroAge > STALE_HERO_MS) {
    const mem = mob?.lastKnownHeroPos;
    if (mem && Number.isFinite(mem.x) && Number.isFinite(mem.y)) {
      const memAge = now - (mem.updatedMs ?? 0);
      if (memAge <= LAST_KNOWN_HERO_GRACE_MS) {
        hx = mem.x;
        hy = mem.y;
        heroAge = memAge;
      }
    }
  }

  // ⚠️ Removido o gate por "stale_mob": mobAge não deve bloquear hit de mob parado.
  // A posição do mob é server-authoritative mesmo sem mover.
  if (heroAge > STALE_HERO_MS) return { ok: false, reason: `stale_hero_${heroAge}ms` };

  const mobTile = toTileCoords({ x: mx, y: my });
  const heroTile = toTileCoords({ x: hx, y: hy });
  if (!isValidTile(mobTile) || !isValidTile(heroTile)) {
    return { ok: false, reason: 'invalid_tile' };
  }

  const rangeTiles = Number.isFinite(mob.attackRangeTiles) ? mob.attackRangeTiles : 1;
  const distTiles = chebyshevTiles(mobTile, heroTile);
  if (!Number.isFinite(distTiles) || distTiles > rangeTiles) {
    return { ok: false, reason: `out_of_range_${distTiles}gt${rangeTiles}`, mobTile, heroTile, distTiles };
  }

  const requiresLos = mob.attackRequiresLos !== false;
  const canSee = IGNORE_LOS || !requiresLos
    ? true
    : hasLineOfSightTiles(losGrid, mobTile.tx, mobTile.ty, heroTile.tx, heroTile.ty);
  if (!canSee) {
    return { ok: false, reason: 'no_los', mobTile, heroTile, distTiles };
  }

  return {
    ok: true,
    distTiles,
    mobTile,
    heroTile,
    heroPx: { x: hx, y: hy },
    heroAge,
  };
}

function recordHeroObservation({ heroId, mapKey, x, y, now }) {
  if (!heroId) return;
  const cx = Math.floor(Number(x ?? 0) / STEP_PX);
  const cy = Math.floor(Number(y ?? 0) / STEP_PX);
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;

  const id = String(heroId);
  const prev = heroMemory.get(id);
  let heading = prev?.heading || null;
  if (!prev || prev.cx !== cx || prev.cy !== cy) {
    const dx = cx - (prev?.cx ?? cx);
    const dy = cy - (prev?.cy ?? cy);
    if (dx || dy) {
      const clampedDx = Math.max(-HERO_PREDICTION_MAX_TILES, Math.min(dx, HERO_PREDICTION_MAX_TILES));
      const clampedDy = Math.max(-HERO_PREDICTION_MAX_TILES, Math.min(dy, HERO_PREDICTION_MAX_TILES));
      heading = (clampedDx || clampedDy) ? { dx: clampedDx, dy: clampedDy } : null;
    }
  }

  heroMemory.set(id, {
    cx,
    cy,
    lastCx: prev?.cx ?? cx,
    lastCy: prev?.cy ?? cy,
    heading: heading && (heading.dx || heading.dy) ? heading : null,
    updatedAt: now,
    mapKey,
  });
}

function updateHeroMemoryForMap(mapKey, heroes, now) {
  const seen = new Set();
  if (Array.isArray(heroes)) {
    for (const hero of heroes) {
      if (!hero || hero.heroId == null) continue;
      recordHeroObservation({ heroId: hero.heroId, mapKey, x: hero.x, y: hero.y, now });
      seen.add(String(hero.heroId));
    }
  }

  for (const [heroId, mem] of heroMemory.entries()) {
    if (!mem || (mem.mapKey != null && mem.mapKey !== mapKey)) continue;
    if (seen.has(heroId)) continue;
    if (now - (mem.updatedAt || 0) > HERO_MEMORY_TTL_MS) {
      heroMemory.delete(heroId);
    }
  }
}

function predictHeroTileCx(mem, fallbackCx, fallbackCy) {
  if (!mem) return null;
  let dx = 0;
  let dy = 0;
  if (mem.heading && (mem.heading.dx || mem.heading.dy)) {
    dx = mem.heading.dx;
    dy = mem.heading.dy;
  } else if (Number.isFinite(mem.cx) && Number.isFinite(mem.lastCx)) {
    dx = mem.cx - mem.lastCx;
    dy = mem.cy - mem.lastCy;
  }
  dx = Math.max(-HERO_PREDICTION_MAX_TILES, Math.min(dx, HERO_PREDICTION_MAX_TILES));
  dy = Math.max(-HERO_PREDICTION_MAX_TILES, Math.min(dy, HERO_PREDICTION_MAX_TILES));
  if (!dx && !dy) return null;
  return {
    cx: fallbackCx + dx,
    cy: fallbackCy + dy,
    heading: mem.heading || null,
    updatedAt: mem.updatedAt || Date.now(),
  };
}

function computeMobDensityPenalty({ occupancy, cx, cy, mobId, heroCx, heroCy }) {
  if (!occupancy) return 0;
  let penalty = 0;

  const key = tileKey(cx, cy);
  const set = occupancy.get(key);
  if (set && set.size) {
    const others = set.has(mobId) ? Math.max(0, set.size - 1) : set.size;
    if (others > 0) penalty += others * 4;
  }

  for (const dir of CARDINAL_DIRS) {
    const nx = cx + dir.dx;
    const ny = cy + dir.dy;
    const nearSet = occupancy.get(tileKey(nx, ny));
    if (nearSet && nearSet.size) {
      penalty += Math.min(nearSet.size, 4) * CROWD_PENALTY_SCALE;
    }
  }

  if (Number.isFinite(heroCx) && Number.isFinite(heroCy)) {
    const distHero = Math.abs(cx - heroCx) + Math.abs(cy - heroCy);
    if (distHero === 1) {
      let adjacentCount = 0;
      for (const dir of CARDINAL_DIRS) {
        const adjSet = occupancy.get(tileKey(heroCx + dir.dx, heroCy + dir.dy));
        if (adjSet && adjSet.size) adjacentCount += adjSet.size;
      }
      if (adjacentCount > 1) penalty += (adjacentCount - 1) * SURROUND_PENALTY;
    }
  }

  return penalty;
}

function computeMobFlankBonus({ cx, cy, heroCx, heroCy, heading }) {
  if (!heading || !(heading.dx || heading.dy)) return 0;
  if (!Number.isFinite(heroCx) || !Number.isFinite(heroCy)) return 0;
  const relX = cx - heroCx;
  const relY = cy - heroCy;
  const manhattan = Math.abs(relX) + Math.abs(relY);
  if (manhattan !== 1) return 0;

  const facingX = Math.sign(heading.dx || 0);
  const facingY = Math.sign(heading.dy || 0);
  if (facingX && relX === facingX) return FLANK_BONUS;
  if (facingY && relY === facingY) return FLANK_BONUS;
  if ((facingX && relY !== 0) || (facingY && relX !== 0)) return FLANK_BONUS * 0.6;
  if ((relX && facingX && relX === -facingX) || (relY && facingY && relY === -facingY)) return -FLANK_BONUS * 0.5;
  return 0;
}


// --------- DB helpers ----------
async function fetchAliveMonsters() {
  const rows = (await all(`
    SELECT mi.id,
          COALESCE(mi.map_key, s."mapKey") AS map_key,
          mi.x, mi.y,
          mm.attack_range,
          mm.aggro_range,
          mm.attack_ms,
          mm.speed,
          mm.key AS monster_key,
          COALESCE(mm."attacksJSON", '[]'::jsonb) AS attacks_json,
          s.x  AS spawn_x,
          s.y  AS spawn_y,
          COALESCE(s.w, 0) AS spawn_w,
          COALESCE(s.h, 0) AS spawn_h,
          COALESCE(s."leashPx", mm.leash_px, 0) AS leash_px   -- 👈 spawn > monstro > 0
      FROM monster_instances mi
      JOIN monsters_master mm ON mm.id = mi.monster_id
      LEFT JOIN spawns s ON s.id = mi.spawn_id
    WHERE mi.state = 'ALIVE' AND mi.hp > 0
  `)) || [];

  return rows.map(row => {
    const profile = resolveMonsterAttackProfile({
      attack_ms: row.attack_ms,
      attack_range: row.attack_range,
      attacks_json: row.attacks_json,
    });
    return {
      ...row,
      attack_profile: profile,
      attack_range: profile.rangeTiles,
      attack_ms: profile.intervalMs,
      attack_type: profile.type,
      leash_px: Number(row.leash_px || 0),          // 👈 entra no objeto usado pelo ensureMob
    };
  });
}


// 💡 Usa player_online (presença real) + última posição daquele player no mesmo mapa.
//    **Filtra só heróis VIVOS (hp > 0)** para não mirar em morto.
async function fetchOnlineHeroesInMap(mapKey) {
  const now = Date.now();
  const merged = [];
  const seen = new Set();

  const live = listFreshHeroesByMap(mapKey, ONLINE_RECENT_MS) || [];
  for (const lp of live) {
    if (!lp?.heroId) continue;
    const hid = String(lp.heroId);
    if (seen.has(hid)) continue;
    merged.push({
      heroId: hid,
      x: lp.x | 0,
      y: lp.y | 0,
      updatedMs: Number(lp.updatedMs || now),
    });
    seen.add(hid);
  }

  const rows = await all(`
    SELECT hlp.hero_id::text AS hero_id,
           hlp.x|0           AS x,
           hlp.y|0           AS y,
           (EXTRACT(EPOCH FROM hlp.updated_at) * 1000)::bigint AS updated_ms
      FROM hero_last_pos hlp
      JOIN player_heroes ph ON ph.id::text = hlp.hero_id::text
    WHERE hlp.map_key = $1
      AND ph.hp > 0
      AND hlp.updated_at >= NOW() - ($2 || ' milliseconds')::interval
    ORDER BY hlp.updated_at DESC
  `, [mapKey, String(Math.max(ONLINE_RECENT_MS, 60000))]) || [];


  for (const row of rows) {
    const hid = row?.hero_id ? String(row.hero_id) : null;
    if (!hid || seen.has(hid)) continue;
    merged.push({
      heroId: hid,
      x: row.x | 0,
      y: row.y | 0,
      updatedMs: Number(row.updated_ms || now),
    });
    seen.add(hid);
  }

  return merged;
}


async function getHeroLastPosPx(heroId, mapKey) {
  const row = await all(`
    SELECT hlp.x|0 AS x,
           hlp.y|0 AS y,
           (EXTRACT(EPOCH FROM hlp.updated_at) * 1000)::bigint AS updated_ms
      FROM hero_last_pos hlp
     WHERE hlp.hero_id::text = $1
       AND hlp.map_key = $2
     ORDER BY hlp.updated_at DESC
     LIMIT 1
  `, [String(heroId), String(mapKey)]);


  return row?.[0]
    ? { x: row[0].x | 0, y: row[0].y | 0, updatedMs: Number(row[0].updated_ms || 0) }
    : null;
}


// --------- State helpers ----------
function resolveMobSpeedPx(stat) {
  // `speed` no YAML (monsters_master.speed) é interpretado como pixels por segundo.
  const raw = Number(stat);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_CHASE_SPEED_PX_S;
  const clamped = Math.max(MIN_CHASE_SPEED_PX_S, Math.min(MAX_CHASE_SPEED_PX_S, raw));
  return clamped;
}

function ensureMob(instanceId, patch = {}) {
  const id = String(instanceId);
  const cur = mobs.get(id) || {};

  const spawnRect = patch.spawnRect || cur.spawnRect || null;
  const pos = normalizeMonsterPos({
    x: patch.x ?? cur.x ?? 0,
    y: patch.y ?? cur.y ?? 0,
    spawnRect
  });

  const spawnHome = computeSpawnCenterPx(spawnRect, pos);
  let home = spawnHome;
  if (patch.home && Number.isFinite(patch.home.x) && Number.isFinite(patch.home.y)) {
    home = { x: patch.home.x | 0, y: patch.home.y | 0 };
  } else if (!spawnRect && cur.home && Number.isFinite(cur.home.x) && Number.isFinite(cur.home.y)) {
    home = { x: cur.home.x | 0, y: cur.home.y | 0 };
  }

  // tiles recebidos do SELECT (fallback para valores anteriores/constantes)
  const profilePatch = patch.attack_profile || cur.attack_profile || null;
  const rawRangeTiles = patch.attack_range_tiles ?? patch.attack_range;
  const attackRangeTiles = Number.isFinite(rawRangeTiles)
    ? Number(rawRangeTiles)
    : Number.isFinite(profilePatch?.rangeTiles)
      ? profilePatch.rangeTiles
      : Number(cur.attack_range ?? 1);
  const aggroRangeTiles  = Math.max(1, Number(patch.aggro_range ?? cur.aggro_range ?? 8));
  const attackMs = Number.isFinite(profilePatch?.intervalMs)
    ? profilePatch.intervalMs
    : Number(patch.attack_ms ?? cur.attack_ms ?? 1200);

  const attackTypeRaw = patch.attack_type || cur.attack_type || profilePatch?.type || 'melee';
  const attackType = typeof attackTypeRaw === 'string'
    ? attackTypeRaw.toLowerCase()
    : 'melee';
  const attackRequiresLos = patch.attack_requires_los ?? cur.attack_requires_los ?? profilePatch?.requiresLos ?? (attackType !== 'melee');

  const dmgMinSrc = (patch.attack_damage && patch.attack_damage.min)
    ?? profilePatch?.min
    ?? cur.attackDamage?.min
    ?? 0;
  const dmgMaxSrc = (patch.attack_damage && patch.attack_damage.max)
    ?? profilePatch?.max
    ?? cur.attackDamage?.max
    ?? dmgMinSrc;
  const dmgMin = Math.max(0, Math.floor(Number(dmgMinSrc) || 0));
  const dmgMax = Math.max(dmgMin, Math.floor(Number(dmgMaxSrc) || dmgMin));
  const attackDamage = { min: dmgMin, max: dmgMax };

  let speedStat = null;
  if (Number.isFinite(Number(patch.speed)) && Number(patch.speed) > 0) {
    speedStat = Number(patch.speed);
  } else if (Number.isFinite(Number(cur.speed)) && Number(cur.speed) > 0) {
    speedStat = Number(cur.speed);
  }
  const moveSpeedPx = resolveMobSpeedPx(speedStat);

  const pendingStepPatch = patch.pendingStep;
  const pendingStep = pendingStepPatch === undefined
    ? (cur.pendingStep || null)
    : (pendingStepPatch && Number.isFinite(pendingStepPatch.x) && Number.isFinite(pendingStepPatch.y)
        ? { x: pendingStepPatch.x | 0, y: pendingStepPatch.y | 0 }
        : null);

  // leash: prioriza patch -> estado atual -> null
  const rawLeash = patch.leashPx ?? patch.leash_px ?? cur.leashRangePx ?? cur.leashPx ?? null;
  const leashRangePx = Number.isFinite(rawLeash) && rawLeash > 0
    ? Math.max(PX_PER_TILE, Math.round(rawLeash))
    : null;

  const resetThreat = patch.resetThreat === true;
  const modeValue = patch.mode ?? cur.mode ?? 'idle';

  let targetHeroId = null;
  if (patch.targetHeroId !== undefined) {
    targetHeroId = patch.targetHeroId == null ? null : String(patch.targetHeroId);
  } else if (cur.targetHeroId != null) {
    targetHeroId = String(cur.targetHeroId);
  }

  let threatMap;
  if (patch.threat instanceof Map) threatMap = patch.threat;
  else threatMap = resetThreat ? new Map() : (cur.threat || new Map());

  const posUpdatedAt = Number(patch.posUpdatedAt ?? cur.posUpdatedAt ?? Date.now());
  const lastSeenAt = Number(patch.lastSeenAt ?? cur.lastSeenAt ?? 0);
  const repathAt = Number(patch.repathAt ?? cur.repathAt ?? 0);
  const lastSwitchAt = Number(patch.lastSwitchAt ?? cur.lastSwitchAt ?? 0);
  const agroSince = Number(patch.agroSince ?? cur.agroSince ?? 0);
  const lastProgressAt = Number(patch.lastProgressAt ?? cur.lastProgressAt ?? Date.now());
  const forcedAltUntil = Number(patch.forcedAltUntil ?? cur.forcedAltUntil ?? 0);
  const combatStep = patch.combatStep === undefined ? (cur.combatStep || null) : patch.combatStep;
  const lastCombatStepAt = Number(patch.lastCombatStepAt ?? cur.lastCombatStepAt ?? 0);
  const nextAttackAt = Number(patch.nextAttackAt ?? cur.nextAttackAt ?? 0);
  const returningHome = patch._returningHome !== undefined
    ? Boolean(patch._returningHome)
    : (resetThreat ? false : Boolean(cur._returningHome));

  // janela pós-leash: até quando o mob deve ignorar agro novo
  const leashCooldownUntil = Number(patch.leashCooldownUntil ?? cur.leashCooldownUntil ?? 0) || 0;

  const next = {
    instanceId: id,
    mapKey: patch.mapKey ?? cur.mapKey ?? null,
    x: pos.x | 0,
    y: pos.y | 0,
    speed: speedStat,
    moveSpeedPx,
    monsterKey: patch.monsterKey ?? cur.monsterKey ?? null,

    // runtime
    posUpdatedAt,
    mode: modeValue,
    targetHeroId,
    lastSeenAt,
    repathAt,
    lastSwitchAt,
    threat: threatMap,
    pendingStep,

    agroSince,
    lastProgressAt,
    forcedAltUntil,
    combatStep,
    lastCombatStepAt,

    // === Ranges em PX e cooldown em ms, todos no mesmo relógio (ms) ===
    attackRangeTiles: Math.max(1, attackRangeTiles | 0),
    aggroRangePx:  (aggroRangeTiles  * PX_PER_TILE) | 0,
    attackMs,
    nextAttackAt,
    attackDamage,
    attackType,
    attackRequiresLos: attackRequiresLos ? true : false,
    attack_profile: profilePatch || null,

    // mantém os originais para debug (opcional)
    attack_range: Math.max(1, attackRangeTiles | 0),
    aggro_range:  aggroRangeTiles,
    attack_ms:    attackMs,
    attack_type:  attackType,

    // debug / leash
    spawnRect,
    home,
    leashRangePx,
    leashPx: leashRangePx,
    _returningHome: returningHome,
    leashCooldownUntil,
  };

  mobs.set(id, next);
  return next;
}


function computeRepathCooldownMs(mob) {
  const speed = Number.isFinite(mob?.moveSpeedPx) ? mob.moveSpeedPx : DEFAULT_CHASE_SPEED_PX_S;
  const travelMs = (STEP_PX / Math.max(1, speed)) * 1000;
  return Math.max(90, Math.min(420, travelMs * 0.9));
}

// Exposta para seed inicial a partir do index.js
function seedPosition({
  id,
  x,
  y,
  mapKey,
  spawnRect,
  speed = null,
  monsterKey = null,
  leashPx = null,
  resetThreat = false
}) {
  const now = Date.now();
  const patch = {
    x: Number.isFinite(x) ? (x | 0) : undefined,
    y: Number.isFinite(y) ? (y | 0) : undefined,
    mapKey: mapKey == null ? undefined : String(mapKey),
    posUpdatedAt: now,
    spawnRect,
    speed,
    monsterKey,
    leashPx,
  };

  if (resetThreat) {
    patch.resetThreat = true;
    patch.mode = 'idle';
    patch.targetHeroId = null;
    patch.agroSince = 0;
    patch.lastSeenAt = 0;
    patch.repathAt = 0;
    patch.lastSwitchAt = 0;
    patch.pendingStep = null;
    patch.forcedAltUntil = 0;
    patch.combatStep = null;
    patch.lastCombatStepAt = now;
    patch.lastProgressAt = now;
    patch.nextAttackAt = now;
    patch._returningHome = false;
    patch.leashCooldownUntil = 0;
  }

  ensureMob(id, patch);
}




// Exposta para herói->mob (quando herói bate, aumenta threat)
function addThreatFromHeroHit(instanceId, heroId, amount = THREAT_ON_HIT) {
  const mob = mobs.get(String(instanceId));
  if (!mob) return;

  const now = Date.now();
  const cooldownUntil = Number(mob.leashCooldownUntil || 0);
  // Se o mob acabou de estourar o leash e está na janela de retorno,
  // ignora threat de hit para não reacender agro no caminho.
  if (cooldownUntil && now < cooldownUntil) return;

  const cur = mob.threat.get(String(heroId)) || 0;
  const inc = Math.max(0, Number(amount) || 0);
  mob.threat.set(String(heroId), cur + inc);
  if (DEBUG_AI) console.log(`[ai-mobs] threat++ mob=${instanceId} hero=${heroId} -> ${cur}+${inc}`);
}



// --------- Boot/Stop ----------
async function start() {
  if (loopTimer) return;

  const alive = await fetchAliveMonsters();
  for (const r of alive) {
    const sx = Number(r.spawn_x);
    const sy = Number(r.spawn_y);
    const hasSpawn = Number.isFinite(sx) && Number.isFinite(sy);
    const spawnRect = hasSpawn
      ? {
          x: sx,
          y: sy,
          w: Number(r.spawn_w),
          h: Number(r.spawn_h)
        }
      : null;

    ensureMob(r.id, {
      mapKey: r.map_key,
      x: (r.x | 0),
      y: (r.y | 0),
      mode: 'idle',
      attack_range: r.attack_range,  // tiles
      aggro_range:  r.aggro_range,
      attack_ms:    r.attack_ms,
      attack_profile: r.attack_profile,
      attack_type:  r.attack_type,
      spawnRect,
      speed: r.speed,
      monsterKey: r.monster_key,
      leashPx: r.leash_px,
      pendingStep: null,
    });

  }

  lastTickAt = Date.now();
  loopTimer = setInterval(tickLoop, TICK_MS);
  console.log('[ai-mobs] started. alive=', alive.length);
}

function stop() {
  if (loopTimer) clearInterval(loopTimer);
  loopTimer = null;
  mobs.clear();
  console.log('[ai-mobs] stopped.');
}

// --------- Loop principal ----------
const CARDINAL_DIRS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];
const ADJACENT_DIRS = [
  ...CARDINAL_DIRS,
  { dx: 1, dy: 1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: 1 },
  { dx: -1, dy: -1 },
];
const HERO_RING_PRIORITY = [
  { dx: 0, dy: -1, cardinal: true }, // norte
  { dx: 0, dy: 1, cardinal: true },  // sul
  { dx: -1, dy: 0, cardinal: true }, // oeste
  { dx: 1, dy: 0, cardinal: true },  // leste
  { dx: -1, dy: -1, cardinal: false },
  { dx: 1, dy: -1, cardinal: false },
  { dx: -1, dy: 1, cardinal: false },
  { dx: 1, dy: 1, cardinal: false },
];
const HERO_RING2_OFFSETS = [
  { dx: 0, dy: -2 },
  { dx: -1, dy: -2 },
  { dx: 1, dy: -2 },
  { dx: -2, dy: -2 },
  { dx: -2, dy: -1 },
  { dx: -2, dy: 0 },
  { dx: -2, dy: 1 },
  { dx: -2, dy: 2 },
  { dx: -1, dy: 2 },
  { dx: 0, dy: 2 },
  { dx: 1, dy: 2 },
  { dx: 2, dy: 2 },
  { dx: 2, dy: 1 },
  { dx: 2, dy: 0 },
  { dx: 2, dy: -1 },
  { dx: 2, dy: -2 },
];
const ORBIT_SHIFT_MS = 1400;

function tileKey(cx, cy) {
  return `${cx}|${cy}`;
}

function coerceTileSet(tiles) {
  if (tiles instanceof Set) return tiles;
  if (!tiles) return new Set();
  return new Set(tiles);
}

function losGridRows(losGrid) {
  if (!losGrid || !losGrid.cols) return 0;
  return Math.floor(losGrid.data.length / losGrid.cols);
}

function isSolidTile(losGrid, cx, cy) {
  if (!losGrid || !losGrid.data) return false;
  if (cx < 0 || cy < 0) return true;
  if (cx >= losGrid.cols) return true;
  const rows = losGridRows(losGrid);
  if (cy >= rows) return true;
  const idx = cy * losGrid.cols + cx;
  return losGrid.data[idx] === 1;
}

function isTileBlockedByMobs(occupancy, cx, cy, ignoreId) {
  if (!occupancy) return false;
  const key = tileKey(cx, cy);
  const set = occupancy.get(key);
  if (!set || set.size === 0) return false;
  if (set.size === 1 && set.has(ignoreId)) return false;
  return true;
}

/**
 * Retorna true quando o mob já está colado (Chebyshev <= 1) ao herói-alvo.
 * Usado para pausar o deslocamento e focar em atacar.
 */
function estaAoLadoDoJogador({ mob, heroCx, heroCy }) {
  if (!mob) return false;
  if (!Number.isFinite(heroCx) || !Number.isFinite(heroCy)) return false;
  const mobCx = Math.floor(Number(mob.x) / STEP_PX);
  const mobCy = Math.floor(Number(mob.y) / STEP_PX);
  if (!Number.isFinite(mobCx) || !Number.isFinite(mobCy)) return false;
  const rangeTiles = Number.isFinite(mob.attackRangeTiles) ? mob.attackRangeTiles : 1;
  return Math.max(Math.abs(mobCx - heroCx), Math.abs(mobCy - heroCy)) <= rangeTiles;
}

function buildHeroTileSet(mapKey, heroes, now = Date.now()) {
  const res = new Set();
  if (Array.isArray(heroes)) {
    for (const h of heroes) {
      const cx = Math.floor(Number(h?.x) / STEP_PX);
      const cy = Math.floor(Number(h?.y) / STEP_PX);
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
      res.add(tileKey(cx, cy));
    }
  }

  const mapStr = mapKey != null ? String(mapKey) : null;
  for (const mem of heroMemory.values()) {
    if (!mem) continue;
    if (mapStr && String(mem.mapKey) !== mapStr) continue;
    if (now - (mem.updatedAt || 0) > HERO_MEMORY_TTL_MS) continue;
    const cx = Number(mem.cx);
    const cy = Number(mem.cy);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    res.add(tileKey(cx, cy));
  }

  return res;
}

function buildMobOccupancy(list) {
  const occ = new Map();
  if (!Array.isArray(list)) return occ;
  for (const mob of list) {
    const cx = Math.floor(Number(mob?.x) / STEP_PX);
    const cy = Math.floor(Number(mob?.y) / STEP_PX);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    mob._tileCx = cx;
    mob._tileCy = cy;
    mob._tileKey = tileKey(cx, cy);
    let set = occ.get(mob._tileKey);
    if (!set) {
      set = new Set();
      occ.set(mob._tileKey, set);
    }
    set.add(mob.instanceId);
  }
  return occ;
}

function buildRingOptions({ baseCx, baseCy, offsets, heroTilesSet, heroKey, losGrid, occupancy, mob }) {
  const list = [];
  if (!Number.isFinite(baseCx) || !Number.isFinite(baseCy)) return list;

  const mobCx = mob ? Math.floor(Number(mob.x) / STEP_PX) : null;
  const mobCy = mob ? Math.floor(Number(mob.y) / STEP_PX) : null;

  offsets.forEach((dir, idx) => {
    const cx = baseCx + dir.dx;
    const cy = baseCy + dir.dy;
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;
    const key = tileKey(cx, cy);
    const solid = isSolidTile(losGrid, cx, cy);
    const heroReserved = heroTilesSet.has(key) && key !== heroKey;
    const blockedByMob = isTileBlockedByMobs(occupancy, cx, cy, mob?.instanceId);
    const occSet = occupancy ? occupancy.get(key) : null;
    const occCount = occSet ? (occSet.has(mob?.instanceId) ? Math.max(0, occSet.size - 1) : occSet.size) : 0;
    const dist = Number.isFinite(mobCx) && Number.isFinite(mobCy)
      ? Math.abs(cx - mobCx) + Math.abs(cy - mobCy)
      : Infinity;
    list.push({
      cx,
      cy,
      key,
      solid,
      heroReserved,
      blockedByMob,
      occCount,
      dist,
      blocked: solid || heroReserved || blockedByMob,
      prefIndex: idx,
      cardinal: Boolean(dir.cardinal),
    });
  });

  return list;
}

async function maybeReturnMobHome({ mob, dt, losGrid, occupancy, heroTiles }) {
  if (!mob) return;

  const homeX = Number(mob?.home?.x);
  const homeY = Number(mob?.home?.y);
  if (!Number.isFinite(homeX) || !Number.isFinite(homeY)) {
    mob._returningHome = false;
    mob.pendingStep = null;
    mob.combatStep = null;
    return;
  }

  const distChebyPx = Math.max(Math.abs(mob.x - homeX), Math.abs(mob.y - homeY));
  if (distChebyPx <= HOME_TOLERANCE_PX) {
    mob._returningHome = false;
    mob.leashCooldownUntil = 0;

    // snap exato pro centro do spawn
    mob.x = homeX | 0;
    mob.y = homeY | 0;
    mob.posUpdatedAt = Date.now();
    mob._tileCx = Math.floor(mob.x / STEP_PX);
    mob._tileCy = Math.floor(mob.y / STEP_PX);
    mob._tileKey = tileKey(mob._tileCx, mob._tileCy);

    try {
      await run(
        `UPDATE monster_instances
           SET x = $2,
               y = $3,
               hp = max_hp,      -- 👈 cura full ao chegar em casa
               updated_at = now()
         WHERE id = $1`,
        [mob.instanceId, mob.x | 0, mob.y | 0]
      );
      try {
        broadcast({ type: 'mob_pos', instanceId: mob.instanceId, mapKey: mob.mapKey, x: mob.x, y: mob.y });
      } catch {}
    } catch (e) {
      console.warn('[ai-mobs] home persist error:', e?.message);
    }

    mob.pendingStep = null;
    mob.combatStep = null;
    return;
  }


  if (!mob._returningHome) {
    mob.pendingStep = null;
    mob.combatStep = null;
  }
  mob._returningHome = true;

  const target = { x: homeX, y: homeY };
  let stepTarget = null;

  const hasValidPending = mob.pendingStep && Number.isFinite(mob.pendingStep.x) && Number.isFinite(mob.pendingStep.y);
  if (hasValidPending) {
    stepTarget = mob.pendingStep;
  } else {
    const step = pickStepGreedy(mob, target, losGrid, occupancy, heroTiles, null);
    if (!step) {
      mob.pendingStep = null;
      return;
    }
    stepTarget = { x: step.x | 0, y: step.y | 0 };
    mob.pendingStep = stepTarget;
  }

  const reached = await moveMobAndPersist(mob, stepTarget, dt, losGrid, occupancy);
  if (reached) {
    mob.pendingStep = null;
  }
}

function findNearestFreeTile({
  startCx,
  startCy,
  occupancy,
  heroTiles,
  losGrid,
  ignoreId,
  maxDepth = 8,
}) {
  const queue = [{ cx: startCx, cy: startCy, depth: 0 }];
  const visited = new Set([tileKey(startCx, startCy)]);

  while (queue.length) {
    const node = queue.shift();
    if (node.depth >= maxDepth) continue;

    for (const dir of ADJACENT_DIRS) {
      const nx = node.cx + dir.dx;
      const ny = node.cy + dir.dy;
      if (isSolidTile(losGrid, nx, ny)) continue;
      const k = tileKey(nx, ny);
      if (visited.has(k)) continue;
      visited.add(k);
      if (heroTiles && heroTiles.has(k)) {
        // evita ocupar o mesmo tile que o herói, mas pode explorar ao redor
        queue.push({ cx: nx, cy: ny, depth: node.depth + 1 });
        continue;
      }

      const blocked = isTileBlockedByMobs(occupancy, nx, ny, ignoreId);
      if (!blocked) {
        return { cx: nx, cy: ny };
      }

      queue.push({ cx: nx, cy: ny, depth: node.depth + 1 });
    }
  }
  return null;
}

async function teleportMobToTile({ mob, cx, cy, occupancy }) {
  if (!mob) return;
  const prevCx = Math.floor(Number(mob.x) / STEP_PX);
  const prevCy = Math.floor(Number(mob.y) / STEP_PX);
  const prevKey = tileKey(prevCx, prevCy);

  const px = cx * STEP_PX + STEP_PX / 2;
  const py = cy * STEP_PX + STEP_PX / 2;
  mob.x = px | 0;
  mob.y = py | 0;
  mob.posUpdatedAt = Date.now();

  if (occupancy) {
    const prevSet = occupancy.get(prevKey);
    if (prevSet) {
      prevSet.delete(mob.instanceId);
      if (!prevSet.size) occupancy.delete(prevKey);
    }

    const destKey = tileKey(cx, cy);
    let set = occupancy.get(destKey);
    if (!set) {
      set = new Set();
      occupancy.set(destKey, set);
    }
    set.add(mob.instanceId);

    mob._tileCx = cx;
    mob._tileCy = cy;
    mob._tileKey = destKey;
  }

  try {
    await run(
      `UPDATE monster_instances SET x=$2, y=$3, updated_at=now() WHERE id=$1`,
      [mob.instanceId, mob.x | 0, mob.y | 0]
    );
    try {
      broadcast({ type: 'mob_pos', instanceId: mob.instanceId, mapKey: mob.mapKey, x: mob.x, y: mob.y });
    } catch {}
  } catch (e) {
    console.warn('[ai-mobs] teleport persist error:', e?.message);
  }
}

async function resolveMobStacks({ mobsInMap, occupancy, heroTiles, losGrid }) {
  if (!Array.isArray(mobsInMap) || mobsInMap.length === 0) return;
  const stacks = new Map();
  for (const mob of mobsInMap) {
    if (!mob || mob._tileKey == null) continue;
    if (!stacks.has(mob._tileKey)) stacks.set(mob._tileKey, []);
    stacks.get(mob._tileKey).push(mob);
  }

  for (const [key, stack] of stacks.entries()) {
    if (!Array.isArray(stack) || stack.length <= 1) continue;
    // mantém o primeiro no tile atual, desloca os demais
    stack.sort((a, b) => {
      const ia = Number(a?.instanceId) || 0;
      const ib = Number(b?.instanceId) || 0;
      return ia - ib;
    });

    for (let i = 1; i < stack.length; i++) {
      const mob = stack[i];
      const startCx = mob?._tileCx;
      const startCy = mob?._tileCy;
      if (!Number.isFinite(startCx) || !Number.isFinite(startCy)) continue;

      const free = findNearestFreeTile({
        startCx,
        startCy,
        occupancy,
        heroTiles,
        losGrid,
        ignoreId: mob.instanceId,
        maxDepth: 10,
      });

      if (!free) continue;
      await teleportMobToTile({ mob, cx: free.cx, cy: free.cy, occupancy });
    }
  }
}

async function tickLoop() {
  const now = Date.now();
  const dt = Math.min(0.25, (now - lastTickAt) / 1000);
  lastTickAt = now;

  // group by map
  const byMap = new Map();
  for (const m of mobs.values()) {
    if (!m.mapKey) continue;
    if (!byMap.has(m.mapKey)) byMap.set(m.mapKey, []);
    byMap.get(m.mapKey).push(m);
  }

  for (const [mapKey, list] of byMap.entries()) {
    const heroes = await fetchOnlineHeroesInMap(mapKey);

    const { grid, cols } = await getGrid(mapKey);

    // 🔍 LOG DE SANIDADE DO GRID (1x por minuto)
    if (!global.__gridLogged || Date.now() - global.__gridLogged > 60000) {
      const rows = Math.floor(grid.length / cols);
      console.log(`[GRID] map=${mapKey} cols=${cols} rows=${rows} len=${grid.length}`);
      global.__gridLogged = Date.now();
    }

    const losGrid = { data: grid, cols };
    const occupancy = buildMobOccupancy(list);

    updateHeroMemoryForMap(mapKey, heroes, now);

    const heroTiles = buildHeroTileSet(mapKey, heroes, now);

    await resolveMobStacks({ mobsInMap: list, occupancy, heroTiles, losGrid });

    if (DEBUG_AI) {
      console.log(`[ai-mobs] tick map=${mapKey} heroes=${heroes.length} mobs=${list.length}`);
      if (heroes.length === 0 && list.length) {
        console.log(`[ai-mobs] no heroes online in map=${mapKey}`);
      }
    }

    for (const mob of list) {
      try {
        await stepMob(now, dt, mob, heroes, losGrid, occupancy, heroTiles);
      } catch (e) {
        console.warn('[ai-mobs] stepMob error:', e?.message);
      }
    }
  }
}

async function stepMob(now, dt, mob, heroes, losGrid, occupancy, heroTiles) {
  decayThreat(mob, dt);
  selectTargetByThreat(now, mob, heroes, losGrid);

  // 1) GATE de leash: se passou do raio, limpa agro e volta pra casa
  const leashRangePx = Number.isFinite(mob?.leashRangePx) ? mob.leashRangePx : null;
  if (
    leashRangePx != null && leashRangePx > 0 &&
    mob?.home && Number.isFinite(mob.home.x) && Number.isFinite(mob.home.y)
  ) {
    const distFromHome = Math.hypot(
      (mob.x ?? mob.home.x) - mob.home.x,
      (mob.y ?? mob.home.y) - mob.home.y
    );
    if (distFromHome > leashRangePx + HOME_TOLERANCE_PX) {
      if (mob.targetHeroId) mob.threat.delete(String(mob.targetHeroId));
      mob.targetHeroId = null;
      mob.mode = 'idle';
      mob.pendingStep = null;
      mob.combatStep = null;
      mob.agroSince = 0;
      // durante alguns ms após estourar o leash, ignora novo agro
      mob.leashCooldownUntil = now + LEASH_COOLDOWN_MS;
      await maybeReturnMobHome({ mob, dt, losGrid, occupancy, heroTiles });
      return;
    }
  }

  // Sem alvo -> idle + return home
  if (!mob.targetHeroId) {
    mob.mode = 'idle';
    mob.agroSince = 0;
    mob.forcedAltUntil = 0;
    mob.lastProgressAt = mob.posUpdatedAt || now;
    mob.pendingStep = null;
    mob.combatStep = null;
    mob.lastKnownHeroPos = null;
    await maybeReturnMobHome({ mob, dt, losGrid, occupancy, heroTiles });
    return;
  }

  // ---- NOVO: resolve posição atual do alvo (tgtPos) uma vez ----
  let tgtPos = null;
  if (mob.targetHeroId) {
    // 1) player online e fresco
    tgtPos = heroes.find(h => h.heroId === mob.targetHeroId) || null;

    // 2) se não estiver online, usa memória local do próprio mob (lastKnownHeroPos)
    if (!tgtPos) {
      const memPos = mob.lastKnownHeroPos;
      if (memPos && Number.isFinite(memPos.x) && Number.isFinite(memPos.y)) {
        const memAge = now - (memPos.updatedMs ?? 0);
        if (memAge <= LAST_KNOWN_HERO_GRACE_MS) {
          tgtPos = {
            heroId: mob.targetHeroId,
            x: memPos.x | 0,
            y: memPos.y | 0,
            updatedMs: memPos.updatedMs ?? 0,
          };
        }
      }
    }

    // 3) fallback: última posição vinda do DB (hero_last_pos)
    if (!tgtPos) {
      const fb = await getHeroLastPosPx(mob.targetHeroId, mob.mapKey);
      if (fb && Number.isFinite(fb.x) && Number.isFinite(fb.y)) {
        tgtPos = {
          heroId: mob.targetHeroId,
          x: fb.x | 0,
          y: fb.y | 0,
          updatedMs: fb.updatedMs || 0,
        };
      }
    }
  }

  // se ainda assim não temos posição útil -> esquece alvo e volta pra casa
  if (!tgtPos) {
    if (now - (mob.lastSeenAt || 0) > GIVEUP_MS) {
      if (mob.targetHeroId) mob.threat.delete(String(mob.targetHeroId));
      mob.targetHeroId = null;
      mob.mode = 'idle';
      mob.lastKnownHeroPos = null;
      mob.agroSince = 0;
    }
    mob.pendingStep = null;
    mob.combatStep = null;
    await maybeReturnMobHome({ mob, dt, losGrid, occupancy, heroTiles });
    return;
  }

  // 👇 Perda de agro quando o herói sai da "tela" por muito tempo
  const visionPx = mob.aggroRangePx || (8 * PX_PER_TILE); // raio base
  const dxVision = (mob.x ?? 0) - (tgtPos.x ?? 0);
  const dyVision = (mob.y ?? 0) - (tgtPos.y ?? 0);
  const distVision2 = dxVision * dxVision + dyVision * dyVision;

  if (distVision2 > visionPx * visionPx && now - (mob.lastSeenAt || 0) > GIVEUP_MS) {
    if (mob.targetHeroId) mob.threat.delete(String(mob.targetHeroId));
    mob.targetHeroId = null;
    mob.mode = 'idle';
    mob.pendingStep = null;
    mob.combatStep = null;
    mob.agroSince = 0;
    mob.lastKnownHeroPos = null;

    await maybeReturnMobHome({ mob, dt, losGrid, occupancy, heroTiles });
    return;
  }

  let heroMem = mob.targetHeroId ? heroMemory.get(String(mob.targetHeroId)) : null;

  // --- geometria básica / stuck / orbit ---
  const TILE = PX_PER_TILE;
  const mobCx  = Math.floor(mob.x / TILE);
  const mobCy  = Math.floor(mob.y / TILE);
  const heroCx = Math.floor(tgtPos.x / TILE);
  const heroCy = Math.floor(tgtPos.y / TILE);

  if (heroTiles && Number.isFinite(heroCx) && Number.isFinite(heroCy)) {
    heroTiles.add(tileKey(heroCx, heroCy));
  }

  const stuckBaseline = Math.max(mob.lastProgressAt || 0, mob.agroSince || 0);
  const stuckFor = now - stuckBaseline;
  const agroActive = mob.agroSince > 0 && (now - mob.agroSince) < GIVEUP_MS * 2;
  const shouldForceAlternate = agroActive && stuckFor >= STUCK_RECHECK_MS;
  const altPathMode = shouldForceAlternate || (mob.forcedAltUntil || 0) > now;

  if (shouldForceAlternate) {
    const rotateCooldown = Math.max(400, STUCK_RECHECK_MS / 2);
    if (!mob.lastGoalRotateAt || now - mob.lastGoalRotateAt >= rotateCooldown) {
      mob.goalRotateIndex = ((mob.goalRotateIndex ?? 0) + 1) % HERO_RING_PRIORITY.length;
      mob.lastGoalRotateAt = now;
      mob.requestOrbitShift = true;
    }
  }

  const mobTile = toTileCoords({ x: mob.x, y: mob.y });
  const heroTile = toTileCoords({ x: tgtPos.x, y: tgtPos.y });
  const rangeTiles = Number.isFinite(mob.attackRangeTiles) ? mob.attackRangeTiles : 1;
  const distTiles = chebyshevTiles(mobTile, heroTile);
  const inRangeTiles = Number.isFinite(distTiles) && distTiles <= rangeTiles;

  const canSeeNow = IGNORE_LOS || !mob.attackRequiresLos
    ? true
    : hasLineOfSightTiles(losGrid, mobTile.tx, mobTile.ty, heroTile.tx, heroTile.ty);

  if (DEBUG_AI) {
    console.log(
      `[ai-mobs] tgt mob=${mob.instanceId} -> hero=${mob.targetHeroId} distTiles=${distTiles} ` +
      `range=${rangeTiles} los=${canSeeNow}`
    );
  }

  // 2) Se não está em range/LOS, volta pra chase
  if (!(inRangeTiles && canSeeNow)) {
    if (mob.mode === 'attack') mob.mode = 'chase';
    if (shouldForceAlternate) {
      mob.forcedAltUntil = Math.max(mob.forcedAltUntil || 0, now + ALT_PATH_WINDOW_MS);
    }
    mob.combatStep = null;
  }

  // 3) ATAQUE
  if (inRangeTiles && canSeeNow) {
    // usa posição já resolvida (tgtPos) como base
    let tgt = tgtPos;

    let gate = canMobHitNow({ now, mob, tgtPos: tgt, losGrid });
    if (!gate.ok && shouldForceAlternate && heroMem) {
      const predictedHit = predictHeroTileCx(heroMem, heroCx, heroCy);
      if (predictedHit && Number.isFinite(predictedHit.cx) && Number.isFinite(predictedHit.cy)) {
        const alt = {
          heroId: mob.targetHeroId,
          x: predictedHit.cx * STEP_PX + STEP_PX / 2,
          y: predictedHit.cy * STEP_PX + STEP_PX / 2,
          updatedMs: predictedHit.updatedAt || now,
        };
        const altGate = canMobHitNow({ now, mob, tgtPos: alt, losGrid });
        if (altGate.ok) {
          gate = altGate;
          tgt = alt;
        }
      }
    }

    if (!gate.ok) {
      if (DEBUG_AI) {
        console.log('[ai-mobs] HIT BLOQUEADO', gate.reason,
          'mob=', mob.instanceId, 'hero=', mob.targetHeroId,
          'mobPos=', {x:mob.x,y:mob.y, age: now-(mob.posUpdatedAt||0)},
          'heroPos=', tgt ? {x:tgt.x,y:tgt.y, age: now-(tgt.updatedMs||0)} : null
        );
      }
      if (mob.mode === 'attack') mob.mode = 'chase';
      if (shouldForceAlternate) {
        mob.forcedAltUntil = Math.max(mob.forcedAltUntil || 0, now + ALT_PATH_WINDOW_MS);
      }
      mob.combatStep = null;
      return;
    }

    mob.mode = 'attack';
    mob.pendingStep = null;
    mob.lastSeenAt = now;
    mob.lastProgressAt = now;
    mob.forcedAltUntil = 0;

    if (gate.ok && gate.heroPx && Number.isFinite(gate.heroPx.x) && Number.isFinite(gate.heroPx.y)) {
      mob.lastKnownHeroPos = {
        x: gate.heroPx.x | 0,
        y: gate.heroPx.y | 0,
        updatedMs: now,
      };
    }

    const cd = Number(mob.attackMs || (K.MONSTER_SPEED_MS && K.MONSTER_SPEED_MS.DEFAULT) || 1200);
    if (now >= (mob.nextAttackAt || 0)) {
      mob.nextAttackAt = now + cd;

      // mantém a posição do mob "fresca" mesmo parado, sem depender de movimento
      mob.posUpdatedAt = now;

      if (DEBUG_AI) {
        console.log('[ai-mobs] atk (tile-range)', mob.instanceId, '->', mob.targetHeroId,
          'mobTile=', mobTile, 'heroTile=', heroTile, 'dist=', distTiles);
      }
      try {
        await applyMobHit({
          attackerInstanceId: String(mob.instanceId),
          targetHeroId: String(mob.targetHeroId),
          attackInfo: {
            min: mob.attackDamage?.min,
            max: mob.attackDamage?.max,
            type: mob.attackType,
            rangeTiles,
            intervalMs: cd,
            requiresLos: mob.attackRequiresLos,
          },
          attackerPos: {
            x: Number.isFinite(mob.x) ? mob.x : undefined,
            y: Number.isFinite(mob.y) ? mob.y : undefined,
            mapKey: mob.mapKey,
            face: mob.face,
            unit: 'px',
            assumeTiles: false,
            assumePx: true,
          },
        });
      } catch (e) {
        console.warn('[ai-mobs] applyMobHit error:', e?.message);
      }
      mob.lastProgressAt = now;
    }

    await maybeHandleCombatDance({
      mob,
      now,
      dt,
      losGrid,
      occupancy,
      heroCx,
      heroCy,
      heroTiles,
    });
    return;
  }

  // 4) CHASE (greedy cardinal com colisão + leash no passo)
  mob.mode = 'chase';
  mob.combatStep = null;

  if (canSeeNow && estaAoLadoDoJogador({ mob, heroCx, heroCy })) {
    mob.pendingStep = null;
    mob.repathAt = now;
    return;
  }

  const hasValidStep = mob.pendingStep && Number.isFinite(mob.pendingStep.x) && Number.isFinite(mob.pendingStep.y);
  let stepTarget = null;
  if (hasValidStep && !altPathMode) {
    stepTarget = mob.pendingStep;
  } else if (hasValidStep) {
    mob.pendingStep = null;
  }

  if (!stepTarget && now >= mob.repathAt) {
    const { step, usedAlternate } = planMobChaseStep({
      mob,
      tgtPos,
      losGrid,
      occupancy,
      heroTiles,
      heroMem,
      altPathMode,
      now,
    });

    if (step) {
      if (usedAlternate) {
        mob.forcedAltUntil = Math.max(mob.forcedAltUntil || 0, now + ALT_PATH_WINDOW_MS);
      }
      mob.pendingStep = { x: step.x | 0, y: step.y | 0 };
      stepTarget = mob.pendingStep;
      const cooldown = computeRepathCooldownMs(mob);
      const adjusted = usedAlternate ? Math.max(90, cooldown * 0.75) : cooldown;
      mob.repathAt = now + adjusted;
    } else {
      mob.pendingStep = null;
      const base = computeRepathCooldownMs(mob);
      const wait = altPathMode ? Math.max(90, base * 0.75) : Math.max(120, base);
      mob.repathAt = now + wait;
      if (altPathMode) {
        mob.forcedAltUntil = Math.max(mob.forcedAltUntil || 0, now + ALT_PATH_WINDOW_MS);
      }
    }
  }

  if (stepTarget) {
    // leash também limita o passo máximo
    if (
      leashRangePx != null && leashRangePx > 0 &&
      mob?.home && Number.isFinite(mob.home.x) && Number.isFinite(mob.home.y)
    ) {
      const stepDist = Math.hypot(stepTarget.x - mob.home.x, stepTarget.y - mob.home.y);
      if (stepDist > leashRangePx + HOME_TOLERANCE_PX) {
        if (mob.targetHeroId) mob.threat.delete(String(mob.targetHeroId));
        mob.targetHeroId = null;
        mob.mode = 'idle';
        mob.pendingStep = null;
        mob.combatStep = null;
        mob.agroSince = 0;
        await maybeReturnMobHome({ mob, dt, losGrid, occupancy, heroTiles });
        return;
      }
    }

    const reached = await moveMobAndPersist(mob, stepTarget, dt, losGrid, occupancy);
    if (reached) {
      mob.pendingStep = null;
      mob.repathAt = now;
    }
  } else if (shouldForceAlternate) {
    mob.forcedAltUntil = Math.max(mob.forcedAltUntil || 0, now + ALT_PATH_WINDOW_MS);
  }
}


// --------- Threat ----------
function decayThreat(mob, dt) {
  if (!mob.threat || mob.threat.size === 0) return;
  const dec = THREAT_DECAY * dt;
  for (const [hid, v] of mob.threat.entries()) {
    const nv = Math.max(0, v - dec);
    if (nv <= 0.001) mob.threat.delete(hid);
    else mob.threat.set(hid, nv);
  }
}

function selectTargetByThreat(now, mob, heroes, losGrid) {
  const aggroR2 = (mob.aggroRangePx || (8 * PX_PER_TILE)) ** 2;

  // Durante a janela pós-leash, o mob ignora agro novo para conseguir,
  // de fato, voltar pra casa.
  const cooldownUntil = Number(mob.leashCooldownUntil || 0);
  if (cooldownUntil && now < cooldownUntil) {
    return;
  }

  // DEBUG: distância mais próxima (mesmo que fora do aggro)
  let nearest = { id: null, d2: Infinity };

  for (const h of heroes) {
    const dx = mob.x - h.x, dy = mob.y - h.y;
    const d2 = dx*dx + dy*dy;
    if (d2 < nearest.d2) nearest = { id: h.heroId, d2 };

    if (d2 <= aggroR2) {
      const canSee = IGNORE_LOS ? true : hasLoSpx(losGrid, mob.x, mob.y, h.x, h.y);
      const base = canSee ? THREAT_ON_SIGHT : THREAT_ON_SIGHT * 0.4;
      const cur = mob.threat.get(h.heroId) || 0;
      const next = cur + base;
      mob.threat.set(h.heroId, next);

      if (DEBUG_AI) {
        const cheby = Math.max(Math.abs(dx), Math.abs(dy)) | 0;
        console.log(
          `[ai-mobs] inRange mob=${mob.instanceId} hero=${h.heroId} cheby=${cheby}px canSee=${canSee} threat=${next.toFixed(2)}`
        );
      }

      if (canSee) mob.lastSeenAt = now;
    }
  }

  if (DEBUG_AI && nearest.id) {
    const cheby = Math.max(
      Math.abs(mob.x - heroes.find(h => h.heroId === nearest.id).x),
      Math.abs(mob.y - heroes.find(h => h.heroId === nearest.id).y)
    ) | 0;
    const aggro = Math.sqrt(aggroR2) | 0; // pode manter esse, é só info
    console.log(`[ai-mobs] nearest mob=${mob.instanceId} -> hero=${nearest.id} cheby=${cheby}px (aggro≈${aggro}px)`);
  }

  // Escolhe o maior threat; troca só se superar atual + histerese
  let bestId = null, bestV = -1;
  for (const [hid, v] of mob.threat.entries()) if (v > bestV) { bestV = v; bestId = hid; }

  if (!bestId) {
    mob.targetHeroId = null;
    mob.mode = 'idle';
    mob.agroSince = 0;
    mob.forcedAltUntil = 0;
    mob.lastProgressAt = mob.posUpdatedAt || now;
    mob.pendingStep = null;
    mob.combatStep = null;
    mob.lastChaseGoalKey = null;
    mob.lastWaitGoalKey = null;
    mob.waitOrbitIndex = 0;
    mob.goalRotateIndex = 0;
    mob.requestOrbitShift = false;
    mob.lastKnownHeroPos = null;
    return;
  }
  if (!mob.targetHeroId) {
    mob.targetHeroId = bestId;
    mob.lastSwitchAt = now;
    mob.lastSeenAt = now;
    mob.agroSince = now;
    mob.lastProgressAt = now;
    mob.forcedAltUntil = 0;
    mob.pendingStep = null;
    mob.combatStep = null;
    mob.lastChaseGoalKey = null;
    mob.lastWaitGoalKey = null;
    mob.waitOrbitIndex = 0;
    mob.goalRotateIndex = 0;
    mob.requestOrbitShift = false;
    try { battleState.touchHero(bestId, { reason: 'aggro' }); } catch {}
    if (DEBUG_AI) console.log(`[ai-mobs] target set mob=${mob.instanceId} -> ${bestId} (threat=${bestV.toFixed(2)})`);
    return;
  }

  if (bestId !== mob.targetHeroId) {
    const curV = mob.threat.get(mob.targetHeroId) || 0;
    if (bestV >= curV + SWITCH_HYSTERESIS) {
      if (DEBUG_AI) console.log(`[ai-mobs] switch target ...`);
      mob.targetHeroId = bestId;
      mob.lastSwitchAt = now;
      mob.nextAttackAt = now + Math.max(0, Number(mob.attackMs) || 0);
      mob.agroSince = now;
      mob.lastProgressAt = now;
      mob.forcedAltUntil = 0;
      mob.pendingStep = null;
      mob.combatStep = null;
      mob.lastChaseGoalKey = null;
      mob.lastWaitGoalKey = null;
      mob.waitOrbitIndex = 0;
      mob.goalRotateIndex = 0;
      mob.requestOrbitShift = false;
      try { battleState.touchHero(bestId, { reason: 'aggro-switch' }); } catch {}
    }
  }

  if (mob.targetHeroId && !mob.agroSince) {
    mob.agroSince = now;
  }
}


// --------- Movement ----------
function isBlockedPx(losGrid, wx, wy) {
  if (IGNORE_COLLISION) return false; // toggle de teste
  const cx = Math.floor(wx / STEP_PX);
  const cy = Math.floor(wy / STEP_PX);
  if (cx < 0 || cy < 0 || cy * losGrid.cols + cx >= losGrid.data.length) return true;
  // grid.js marca 1 como sólido/bloqueado. Se o seu mapa usar o inverso, troque para === 0.
  return losGrid.data[cy * losGrid.cols + cx] === 1;
}

function selectMobChaseGoal({ mob, heroCx, heroCy, heroMem, losGrid, occupancy, heroTiles, now = Date.now() }) {
  if (!mob) {
    return { cx: heroCx, cy: heroCy, predicted: null, heading: null };
  }

  const predicted = predictHeroTileCx(heroMem, heroCx, heroCy);
  const fallbackCx = Number.isFinite(predicted?.cx) ? predicted.cx : heroCx;
  const fallbackCy = Number.isFinite(predicted?.cy) ? predicted.cy : heroCy;
  const heroTilesSet = coerceTileSet(heroTiles);
  const heroKey = Number.isFinite(heroCx) && Number.isFinite(heroCy) ? tileKey(heroCx, heroCy) : null;
  const heading = predicted?.heading || heroMem?.heading || null;

  if (!Number.isFinite(heroCx) || !Number.isFinite(heroCy)) {
    return {
      cx: Number.isFinite(fallbackCx) ? fallbackCx : heroCx,
      cy: Number.isFinite(fallbackCy) ? fallbackCy : heroCy,
      predicted,
      heading,
    };
  }

  const ring1 = buildRingOptions({
    baseCx: heroCx,
    baseCy: heroCy,
    offsets: HERO_RING_PRIORITY,
    heroTilesSet,
    heroKey,
    losGrid,
    occupancy,
    mob,
  });

  let target = null;
  if (mob.lastChaseGoalKey) {
    const pinned = ring1.find(opt => opt.key === mob.lastChaseGoalKey && !opt.blocked);
    if (pinned) target = pinned;
  }

  if (!target) {
    const rotateIndex = Math.max(0, (mob.goalRotateIndex ?? 0) % Math.max(1, ring1.length));
    for (let i = 0; i < ring1.length; i++) {
      const idx = (rotateIndex + i) % ring1.length;
      const candidate = ring1[idx];
      if (!candidate || candidate.blocked) continue;
      target = candidate;
      break;
    }
  }

  if (target) {
    mob.lastChaseGoalKey = target.key;
    mob.lastWaitGoalKey = null;
    mob.requestOrbitShift = false;
    return {
      cx: target.cx,
      cy: target.cy,
      predicted,
      heading,
    };
  }

  let ring2 = buildRingOptions({
    baseCx: heroCx,
    baseCy: heroCy,
    offsets: HERO_RING2_OFFSETS,
    heroTilesSet,
    heroKey,
    losGrid,
    occupancy,
    mob,
  }).filter(opt => !opt.blocked);

  if (ring2.length) {
    ring2.sort((a, b) => {
      if (a.occCount !== b.occCount) return a.occCount - b.occCount;
      if (a.dist !== b.dist) return a.dist - b.dist;
      return a.prefIndex - b.prefIndex;
    });

    const lastOrbitAt = Number.isFinite(mob.lastOrbitShiftAt) ? mob.lastOrbitShiftAt : now;
    if (mob.requestOrbitShift || (Number.isFinite(now) && now - lastOrbitAt >= ORBIT_SHIFT_MS)) {
      mob.waitOrbitIndex = ((mob.waitOrbitIndex ?? 0) + 1) % ring2.length;
      mob.lastOrbitShiftAt = now;
      mob.requestOrbitShift = false;
    } else if (!Number.isFinite(mob.lastOrbitShiftAt) && Number.isFinite(now)) {
      mob.lastOrbitShiftAt = now;
    }

    let waitChoice = null;
    if (mob.lastWaitGoalKey) {
      waitChoice = ring2.find(opt => opt.key === mob.lastWaitGoalKey) || null;
    }

    if (!waitChoice) {
      const start = Math.max(0, Math.min(ring2.length - 1, mob.waitOrbitIndex ?? 0));
      for (let i = 0; i < ring2.length; i++) {
        const idx = (start + i) % ring2.length;
        const candidate = ring2[idx];
        if (!candidate) continue;
        waitChoice = candidate;
        mob.waitOrbitIndex = idx;
        break;
      }
    }

    if (waitChoice) {
      mob.lastWaitGoalKey = waitChoice.key;
      mob.lastChaseGoalKey = null;
      mob.requestOrbitShift = false;
      return {
        cx: waitChoice.cx,
        cy: waitChoice.cy,
        predicted,
        heading,
      };
    }
  }

  mob.requestOrbitShift = false;
  mob.lastWaitGoalKey = null;
  mob.waitOrbitIndex = 0;
  if (!Number.isFinite(fallbackCx) || !Number.isFinite(fallbackCy)) {
    return { cx: heroCx, cy: heroCy, predicted, heading };
  }

  return {
    cx: fallbackCx,
    cy: fallbackCy,
    predicted,
    heading,
  };
}

function planMobChaseStep({ mob, tgtPos, losGrid, occupancy, heroTiles, heroMem, altPathMode, now }) {
  if (!mob || !tgtPos) return { step: null, usedAlternate: false };

  let step = pickStepGreedy(mob, tgtPos, losGrid, occupancy, heroTiles, heroMem, now);
  let usedAlternate = false;

  if (!step && altPathMode) {
    step = pickStepAlternate(
      mob,
      tgtPos,
      losGrid,
      occupancy,
      heroTiles,
      heroMem,
      { maxDepth: ALT_PATH_MAX_DEPTH },
      now,
    );
    usedAlternate = Boolean(step);
  }

  return { step, usedAlternate };
}

function pickCombatDanceStep({ mob, heroCx, heroCy, losGrid, occupancy, heroTiles }) {
  if (!mob) return null;
  if (!Number.isFinite(heroCx) || !Number.isFinite(heroCy)) return null;

  const mobCx = Math.floor(Number(mob.x) / STEP_PX);
  const mobCy = Math.floor(Number(mob.y) / STEP_PX);
  const heroTilesSet = coerceTileSet(heroTiles);
  const heroKey = tileKey(heroCx, heroCy);

  const options = [];
  for (const dir of CARDINAL_DIRS) {
    const cx = mobCx + dir.dx;
    const cy = mobCy + dir.dy;
    const key = tileKey(cx, cy);

    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    if (heroTilesSet.has(key) && key !== heroKey) continue;
    if (isSolidTile(losGrid, cx, cy)) continue;
    if (isTileBlockedByMobs(occupancy, cx, cy, mob.instanceId)) continue;

    const chebyHero = Math.max(Math.abs(cx - heroCx), Math.abs(cy - heroCy));
    if (chebyHero > 1) continue; // precisa continuar adjacente ao alvo

    const relX = mobCx - heroCx;
    const relY = mobCy - heroCy;
    let score = Math.abs(cx - mobCx) + Math.abs(cy - mobCy);
    if (dir.dx && Math.sign(relX) === dir.dx && Math.abs(relX) > 0) score += 0.75;
    if (dir.dy && Math.sign(relY) === dir.dy && Math.abs(relY) > 0) score += 0.75;
    if (dir.dx && relX && Math.sign(relX) === -dir.dx) score -= 0.65;
    if (dir.dy && relY && Math.sign(relY) === -dir.dy) score -= 0.65;

    options.push({ cx, cy, score });
  }

  if (!options.length) return null;

  options.sort((a, b) => a.score - b.score);
  const best = options[0];
  return {
    x: best.cx * STEP_PX + STEP_PX / 2,
    y: best.cy * STEP_PX + STEP_PX / 2,
    cx: best.cx,
    cy: best.cy,
  };
}

async function maybeHandleCombatDance({ mob, now, dt, losGrid, occupancy, heroCx, heroCy, heroTiles }) {
  if (!mob) return false;
  if (!Number.isFinite(heroCx) || !Number.isFinite(heroCy)) return false;
  const speed = Number.isFinite(mob.moveSpeedPx) ? mob.moveSpeedPx : DEFAULT_CHASE_SPEED_PX_S;
  if (speed <= 0) return false;

  const heroTilesSet = coerceTileSet(heroTiles);
  const heroKey = tileKey(heroCx, heroCy);

  if (mob.combatStep && now - (mob.combatStep.lastStageAt || mob.combatStep.startedAt || now) > COMBAT_DANCE_STAGE_TIMEOUT_MS) {
    mob.combatStep = null;
  }

  const state = mob.combatStep;
  if (state) {
    if (state.stage === 'return' && now < (state.readyToReturnAt || 0)) {
      return false;
    }

    const target = state.stage === 'return' ? state.returnTo : state.target;
    if (!target) {
      mob.combatStep = null;
      return false;
    }

    const cx = Math.floor(Number(target.x) / STEP_PX);
    const cy = Math.floor(Number(target.y) / STEP_PX);
    const key = tileKey(cx, cy);
    if ((heroTilesSet.has(key) && key !== heroKey) || isSolidTile(losGrid, cx, cy) || isTileBlockedByMobs(occupancy, cx, cy, mob.instanceId)) {
      mob.combatStep = null;
      return false;
    }

    const reached = await moveMobAndPersist(mob, target, dt, losGrid, occupancy);
    state.lastStageAt = now;
    if (reached) {
      if (state.stage === 'out') {
        state.stage = 'return';
        if (!state.readyToReturnAt || state.readyToReturnAt < now) {
          state.readyToReturnAt = now + COMBAT_DANCE_RETURN_DELAY_MS;
        }
      } else {
        mob.combatStep = null;
        mob.lastCombatStepAt = now;
      }
    }
    return true;
  }

  if (mob.pendingStep) return false;
  if (now - (mob.lastCombatStepAt || 0) < COMBAT_DANCE_COOLDOWN_MS) return false;

  const target = pickCombatDanceStep({ mob, heroCx, heroCy, losGrid, occupancy, heroTiles: heroTilesSet });
  if (!target) return false;

  const returnCx = Math.floor(Number(mob.x) / STEP_PX);
  const returnCy = Math.floor(Number(mob.y) / STEP_PX);
  const returnTo = {
    x: returnCx * STEP_PX + STEP_PX / 2,
    y: returnCy * STEP_PX + STEP_PX / 2,
  };

  mob.pendingStep = null;
  mob.combatStep = {
    stage: 'out',
    target,
    returnTo,
    startedAt: now,
    lastStageAt: now,
    readyToReturnAt: now + COMBAT_DANCE_RETURN_DELAY_MS,
  };

  const reached = await moveMobAndPersist(mob, target, dt, losGrid, occupancy);
  if (reached) {
    mob.combatStep.stage = 'return';
    mob.combatStep.lastStageAt = now;
  }
  return true;
}

function pickStepGreedy(mob, tgtPos, losGrid, occupancy, heroTiles, heroMem, now = Date.now()) {
  const c0x = Math.floor(mob.x / STEP_PX), c0y = Math.floor(mob.y / STEP_PX);
  const heroCx = Math.floor(tgtPos.x / STEP_PX), heroCy = Math.floor(tgtPos.y / STEP_PX);
  const heroTilesSet = coerceTileSet(heroTiles);
  const chaseGoal = selectMobChaseGoal({
    mob,
    heroCx,
    heroCy,
    heroMem,
    losGrid,
    occupancy,
    heroTiles: heroTilesSet,
    now,
  });
  const goalCx = Number.isFinite(chaseGoal?.cx) ? chaseGoal.cx : heroCx;
  const goalCy = Number.isFinite(chaseGoal?.cy) ? chaseGoal.cy : heroCy;
  const currentDist = Math.abs(c0x - goalCx) + Math.abs(c0y - goalCy);
  const heading = chaseGoal?.heading || null;

  const candidates = [];
  for (const dir of CARDINAL_DIRS) {
    candidates.push({ cx: c0x + dir.dx, cy: c0y + dir.dy });
  }

  let best = null;
  let bestScore = Infinity;

  for (const c of candidates) {
    const wx = c.cx * STEP_PX + STEP_PX / 2;
    const wy = c.cy * STEP_PX + STEP_PX / 2;
    if (isBlockedPx(losGrid, wx, wy)) continue;
    const key = tileKey(c.cx, c.cy);
    if (heroTilesSet.has(key)) continue;
    if (c.cx === heroCx && c.cy === heroCy) continue;
    if (isTileBlockedByMobs(occupancy, c.cx, c.cy, mob.instanceId)) continue;

    const distGoal = Math.abs(c.cx - goalCx) + Math.abs(c.cy - goalCy);
    const distHero = Math.abs(c.cx - heroCx) + Math.abs(c.cy - heroCy);
    const densityPenalty = computeMobDensityPenalty({
      occupancy,
      cx: c.cx,
      cy: c.cy,
      mobId: mob.instanceId,
      heroCx,
      heroCy,
    });
    const flank = computeMobFlankBonus({
      cx: c.cx,
      cy: c.cy,
      heroCx,
      heroCy,
      heading,
    });

    let score = distGoal + densityPenalty - flank;
    if (distHero <= 1 && densityPenalty < 0.6) score -= 0.25;
    if (distGoal > currentDist && currentDist > 1) score += (distGoal - currentDist) * 1.4;
    if (c.cx === goalCx && c.cy === goalCy) score -= 0.35;

    if (score < bestScore) {
      bestScore = score;
      best = { x: wx, y: wy };
    }
  }

  if (!best && DEBUG_AI) console.log(`[ai-mobs] path blocked mob=${mob.instanceId}`);
  return best;
}

function pickStepAlternate(mob, tgtPos, losGrid, occupancy, heroTiles, heroMem, opts = {}, now = Date.now()) {
  if (!mob || !tgtPos) return null;

  const maxDepth = Number.isFinite(opts.maxDepth) ? Math.max(1, opts.maxDepth | 0) : ALT_PATH_MAX_DEPTH;

  const startCx = Math.floor(mob.x / STEP_PX);
  const startCy = Math.floor(mob.y / STEP_PX);
  const heroCx = Math.floor(tgtPos.x / STEP_PX);
  const heroCy = Math.floor(tgtPos.y / STEP_PX);
  const heroTilesSet = coerceTileSet(heroTiles);
  const chaseGoal = selectMobChaseGoal({
    mob,
    heroCx,
    heroCy,
    heroMem,
    losGrid,
    occupancy,
    heroTiles: heroTilesSet,
    now,
  });
  const goalCx = Number.isFinite(chaseGoal?.cx) ? chaseGoal.cx : heroCx;
  const goalCy = Number.isFinite(chaseGoal?.cy) ? chaseGoal.cy : heroCy;
  const startKey = tileKey(startCx, startCy);
  const queue = [{ cx: startCx, cy: startCy, depth: 0 }];
  const parents = new Map([[startKey, null]]);

  let best = null;

  while (queue.length) {
    const node = queue.shift();
    if (!node) break;
    if (node.depth >= maxDepth) continue;

    for (const dir of CARDINAL_DIRS) {
      const nx = node.cx + dir.dx;
      const ny = node.cy + dir.dy;
      const key = tileKey(nx, ny);

      if (parents.has(key)) continue;
      if (isSolidTile(losGrid, nx, ny)) continue;

      const isHeroTile = nx === heroCx && ny === heroCy;
      const isGoalTile = nx === goalCx && ny === goalCy;
      if (!opts.allowHeroTile && (isHeroTile || heroTilesSet.has(key)) && !isGoalTile) continue;

      if (isTileBlockedByMobs(occupancy, nx, ny, mob.instanceId)) {
        // permite explorar tiles ocupados apenas se forem o alvo final para tentar contornar depois
        if (!opts.allowOccupied || (!isHeroTile && !isGoalTile)) continue;
      }

      parents.set(key, tileKey(node.cx, node.cy));

      const manhattan = Math.abs(nx - goalCx) + Math.abs(ny - goalCy);
      const depth = node.depth + 1;
      const candidate = { cx: nx, cy: ny, manhattan, depth };

      if (!best || manhattan < best.manhattan || (manhattan === best.manhattan && depth < best.depth)) {
        best = candidate;
      }

      if (manhattan <= 1 && (!heroTilesSet.has(key) || opts.allowHeroTile)) {
        best = candidate;
        queue.length = 0;
        break;
      }

      if (depth < maxDepth) {
        queue.push({ cx: nx, cy: ny, depth });
      }
    }
  }

  if (!best || best.manhattan == null) return null;

  let stepCx = best.cx;
  let stepCy = best.cy;
  let key = tileKey(stepCx, stepCy);
  let parent = parents.get(key);

  while (parent && parent !== startKey) {
    const [pcx, pcy] = parent.split('|').map(Number);
    if (!Number.isFinite(pcx) || !Number.isFinite(pcy)) break;
    stepCx = pcx;
    stepCy = pcy;
    key = parent;
    parent = parents.get(parent);
  }

  if (parent == null) {
    // melhor tile é o próprio start (sem movimento)
    return null;
  }

  const px = stepCx * STEP_PX + STEP_PX / 2;
  const py = stepCy * STEP_PX + STEP_PX / 2;
  if (isTileBlockedByMobs(occupancy, stepCx, stepCy, mob.instanceId)) return null;

  return { x: px | 0, y: py | 0 };
}

function clampToMapPx(losGrid, px) {
  const cols = losGrid.cols;
  const rows = Math.floor(losGrid.data.length / cols);
  const maxX = cols * PX_PER_TILE - 1;
  const maxY = rows * PX_PER_TILE - 1;
  return {
    x: Math.max(0, Math.min(px.x, maxX)),
    y: Math.max(0, Math.min(px.y, maxY)),
  };
}

async function moveMobAndPersist(mob, step, dt, losGrid, occupancy) {
  if (!mob || !step) return true;
  const speed = Number.isFinite(mob.moveSpeedPx) ? mob.moveSpeedPx : DEFAULT_CHASE_SPEED_PX_S;
  const maxMove = Math.max(0, speed * Math.max(0, dt));

  const dx = step.x - mob.x;
  const dy = step.y - mob.y;
  const dist = Math.hypot(dx, dy);
  const nowMs = Date.now();
  const prevX = mob.x;
  const prevY = mob.y;
  if (dist <= 0.5) {
    mob.x = step.x | 0;
    mob.y = step.y | 0;
    mob.posUpdatedAt = nowMs;
    mob.lastProgressAt = nowMs;
    return true;
  }

  const ux = dx / dist;
  const uy = dy / dist;
  const nx = dist <= maxMove ? step.x : (mob.x + ux * maxMove);
  const ny = dist <= maxMove ? step.y : (mob.y + uy * maxMove);

  const prevCx = Math.floor(mob.x / STEP_PX);
  const prevCy = Math.floor(mob.y / STEP_PX);

  // clamp dentro do mapa (evita OOB por arredondamento/velocidade)
  const clamped = losGrid ? clampToMapPx(losGrid, { x: nx|0, y: ny|0 }) : { x: nx|0, y: ny|0 };
  mob.x = clamped.x; mob.y = clamped.y;
  mob.posUpdatedAt = nowMs; // posição do mob fica "fresca" ao mover

  const nextCx = Math.floor(mob.x / STEP_PX);
  const nextCy = Math.floor(mob.y / STEP_PX);
  let progressed = false;

  if (prevCx !== nextCx || prevCy !== nextCy) {
    progressed = true;
    if (occupancy) {
      const prevKey = tileKey(prevCx, prevCy);
      const prevSet = occupancy.get(prevKey);
      if (prevSet) {
        prevSet.delete(mob.instanceId);
        if (!prevSet.size) occupancy.delete(prevKey);
      }
      const nextKey = tileKey(nextCx, nextCy);
      let set = occupancy.get(nextKey);
      if (!set) {
        set = new Set();
        occupancy.set(nextKey, set);
      }
      set.add(mob.instanceId);
      mob._tileCx = nextCx;
      mob._tileCy = nextCy;
      mob._tileKey = nextKey;
    }
    try {
      await run(
        `UPDATE monster_instances SET x=$2, y=$3, updated_at=now() WHERE id=$1`,
        [mob.instanceId, mob.x | 0, mob.y | 0]
      );

      try {
        broadcast({ type:'mob_pos', instanceId: mob.instanceId, mapKey: mob.mapKey, x: mob.x, y: mob.y });
      } catch {}
    } catch (e) {
      console.warn('[ai-mobs] persist pos error:', e?.message);
    }
  }

  const movedDist = Math.hypot(mob.x - prevX, mob.y - prevY);
  if (progressed || movedDist > 0.5) {
    mob.lastProgressAt = nowMs;
  }

  const remaining = Math.hypot(step.x - mob.x, step.y - mob.y);
  return remaining <= 1.25;
}


// limpa threat de um herói (ex.: ao morrer/respawnar)
function removeHeroThreat(heroId) {
  const hid = String(heroId);
  for (const mob of mobs.values()) {
    if (mob?.threat?.has(hid)) mob.threat.delete(hid);
    if (mob.targetHeroId === hid) {
      mob.targetHeroId = null;
      mob.mode = 'idle';
      mob.nextAttackAt = Date.now() + Math.max(0, Number(mob.attackMs) || 0);
      mob.pendingStep = null;
      mob.combatStep = null;
      mob.agroSince = 0;
      mob.lastKnownHeroPos = null;
    }
  }
  try { battleState.cooldown(heroId); } catch {}
}

// --------- Exports ----------
module.exports = {
  start,
  stop,
  seedPosition,
  addThreatFromHeroHit,
  removeHeroThreat,
  _state: mobs
};
