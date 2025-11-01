const MELEE_KEYWORDS = new Set(['melee', 'close', 'slash', 'club', 'bite', 'physical']);
const RANGED_KEYWORDS = new Set(['ranged', 'distance', 'shoot', 'projectile', 'bow', 'arrow', 'throw']);
const MAGIC_KEYWORDS = new Set(['magic', 'spell', 'wand', 'rod', 'energy', 'fire', 'ice', 'holy', 'death']);

const DEFAULT_MELEE_RANGE = 1;
const DEFAULT_RANGED_RANGE = 3;
const DEFAULT_MIN_RANGED = 2;
const DEFAULT_ATTACK_MS = 1200;

function parseJSON(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') {
    if (Array.isArray(raw.list)) return raw.list;
    if (Array.isArray(raw.attacks)) return raw.attacks;
    if (Array.isArray(raw.values)) return raw.values;
    return null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.list)) return parsed.list;
        if (Array.isArray(parsed.attacks)) return parsed.attacks;
        if (Array.isArray(parsed.values)) return parsed.values;
      }
    } catch {}
  }
  return null;
}

function parseAttacksPayload(raw) {
  const parsed = parseJSON(raw);
  return Array.isArray(parsed) ? parsed : [];
}

function normalizeType(rawType, fallbackRange = DEFAULT_MELEE_RANGE) {
  const str = String(rawType || '').trim().toLowerCase();
  if (MELEE_KEYWORDS.has(str)) return 'melee';
  if (RANGED_KEYWORDS.has(str)) return 'ranged';
  if (MAGIC_KEYWORDS.has(str)) return 'magic';
  if (str.includes('melee')) return 'melee';
  if (str.includes('range') || str.includes('dist')) return 'ranged';
  if (str.includes('spell') || str.includes('magic')) return 'magic';
  if (fallbackRange > DEFAULT_MELEE_RANGE) return 'ranged';
  return 'melee';
}

function coerceNumber(value, fallback = null) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function clampRange(min, max) {
  let mi = Number.isFinite(min) ? min : 0;
  let mx = Number.isFinite(max) ? max : mi;
  if (mx < mi) mx = mi;
  return { min: mi, max: mx };
}

function pickPrimaryAttack(attacks) {
  if (!Array.isArray(attacks)) return null;
  let best = null;
  for (const atk of attacks) {
    if (!atk) continue;
    const chance = coerceNumber(atk.chancePercent ?? atk.chance ?? 100, 100);
    if (chance <= 0) continue;
    best = atk;
    if (chance >= 100) break;
  }
  return best;
}

function resolveAttackRange(type, overrideRange) {
  const range = coerceNumber(overrideRange, NaN);
  if (Number.isFinite(range) && range > 0) return range;
  if (type === 'melee') return DEFAULT_MELEE_RANGE;
  return DEFAULT_RANGED_RANGE;
}

function resolveMonsterAttackProfile(monster = {}, override = {}) {
  const fallbackMs = coerceNumber(monster.attack_ms, DEFAULT_ATTACK_MS) || DEFAULT_ATTACK_MS;
  const fallbackRange = coerceNumber(monster.attack_range, DEFAULT_MELEE_RANGE) || DEFAULT_MELEE_RANGE;

  const attacks = parseAttacksPayload(monster.attacks_json ?? monster.attacksJSON ?? monster.attacks);
  const chosen = override.primaryAttack || pickPrimaryAttack(attacks) || null;

  const resolvedType = normalizeType(override.type ?? chosen?.type, fallbackRange);
  const rangeTilesRaw = override.rangeTiles ?? chosen?.rangeTiles ?? chosen?.range;
  const rangeTiles = Math.max(1, resolveAttackRange(resolvedType, rangeTilesRaw) | 0);

  const minRangeRaw = override.minRangeTiles
    ?? override.minRange
    ?? chosen?.minRangeTiles
    ?? chosen?.minRange
    ?? chosen?.rangeMin
    ?? chosen?.min_range
    ?? chosen?.min_distance;

  let minRangeTiles = coerceNumber(minRangeRaw, NaN);
  if (!Number.isFinite(minRangeTiles) || minRangeTiles <= 0) {
    if (resolvedType === 'ranged') {
      const fallback = Math.min(rangeTiles, DEFAULT_MIN_RANGED);
      minRangeTiles = Math.max(1, fallback);
    } else {
      minRangeTiles = 1;
    }
  }
  minRangeTiles = Math.max(1, Math.min(rangeTiles, Math.round(minRangeTiles)));

  const intervalMsRaw = override.intervalMs
    ?? override.interval_ms
    ?? chosen?.intervalMs
    ?? chosen?.interval_ms
    ?? chosen?.cooldownMs
    ?? chosen?.cooldown;
  const intervalMs = Math.max(50, (coerceNumber(intervalMsRaw, fallbackMs) || fallbackMs) | 0);

  const rawMin = override.min ?? override.minDamage ?? chosen?.min ?? chosen?.minDamage ?? chosen?.min_dmg ?? chosen?.damageMin;
  const rawMax = override.max ?? override.maxDamage ?? chosen?.max ?? chosen?.maxDamage ?? chosen?.max_dmg ?? chosen?.damageMax;
  const { min, max } = clampRange(coerceNumber(rawMin, 0), coerceNumber(rawMax, rawMin));

  const chanceRaw = override.chancePercent ?? override.chance ?? chosen?.chancePercent ?? chosen?.chance;
  let chancePercent = coerceNumber(chanceRaw, 100);
  if (!Number.isFinite(chancePercent)) chancePercent = 100;
  chancePercent = Math.max(0, Math.min(100, Math.round(chancePercent)));

  const requiresLosRaw = override.requiresLos ?? override.requires_los ?? chosen?.requiresLos ?? chosen?.requires_los ?? chosen?.needsLos;
  const requiresLos = requiresLosRaw != null ? !!requiresLosRaw : resolvedType !== 'melee';

  return {
    type: resolvedType,
    rangeTiles,
    minRangeTiles,
    intervalMs,
    min,
    max,
    chancePercent,
    requiresLos,
  };
}

module.exports = {
  resolveMonsterAttackProfile,
  parseAttacksPayload,
  normalizeType,
};
