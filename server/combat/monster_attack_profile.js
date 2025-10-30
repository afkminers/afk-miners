const MELEE_KEYWORDS = new Set(['melee', 'close', 'slash', 'club', 'bite', 'physical']);
const RANGED_KEYWORDS = new Set(['ranged', 'distance', 'shoot', 'projectile', 'bow', 'arrow', 'throw']);
const MAGIC_KEYWORDS = new Set(['magic', 'spell', 'wand', 'rod', 'energy', 'fire', 'ice', 'holy', 'death']);

const DEFAULT_MELEE_RANGE = 1;
const DEFAULT_RANGED_RANGE = 3;
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
  const rangeTiles = resolveAttackRange(resolvedType, override.rangeTiles ?? chosen?.rangeTiles ?? chosen?.range);

  const intervalMsRaw = override.intervalMs ?? override.interval_ms ?? chosen?.intervalMs ?? chosen?.interval_ms ?? chosen?.cooldownMs;
  const intervalMs = coerceNumber(intervalMsRaw, fallbackMs) || fallbackMs;

  const rawMin = override.min ?? override.minDamage ?? chosen?.min ?? chosen?.minDamage ?? chosen?.min_dmg ?? chosen?.damageMin;
  const rawMax = override.max ?? override.maxDamage ?? chosen?.max ?? chosen?.maxDamage ?? chosen?.max_dmg ?? chosen?.damageMax;
  const { min, max } = clampRange(coerceNumber(rawMin, 0), coerceNumber(rawMax, rawMin));

  const requiresLos = override.requiresLos ?? (resolvedType !== 'melee');

  return {
    type: resolvedType,
    rangeTiles: Math.max(1, rangeTiles | 0),
    intervalMs: Math.max(50, intervalMs | 0),
    min,
    max,
    requiresLos: requiresLos !== false,
  };
}

module.exports = {
  resolveMonsterAttackProfile,
  parseAttacksPayload,
  normalizeType,
};
