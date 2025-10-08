// server/combat/monster_atk_simple.js
const { all, run } = require('../models/db'); // helpers do projeto
const { applyMobHit } = require('./service');
const { getGrid } = require('../maps/grid');
const { getMonster } = require('../services/catalogCache');

// ======= Tuning via .env =======
const TILE = 32;

// Loop
const TICK_MS = +(process.env.MONSTER_ATK_TICK_MS || 150);

// Movimento
const MONSTER_STEP_MS        = +(process.env.MONSTER_STEP_MS || 150);    // 1 passo (1 tile) a cada X ms
const MONSTER_PERSIST_POS_MS = +(process.env.MONSTER_PERSIST_POS_MS || 1000); // persiste pos no DB no máx. 1x/s

// Ataque corpo-a-corpo
const ATK_COOLDOWN_MS = +(process.env.MONSTER_ATK_COOLDOWN_MS || 900);
const DMG_MIN  = +(process.env.MONSTER_BASE_DMG_MIN || 6);
const DMG_MAX  = +(process.env.MONSTER_BASE_DMG_MAX || 12);
const DEFAULT_ATTACK_PROFILE = Object.freeze({
  min: DMG_MIN,
  max: DMG_MAX,
  intervalMs: ATK_COOLDOWN_MS,
  chancePercent: 100,
});

// Gate do spawn (agora DESLIGADO por padrão)
const CHASE_INSIDE_SPAWN_ONLY = (process.env.MONSTER_CHASE_INSIDE_SPAWN_ONLY ?? '0') === '1';

// Fallback: mesmo com gate ligado, se não achar alvo dentro do spawn,
// permite perseguir até N tiles de distância (evita mobs parados)
const CHASE_MAX_TILES = +(process.env.MONSTER_CHASE_MAX_TILES || 25);

// Evita processar monstro demais por tick (alivia pool)
const MONSTER_MAX_PER_TICK = +(process.env.MONSTER_MAX_PER_TICK || 40);
const MONSTER_SEARCH_DEPTH = +(process.env.MONSTER_STEP_SEARCH_DEPTH || 4);
const MONSTER_STEP_BACKTRACK_PENALTY = +(process.env.MONSTER_STEP_BACKTRACK_PENALTY || 2);
const MONSTER_STACK_RESOLVE_DEPTH = +(process.env.MONSTER_STACK_RESOLVE_DEPTH || 6);

const DETECTION_RADIUS_TILES = +(process.env.MONSTER_DETECTION_RADIUS_TILES || 8);
const AGGRO_LOSS_MS = +(process.env.MONSTER_AGGRO_LOSS_MS || 6000);
const AGGRO_SWITCH_DELTA = +(process.env.MONSTER_AGGRO_SWITCH_DELTA || 2);
const AGGRO_PERSIST_BONUS = +(process.env.MONSTER_AGGRO_PERSIST_BONUS || 1.5);
const HERO_PREDICTION_MAX_TILES = +(process.env.MONSTER_HERO_PREDICTION_MAX_TILES || 2);

const PATROL_INTERVAL_MS = +(process.env.MONSTER_PATROL_INTERVAL_MS || 4500);
const PATROL_STEP_MS = +(process.env.MONSTER_PATROL_STEP_MS || 950);
const PATROL_RADIUS_TILES = +(process.env.MONSTER_PATROL_RADIUS_TILES || 6);
const PATROL_TARGET_TTL_MS = +(process.env.MONSTER_PATROL_TARGET_TTL_MS || 12000);

// ======= Estado em RAM =======
let timer = null;
let running = false;

const _lastAtkAt      = new Map(); // monsterId -> ms
const _lastMoveAt     = new Map(); // monsterId -> ms
const _lastPosWriteAt = new Map(); // monsterId -> ms
const _wasQuantized   = new Set(); // monsterId -> bool
const _livePos        = new Map(); // monsterId -> { x, y, mapKey, face }
const _aggroTarget    = new Map(); // monsterId -> heroId
const _aggroUntil     = new Map(); // monsterId -> ms timestamp
const _patrolTargets  = new Map(); // monsterId -> { tx, ty, expiresAt }
const _lastPatrolMove = new Map(); // monsterId -> ms
const _heroMemory     = new Map(); // heroId -> { tx, ty, lastTx, lastTy, heading, updatedAt, mapKey }
const _attackProfileCache = new Map(); // monsterKey -> { profile, signature }
const _attackWarnedKeys = new Set();

// ======= Utils =======
const tileOf = (v) => Math.floor(Number(v || 0) / TILE);
const centerOfTile = (t) => (t * TILE) + TILE / 2;
const tileKey = (tx, ty) => `${tx},${ty}`;

function toFiniteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function parseAttacksPayload(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  if (typeof raw === 'object') {
    if (Array.isArray(raw.attacks)) return raw.attacks;
    if (Array.isArray(raw.list)) return raw.list;
    if (Array.isArray(raw.data)) return raw.data;
    if (Array.isArray(raw.entries)) return raw.entries;
    if (Array.isArray(raw.values)) return raw.values;
    if (Array.isArray(raw.melee)) return raw.melee;
    try {
      const values = Object.values(raw).filter(v => typeof v === 'object');
      return Array.isArray(values) ? values : [];
    } catch {
      return [];
    }
  }
  return [];
}

function buildAttackProfile(entry, fallbackIntervalMs) {
  if (!entry || typeof entry !== 'object') {
    return { ...DEFAULT_ATTACK_PROFILE };
  }

  const min = toFiniteNumber(
    entry.min ?? entry.minDamage ?? entry.min_dmg ?? entry.damageMin,
    DEFAULT_ATTACK_PROFILE.min,
  );
  let max = toFiniteNumber(
    entry.max ?? entry.maxDamage ?? entry.max_dmg ?? entry.damageMax,
    Math.max(min, DEFAULT_ATTACK_PROFILE.max),
  );
  if (!Number.isFinite(max) || max < min) max = Math.max(min, DEFAULT_ATTACK_PROFILE.max);

  let intervalMs = toFiniteNumber(
    entry.intervalMs ?? entry.interval_ms ?? entry.cooldownMs ?? entry.cooldown,
    Number.isFinite(fallbackIntervalMs) && fallbackIntervalMs > 0 ? fallbackIntervalMs : DEFAULT_ATTACK_PROFILE.intervalMs,
  );
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) intervalMs = DEFAULT_ATTACK_PROFILE.intervalMs;

  let chancePercent = clamp(
    entry.chancePercent ?? entry.chance,
    0,
    100,
  );
  if (!Number.isFinite(chancePercent)) chancePercent = DEFAULT_ATTACK_PROFILE.chancePercent;

  return {
    min,
    max,
    intervalMs,
    chancePercent,
  };
}

function computeAttackSignature(monster) {
  if (!monster) return null;
  const raw = monster.attacks_json;
  if (typeof raw === 'string') return raw.trim();
  if (Array.isArray(raw)) {
    try { return JSON.stringify(raw); } catch { return null; }
  }
  if (raw && typeof raw === 'object') {
    try { return JSON.stringify(raw); } catch { return null; }
  }
  return null;
}

async function resolveMonsterAttackProfile(monster) {
  if (!monster) return DEFAULT_ATTACK_PROFILE;
  const key = monster.monster_key != null ? String(monster.monster_key) : null;
  if (!key) return DEFAULT_ATTACK_PROFILE;

  const signature = computeAttackSignature(monster);
  const cached = _attackProfileCache.get(key);
  if (cached && cached.profile && cached.signature === signature) {
    return cached.profile;
  }

  let attacks = parseAttacksPayload(monster.attacks_json);

  if (!attacks.length && typeof getMonster === 'function') {
    try {
      const catalogMonster = await getMonster(key);
      if (catalogMonster) {
        attacks = parseAttacksPayload(catalogMonster.attacks || catalogMonster.attacksJSON);
      }
    } catch (err) {
      if (!_attackWarnedKeys.has(key)) {
        console.warn(`[monster_atk_simple] failed to load attacks for ${key}:`, err?.message);
        _attackWarnedKeys.add(key);
      }
    }
  }

  let chosen = null;
  for (const entry of attacks) {
    if (!entry || typeof entry !== 'object') continue;
    const type = String(entry.type || '').toLowerCase();
    if (type === 'melee') { chosen = entry; break; }
    if (!chosen) chosen = entry;
  }

  if (!chosen && !_attackWarnedKeys.has(key)) {
    console.warn(`[monster_atk_simple] no melee attack configured for ${key}, using defaults`);
    _attackWarnedKeys.add(key);
  }

  const profile = Object.freeze(buildAttackProfile(chosen, monster.attack_ms));
  _attackProfileCache.set(key, { profile, signature });
  return profile;
}

function toCenterPxCoord(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (Math.abs(n) < 1000) {
    return (Math.round(n) * TILE) + TILE / 2;
  }
  return Math.round(n);
}

function pickFaceFromDelta(dx, dy, fallback = 'south') {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return fallback;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx < 0.5 && ady < 0.5) return fallback;
  if (adx > ady) {
    if (dx > 0) return 'east';
    if (dx < 0) return 'west';
  } else if (ady > 0.5) {
    if (dy > 0) return 'south';
    if (dy < 0) return 'north';
  }
  return fallback;
}

function computeFaceToward(fromX, fromY, toX, toY, fallback = 'south') {
  if (!Number.isFinite(fromX) || !Number.isFinite(fromY)) return fallback;
  if (!Number.isFinite(toX) || !Number.isFinite(toY)) return fallback;
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return fallback;
  return pickFaceFromDelta(dx, dy, fallback);
}

function directionFromStep(fromX, fromY, toX, toY, fallback = 'south') {
  if (!Number.isFinite(fromX) || !Number.isFinite(fromY) || !Number.isFinite(toX) || !Number.isFinite(toY)) {
    return fallback;
  }
  return computeFaceToward(fromX, fromY, toX, toY, fallback);
}

function isTileBlockedByCollision(mapCollision, tx, ty) {
  if (!mapCollision) return false;
  const { grid, cols, rows } = mapCollision;
  if (!grid || !Number.isFinite(cols) || !Number.isFinite(rows)) return false;
  if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) return true;
  const idx = (ty * cols) + tx;
  return grid[idx] === 1;
}

function updateLivePos(monster) {
  if (!monster || monster.id == null) return;
  const face = typeof monster.face === 'string' ? monster.face : 'south';
  _livePos.set(monster.id, {
    x: Number(monster.x) || 0,
    y: Number(monster.y) || 0,
    mapKey: monster.map_key,
    face,
  });
}

function emitMonsterMove(monster, extra = {}) {
  if (!monster || monster.id == null) return;
  if (!global._sendToMap) return;
  try {
    const payload = {
      type: 'monster_move',
      id: monster.id,
      x: Number(monster.x) || 0,
      y: Number(monster.y) || 0,
    };
    const face = typeof monster.face === 'string' ? monster.face : null;
    if (face) payload.face = face;
    Object.assign(payload, extra);
    global._sendToMap(monster.map_key, payload);
  } catch {}
}

function buildMonsterTileMap(list = []) {
  const byMap = new Map();
  for (const m of list) {
    const mapKey = m?.map_key == null ? '__null__' : String(m.map_key);
    const tx = tileOf(m?.x);
    const ty = tileOf(m?.y);
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) continue;
    if (!byMap.has(mapKey)) byMap.set(mapKey, new Map());
    const grid = byMap.get(mapKey);
    const key = tileKey(tx, ty);
    let set = grid.get(key);
    if (!set) { set = new Set(); grid.set(key, set); }
    set.add(m.id);
  }
  return byMap;
}

function buildHeroTileSet(list = []) {
  const byMap = new Map();
  for (const h of list) {
    const mapKey = h?.map_key == null ? '__null__' : String(h.map_key);
    const tx = tileOf(h?.x);
    const ty = tileOf(h?.y);
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) continue;
    if (!byMap.has(mapKey)) byMap.set(mapKey, new Set());
    byMap.get(mapKey).add(tileKey(tx, ty));
  }
  return byMap;
}

function updateHeroMemory(heroes = [], now = Date.now()) {
  const seen = new Set();
  for (const hero of heroes) {
    const heroId = hero?.hero_id != null ? String(hero.hero_id) : null;
    if (!heroId) continue;
    const tx = tileOf(hero?.x);
    const ty = tileOf(hero?.y);
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) continue;

    const prev = _heroMemory.get(heroId);
    const moved = !prev || prev.tx !== tx || prev.ty !== ty;
    let heading = prev?.heading || null;
    if (moved) {
      const dx = tx - (prev?.tx ?? tx);
      const dy = ty - (prev?.ty ?? ty);
      if (dx || dy) {
        const clampedDx = Math.max(-HERO_PREDICTION_MAX_TILES, Math.min(dx, HERO_PREDICTION_MAX_TILES));
        const clampedDy = Math.max(-HERO_PREDICTION_MAX_TILES, Math.min(dy, HERO_PREDICTION_MAX_TILES));
        heading = { dx: clampedDx, dy: clampedDy };
      }
    }

    _heroMemory.set(heroId, {
      tx,
      ty,
      lastTx: prev?.tx ?? tx,
      lastTy: prev?.ty ?? ty,
      heading: heading && (heading.dx || heading.dy) ? heading : null,
      updatedAt: now,
      mapKey: hero?.map_key,
    });
    seen.add(heroId);
  }

  for (const [heroId, mem] of _heroMemory.entries()) {
    if (seen.has(heroId)) continue;
    if (!mem || now - (mem.updatedAt || 0) > AGGRO_LOSS_MS * 2) {
      _heroMemory.delete(heroId);
    }
  }
}

function predictHeroTile(heroId, fallbackTx, fallbackTy) {
  if (!heroId) return null;
  const mem = _heroMemory.get(String(heroId));
  if (!mem) return null;

  let dx = 0;
  let dy = 0;

  if (mem.heading && (mem.heading.dx || mem.heading.dy)) {
    dx = mem.heading.dx;
    dy = mem.heading.dy;
  } else if (Number.isFinite(mem.tx) && Number.isFinite(mem.lastTx)) {
    dx = mem.tx - mem.lastTx;
    dy = mem.ty - mem.lastTy;
  }

  dx = Math.max(-HERO_PREDICTION_MAX_TILES, Math.min(dx, HERO_PREDICTION_MAX_TILES));
  dy = Math.max(-HERO_PREDICTION_MAX_TILES, Math.min(dy, HERO_PREDICTION_MAX_TILES));

  if (!dx && !dy) return null;

  return {
    tx: fallbackTx + dx,
    ty: fallbackTy + dy,
    heading: mem.heading || null,
    updatedAt: mem.updatedAt || Date.now(),
  };
}

function computeDensityPenalty({ tilesForMap, candidateKey, candidateTx, candidateTy, monsterId, heroTx, heroTy }) {
  if (!tilesForMap) return 0;
  let penalty = 0;

  const destSet = tilesForMap.get(candidateKey);
  if (destSet) {
    const others = tilesOccupiedByOthers(destSet, monsterId);
    if (others > 0) penalty += others * 4;
  }

  for (const step of CARDINAL_STEPS) {
    const nx = candidateTx + step.dx;
    const ny = candidateTy + step.dy;
    const key = tileKey(nx, ny);
    const nearSet = tilesForMap.get(key);
    if (nearSet && nearSet.size) {
      penalty += Math.min(nearSet.size, 4) * 0.35;
    }
  }

  if (Number.isFinite(heroTx) && Number.isFinite(heroTy)) {
    const distHero = Math.abs(candidateTx - heroTx) + Math.abs(candidateTy - heroTy);
    if (distHero === 1) {
      let adjacentCount = 0;
      for (const step of CARDINAL_STEPS) {
        const adjKey = tileKey(heroTx + step.dx, heroTy + step.dy);
        const set = tilesForMap.get(adjKey);
        if (set && set.size) adjacentCount += set.size;
      }
      if (adjacentCount > 1) {
        penalty += (adjacentCount - 1) * 0.9;
      }
    }
  }

  return penalty;
}

function computeFlankBonus({ candidateTx, candidateTy, heroTx, heroTy, heading }) {
  if (!heading || !(heading.dx || heading.dy)) return 0;
  if (!Number.isFinite(heroTx) || !Number.isFinite(heroTy)) return 0;

  const relX = candidateTx - heroTx;
  const relY = candidateTy - heroTy;
  const manhattan = Math.abs(relX) + Math.abs(relY);
  if (manhattan !== 1) return 0;

  // favorece interceptar pela frente ou pelo flanco
  const facingX = Math.sign(heading.dx || 0);
  const facingY = Math.sign(heading.dy || 0);

  if (facingX && relX === facingX) return 1.1;
  if (facingY && relY === facingY) return 1.1;
  if ((facingX && relY !== 0) || (facingY && relX !== 0)) return 0.6;
  if ((relX && facingX && relX === -facingX) || (relY && facingY && relY === -facingY)) return -0.4;
  return 0;
}

function ensurePatrolTarget({ monster, tilesForMap, heroTiles, now, mapCollision }) {
  if (!monster) return null;
  const existing = _patrolTargets.get(monster.id);
  if (existing && now < (existing.expiresAt || 0)) {
    return existing;
  }

  const mx = tileOf(monster.x);
  const my = tileOf(monster.y);
  const candidates = [];
  const radius = Math.max(1, PATROL_RADIUS_TILES | 0);
  const heroTileSet = heroTiles instanceof Set ? heroTiles : new Set();

  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      if (dx === 0 && dy === 0) continue;
      const tx = mx + dx;
      const ty = my + dy;
    if (!isTileInsideSpawn(tx, ty, monster)) continue;
    if (isTileBlockedByCollision(mapCollision, tx, ty)) continue;
      const key = tileKey(tx, ty);
      if (heroTileSet.has(key)) continue;
      const set = tilesForMap.get(key);
      if (set && set.size) continue;
      candidates.push({ tx, ty });
    }
  }

  if (!candidates.length) return null;

  const choice = candidates[Math.floor(Math.random() * candidates.length)];
  const goal = { ...choice, expiresAt: now + PATROL_TARGET_TTL_MS };
  _patrolTargets.set(monster.id, goal);
  return goal;
}

function selectHeroTarget({ monster, heroes, now }) {
  if (!monster) return null;
  const mx = tileOf(monster.x);
  const my = tileOf(monster.y);
  if (!Number.isFinite(mx) || !Number.isFinite(my)) return null;

  const prevHeroId = _aggroTarget.get(monster.id) != null ? String(_aggroTarget.get(monster.id)) : null;
  const detectionRange = Math.max(
    DETECTION_RADIUS_TILES > 0 ? DETECTION_RADIUS_TILES : 0,
    CHASE_MAX_TILES > 0 ? CHASE_MAX_TILES : 0,
    4,
  );

  const spawnCandidates = [];
  const fallbackCandidates = [];
  let prevCandidate = null;

  if (Array.isArray(heroes)) {
    for (const hero of heroes) {
      const heroId = hero?.hero_id != null ? String(hero.hero_id) : null;
      if (!heroId) continue;
      const hx = tileOf(hero?.x);
      const hy = tileOf(hero?.y);
      if (!Number.isFinite(hx) || !Number.isFinite(hy)) continue;

      const dist = Math.abs(mx - hx) + Math.abs(my - hy);
      const insideSpawn = !CHASE_INSIDE_SPAWN_ONLY || isInsideSpawnRect(hero.x, hero.y, monster, 0);

      const entry = { hero, heroId, hx, hy, dist, insideSpawn };
      if (prevHeroId && heroId === prevHeroId) prevCandidate = entry;

      if (insideSpawn) {
        spawnCandidates.push(entry);
      } else if (CHASE_MAX_TILES <= 0 || dist <= CHASE_MAX_TILES) {
        fallbackCandidates.push(entry);
      }
    }
  }

  const evaluateCandidate = (entry) => {
    let score = entry.dist;
    if (entry.dist <= DETECTION_RADIUS_TILES) score -= 0.35;
    if (prevHeroId && entry.heroId === prevHeroId) score -= AGGRO_PERSIST_BONUS;
    score += Math.random() * 0.05;
    return score;
  };

  const pickFrom = (list) => {
    let best = null;
    let bestScore = Infinity;
    for (const entry of list) {
      const score = evaluateCandidate(entry);
      if (score < bestScore) {
        best = entry;
        bestScore = score;
      }
    }
    return best;
  };

  let chosen = spawnCandidates.length ? pickFrom(spawnCandidates) : null;
  if (!chosen && fallbackCandidates.length) {
    chosen = pickFrom(fallbackCandidates);
  }

  if (chosen && prevCandidate && chosen.heroId !== prevCandidate.heroId) {
    if (prevCandidate.dist <= chosen.dist + AGGRO_SWITCH_DELTA) {
      chosen = prevCandidate;
    }
  }

  if (!chosen && prevCandidate) {
    const dist = prevCandidate.dist;
    const aggroValidUntil = _aggroUntil.get(monster.id) || 0;
    if (dist <= detectionRange || aggroValidUntil > now) {
      chosen = prevCandidate;
    }
  }

  if (chosen) {
    const heroId = chosen.heroId;
    let predicted = predictHeroTile(heroId, chosen.hx, chosen.hy);
    if (predicted && !isTileInsideSpawn(predicted.tx, predicted.ty, monster)) {
      predicted = null;
    }
    _aggroTarget.set(monster.id, heroId);
    _aggroUntil.set(monster.id, now + AGGRO_LOSS_MS);
    return {
      hero: chosen.hero,
      heroId,
      hx: chosen.hx,
      hy: chosen.hy,
      dist: chosen.dist,
      ghost: false,
      predicted,
      heroHeading: _heroMemory.get(heroId)?.heading || null,
    };
  }

  if (prevHeroId) {
    const aggroValidUntil = _aggroUntil.get(monster.id) || 0;
    const mem = _heroMemory.get(prevHeroId);
    const sameMap = mem && (
      (mem.mapKey == null && monster.map_key == null) ||
      (mem.mapKey != null && monster.map_key != null && String(mem.mapKey) === String(monster.map_key))
    );
    if (aggroValidUntil > now && sameMap) {
      if (Number.isFinite(mem.tx) && Number.isFinite(mem.ty)) {
        let predicted = predictHeroTile(prevHeroId, mem.tx, mem.ty);
        if (predicted && !isTileInsideSpawn(predicted.tx, predicted.ty, monster)) {
          predicted = null;
        }
        return {
          hero: null,
          heroId: prevHeroId,
          hx: mem.tx,
          hy: mem.ty,
          dist: Math.abs(mx - mem.tx) + Math.abs(my - mem.ty),
          ghost: true,
          predicted,
          heroHeading: mem.heading || null,
        };
      }
    }
  }

  _aggroTarget.delete(monster.id);
  _aggroUntil.delete(monster.id);
  return null;
}

function isAdjacent4Tiles(mx, my, hx, hy) {
  const dx = Math.abs(mx - hx);
  const dy = Math.abs(my - hy);
  return (dx + dy) === 1; // ortogonal
}

function isInsideSpawnRect(hx, hy, m, pad = 0) {
  const sx = Number(m.sx) | 0;
  const sy = Number(m.sy) | 0;
  const sw = Math.max(1, Number(m.sw) || 32);
  const sh = Math.max(1, Number(m.sh) || 32);
  return hx >= sx - pad && hx <= sx + sw + pad &&
         hy >= sy - pad && hy <= sy + sh + pad;
}

function isTileInsideSpawn(tx, ty, m) {
  if (!CHASE_INSIDE_SPAWN_ONLY) return true;
  const sx = Number(m.sx) | 0, sy = Number(m.sy) | 0;
  const sw = Math.max(1, Number(m.sw) || 32);
  const sh = Math.max(1, Number(m.sh) || 32);
  const minTx = tileOf(sx);
  const maxTx = tileOf(sx + sw - 1);
  const minTy = tileOf(sy);
  const maxTy = tileOf(sy + sh - 1);
  return tx >= minTx && tx <= maxTx && ty >= minTy && ty <= maxTy;
}

const CARDINAL_STEPS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

function findNearestFreeTile({
  startTx,
  startTy,
  monster,
  tilesForMap,
  heroTiles,
  maxDepth = MONSTER_STACK_RESOLVE_DEPTH,
  mapCollision = null,
}) {
  if (maxDepth <= 0) return null;

  const queue = [{ tx: startTx, ty: startTy, depth: 0 }];
  const visited = new Set([tileKey(startTx, startTy)]);
  const heroTileSet = heroTiles instanceof Set ? heroTiles : new Set();

  while (queue.length) {
    const node = queue.shift();
    if (node.depth >= maxDepth) continue;

    for (const step of CARDINAL_STEPS) {
      const nx = node.tx + step.dx;
      const ny = node.ty + step.dy;
      if (!isTileInsideSpawn(nx, ny, monster)) continue;

      if (isTileBlockedByCollision(mapCollision, nx, ny)) continue;
      const key = tileKey(nx, ny);
      if (visited.has(key)) continue;
      visited.add(key);

      const blockedByHero = heroTileSet.has(key);
      const occupantSet = tilesForMap.get(key);
      const blockedByMonster = occupantSet && occupantSet.size > 0;

      if (!blockedByHero && !blockedByMonster) {
        return { tx: nx, ty: ny };
      }

      if (blockedByHero) continue;

      queue.push({ tx: nx, ty: ny, depth: node.depth + 1 });
    }
  }

  return null;
}

function tilesOccupiedByOthers(set, monsterId) {
  if (!set) return 0;
  if (!set.size) return 0;
  if (!set.has(monsterId)) return set.size;
  if (set.size <= 1) return 0;
  return set.size - 1;
}

function pickChaseGoalTile({ monster, heroTx, heroTy, tilesForMap, mapCollision, heroTiles }) {
  if (!monster) return null;
  if (!Number.isFinite(heroTx) || !Number.isFinite(heroTy)) return null;

  const heroTileSet = heroTiles instanceof Set ? heroTiles : new Set();
  const mx = tileOf(monster.x);
  const my = tileOf(monster.y);
  if (!Number.isFinite(mx) || !Number.isFinite(my)) return null;

  const candidates = [];
  for (const step of CARDINAL_STEPS) {
    const tx = heroTx + step.dx;
    const ty = heroTy + step.dy;
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) continue;
    if (!isTileInsideSpawn(tx, ty, monster)) continue;
    if (isTileBlockedByCollision(mapCollision, tx, ty)) continue;
    const key = tileKey(tx, ty);
    if (heroTileSet.has(key)) continue;
    const occ = tilesForMap.get(key);
    const others = tilesOccupiedByOthers(occ, monster.id);
    const dist = Math.abs(mx - tx) + Math.abs(my - ty);
    const score = dist + (others * 3);
    candidates.push({ tx, ty, key, others, dist, score });
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    if (a.others !== b.others) return a.others - b.others;
    return a.dist - b.dist;
  });

  const best = candidates.find(c => c.others === 0) || candidates[0];
  return best ? { tx: best.tx, ty: best.ty } : null;
}

function findBestStepToward({
  mx,
  my,
  targetTx,
  targetTy,
  monster,
  tilesForMap,
  heroTiles,
  mode = 'chase',
  heroId = null,
  predictedTile = null,
  heroHeading = null,
  mapCollision = null,
}) {
  const heroTilesSet = heroTiles instanceof Set ? heroTiles : new Set();
  const originKey = tileKey(mx, my);
  const visited = new Set([originKey]);
  const queue = [];

  const goalTx = Number.isFinite(predictedTile?.tx) ? predictedTile.tx : targetTx;
  const goalTy = Number.isFinite(predictedTile?.ty) ? predictedTile.ty : targetTy;

  const referenceTx = Number.isFinite(goalTx) ? goalTx : targetTx;
  const referenceTy = Number.isFinite(goalTy) ? goalTy : targetTy;
  const currentDist = (Number.isFinite(referenceTx) && Number.isFinite(referenceTy))
    ? Math.abs(mx - referenceTx) + Math.abs(my - referenceTy)
    : 0;

  const pushNode = (nx, ny, depth, firstStep) => {
    if (depth > MONSTER_SEARCH_DEPTH) return;
    if (!isTileInsideSpawn(nx, ny, monster)) return;
    if (isTileBlockedByCollision(mapCollision, nx, ny)) return;
    const key = tileKey(nx, ny);
    if (visited.has(key)) return;
    visited.add(key);

    const distGoal = (Number.isFinite(goalTx) && Number.isFinite(goalTy))
      ? Math.abs(nx - goalTx) + Math.abs(ny - goalTy)
      : Math.abs(nx - referenceTx) + Math.abs(ny - referenceTy);
    const distHero = (Number.isFinite(targetTx) && Number.isFinite(targetTy))
      ? Math.abs(nx - targetTx) + Math.abs(ny - targetTy)
      : distGoal;

    queue.push({
      nx,
      ny,
      key,
      depth,
      firstStep,
      distGoal,
      distHero,
    });
  };

  for (const step of CARDINAL_STEPS) {
    const nx = mx + step.dx;
    const ny = my + step.dy;
    pushNode(nx, ny, 1, { nx, ny });
  }

  let best = null;

  const scoreNode = (node, densityPenalty) => {
    const distGoal = node.distGoal;
    const distDelta = distGoal - currentDist;
    const backtrackPenalty = distDelta > 0 ? distDelta * MONSTER_STEP_BACKTRACK_PENALTY : 0;
    let score = distGoal + (node.depth * 0.12) + backtrackPenalty + densityPenalty;

    if (mode === 'chase') {
      if (node.distHero <= 1 && densityPenalty < 0.6) {
        score -= 0.2;
      }
      const memHeading = heroId != null ? _heroMemory.get(String(heroId))?.heading : null;
      const heading = heroHeading || predictedTile?.heading || memHeading;
      const flank = computeFlankBonus({
        candidateTx: node.firstStep?.nx ?? node.nx,
        candidateTy: node.firstStep?.ny ?? node.ny,
        heroTx: targetTx,
        heroTy: targetTy,
        heading,
      });
      score -= flank;
    }

    return score;
  };

  while (queue.length) {
    queue.sort((a, b) => {
      const sa = scoreNode(a, 0);
      const sb = scoreNode(b, 0);
      if (sa !== sb) return sa - sb;
      if (a.distGoal !== b.distGoal) return a.distGoal - b.distGoal;
      return a.depth - b.depth;
    });

    const node = queue.shift();
    const destKey = node.key;
    if (destKey === originKey) continue;

    const blockedByHero = heroTilesSet.has(destKey);
    if (isTileBlockedByCollision(mapCollision, node.nx, node.ny)) continue;
    const destSet = tilesForMap.get(destKey);
    const blockedByMonster = tilesOccupiedByOthers(destSet, monster.id) > 0;

    if (!blockedByHero && !blockedByMonster) {
      const candidateTx = node.firstStep?.nx ?? node.nx;
      const candidateTy = node.firstStep?.ny ?? node.ny;
      const candidateKey = tileKey(candidateTx, candidateTy);
      const densityPenalty = computeDensityPenalty({
        tilesForMap,
        candidateKey,
        candidateTx,
        candidateTy,
        monsterId: monster.id,
        heroTx: targetTx,
        heroTy: targetTy,
      });

      const score = scoreNode(node, densityPenalty);
      const improves = !best || score < best.score;
      const keepsDistanceReasonable = node.distGoal <= currentDist || currentDist <= 1;
      if (improves && keepsDistanceReasonable) {
        best = {
          nx: node.firstStep?.nx ?? node.nx,
          ny: node.firstStep?.ny ?? node.ny,
          score,
          dist: node.distHero,
          depth: node.depth,
        };
        if (node.depth === 1 && node.distGoal <= currentDist) break;
      }
    }

    if (node.depth >= MONSTER_SEARCH_DEPTH) {
      continue;
    }

    for (const step of CARDINAL_STEPS) {
      const nx = node.nx + step.dx;
      const ny = node.ny + step.dy;
      pushNode(nx, ny, node.depth + 1, node.firstStep);
    }
  }

  return best;
}

async function resolveTileStacks({
  tilesForMap,
  heroTiles,
  monstersById,
  now,
  budget,
  movedSet,
  mapCollision = null,
}) {
  if (budget <= 0) return 0;
  const heroTileSet = heroTiles instanceof Set ? heroTiles : new Set();
  let used = 0;

  for (const [tileKeyStr, occupants] of Array.from(tilesForMap.entries())) {
    if (used >= budget) break;
    if (!occupants || occupants.size <= 1) continue;

    const ids = Array.from(occupants);
    // Keep the first occupant, try to move the rest away
    for (let i = 1; i < ids.length && used < budget; i++) {
      const monsterId = ids[i];
      const monster = monstersById.get(monsterId);
      if (!monster) continue;

      const lastMove = _lastMoveAt.get(monsterId) || 0;
      if (now - lastMove < MONSTER_STEP_MS) continue;

      const [txStr, tyStr] = tileKeyStr.split(',');
      const tx = Number(txStr);
      const ty = Number(tyStr);
      if (!Number.isFinite(tx) || !Number.isFinite(ty)) continue;

      const escape = findNearestFreeTile({
        startTx: tx,
        startTy: ty,
        monster,
        tilesForMap,
        heroTiles: heroTileSet,
        mapCollision,
      });

      if (!escape) continue;

      const fromSet = tilesForMap.get(tileKeyStr);
      if (fromSet) {
        fromSet.delete(monsterId);
        if (!fromSet.size) tilesForMap.delete(tileKeyStr);
      }

      const destKey = tileKey(escape.tx, escape.ty);
      if (!tilesForMap.has(destKey)) tilesForMap.set(destKey, new Set());
      tilesForMap.get(destKey).add(monsterId);

      const prevPx = Number(monster.x);
      const prevPy = Number(monster.y);
      const px = centerOfTile(escape.tx);
      const py = centerOfTile(escape.ty);
      monster.x = px;
      monster.y = py;
      const moveFace = directionFromStep(prevPx, prevPy, px, py, monster.face || 'south');
      if (moveFace) monster.face = moveFace;
      updateLivePos(monster);
      _lastMoveAt.set(monsterId, now);
      movedSet.add(monsterId);

      try { await updateMonsterPos(monsterId, px, py, now); } catch {}

      emitMonsterMove(monster);

      used++;
      if (used >= budget) break;
    }
  }

  return used;
}

// ======= DB =======
async function fetchAliveMonsters() {
  const sql = `
    SELECT mi.id,
           COALESCE(mi.map_key, s."mapKey") AS map_key,
           mi.x,
           mi.y,
           mi.hp,
           mi.hp_max,
           s.id              AS spawn_id,
           s.x               AS sx,
           s.y               AS sy,
           COALESCE(s.w,32)  AS sw,
           COALESCE(s.h,32)  AS sh,
           s."monsterKey"    AS monster_key,
           COALESCE(mm.name, s."monsterKey") AS monster_name,
           mm."attacksJSON" AS attacks_json,
           mm.attack_ms     AS attack_ms
      FROM monster_instances mi
      LEFT JOIN spawns s ON s.id = mi.spawn_id
      LEFT JOIN monsters_master mm ON mm.key = s."monsterKey"
     WHERE mi.state = 'ALIVE' AND mi.hp > 0
  `;
  return await all(sql);
}

async function fetchAliveHeroesWithPos() {
  const sql = `
    SELECT ph.id AS hero_id, ph."playerId" AS player_id,
           ph.hp, ph.max_hp, ph.alive,
           pl.map_key, pl.x, pl.y
      FROM player_heroes ph
      JOIN player_last_pos pl
        ON pl.player_id::text = ph."playerId"::text
     WHERE ph.alive = TRUE AND ph.hp > 0
  `;
  return await all(sql);
}

async function markLastHit(monsterId, heroId) {
  try {
    await run(
      `UPDATE monster_instances
          SET last_hit_hero_id = $2,
              last_hit_at = NOW()
        WHERE id = $1`,
      [monsterId, heroId]
    );
  } catch {}
}

async function updateMonsterPos(id, px, py, now) {
  const lastW = _lastPosWriteAt.get(id) || 0;
  if (now - lastW < MONSTER_PERSIST_POS_MS) return; // throttling de escrita
  try {
    await run(`UPDATE monster_instances SET x=$2, y=$3 WHERE id=$1`, [id, px | 0, py | 0]);
    _lastPosWriteAt.set(id, now);
  } catch {}
}

// ======= Loop =======
async function tick() {
  if (running) return; // anti overlap
  running = true;

  try {
    const [monsters, heroes] = await Promise.all([
      fetchAliveMonsters(),
      fetchAliveHeroesWithPos(),
    ]);

    const aliveIdSet = new Set(monsters.map(m => Number(m.id)));

    for (const m of monsters) {
      const live = _livePos.get(m.id);
      if (!live) continue;
      if (Number.isFinite(live.x)) m.x = live.x;
      if (Number.isFinite(live.y)) m.y = live.y;
      if (live.mapKey !== undefined && live.mapKey !== null) m.map_key = live.mapKey;
      if (typeof live.face === 'string') m.face = live.face;
    }

    if (_livePos.size) {
      for (const id of Array.from(_livePos.keys())) {
        if (!aliveIdSet.has(Number(id))) _livePos.delete(id);
      }
    }

    const cleanupStore = (store) => {
      if (!store || typeof store.keys !== 'function') return;
      for (const key of Array.from(store.keys())) {
        if (!aliveIdSet.has(Number(key))) store.delete(key);
      }
    };

    cleanupStore(_aggroTarget);
    cleanupStore(_aggroUntil);
    cleanupStore(_patrolTargets);
    cleanupStore(_lastPatrolMove);
    cleanupStore(_lastAtkAt);
    cleanupStore(_lastMoveAt);
    cleanupStore(_lastPosWriteAt);
    for (const id of Array.from(_wasQuantized)) {
      if (!aliveIdSet.has(Number(id))) _wasQuantized.delete(id);
    }

    if (!monsters.length) { running = false; return; }

    const monsterTilesByMap = buildMonsterTileMap(monsters);
    const heroTilesByMap = buildHeroTileSet(heroes);

    const heroesByMap = new Map();
    for (const h of heroes) {
      if (!heroesByMap.has(h.map_key)) heroesByMap.set(h.map_key, []);
      heroesByMap.get(h.map_key).push(h);
    }

    const now = Date.now();
    updateHeroMemory(heroes, now);
    const monstersById = new Map(monsters.map(m => [m.id, m]));
    const movedThisTick = new Set();
    let movesUsed = 0;

    const collisionByMap = new Map();
    const ensureCollisionFor = async (rawKey) => {
      if (!rawKey && rawKey !== 0) return null;
      const key = String(rawKey);
      if (collisionByMap.has(key)) return collisionByMap.get(key);
      try {
        const info = await getGrid(rawKey);
        collisionByMap.set(key, info);
        return info;
      } catch (err) {
        collisionByMap.set(key, null);
        console.warn('[monster_atk_simple] collision load failed:', rawKey, err?.message);
        return null;
      }
    };

    for (const [mapKeyStr, tilesForMap] of monsterTilesByMap.entries()) {
      if (movesUsed >= MONSTER_MAX_PER_TICK) break;
      const heroTilesForMap = heroTilesByMap.get(mapKeyStr) || new Set();
      const realKey = mapKeyStr === '__null__' ? null : mapKeyStr;
      const mapCollision = realKey ? await ensureCollisionFor(realKey) : null;
      movesUsed += await resolveTileStacks({
        tilesForMap,
        heroTiles: heroTilesForMap,
        monstersById,
        now,
        budget: MONSTER_MAX_PER_TICK - movesUsed,
        movedSet: movedThisTick,
        mapCollision,
      });
    }

    for (const m of monsters) {
      const alreadyMoved = movedThisTick.has(m.id);
      const hs = heroesByMap.get(m.map_key) || [];

      const mapKeyStr = m.map_key == null ? '__null__' : String(m.map_key);
      let tilesForMap = monsterTilesByMap.get(mapKeyStr);
      if (!tilesForMap) {
        tilesForMap = new Map();
        monsterTilesByMap.set(mapKeyStr, tilesForMap);
      }
      const heroTilesForMap = heroTilesByMap.get(mapKeyStr) || new Set();
      const mapCollision = await ensureCollisionFor(m.map_key);
      const targetInfo = selectHeroTarget({ monster: m, heroes: hs, now });

      if (!_wasQuantized.has(m.id)) {
        const mx0 = tileOf(m.x), my0 = tileOf(m.y);
        const cx = centerOfTile(mx0), cy = centerOfTile(my0);
        if (cx !== (m.x | 0) || cy !== (m.y | 0)) {
          await updateMonsterPos(m.id, cx, cy, now);
          m.x = cx; m.y = cy;
        }
        _wasQuantized.add(m.id);
        if (!m.face) m.face = 'south';
        updateLivePos(m);
      }

      const mx = tileOf(m.x), my = tileOf(m.y);
      if (!Number.isFinite(mx) || !Number.isFinite(my)) continue;

      const currentTileKey = tileKey(mx, my);
      if (!tilesForMap.has(currentTileKey)) {
        tilesForMap.set(currentTileKey, new Set([m.id]));
      } else {
        const set = tilesForMap.get(currentTileKey);
        if (!set.has(m.id)) set.add(m.id);
      }

      if (targetInfo) {
        _patrolTargets.delete(m.id);

        const hx = Number.isFinite(targetInfo.hx) ? targetInfo.hx : null;
        const hy = Number.isFinite(targetInfo.hy) ? targetInfo.hy : null;
        const heroIdForChase = targetInfo.heroId;
        const predicted = targetInfo.predicted;
        const heroHeading = targetInfo.heroHeading;
        const isGhost = !!targetInfo.ghost;

        const heroPx = Number.isFinite(targetInfo.hero?.x)
          ? toCenterPxCoord(targetInfo.hero.x)
          : toCenterPxCoord(hx);
        const heroPy = Number.isFinite(targetInfo.hero?.y)
          ? toCenterPxCoord(targetInfo.hero.y)
          : toCenterPxCoord(hy);

        const currentFace = typeof m.face === 'string' ? m.face : 'south';
        const faceTowardHero = (Number.isFinite(heroPx) && Number.isFinite(heroPy))
          ? computeFaceToward(m.x, m.y, heroPx, heroPy, currentFace)
          : currentFace;

        const chaseGoal = (Number.isFinite(hx) && Number.isFinite(hy))
          ? pickChaseGoalTile({
              monster: m,
              heroTx: hx,
              heroTy: hy,
              tilesForMap,
              mapCollision,
              heroTiles: heroTilesForMap,
            })
          : null;

        const pathTargetTx = chaseGoal?.tx ?? hx;
        const pathTargetTy = chaseGoal?.ty ?? hy;
        const pathPrediction = chaseGoal
          ? { tx: chaseGoal.tx, ty: chaseGoal.ty, heading: predicted?.heading || null }
          : predicted;

        const adjacent = (Number.isFinite(hx) && Number.isFinite(hy)) ? isAdjacent4Tiles(mx, my, hx, hy) : false;

        if (!adjacent && !alreadyMoved) {
          const lastMove = _lastMoveAt.get(m.id) || 0;
          const canMove = now - lastMove >= MONSTER_STEP_MS && movesUsed < MONSTER_MAX_PER_TICK;
          if (canMove && Number.isFinite(pathTargetTx) && Number.isFinite(pathTargetTy)) {
            const fromKey = tileKey(mx, my);
            const bestStep = findBestStepToward({
              mx,
              my,
              targetTx: pathTargetTx,
              targetTy: pathTargetTy,
              monster: m,
              tilesForMap,
              heroTiles: heroTilesForMap,
              mode: 'chase',
              heroId: heroIdForChase,
              predictedTile: pathPrediction,
              heroHeading,
              mapCollision,
            });

            if (bestStep) {
              const destKey = tileKey(bestStep.nx, bestStep.ny);

              let fromSet = tilesForMap.get(fromKey);
              if (fromSet) {
                fromSet.delete(m.id);
                if (!fromSet.size) tilesForMap.delete(fromKey);
              }

              if (!tilesForMap.has(destKey)) tilesForMap.set(destKey, new Set());
              tilesForMap.get(destKey).add(m.id);

              const prevPx = Number(m.x);
              const prevPy = Number(m.y);
              const px = centerOfTile(bestStep.nx);
              const py = centerOfTile(bestStep.ny);
              m.x = px; m.y = py;

              let faceAfterMove = faceTowardHero;
              if (Number.isFinite(heroPx) && Number.isFinite(heroPy)) {
                faceAfterMove = computeFaceToward(px, py, heroPx, heroPy,
                  directionFromStep(prevPx, prevPy, px, py, faceTowardHero));
              } else {
                faceAfterMove = directionFromStep(prevPx, prevPy, px, py, faceTowardHero);
              }
              if (faceAfterMove) m.face = faceAfterMove;

              updateLivePos(m);
              _lastMoveAt.set(m.id, now);
              movedThisTick.add(m.id);
              movesUsed++;
              await updateMonsterPos(m.id, px, py, now);

              emitMonsterMove(m);
            } else {
              _lastMoveAt.set(m.id, now);
              if (faceTowardHero && faceTowardHero !== m.face) {
                m.face = faceTowardHero;
                updateLivePos(m);
                emitMonsterMove(m);
              }
            }
          }
          continue;
        } else if (!adjacent) {
          if (faceTowardHero && faceTowardHero !== m.face) {
            m.face = faceTowardHero;
            updateLivePos(m);
            emitMonsterMove(m);
          }
          continue;
        }

        if (faceTowardHero && faceTowardHero !== m.face) {
          m.face = faceTowardHero;
          updateLivePos(m);
          emitMonsterMove(m);
        }

        if (isGhost || !targetInfo.hero) continue;

        const targetHero = targetInfo.hero;
        const attackProfile = await resolveMonsterAttackProfile(m);
        const cooldownMs = Math.max(50, Number(attackProfile?.intervalMs || ATK_COOLDOWN_MS));
        const chancePercent = clamp(attackProfile?.chancePercent ?? 100, 0, 100);
        const lastAtk = _lastAtkAt.get(m.id) || 0;
        if (now - lastAtk < cooldownMs) continue;

        if (chancePercent < 100) {
          const roll = Math.random() * 100;
          if (roll >= chancePercent) {
            _lastAtkAt.set(m.id, now);
            continue;
          }
        }

        let attackRes = null;
        try {
          attackRes = await applyMobHit({
            attackerInstanceId: m.id,
            targetHeroId: targetHero.hero_id,
            attackInfo: {
              min: attackProfile?.min ?? DMG_MIN,
              max: attackProfile?.max ?? DMG_MAX,
            },
            attackerPos: {
              x: Number.isFinite(m.x) ? m.x : undefined,
              y: Number.isFinite(m.y) ? m.y : undefined,
              mapKey: targetHero.map_key ?? m.map_key,
              face: m.face,
              unit: 'px',
              assumeTiles: false,
              assumePx: true,
            },
          });
        } catch (err) {
          console.warn('[monster_atk_simple] applyMobHit error:', err?.message);
        }

        if (attackRes?.ok) {
          if (attackRes.attackerPos) {
            const ax = Number(attackRes.attackerPos.x);
            const ay = Number(attackRes.attackerPos.y);
            if (Number.isFinite(ax)) m.x = ax;
            if (Number.isFinite(ay)) m.y = ay;
            const faceFromHit = typeof attackRes.attackerPos.face === 'string' ? attackRes.attackerPos.face : null;
            if (faceFromHit) m.face = faceFromHit;
          }
          _lastAtkAt.set(m.id, now);
          await markLastHit(m.id, targetHero.hero_id);
          _aggroUntil.set(m.id, now + AGGRO_LOSS_MS);

          if (attackRes.dead) {
            const arr = heroesByMap.get(targetHero.map_key);
            if (arr) {
              const idx = arr.findIndex(hh => String(hh.hero_id) === String(targetHero.hero_id));
              if (idx >= 0) arr.splice(idx, 1);
            }
          } else if (attackRes.hpAfter != null) {
            targetHero.hp = attackRes.hpAfter;
            if (attackRes.heroPos) {
              const hx2 = Number(attackRes.heroPos.x);
              const hy2 = Number(attackRes.heroPos.y);
              if (Number.isFinite(hx2)) targetHero.x = hx2;
              if (Number.isFinite(hy2)) targetHero.y = hy2;
            }
          }

          updateLivePos(m);

          if (global._sendToMap) {
            const attackIntervalMs = cooldownMs;
            const hitMapKey = attackRes.attackerPos?.mapKey ?? targetHero.map_key ?? m.map_key;
            if (hitMapKey != null) targetHero.map_key = hitMapKey;
            global._sendToMap(hitMapKey, {
              type: 'hero_hit',
              heroId: targetHero.hero_id,
              dmg: attackRes.damage,
              hp: attackRes.hpAfter,
              hpMax: attackRes.maxHp ?? targetHero.max_hp,
              died: attackRes.dead,
              instanceId: m.id,
              face: m.face,
              attackIntervalMs,
              monster: {
                id: m.id,
                key: m.monster_key || 'unknown',
                name: m.monster_name || m.monster_key || 'Monster',
                x: m.x,
                y: m.y,
                mapKey: hitMapKey,
                spawnId: m.spawn_id,
                face: m.face,
                attackIntervalMs,
              },
            });
          }
        }

        continue;
      }

      _aggroTarget.delete(m.id);
      _aggroUntil.delete(m.id);

      if (alreadyMoved || movesUsed >= MONSTER_MAX_PER_TICK) continue;

      const sincePatrol = now - (_lastPatrolMove.get(m.id) || 0);
      if (sincePatrol < PATROL_STEP_MS) continue;

      const patrolGoal = ensurePatrolTarget({ monster: m, tilesForMap, heroTiles: heroTilesForMap, now, mapCollision });
      if (!patrolGoal) {
        _patrolTargets.delete(m.id);
        _lastPatrolMove.set(m.id, now);
        continue;
      }

      if (mx === patrolGoal.tx && my === patrolGoal.ty) {
        _patrolTargets.delete(m.id);
        _lastPatrolMove.set(m.id, now);
        continue;
      }

      const bestStep = findBestStepToward({
        mx,
        my,
        targetTx: patrolGoal.tx,
        targetTy: patrolGoal.ty,
        monster: m,
        tilesForMap,
        heroTiles: heroTilesForMap,
        mode: 'patrol',
        mapCollision,
      });

      if (!bestStep) {
        _patrolTargets.delete(m.id);
        _lastPatrolMove.set(m.id, now);
        continue;
      }

      const fromKey = tileKey(mx, my);
      let fromSet = tilesForMap.get(fromKey);
      if (fromSet) {
        fromSet.delete(m.id);
        if (!fromSet.size) tilesForMap.delete(fromKey);
      }

      const destKey = tileKey(bestStep.nx, bestStep.ny);
      if (!tilesForMap.has(destKey)) tilesForMap.set(destKey, new Set());
      tilesForMap.get(destKey).add(m.id);

      const prevPx = Number(m.x);
      const prevPy = Number(m.y);
      const px = centerOfTile(bestStep.nx);
      const py = centerOfTile(bestStep.ny);
      m.x = px; m.y = py;
      const patrolFace = directionFromStep(prevPx, prevPy, px, py, m.face || 'south');
      if (patrolFace) m.face = patrolFace;
      updateLivePos(m);
      _lastMoveAt.set(m.id, now);
      _lastPatrolMove.set(m.id, now);
      movedThisTick.add(m.id);
      movesUsed++;
      await updateMonsterPos(m.id, px, py, now);

      emitMonsterMove(m);
    }
  } catch (err) {
    console.warn('[monster_atk_simple] tick error:', err && err.message);
  } finally {
    running = false;
  }
}

function start() {
  if (timer) return;
  timer = setInterval(() => { tick(); }, TICK_MS);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop };
