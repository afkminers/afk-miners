// client/js/sfx/combat-sfx.js
// Utilitários para sons de combate dos heróis

const AudioCtor = (typeof window !== 'undefined' && typeof window.Audio === 'function')
  ? window.Audio
  : (typeof Audio === 'function' ? Audio : null);

function makeAudio(src) {
  if (!AudioCtor) return null;
  try {
    const audio = new AudioCtor(src);
    audio.preload = 'auto';
    return audio;
  } catch {
    return null;
  }
}

function playFrom(audio) {
  if (!audio) return;
  try {
    if (audio.currentTime != null) {
      try { audio.currentTime = 0; } catch {}
    }
    const p = audio.play?.();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {});
    }
  } catch {}
}

const swordHitAudio = makeAudio('/sfx/sword-sucess.mp3');
const arrowHitAudio = makeAudio('/sfx/arrow-sucess.mp3');
const missAudio = makeAudio('/sfx/click.mp3');

export function playHeroMeleeHit() {
  playFrom(swordHitAudio);
}

export function playHeroRangedHit() {
  playFrom(arrowHitAudio);
}

export function playHeroMissSfx() {
  playFrom(missAudio);
}

function normalizeId(raw) {
  if (raw == null) return null;
  const str = String(raw).trim();
  if (!str || str === 'undefined' || str === 'null') return null;
  return str;
}

function normalizeString(raw) {
  if (raw == null) return '';
  return String(raw).trim();
}

function normalizeUpper(raw) {
  const str = normalizeString(raw);
  return str ? str.toUpperCase() : '';
}

function normalizeBool(raw) {
  if (raw === true || raw === false) return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') {
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) return null;
    if (trimmed === 'true' || trimmed === '1' || trimmed === 'yes') return true;
    if (trimmed === 'false' || trimmed === '0' || trimmed === 'no') return false;
  }
  return null;
}

function gatherHeroSnapshot(heroId) {
  const normalized = normalizeId(heroId);
  const candidates = [];

  const summary = typeof window !== 'undefined' ? window.ActiveHeroSummary : null;
  if (summary) {
    const sid = normalizeId(summary.id ?? summary.heroId ?? summary.hero_id);
    if (!normalized || (sid && sid === normalized)) candidates.push(summary);
  }

  const heroState = typeof window !== 'undefined' ? window.HeroState : null;
  if (heroState) {
    const hid = normalizeId(heroState.id);
    if (!normalized || (hid && hid === normalized)) candidates.push(heroState);
  }

  const player = typeof window !== 'undefined' ? window.Player : null;
  if (player && Array.isArray(player.heroes)) {
    const found = player.heroes.find((h) => normalizeId(h?.id ?? h?.heroId) === normalized);
    if (found) candidates.push(found);
  }

  if (candidates.length === 0) return {};
  return Object.assign({}, ...candidates);
}

function classifyFromString(raw) {
  const upper = normalizeUpper(raw);
  if (!upper) return null;
  if (upper.includes('MAGIC') || upper.includes('SPELL') || upper.includes('ARCANE') || upper.includes('HOLY') || upper.includes('LIGHTNING') || upper.includes('FROST') || upper.includes('FIRE') || upper.includes('CAST') || upper.includes('MYSTIC')) {
    return 'MAGIC';
  }
  if (upper.includes('RANG') || upper.includes('DISTANCE') || upper.includes('BOW') || upper.includes('ARROW') || upper.includes('CROSSBOW') || upper.includes('SHOOT') || upper.includes('GUN') || upper.includes('PROJECTILE')) {
    return 'RANGED';
  }
  if (upper.includes('MELEE') || upper.includes('SWORD') || upper.includes('AXE') || upper.includes('CLUB') || upper.includes('HAMMER') || upper.includes('MACE') || upper.includes('DAGGER') || upper.includes('BLADE') || upper.includes('SPEAR') || upper.includes('PIKE') || upper.includes('FIST')) {
    return 'MELEE';
  }
  if (upper.includes('STAFF') || upper.includes('WAND') || upper.includes('ROD') || upper.includes('TOME')) {
    return 'MAGIC';
  }
  return null;
}

function classifyFromHeroClass(raw) {
  const upper = normalizeUpper(raw);
  if (!upper) return null;
  if (upper.includes('ARCH') || upper.includes('RANG') || upper.includes('HUNT')) return 'RANGED';
  if (upper.includes('MAGE') || upper.includes('WIZ') || upper.includes('SORC') || upper.includes('DRUID') || upper.includes('CLERIC') || upper.includes('PRIEST') || upper.includes('NECRO') || upper.includes('SUMMON') || upper.includes('ANGEL')) {
    return 'MAGIC';
  }
  return 'MELEE';
}

function resolveHeroAttackNature({ heroId, payload }) {
  const heroData = gatherHeroSnapshot(heroId);

  const boolHints = [
    normalizeBool(payload?.isRanged ?? payload?.ranged ?? payload?.distance),
    normalizeBool(heroData?.isRanged ?? heroData?.ranged),
  ];

  for (const hint of boolHints) {
    if (hint === true) return 'RANGED';
    if (hint === false) return 'MELEE';
  }

  const stringHints = [
    payload?.attackType,
    payload?.attack_type,
    payload?.type,
    payload?.weaponType,
    payload?.weapon_type,
    payload?.weaponCategory,
    payload?.weapon_category,
    payload?.skillType,
    payload?.skill_type,
    heroData?.attackType,
    heroData?.attack_type,
    heroData?.weaponType,
    heroData?.weapon_type,
    heroData?.weapon_pref,
    heroData?.weaponPref,
  ];

  for (const hint of stringHints) {
    const cls = classifyFromString(hint);
    if (cls) return cls;
  }

  const classHint = heroData?.heroClass ?? heroData?.class;
  const classResult = classifyFromHeroClass(classHint);
  if (classResult) return classResult;

  return 'MELEE';
}

export function playHeroAttackSfx({ heroId, payload }) {
  const nature = resolveHeroAttackNature({ heroId, payload });
  if (nature === 'MAGIC') return;
  if (nature === 'RANGED') {
    playHeroRangedHit();
  } else {
    playHeroMeleeHit();
  }
}

export function __test_only__resolveHeroAttackNature(input) {
  return resolveHeroAttackNature(input || {});
}
