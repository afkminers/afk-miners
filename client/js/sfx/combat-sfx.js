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

const heroMetaCache = new Map(); // heroId -> meta snapshot (class, heroKey, attack_type, etc.)

const HERO_ATTACK_NATURE_BY_KEY = {
  aric: 'MELEE',
  lyria: 'RANGED',
  brokk: 'MELEE',
  seraph: 'MAGIC',
  kaelen: 'MELEE',
  morrin: 'MELEE',
  elara: 'MAGIC',
  darrion: 'MELEE',
  sylva: 'MAGIC',
  ragnar: 'MELEE',
  selene: 'RANGED',
  tharion: 'MAGIC',
  auriel: 'MAGIC',
  zephyr: 'MAGIC',
  arkan: 'MAGIC',
};

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

function rememberHeroMeta(raw) {
  if (!raw) return;
  const id = normalizeId(raw.id ?? raw.heroId ?? raw.hero_id ?? raw.playerHeroId);
  if (!id) return;
  const prev = heroMetaCache.get(id) || {};
  const result = { ...prev };
  const keys = [
    'id', 'heroId', 'hero_id', 'playerHeroId',
    'heroKey', 'hero_key', 'key',
    'class', 'heroClass', 'hero_class',
    'attackType', 'attack_type',
    'weaponType', 'weapon_type',
    'weapon_pref', 'weaponPref',
    'role', 'element',
    'isRanged', 'ranged', 'distance'
  ];
  for (const k of keys) {
    const value = raw[k];
    if (value != null && value !== '') result[k] = value;
  }
  heroMetaCache.set(id, result);
}

function primeCacheFromPlayer() {
  if (typeof window === 'undefined') return;
  const player = window.Player;
  if (!player) return;
  const lists = [];
  if (Array.isArray(player.heroes)) lists.push(player.heroes);
  if (Array.isArray(player.teamHeroes)) lists.push(player.teamHeroes);
  if (Array.isArray(player.team)) lists.push(player.team);
  for (const list of lists) {
    for (const hero of list) rememberHeroMeta(hero);
  }
}

function getActiveHeroIdMaybe() {
  if (typeof window === 'undefined') return null;
  if (window.ActiveHeroId != null) return normalizeId(window.ActiveHeroId);
  try {
    const fromTeam = window.Team?.getActiveHeroId?.();
    if (fromTeam != null) return normalizeId(fromTeam);
  } catch {}
  try {
    if (window.HeroState?.id != null) return normalizeId(window.HeroState.id);
  } catch {}
  return null;
}

function getActiveHeroKeyMaybe() {
  if (typeof window === 'undefined') return null;
  const candidates = [];
  const summary = window.ActiveHeroSummary;
  if (summary) candidates.push(summary.heroKey, summary.hero_key, summary.key);
  const heroState = window.HeroState;
  if (heroState) candidates.push(heroState.heroKey, heroState.hero_key);
  const activeId = getActiveHeroIdMaybe();
  if (activeId && window.Player && Array.isArray(window.Player.heroes)) {
    const found = window.Player.heroes.find((h) => normalizeId(h?.id ?? h?.heroId) === activeId);
    if (found) candidates.push(found.heroKey, found.hero_key, found.key);
  }
  candidates.push(window.GameScene?.playerVis?.heroKey);
  for (const cand of candidates) {
    const str = normalizeString(cand);
    if (str) return str;
  }
  return null;
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  const prime = () => primeCacheFromPlayer();
  prime();
  setTimeout(primeCacheFromPlayer, 0);
  window.addEventListener('hero:state', (ev) => rememberHeroMeta(ev.detail));
  window.addEventListener('tick:hero', (ev) => rememberHeroMeta(ev.detail));
  window.addEventListener('team:changed', prime);
  window.addEventListener('heroes:rendered', prime);
  window.addEventListener('player:me:update', prime);
  window.addEventListener('hero:active-changed', () => {
    const id = getActiveHeroIdMaybe();
    const key = getActiveHeroKeyMaybe();
    if (id && key) rememberHeroMeta({ id, heroKey: key });
  });
}

function gatherHeroSnapshot(heroId) {
  const normalized = normalizeId(heroId);
  const candidates = [];
  if (normalized && heroMetaCache.has(normalized)) {
    candidates.push(heroMetaCache.get(normalized));
  }
  const summary = typeof window !== 'undefined' ? window.ActiveHeroSummary : null;
  if (summary) {
    const sid = normalizeId(summary.id ?? summary.heroId ?? summary.hero_id);
    if (!normalized || (sid && sid === normalized)) {
      rememberHeroMeta(summary);
      candidates.push(summary);
    }
  }

  const heroState = typeof window !== 'undefined' ? window.HeroState : null;
  if (heroState) {
    const hid = normalizeId(heroState.id);
    if (!normalized || (hid && hid === normalized)) {
      rememberHeroMeta(heroState);
      candidates.push(heroState);
    }
  }

  const player = typeof window !== 'undefined' ? window.Player : null;
  if (player && Array.isArray(player.heroes)) {
    const found = player.heroes.find((h) => normalizeId(h?.id ?? h?.heroId) === normalized);
    if (found) {
      rememberHeroMeta(found);
      candidates.push(found);
    }
  }

  if (candidates.length === 0) {
    if (normalized && heroMetaCache.has(normalized)) {
      return { ...heroMetaCache.get(normalized), id: normalized };
    }
    return normalized ? { id: normalized } : {};
  }

  const merged = Object.assign({}, ...candidates);
  if (normalized && !merged.id) merged.id = normalized;
  rememberHeroMeta(merged);
  return merged;
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

function classifyFromHeroKey(raw) {
  const key = normalizeString(raw).toLowerCase();
  if (!key) return null;
  return HERO_ATTACK_NATURE_BY_KEY[key] || null;
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
  const normalizedId = normalizeId(heroId);
  const heroData = gatherHeroSnapshot(normalizedId);
  const cached = normalizedId ? heroMetaCache.get(normalizedId) : null;

  const boolHints = [
    normalizeBool(payload?.isRanged ?? payload?.ranged ?? payload?.distance),
    normalizeBool(heroData?.isRanged ?? heroData?.ranged ?? heroData?.distance ?? heroData?.is_distance),
    normalizeBool(cached?.isRanged ?? cached?.ranged ?? cached?.distance),
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
    cached?.attackType,
    cached?.attack_type,
    cached?.weaponType,
    cached?.weapon_type,
    cached?.weapon_pref,
    cached?.weaponPref,
  ];

  for (const hint of stringHints) {
    const cls = classifyFromString(hint);
    if (cls) return cls;
  }

  const heroKeyHints = [
    heroData?.heroKey,
    heroData?.hero_key,
    heroData?.key,
    payload?.heroKey,
    payload?.hero_key,
    payload?.attackerHeroKey,
    cached?.heroKey,
    cached?.hero_key,
    cached?.key,
  ];
  if (normalizedId) {
    const activeId = getActiveHeroIdMaybe();
    if (activeId && normalizedId === activeId) {
      heroKeyHints.push(getActiveHeroKeyMaybe());
    }
  }

  for (const hint of heroKeyHints) {
    const cls = classifyFromHeroKey(hint);
    if (cls) return cls;
  }

  const classHints = [
    heroData?.heroClass,
    heroData?.class,
    heroData?.hero_class,
    cached?.heroClass,
    cached?.class,
    cached?.hero_class,
  ];
  for (const hint of classHints) {
    const cls = classifyFromHeroClass(hint);
    if (cls) return cls;
  }

  return 'MELEE';
}

export function playHeroAttackSfx({ heroId, payload }) {
  const normalizedId = normalizeId(heroId);
  if (normalizedId) {
    const activeId = getActiveHeroIdMaybe();
    if (activeId && normalizedId === activeId) {
      const activeKey = getActiveHeroKeyMaybe();
      if (activeKey) rememberHeroMeta({ id: normalizedId, heroKey: activeKey });
    }
  }
  const nature = resolveHeroAttackNature({ heroId: normalizedId, payload });
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
