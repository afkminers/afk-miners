// /client/js/play.js
// Cena jogável genérica (House/PvP): usa ?map=<key> (padrão house).
// Agora 100% WS para posição: cliente publica (publishPos) e aceita correção (pos_snap).
// Input (WASD/Numpad/Mouse) + PlayerController + Camera2D + AStarGrid + ClickToMove.
// Requests HTTP centralizadas em client/js/api.js (CSRF automático).

import { getCsrf, apiGet } from './api.js';
import { CombatActions } from './combat/actions.js';
import { publishPos, setMapKey } from './pos-publisher.js';
import { onMessage, authenticate } from './ws/singleton.js';
import { HeroState } from './state/hero-state.js';



const QS = new URLSearchParams(location.search);
const MAP_KEY = QS.get('map') || 'house';
const TILE = 32;
// Desliga a IA local de mobs; posição deve vir do servidor
const ENABLE_LOCAL_MOB_AI = false;


// === buffer de pos_snap recebido cedo (antes do controller existir)
let _earlySnap = null;
function _applyEarlySnapIfAny(controller) {
  if (!_earlySnap || !controller) return;
  if (_earlySnap.mapKey && _earlySnap.mapKey !== MAP_KEY) return;
  try { controller.setPosition(_earlySnap.x | 0, _earlySnap.y | 0); } catch {}
  _earlySnap = null;
}

// registre o handler o quanto antes (ainda no topo do arquivo)
onMessage('pos_snap', (msg) => {
  // se o controller ainda não existe, guarda; senão aplica na hora
  const ctrl = window.GameScene?.controller;
  if (!ctrl) { _earlySnap = msg; return; }
  if (msg.mapKey && msg.mapKey !== MAP_KEY) return;
  try { ctrl.setPosition(msg.x | 0, msg.y | 0); } catch {}
});

// >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
// WS Auth: garante que o servidor sabe quem é o player (id/nome) e
// assim persiste sua posição no banco (player_last_pos). Sem isso, no F5
// você volta para o spawn porque o server não sabe seu player_id.
async function bootAuth() {
  await authenticate(async () => {
    // usa teu endpoint atual
    const me = await apiGet('/api/player/me').catch(() => null);

    // >>> NOVO: alimenta o estado global do herói (idempotente)
    try { HeroState.setFromServer(me); } catch {}

    // em alguns lugares o payload vem como { profile: {...} }, noutros, direto
    const p = (me && me.profile) ? me.profile : me;

    // devolve o shape que o singleton espera
    return {
      id:   String(p?.id || p?.playerId || ''), // <<<<<< ESSENCIAL
      name:        p?.name || p?.username || 'Player'
    };
  });
}

// <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

// HP em tempo real -> HUD
onMessage('hero_hp', (msg) => {
  if (window.HUD_ApplyHeroHpUpdate) {
    const hid = String(msg.heroId);
    window.HUD_ApplyHeroHpUpdate(hid, Number(msg.hp), Number(msg.maxHp));
  }
  // Log básico (se o chat ainda não tiver aba "Log")
  const line = `[Dano] Mob ${msg.byMob ?? msg.instanceId} acertou você por ${msg.dmg} (HP: ${msg.hp}/${msg.maxHp})`;
  if (window.Chat?.pushLog) window.Chat.pushLog(line); else console.log('[LOG]', line);
});

// Respawn -> força refresh HUD imediato
onMessage('hero_respawn', (msg) => {
  if (window.HUD_ApplyHeroHpUpdate) {
    const hid = String(msg.heroId);
    window.HUD_ApplyHeroHpUpdate(hid, Number(msg.hp), Number(msg.hp));
  }
});

// Log genérico de combate (quando implementarmos no server)
onMessage('combat_log', (m) => {
  let line = '';
  if (m.to) {
    line = `[Você] causou ${m.amount} em ${m.to} (hp alvo: ${m.hpAfter ?? '—'})`;
  } else {
    line = `[Dano] Mob ${m.byMob ?? m.instanceId} acertou você por ${m.amount} (HP: ${m.hpAfter ?? '—'}/${m.maxHp ?? '—'})`;
  }
  if (window.Chat?.pushLog) window.Chat.pushLog(line); else console.log('[LOG]', line);
});

// == NOVO: evento rico dizendo "quem bateu" ==
onMessage('hero_hit', (msg) => {
  // Atualiza HUD de HP do herói
  if (window.HUD_ApplyHeroHpUpdate && msg.heroId != null) {
    const cur = Number(msg.hp);
    const max = Number(msg.hpMax ?? msg.maxHp ?? msg.hp_max ?? msg.maxhp);
    window.HUD_ApplyHeroHpUpdate(String(msg.heroId), cur, max);
  }

  // Nome do bicho que bateu (cai em chaves até achar algo útil)
  const mobName =
    msg?.monster?.name ||
    msg?.monster?.key ||
    msg?.monsterKey ||
    `Mob ${msg?.monster?.id ?? msg?.instanceId ?? '?'}`;

  const amount = Number(msg.dmg ?? msg.amount ?? 0);
  const hpStr  = `${msg.hp}/${msg.hpMax ?? msg.maxHp ?? '—'}`;

  // Log de combate
  const line = `[Dano] ${mobName} te acertou por ${amount} (HP: ${hpStr})`;
  if (window.Chat?.pushLog) window.Chat.pushLog(line); else console.log('[LOG]', line);

  // Dano flutuante acima do monstro (se soubermos posição) — cai pro player se não tiver
  if (window.HeroDamageUI && typeof window.HeroDamageUI.spawn === 'function') {
    let x = Number(msg?.monster?.x), y = Number(msg?.monster?.y);

    // Se só veio instanceId, tenta achar a sprite do mob ligado ao instanceId
    if ((!Number.isFinite(x) || !Number.isFinite(y)) && msg.instanceId && window.GameScene?.getMobByInstanceId) {
      const s = window.GameScene.getMobByInstanceId(String(msg.instanceId));
      if (s) { x = s.x; y = s.y; }
    }

    // Fallback: usa a posição do player
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      const p = window.GameScene?.controller?.getPosition?.();
      if (p) { x = p.x; y = p.y - 16; }
    }

    if (Number.isFinite(x) && Number.isFinite(y)) {
      window.HeroDamageUI.spawn({ x, y, amount, kind: 'from_mob' });
    }
  }

  try { triggerMonsterAttackAnimation(msg); } catch {}

  // Se morreu, deixa o overlay/efeito a seu gosto
  if (msg.died && typeof window.showDeathOverlay === 'function') {
    window.showDeathOverlay();
  }
});


// registra o mapKey para o publicador WS
setMapKey(MAP_KEY);

// ----------------- namespace público p/ outros módulos -----------------
window.GameScene = window.GameScene || {};
window.GameScene.mapKey = MAP_KEY;

// ======= Time/Hero ativo (base para coleta e combate) =======
/** Define o herói ativo globalmente e emite evento. */
window.setActiveHero = function setActiveHero(id) {
  if (!id) return;
  try {
    const s = String(id);
    window.ActiveHeroId = s;
    if (window.GameScene) window.GameScene.activeHeroId = s;
    window.dispatchEvent(new CustomEvent('hero:active-changed', { detail: { heroId: s } }));
  } catch {}
};

/** Estado leve do time: até 3 heróis. */
window.Team = window.Team || (function () {
  const state = { activeIds: [] };
  function uniq(arr) {
    const seen = new Set(); const out = [];
    for (const x of arr) { const k = String(x); if (!seen.has(k)) { seen.add(k); out.push(k); } }
    return out;
  }
  return {
    setActiveTeam(ids) {
      const list = Array.isArray(ids) ? ids.map(String) : [];
      state.activeIds = uniq(list).slice(0, 3);
      if (state.activeIds.length > 0) window.setActiveHero(state.activeIds[0]);
      window.dispatchEvent(new CustomEvent('team:changed', { detail: { heroIds: state.activeIds.slice() } }));
    },
    add(id) {
      const s = String(id);
      if (!s) return;
      const next = uniq([...(state.activeIds || []), s]).slice(0,3);
      state.activeIds = next;
      if (!window.ActiveHeroId) window.setActiveHero(next[0]);
      window.dispatchEvent(new CustomEvent('team:changed', { detail: { heroIds: state.activeIds.slice() } }));
    },
    remove(id) {
      const s = String(id);
      state.activeIds = (state.activeIds || []).filter(x => String(x) !== s);
      if (window.ActiveHeroId === s) {
        const nxt = state.activeIds[0] || null;
        if (nxt) window.setActiveHero(nxt);
      }
      window.dispatchEvent(new CustomEvent('team:changed', { detail: { heroIds: state.activeIds.slice() } }));
    },
    getActiveTeamIds() { return (state.activeIds || []).slice(0,3); },
    getActiveHeroId() { return window.ActiveHeroId || (state.activeIds && state.activeIds[0]) || null; }
  };
})();

// ==== BINDING ESTÁVEL (sem gambiarra): instanceId <-> sprite; spawnId -> Set<sprites> ====
const MOB_BY_INSTANCE = new Map();        // instanceId (UUID) -> sprite
const MOB_SPRITES_BY_SPAWN = new Map();   // spawnId (int) -> Set<sprite>

window.GameScene.getMobByInstanceId = (id) => MOB_BY_INSTANCE.get(String(id)) || null;

// === bind por monsterKey quando não tiver spawnId do servidor ===
window.GameScene.bindInstanceToAnySpriteByKey = (instanceId, monsterKey) => {
  const want = String(monsterKey || '').trim().toLowerCase();
  let best = null;
  for (const s of window.GameScene.mobs || []) {
    const sameKind =
      (String(s.kind || s.key || '').toLowerCase() === want) ||
      (String(s.meta?.image || '').toLowerCase().includes(want));
    if (!sameKind) continue;
    if (!s.instanceId) { best = s; break; }           // preferir livre
    if (!best && (s.dead || s.hidden)) best = s;      // senão, reaproveitar
  }
  if (!best) return null;

  best.instanceId = String(instanceId);
  best.dead = false;
  best.hidden = false;
  best._animFrozen = false;
  best._animFrozenFrame = 0;
  best._serverMove = null;

  MOB_BY_INSTANCE.set(String(instanceId), best);
  return best;
};

window.GameScene.registerMobSprite = (sprite, meta = {}) => {
  if (!sprite) return;
  if (sprite._serverMove == null) sprite._serverMove = null;
  if (Number.isFinite(meta.spawnId)) {
    sprite.spawnId = Number(meta.spawnId);
    if (!MOB_SPRITES_BY_SPAWN.has(sprite.spawnId)) MOB_SPRITES_BY_SPAWN.set(sprite.spawnId, new Set());
    MOB_SPRITES_BY_SPAWN.get(sprite.spawnId).add(sprite);
  }
  if (meta.instanceId) {
    sprite.instanceId = String(meta.instanceId);
    MOB_BY_INSTANCE.set(sprite.instanceId, sprite);
  }

  retryBindPendingServerMonsters();
};

// escolhe uma sprite “livre” daquele spawn
function pickFreeSpriteForSpawn(spawnId) {
  const set = MOB_SPRITES_BY_SPAWN.get(Number(spawnId));
  if (!set || set.size === 0) return null;
  let candidate = null;
  for (const s of set) { if (!s.instanceId) return s; if (!candidate && (s.dead || s.hidden)) candidate = s; }
  return candidate || [...set][0];
}

window.GameScene.bindInstanceToSpawn = (instanceId, spawnId) => {
  const s = pickFreeSpriteForSpawn(spawnId);
  if (!s) return null;
  s.instanceId = String(instanceId);
  s.dead = false;
  s.hidden = false;
  s._animFrozen = false;
  s._animFrozenFrame = 0;
  s._serverMove = null;
  MOB_BY_INSTANCE.set(String(instanceId), s);
  return s;
};

window.GameScene.onMonsterDead = (instanceId) => {
  const s = MOB_BY_INSTANCE.get(String(instanceId));
  if (!s) return;
  s.dead = true;
  s.hidden = false;
  s._animFrozen = false;
  s._animFrozenFrame = 0;
  s._serverMove = null;
  s._serverAction = 'dead';
  s._serverActionUntil = null;
  s._animIsMoving = false;
  if (!s.face) s.face = 'south';
  if (s.instanceId != null) MOB_BY_INSTANCE.delete(String(s.instanceId));
  s.instanceId = null;
};

// ======= Server-driven monster state =======
const SERVER_MONSTER_STATE = new Map(); // id -> { sprite, x, y, spawnId, monsterKey, mapKey, dead, renderX, renderY, animSpeedMultiplier, isMoving, blockKey, tileX, tileY, lastServerAt }
const UNBOUND_SERVER_MONSTERS = new Set(); // ids aguardando sprite
const MONSTER_BLOCKED_TILES = new Map(); // "cx,cy" -> Set(instanceId)
let _serverMonsterRetryScheduled = false;

const SERVER_MONSTER_STEP_MS = 180;
const SERVER_MONSTER_MIN_TWEEN_MS = 60;
const SERVER_MONSTER_MAX_TWEEN_MS = 260;
const SERVER_MONSTER_BASE_SPEED = TILE / (SERVER_MONSTER_STEP_MS / 1000);
const SERVER_MONSTER_IDLE_ANIM = 0.8;
const SERVER_MONSTER_MIN_ANIM = 0.65;
const SERVER_MONSTER_MAX_ANIM = 1.35;

function getOrCreateServerMonsterState(id) {
  const key = String(id);
  let state = SERVER_MONSTER_STATE.get(key);
  if (!state) {
    state = {
      id: key,
      sprite: null,
      x: null,
      y: null,
      spawnId: null,
      monsterKey: null,
      mapKey: null,
      dead: false,
      renderX: null,
      renderY: null,
      animSpeedMultiplier: SERVER_MONSTER_IDLE_ANIM,
      isMoving: false,
      blockKey: null,
      tileX: null,
      tileY: null,
      lastServerAt: null,
      face: 'south',
      action: 'idle',
      actionUntil: null,
    };
    SERVER_MONSTER_STATE.set(key, state);
  }
  return state;
}

function currentSpriteRenderPos(sprite, now = performance.now()) {
  if (!sprite) return { x: NaN, y: NaN };
  const mv = sprite._serverMove;
  if (!mv || !Number.isFinite(mv.duration) || mv.duration <= 0) {
    return {
      x: Number.isFinite(sprite.x) ? sprite.x : NaN,
      y: Number.isFinite(sprite.y) ? sprite.y : NaN,
    };
  }

  const elapsed = now - mv.startAt;
  if (elapsed <= 0) {
    return { x: mv.fromX, y: mv.fromY };
  }

  const t = Math.max(0, Math.min(1, elapsed / mv.duration));
  return {
    x: mv.fromX + (mv.toX - mv.fromX) * t,
    y: mv.fromY + (mv.toY - mv.fromY) * t,
  };
}

function computeTweenDuration(dx, dy) {
  const dist = Math.hypot(dx, dy);
  if (!Number.isFinite(dist) || dist < 1) return 0;
  const tiles = Math.max(1, dist / TILE);
  const base = SERVER_MONSTER_STEP_MS * tiles;
  return Math.max(SERVER_MONSTER_MIN_TWEEN_MS, Math.min(SERVER_MONSTER_MAX_TWEEN_MS, base));
}

function monsterTileKey(cx, cy) {
  return `${cx | 0},${cy | 0}`;
}

function removeMonsterFromTile(state) {
  if (!state || !state.blockKey) return;
  const set = MONSTER_BLOCKED_TILES.get(state.blockKey);
  if (set) {
    set.delete(state.id);
    if (!set.size) MONSTER_BLOCKED_TILES.delete(state.blockKey);
  }
  state.blockKey = null;
  state.tileX = null;
  state.tileY = null;
}

function updateMonsterBlocking(state, cx, cy) {
  if (!state) return;
  removeMonsterFromTile(state);
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;
  const ix = Math.floor(cx);
  const iy = Math.floor(cy);
  const key = monsterTileKey(ix, iy);
  let set = MONSTER_BLOCKED_TILES.get(key);
  if (!set) {
    set = new Set();
    MONSTER_BLOCKED_TILES.set(key, set);
  }
  set.add(state.id);
  state.blockKey = key;
  state.tileX = ix;
  state.tileY = iy;
}

function clearMonsterBlocking(id) {
  const state = SERVER_MONSTER_STATE.get(String(id));
  if (!state) return;
  removeMonsterFromTile(state);
}

function isTileBlockedByMonster(cx, cy) {
  const key = monsterTileKey(cx, cy);
  const set = MONSTER_BLOCKED_TILES.get(key);
  if (!set || !set.size) return false;
  let alive = false;
  for (const id of set) {
    const st = SERVER_MONSTER_STATE.get(String(id));
    if (st && !st.dead && (!st.mapKey || st.mapKey === MAP_KEY)) {
      alive = true;
      break;
    }
  }
  if (!alive) MONSTER_BLOCKED_TILES.delete(key);
  return alive;
}

function msgMatchesCurrentMap(msg = {}) {
  if (!msg || msg.mapKey == null) return true;
  try {
    return String(msg.mapKey) === MAP_KEY;
  } catch {
    return false;
  }
}

function ensureServerMonsterSprite(msg = {}) {
  const rawId = msg.id != null ? msg.id : (msg.instanceId != null ? msg.instanceId : null);
  if (rawId == null) return null;
  const id = String(rawId);

  const state = getOrCreateServerMonsterState(id);
  if (msg.mapKey != null) state.mapKey = String(msg.mapKey);
  if (msg.spawnId != null && Number.isFinite(Number(msg.spawnId))) state.spawnId = Number(msg.spawnId);
  if (msg.monsterKey) state.monsterKey = String(msg.monsterKey);

  let sprite = window.GameScene?.getMobByInstanceId?.(id) || state.sprite || null;

  if (!sprite && state.spawnId != null && window.GameScene?.bindInstanceToSpawn) {
    sprite = window.GameScene.bindInstanceToSpawn(id, Number(state.spawnId));
  }

  if (!sprite && msg.spawnId != null && window.GameScene?.bindInstanceToSpawn) {
    sprite = window.GameScene.bindInstanceToSpawn(id, Number(msg.spawnId));
  }

  const keyCandidate = state.monsterKey || (msg.monsterKey ? String(msg.monsterKey) : null);
  if (!sprite && keyCandidate && window.GameScene?.bindInstanceToAnySpriteByKey) {
    sprite = window.GameScene.bindInstanceToAnySpriteByKey(id, keyCandidate);
  }

  if (sprite) {
    if (keyCandidate && !sprite.rawKey) sprite.rawKey = keyCandidate;
    sprite.dead = false;
    sprite.hidden = false;
    sprite._animFrozen = false;
    sprite._animFrozenFrame = 0;
    if (!sprite.face) sprite.face = state.face || 'south';
    else state.face = sprite.face;
    if (!Number.isFinite(state.animSpeedMultiplier)) state.animSpeedMultiplier = SERVER_MONSTER_IDLE_ANIM;
    sprite._animSpeedMultiplier = state.animSpeedMultiplier;
    sprite._animIsMoving = !!state.isMoving;
    sprite._serverAction = state.action || (state.isMoving ? 'walk' : 'idle');
    sprite._serverActionUntil = Number.isFinite(state.actionUntil) ? state.actionUntil : null;
    if (!sprite._serverMove) sprite._serverMove = null;
    state.sprite = sprite;
    SERVER_MONSTER_STATE.set(id, state);
    UNBOUND_SERVER_MONSTERS.delete(id);
    return sprite;
  }

  SERVER_MONSTER_STATE.set(id, state);
  UNBOUND_SERVER_MONSTERS.add(id);
  scheduleServerMonsterRetry();
  return null;
}

function pickFaceFromDelta(dx, dy, fallback = 'south') {
  if (!Number.isFinite(dx) && !Number.isFinite(dy)) return fallback;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  if (absDx < 0.5 && absDy < 0.5) return fallback;

  if (absDx >= absDy) {
    if (dx > 0.5) return 'east';
    if (dx < -0.5) return 'west';
  } else {
    if (dy > 0.5) return 'south';
    if (dy < -0.5) return 'north';
  }
  return fallback;
}

function updateSpriteFacingFromDelta(sprite, dx, dy, fallbackFace = 'south') {
  const face = pickFaceFromDelta(dx, dy, fallbackFace);
  if (sprite && face) sprite.face = face;
  return face;
}

function setMonsterAction(state, sprite, action, { until = null, face = null } = {}) {
  if (!state) return;
  const normalized = typeof action === 'string' ? action : 'idle';
  state.action = normalized;
  state.actionUntil = Number.isFinite(until) ? until : null;
  state.isMoving = normalized === 'walk';
  if (face) {
    state.face = face;
    if (sprite) sprite.face = face;
  } else if (sprite && sprite.face) {
    state.face = sprite.face;
  }

  if (sprite) {
    sprite._serverAction = normalized;
    sprite._serverActionUntil = state.actionUntil;
    sprite._animIsMoving = normalized === 'walk';
    if (normalized !== 'dead') {
      sprite._animFrozen = false;
      sprite._animFrozenFrame = 0;
    }
  }
}

function applyServerPosition(id, sprite, x, y, opts = {}) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const state = getOrCreateServerMonsterState(id);
  const now = performance.now();
  const options = (opts && typeof opts === 'object') ? opts : {};
  const forceTeleport = options.forceTeleport === true;

  const current = sprite ? currentSpriteRenderPos(sprite, now) : {
    x: Number.isFinite(state.renderX) ? state.renderX : (Number.isFinite(state.x) ? state.x : x),
    y: Number.isFinite(state.renderY) ? state.renderY : (Number.isFinite(state.y) ? state.y : y),
  };

  const prevX = Number.isFinite(current.x) ? current.x : (Number.isFinite(state.renderX) ? state.renderX : x);
  const prevY = Number.isFinite(current.y) ? current.y : (Number.isFinite(state.renderY) ? state.renderY : y);

  const dx = x - prevX;
  const dy = y - prevY;
  const dist = Math.hypot(dx, dy);

  let tweenDur = computeTweenDuration(dx, dy);
  const prevServerAt = Number.isFinite(state.lastServerAt) ? state.lastServerAt : null;
  const serverDelta = (prevServerAt != null) ? Math.max(30, now - prevServerAt) : null;
  if (serverDelta != null && Number.isFinite(serverDelta)) {
    const cap = Math.max(SERVER_MONSTER_MIN_TWEEN_MS, Math.min(SERVER_MONSTER_MAX_TWEEN_MS, serverDelta * 0.92));
    if (tweenDur > cap) tweenDur = cap;
  }

  const shouldTeleport = forceTeleport || !Number.isFinite(dist) || dist < 1;

  let animMultiplier = SERVER_MONSTER_IDLE_ANIM;
  let isMoving = false;
  let face = (typeof options.face === 'string' && options.face) || state.face || (sprite?.face) || 'south';
  if (!shouldTeleport && tweenDur > 0 && dist >= 1) {
    const pxPerSec = dist / (tweenDur / 1000);
    if (Number.isFinite(pxPerSec) && SERVER_MONSTER_BASE_SPEED > 0) {
      const ratio = pxPerSec / SERVER_MONSTER_BASE_SPEED;
      const clamped = Math.max(SERVER_MONSTER_MIN_ANIM, Math.min(SERVER_MONSTER_MAX_ANIM, ratio));
      animMultiplier = Number.isFinite(clamped) ? clamped : SERVER_MONSTER_IDLE_ANIM;
    } else {
      animMultiplier = 1;
    }
    isMoving = true;
    face = updateSpriteFacingFromDelta(sprite, dx, dy, face);
  } else if (sprite && face) {
    sprite.face = face;
  }

  state.x = x;
  state.y = y;
  state.dead = false;
  state.animSpeedMultiplier = isMoving ? animMultiplier : SERVER_MONSTER_IDLE_ANIM;
  state.face = face;

  if (sprite) {
    sprite._animFrozen = false;
    sprite.hidden = false;
    sprite.dead = false;
    sprite._animSpeedMultiplier = state.animSpeedMultiplier;
    state.sprite = sprite;
    UNBOUND_SERVER_MONSTERS.delete(String(id));

    if (shouldTeleport || tweenDur <= 0) {
      sprite._serverMove = null;
      sprite.x = x;
      sprite.y = y;
      setMonsterAction(state, sprite, 'idle', { face });
      state.renderX = x;
      state.renderY = y;
    } else {
      const fromX = prevX;
      const fromY = prevY;
      setMonsterAction(state, sprite, 'walk', { face, until: now + tweenDur });
      sprite._serverMove = {
        fromX,
        fromY,
        toX: x,
        toY: y,
        startAt: now,
        duration: tweenDur,
      };
      sprite.x = fromX;
      sprite.y = fromY;
      state.renderX = fromX;
      state.renderY = fromY;
    }
  } else {
    state.sprite = null;
    state.renderX = x;
    state.renderY = y;
    if (isMoving) {
      setMonsterAction(state, null, 'walk', { face, until: now + tweenDur });
    } else {
      setMonsterAction(state, null, 'idle', { face });
    }
  }

  updateMonsterBlocking(state, x / TILE, y / TILE);
  state.lastServerAt = now;
  SERVER_MONSTER_STATE.set(String(id), state);
}

function updateServerDrivenMonsters(now = performance.now()) {
  for (const state of SERVER_MONSTER_STATE.values()) {
    const sprite = state.sprite;
    if (!sprite) continue;

    if (state.dead) {
      sprite._serverMove = null;
      sprite._animIsMoving = false;
      if (!Number.isFinite(state.animSpeedMultiplier)) state.animSpeedMultiplier = SERVER_MONSTER_IDLE_ANIM;
      if (sprite._animSpeedMultiplier !== state.animSpeedMultiplier) {
        sprite._animSpeedMultiplier = state.animSpeedMultiplier;
      }
      if (Number.isFinite(state.x)) {
        sprite.x = state.x;
        state.renderX = state.x;
      }
      if (Number.isFinite(state.y)) {
        sprite.y = state.y;
        state.renderY = state.y;
      }
      continue;
    }

    const mv = sprite._serverMove;
    if (!mv || !Number.isFinite(mv.duration) || mv.duration <= 0) {
      if (Number.isFinite(state.x)) sprite.x = state.x;
      if (Number.isFinite(state.y)) sprite.y = state.y;
      state.renderX = Number.isFinite(sprite.x) ? sprite.x : state.x;
      state.renderY = Number.isFinite(sprite.y) ? sprite.y : state.y;
      sprite._serverMove = null;
      if (!Number.isFinite(state.animSpeedMultiplier)) state.animSpeedMultiplier = SERVER_MONSTER_IDLE_ANIM;
      sprite._animSpeedMultiplier = state.animSpeedMultiplier;
      sprite._animIsMoving = !!state.isMoving;
    } else {
      const elapsed = now - mv.startAt;
      if (elapsed <= 0) {
        sprite.x = mv.fromX;
        sprite.y = mv.fromY;
        state.renderX = sprite.x;
        state.renderY = sprite.y;
      } else {
        const t = Math.max(0, Math.min(1, elapsed / mv.duration));
        sprite.x = mv.fromX + (mv.toX - mv.fromX) * t;
        sprite.y = mv.fromY + (mv.toY - mv.fromY) * t;
        state.renderX = sprite.x;
        state.renderY = sprite.y;

        if (t >= 1) {
          sprite._serverMove = null;
          sprite.x = mv.toX;
          sprite.y = mv.toY;
          state.renderX = sprite.x;
          state.renderY = sprite.y;
          state.animSpeedMultiplier = SERVER_MONSTER_IDLE_ANIM;
          setMonsterAction(state, sprite, 'idle', { face: sprite.face || state.face });
          sprite._animSpeedMultiplier = SERVER_MONSTER_IDLE_ANIM;
        }
      }
    }

    if (!state.dead && state.action === 'attack' && Number.isFinite(state.actionUntil) && now >= state.actionUntil) {
      const hasMove = !!sprite._serverMove;
      const fallback = hasMove ? 'walk' : 'idle';
      setMonsterAction(state, sprite, fallback, { face: sprite.face || state.face });
      if (!hasMove) {
        state.animSpeedMultiplier = SERVER_MONSTER_IDLE_ANIM;
        sprite._animSpeedMultiplier = SERVER_MONSTER_IDLE_ANIM;
      }
    }

    if (!Number.isFinite(state.animSpeedMultiplier)) state.animSpeedMultiplier = SERVER_MONSTER_IDLE_ANIM;
    if (sprite._animSpeedMultiplier !== state.animSpeedMultiplier) {
      sprite._animSpeedMultiplier = state.animSpeedMultiplier;
    }
  }
}

function retryBindPendingServerMonsters() {
  if (!UNBOUND_SERVER_MONSTERS.size) return;
  for (const id of Array.from(UNBOUND_SERVER_MONSTERS)) {
    const state = SERVER_MONSTER_STATE.get(String(id));
    if (!state || state.dead) {
      UNBOUND_SERVER_MONSTERS.delete(id);
      continue;
    }

    const sprite = ensureServerMonsterSprite({
      id,
      spawnId: state.spawnId,
      monsterKey: state.monsterKey,
      mapKey: state.mapKey,
    });

    if (!sprite) continue;

    if (Number.isFinite(state.x) && Number.isFinite(state.y)) {
      applyServerPosition(id, sprite, state.x, state.y, { face: state.face });
    } else {
      if (!Number.isFinite(state.animSpeedMultiplier)) state.animSpeedMultiplier = SERVER_MONSTER_IDLE_ANIM;
      sprite._animSpeedMultiplier = state.animSpeedMultiplier;
      sprite._animIsMoving = !!state.isMoving;
      if (!sprite.face) sprite.face = state.face || 'south';
      else state.face = sprite.face;
      sprite._serverAction = state.action || (state.isMoving ? 'walk' : 'idle');
      sprite._serverActionUntil = Number.isFinite(state.actionUntil) ? state.actionUntil : null;
      state.sprite = sprite;
      SERVER_MONSTER_STATE.set(String(id), state);
    }

    UNBOUND_SERVER_MONSTERS.delete(id);
  }
}

function scheduleServerMonsterRetry() {
  if (_serverMonsterRetryScheduled) return;
  _serverMonsterRetryScheduled = true;
  setTimeout(() => {
    _serverMonsterRetryScheduled = false;
    try { retryBindPendingServerMonsters(); } catch (e) { console.warn('[mobs] retry bind failed', e?.message); }
  }, 0);
}

function handleServerMonsterRespawn(msg = {}) {
  if (!msgMatchesCurrentMap(msg)) return;
  const id = msg.id != null ? String(msg.id) : null;
  if (!id) return;

  const sprite = ensureServerMonsterSprite(msg);
  const state = getOrCreateServerMonsterState(id);
  state.dead = false;

  const x = Number(msg.x);
  const y = Number(msg.y);
  if (sprite && Number.isFinite(x) && Number.isFinite(y)) {
    applyServerPosition(id, sprite, x, y, { forceTeleport: true, face: state.face });
  } else if (Number.isFinite(x) && Number.isFinite(y)) {
    applyServerPosition(id, null, x, y, { forceTeleport: true, face: state.face });
  }

  SERVER_MONSTER_STATE.set(id, state);
}

function handleServerMonsterMove(msg = {}) {
  if (!msgMatchesCurrentMap(msg)) return;
  const id = msg.id != null ? String(msg.id) : null;
  if (!id) return;

  const x = Number(msg.x);
  const y = Number(msg.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;

  const state = getOrCreateServerMonsterState(id);
  if (state.dead) {
    // Ignore movement updates while dead; keep the corpse locked to its final spot.
    if (!Number.isFinite(state.x) || !Number.isFinite(state.y)) {
      const corpse = state.sprite || window.GameScene?.getMobByInstanceId?.(id) || null;
      if (!Number.isFinite(state.x) && Number.isFinite(corpse?.x)) state.x = corpse.x;
      if (!Number.isFinite(state.y) && Number.isFinite(corpse?.y)) state.y = corpse.y;
      if (!Number.isFinite(state.renderX) && Number.isFinite(state.x)) state.renderX = state.x;
      if (!Number.isFinite(state.renderY) && Number.isFinite(state.y)) state.renderY = state.y;
      SERVER_MONSTER_STATE.set(id, state);
    }
    return;
  }

  const sprite = ensureServerMonsterSprite(msg);
  if (sprite) {
    applyServerPosition(id, sprite, x, y, { face: state.face });
  } else {
    applyServerPosition(id, null, x, y, { face: state.face });
  }
}

function handleServerMonsterDead(msg = {}) {
  if (!msgMatchesCurrentMap(msg)) return;
  const id = msg.id != null ? String(msg.id) : null;
  if (!id) return;

  const state = getOrCreateServerMonsterState(id);
  const sprite = state.sprite || window.GameScene?.getMobByInstanceId?.(id) || null;
  const msgX = Number(msg.x);
  const msgY = Number(msg.y);

  if (sprite && sprite._serverMove) {
    const mv = sprite._serverMove;
    const toX = Number.isFinite(mv?.toX) ? mv.toX : null;
    const toY = Number.isFinite(mv?.toY) ? mv.toY : null;
    if (Number.isFinite(toX)) sprite.x = toX;
    if (Number.isFinite(toY)) sprite.y = toY;
  }

  state.dead = true;
  state.animSpeedMultiplier = SERVER_MONSTER_IDLE_ANIM;
  state.isMoving = false;
  const finalX = Number.isFinite(msgX)
    ? msgX
    : Number.isFinite(sprite?.x)
      ? sprite.x
      : Number.isFinite(state.renderX)
        ? state.renderX
        : state.x;
  const finalY = Number.isFinite(msgY)
    ? msgY
    : Number.isFinite(sprite?.y)
      ? sprite.y
      : Number.isFinite(state.renderY)
        ? state.renderY
        : state.y;

  if (Number.isFinite(finalX)) {
    state.x = finalX;
    state.renderX = finalX;
    if (sprite) sprite.x = finalX;
  }
  if (Number.isFinite(finalY)) {
    state.y = finalY;
    state.renderY = finalY;
    if (sprite) sprite.y = finalY;
  }

  const face = sprite?.face || state.face || 'south';
  setMonsterAction(state, sprite, 'dead', { face });
  state.face = face;
  state.sprite = sprite || null;
  if (sprite) {
    sprite.dead = true;
    sprite.hidden = false;
    sprite._serverMove = null;
    sprite._animSpeedMultiplier = SERVER_MONSTER_IDLE_ANIM;
    sprite._animFrozen = false;
    sprite._animFrozenFrame = 0;
    sprite._animIsMoving = false;
  }
  SERVER_MONSTER_STATE.set(id, state);
  UNBOUND_SERVER_MONSTERS.delete(id);
  clearMonsterBlocking(id);

  try { window.GameScene?.onMonsterDead?.(id); } catch {}
}

function getHeroWorldPosition(heroId) {
  if (heroId == null) return null;
  const active = window.ActiveHeroId != null ? String(window.ActiveHeroId) : null;
  if (active && String(heroId) === active) {
    const ctrl = window.GameScene?.controller;
    const pos = ctrl?.getPosition?.();
    if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
      return { x: pos.x, y: pos.y };
    }
  }
  return null;
}

function triggerMonsterAttackAnimation(msg = {}) {
  const rawId = msg.instanceId != null ? msg.instanceId : (msg.id != null ? msg.id : null);
  if (rawId == null) return;
  const id = String(rawId);
  if (msg?.monster?.mapKey != null && String(msg.monster.mapKey) !== MAP_KEY) return;
  if (msg?.monster?.map_key != null && String(msg.monster.map_key) !== MAP_KEY) return;
  const state = getOrCreateServerMonsterState(id);
  if (state.mapKey && state.mapKey !== MAP_KEY) return;
  if (state.dead) return;

  const sprite = state.sprite || window.GameScene?.getMobByInstanceId?.(id) || null;
  const now = performance.now();
  const heroPos = getHeroWorldPosition(msg.heroId);

  let mx = Number.isFinite(state.renderX) ? state.renderX : Number.isFinite(state.x) ? state.x : null;
  let my = Number.isFinite(state.renderY) ? state.renderY : Number.isFinite(state.y) ? state.y : null;
  if ((!Number.isFinite(mx) || !Number.isFinite(my)) && sprite) {
    if (Number.isFinite(sprite.x)) mx = sprite.x;
    if (Number.isFinite(sprite.y)) my = sprite.y;
  }
  if ((!Number.isFinite(mx) || !Number.isFinite(my)) && msg.monster) {
    const pmx = Number(msg.monster.x);
    const pmy = Number(msg.monster.y);
    if (Number.isFinite(pmx)) mx = pmx;
    if (Number.isFinite(pmy)) my = pmy;
  }

  let face = sprite?.face || state.face || 'south';
  if (heroPos && Number.isFinite(mx) && Number.isFinite(my)) {
    const dx = heroPos.x - mx;
    const dy = heroPos.y - my;
    face = pickFaceFromDelta(dx, dy, face);
  }

  setMonsterAction(state, sprite, 'attack', { face, until: now + 520 });
  state.animSpeedMultiplier = SERVER_MONSTER_IDLE_ANIM;
  state.dead = false;
  state.face = face;
  if (sprite) {
    sprite.dead = false;
    sprite.hidden = false;
    sprite._animSpeedMultiplier = SERVER_MONSTER_IDLE_ANIM;
  }
  state.sprite = sprite || null;
  SERVER_MONSTER_STATE.set(id, state);
}

function normalizeLegacyMobPos(msg = {}) {
  const id = msg.instanceId != null ? String(msg.instanceId) : (msg.id != null ? String(msg.id) : null);
  if (!id) return null;

  return {
    id,
    x: Number(msg.x),
    y: Number(msg.y),
    mapKey: msg.mapKey ?? msg.map_key ?? null,
    spawnId: msg.spawnId ?? msg.spawn_id ?? null,
    monsterKey: msg.monsterKey ?? msg.monster_key ?? null,
  };
}

function handleLegacyMobPos(msg = {}) {
  const normalized = normalizeLegacyMobPos(msg);
  if (!normalized) return;
  handleServerMonsterMove(normalized);
}

onMessage('monster_respawned', handleServerMonsterRespawn);
onMessage('monster_move', handleServerMonsterMove);
onMessage('mob_pos', handleLegacyMobPos);
onMessage('monster_dead', handleServerMonsterDead);
window.GameScene.serverMonsters = SERVER_MONSTER_STATE;
window.GameScene.isTileBlockedByMonster = isTileBlockedByMonster;
window.GameScene.monsterBlockedTiles = MONSTER_BLOCKED_TILES;

// =============== Canvas/HUD flexível (querystring + auto) ===============
function pickElByIds(prefIds = [], fallbackSelectors = []) {
  for (const id of prefIds) { if (!id) continue; const el = document.getElementById(id); if (el) return el; }
  for (const sel of fallbackSelectors) { const el = document.querySelector(sel); if (el) return el; }
  return null;
}
const preferCanvasId = QS.get('canvas'); // ex: ?canvas=scene
const preferHudId = QS.get('hud');    // ex: ?hud=hud

const canvas = pickElByIds([preferCanvasId, 'view', 'scene'], ['canvas#view', 'canvas#scene', 'canvas']);
const hud = pickElByIds([preferHudId, 'hud', 'app-hud'], ['#hud', '#app-hud']);

if (!canvas) {
  console.error('play.js: canvas não encontrado (#view ou #scene).');
  alert('Erro: canvas não encontrado (#view/#scene).');
  throw new Error('Canvas not found');
}
const ctx = canvas.getContext('2d');

// expõe cedo para módulos externos
window.GameScene.canvas = canvas;
window.GameScene.ctx = ctx;

// garante foco p/ WASD e click-to-move
try { canvas.setAttribute('tabindex', '0'); } catch { }
canvas.addEventListener('mousedown', () => { try { canvas.focus(); } catch { } });
canvas.addEventListener('touchstart', () => { try { canvas.focus(); } catch { } });

// helper DOM
const $ = (s) => document.querySelector(s);

// camera hoisted
let camera;

/* ===================== Assets: normalização de paths ===================== */
function assetUrl(p, { asTileset = false } = {}) {
  let s = String(p || '');
  if (!s) return s;
  if (/^https?:\/\//i.test(s)) return s;
  s = s.replace(/^(\.\/)+/, '');
  s = s.replace(/^client\//, '');
  s = s.replace(/^\/client\//, '/');
  if (!s.startsWith('/')) s = asTileset ? '/img/' + s : '/' + s;
  return s;
}

// --- loader de tileset compatível com teu caminho antigo do Tiled
function normalizeTilesetPath(p) {
  let s = String(p || '');
  s = s.replace(/^(\.\.\/)+/, '/');
  if (!s.startsWith('/')) s = '/' + s;
  s = s.replace(/^\/client\//, '/');
  return s;
}

async function loadTilesetImage(rawPath) {
  const primary = normalizeTilesetPath(rawPath);
  const base = primary.split('/').pop();
  const candidates = [
    primary,
    '/sprites/' + base,
    '/sprites/tiles/' + base,
    '/img/tiles/' + base,
    '/img/' + base,
    '/' + base
  ];
  for (const url of candidates) {
    const img = loadImg(url);
    const ok = await ensureImgLoaded(img);
    if (ok) return img;
  }
  console.warn('[tileset] falhou carregar. Tentativas:', candidates);
  return null;
}

/* ============================= Settings (pixel art global) ============================= */
function applySmoothing() {
  try {
    ctx.imageSmoothingEnabled = false;
    ctx.mozImageSmoothingEnabled = false;
    ctx.webkitImageSmoothingEnabled = false;
  } catch {}
  try {
    canvas.style.imageRendering = 'pixelated';
    canvas.style.setProperty('image-rendering', 'pixelated');
  } catch {}
}
applySmoothing();
document.addEventListener('settings:changed', () => { applySmoothing(); resize(); });

/* ============================= Resize + Zoom por tiles ============================= */
function resize() {
  const shell = document.querySelector('#clientShell') || canvas.parentElement;
  const rect = shell ? shell.getBoundingClientRect() : { width: window.innerWidth * 0.9, height: window.innerHeight * 0.9 };
  const wCSS = Math.max(320, Math.floor(rect.width || window.innerWidth * 0.9));
  const hCSS = Math.max(200, Math.floor(rect.height || window.innerHeight * 0.9));
  const st = (window.GameSettings?.get?.() || window.GameSettings?.getState?.()) || {};
  const dprBase = window.devicePixelRatio || 1;
  const dpr = Math.min(dprBase, Number(st.dprCap || dprBase));

  canvas.style.width = wCSS + 'px';
  canvas.style.height = hCSS + 'px';
  const w = Math.round(wCSS * dpr);
  const h = Math.round(hCSS * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  if (camera?.resize) camera.resize(canvas.width, canvas.height);

  applyCameraZoom();
}
window.addEventListener('resize', resize);

/* ============================ Imagens ============================ */
const IMG_CACHE = new Map();
function loadImg(src) {
  const key = assetUrl(src || '');
  if (IMG_CACHE.has(key)) return IMG_CACHE.get(key);
  const img = new Image();
  img.src = key;
  IMG_CACHE.set(key, img);
  return img;
}
function imgReady(img) { return img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0; }
async function ensureImgLoaded(img) {
  if (imgReady(img)) return true;
  try { await img.decode(); return imgReady(img); } catch { return imgReady(img); }
}

/* ======== Índice tolerante para sprites (YAML) + loader robusto ======== */
let SPRITES_META = {};
let SPRITE_INDEX = new Map(); // chave normalizada -> meta

function normKey(s) {
  return String(s || '')
    .replace(/\\/g, '/')
    .replace(/^.*\//, '')
    .replace(/\.(png|jpg|jpeg|gif|webp)$/i, '')
    .replace(/[\s_]+/g, '-')
    .toLowerCase()
    .trim();
}

function indexSpriteMeta(obj) {
  SPRITE_INDEX.clear();
  for (const [key, data] of Object.entries(obj || {})) {
    const nk = normKey(key);
    SPRITE_INDEX.set(nk, data);
    if (data?.image) SPRITE_INDEX.set(normKey(data.image), data);
    if (Array.isArray(data?.aliases)) {
      for (const a of data.aliases) SPRITE_INDEX.set(normKey(a), data);
    }
  }
}

function asObj(v) {
  if (!v) return null;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  return v;
}

async function loadSpriteMeta() {
  const list = await apiGet('/api/assets/sprites'); // [{ key, kind, data }]
  SPRITES_META = Object.fromEntries((list || []).map(e => [e.key, asObj(e.data)]));
  indexSpriteMeta(SPRITES_META);
}

function findMetaFor(spawnKey) {
  const k = String(spawnKey || '').trim();
  if (!k) return null;
  const tries = [k, k.toLowerCase(), k.replace(/[\s_]+/g, '-'), k.replace(/[\s\-]+/g, '_')];
  for (const t of tries) {
    const m = SPRITE_INDEX.get(normKey(t));
    if (m) return m;
  }
  const nk = normKey(k);
  for (const [idx, m] of SPRITE_INDEX.entries()) if (idx.includes(nk)) return m;
  return null;
}

function buildMonsterCandidates(kindNorm, meta, rawKey) {
  const list = [];
  if (meta?.image) {
    const p = meta.image.replace(/^(\.\/)+/, '');
    list.push('/' + p);
    list.push(p);
  }
  const vKebab = String(kindNorm || '').trim();
  const vRaw = String(rawKey || '').trim();
  const vUnder = vRaw.toLowerCase().replace(/[\s\-]+/g, '_');
  const vKebabFromRaw = vRaw.toLowerCase().replace(/[\s_]+/g, '-');
  const variants = [...new Set([vKebab, vUnder, vKebabFromRaw])];

  for (const v of variants) {
    list.push(`/sprites/monsters/${v}.png`);
    list.push(`/sprites/${v}.png`);
    list.push(`/img/monsters/${v}.png`);
    list.push(`/img/${v}.png`);
    list.push(`/${v}.png`);
  }
  return [...new Set(list)];
}

async function loadMonsterImg(kindNorm, meta, rawKey) {
  const candidates = buildMonsterCandidates(kindNorm, meta, rawKey);
  for (const url of candidates) {
    const img = loadImg(url);
    const ok = await ensureImgLoaded(img);
    if (ok) return img;
  }
  console.warn(`[mob sprite] falhou carregar: ${kindNorm}. Tentativas:`, candidates);
  return null;
}

// Auto-meta: tenta 64x64 → 48x32 → 32x32 e define animações padrão
function inferMetaFromImage(img, rawKey) {
  if (!img || !img.naturalWidth || !img.naturalHeight) return null;
  const candidates = [{ w: 64, h: 64 }, { w: 48, h: 32 }, { w: 32, h: 32 }];
  let fw = 32, fh = 32;
  for (const c of candidates) {
    if (img.naturalWidth % c.w === 0 && img.naturalHeight % c.h === 0) { fw = c.w; fh = c.h; break; }
  }
  const cols = Math.max(1, Math.floor(img.naturalWidth / fw));
  const rows = Math.max(1, Math.floor(img.naturalHeight / fh));
  const directionalRows = (rows >= 5)
    ? { south: 1, west: 2, east: 3, north: 4 }
    : (rows >= 4)
      ? { south: 0, west: 1, east: 2, north: 3 }
      : null;
  const baseDirRow = directionalRows ? directionalRows.south : 0;
  const deadRowIndex = rows >= 5 ? Math.min(rows - 1, 4) : rows - 1;
  const attackRows = rows >= 10
    ? { west: 5, east: 6, south: 7, north: 8 }
    : null;
  return {
    key: String(rawKey || '').trim(),
    kind: 'monster',
    image: img.src.replace(location.origin, ''),
    frame: { width: fw, height: fh, margin: 0, spacing: 0, bleedFix: 0.25 },
    grid: { cols, rows },
    anchor: { x: 0.5, y: fw === 64 && fh === 64 ? 0.85 : 0.9 },
    anims: {
      walk: {
        fps: 6,
        frames: Math.min(4, cols),
        startCol: 0,
        rowByDir: directionalRows || undefined,
        row: baseDirRow,
        loop: true
      },
      idle: (rows >= 1)
        ? {
            fps: 2,
            frames: 1,
            row: baseDirRow,
            loop: false,
            rowByDir: directionalRows || undefined,
            startCol: 0,
          }
        : null,
      dead: (rows >= 2)
        ? {
            fps: 4,
            frames: Math.min(4, cols),
            row: Math.max(0, deadRowIndex),
            loop: false,
            startCol: 0,
          }
        : null,
      attack: (rows >= 10)
        ? {
            fps: 10,
            frames: Math.min(4, cols),
            row: attackRows?.south ?? 5,
            loop: false,
            rowByDir: attackRows || undefined,
            startCol: 0,
          }
        : null,
    }
  };
}

/* ========================= Estado do Mapa ========================= */
let mapData = null;
let tileset = null;
let tilesetImg = null;
let groundLayer = null;

let starts = [];
let spawns = [];

/* ========================= Spawners / Mobs ======================== */
const spawners = [];
const mobs = [];
window.GameScene.mobs = mobs;
let mobAutoId = 1;

/* ========================= Loot (estado) ========================== */
const loots = new Map(); // id -> { id, x, y, items:[...] }
window.GameScene.loots = loots;

function lootAtWorld(x, y) {
  for (const l of loots.values()) if (Math.abs(x - l.x) <= 16 && Math.abs(y - l.y) <= 16) return l;
  return null;
}

function drawLoot(l) {
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#d97706';
  ctx.fillRect(l.x - 6, l.y - 10, 12, 10);
  ctx.fillStyle = '#92400e';
  ctx.fillRect(l.x - 6, l.y - 6, 12, 6);
  ctx.restore();
}

/* ========================= Player Visual ========================== */
const playerVis = { w: 32, h: 32, img: null, heroKey: null };

/* ============================== Render ============================ */
function clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); }

function drawGround(cameraObj) {
  if (!groundLayer || !tileset || !imgReady(tilesetImg)) return;
  const data = groundLayer.data;
  const cols = mapData.width;
  const rows = mapData.height;
  const first = tileset.firstgid || 1;
  const tw = tileset.tilewidth, th = tileset.tileheight;
  const columnsInImage = tileset.columns;

  const x0 = Math.max(0, Math.floor(cameraObj.x / TILE));
  const y0 = Math.max(0, Math.floor(cameraObj.y / TILE));
  const x1 = Math.min(cols - 1, Math.ceil((cameraObj.x + cameraObj.w) / TILE));
  const y1 = Math.min(rows - 1, Math.ceil((cameraObj.y + cameraObj.h) / TILE));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const gid = data[y * cols + x];
      if (!gid || gid < first) continue;
      const id = gid - first;
      const sx = (id % columnsInImage) * tw;
      const sy = Math.floor(id / columnsInImage) * th;
      ctx.drawImage(tilesetImg, sx, sy, tw, th, x * TILE, y * TILE, TILE, TILE);
    }
  }
}

function drawPlayer(controller) {
  const p = controller.getPosition();
  if (imgReady(playerVis.img)) {
    const ox = Math.round(p.x - playerVis.w * 0.5);
    const oy = Math.round(p.y - playerVis.h * 0.9);
    ctx.drawImage(playerVis.img, ox, oy, playerVis.w, playerVis.h);
  } else {
    ctx.save();
    ctx.fillStyle = "#f59e0b";
    ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

function drawMob(m) {
  if (m.hidden) return;

  if ((!m.meta || !m.meta.frame || !m.meta.grid) && imgReady(m.img)) {
    const auto = inferMetaFromImage(m.img, m.rawKey || m.kind);
    if (auto) m.meta = auto;
  }

  if (!(m.meta && imgReady(m.img))) {
    if (!m.dead) {
      ctx.save();
      ctx.fillStyle = "#ef4444";
      ctx.beginPath(); ctx.arc(m.x, m.y, 7, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    return;
  }

  const meta = m.meta;
  const frameW  = Number(meta.frame?.width)  || 32;
  const frameH  = Number(meta.frame?.height) || 32;
  const margin  = Number(meta.frame?.margin)  || 0;
  const spacing = Number(meta.frame?.spacing) || 0;
  const cols    = Math.max(1, Number(meta.grid?.cols) || 1);
  const rows    = Math.max(1, Number(meta.grid?.rows) || 1);
  const animIdle = meta.anims?.idle || null;
  const animWalk = meta.anims?.walk || null;
  const animDead = meta.anims?.dead || null;
  const animAttack = meta.anims?.attack || null;
  const defaultWalk = animWalk || { fps: 6, frames: cols, row: 0, startCol: 0, loop: true };

  const face = m.face || 'south';
  const isMoving = !!m._animIsMoving;
  const action = m.dead ? 'dead' : (m._serverAction || (isMoving ? 'walk' : 'idle'));

  let animType = action;
  let anim = null;

  if (action === 'dead' && animDead) {
    anim = animDead;
  } else if (action === 'attack' && animAttack) {
    anim = animAttack;
  } else if (action === 'walk' && animWalk) {
    anim = animWalk;
  } else if (action === 'idle' && animIdle) {
    anim = animIdle;
  } else if (isMoving && animWalk) {
    anim = animWalk;
    animType = 'walk';
  } else if (!m.dead && animIdle) {
    anim = animIdle;
    animType = 'idle';
  } else if (m.dead && animDead) {
    anim = animDead;
    animType = 'dead';
  } else {
    anim = defaultWalk;
    animType = isMoving ? 'walk' : 'static';
  }

  if (!anim) {
    anim = { fps: 6, frames: cols, row: 0, startCol: 0, loop: true };
    if (animType !== 'dead') animType = 'static';
  }

  if (!Number.isFinite(m._animSpeedMultiplier)) m._animSpeedMultiplier = SERVER_MONSTER_IDLE_ANIM;
  if (!m.dead && action !== 'dead') m._animFrozen = false;

  let fps = Number(anim.fps);
  if (!Number.isFinite(fps) || fps < 0) fps = 6;
  if (animType === 'walk') {
    const speedMult = Math.max(0, Number(m._animSpeedMultiplier));
    const mult = speedMult > 0 ? Math.max(SERVER_MONSTER_MIN_ANIM, Math.min(SERVER_MONSTER_MAX_ANIM, speedMult)) : 1;
    fps = Math.min(8, Math.max(3, fps * mult));
  } else if (animType === 'idle') {
    fps = Math.min(4, Math.max(1, fps));
  } else if (animType === 'attack') {
    fps = Math.min(8, Math.max(4, fps));
  } else if (animType === 'dead') {
    fps = Math.min(4, Math.max(1, fps));
  } else if (animType === 'static') {
    fps = 0;
  }

  let seq = Array.isArray(anim.seq) ? anim.seq.slice() : null;
  let frames = Number(anim.frames);
  let startCol = Number(anim.startCol);
  if (!Number.isFinite(frames) || frames <= 0) frames = cols;
  if (!Number.isFinite(startCol) || startCol < 0) startCol = 0;

  let row = Number(anim.row); if (!Number.isFinite(row)) row = 0;
  if (anim.rowByDir && anim.rowByDir[face] != null) {
    const r = Number(anim.rowByDir[face]); if (Number.isFinite(r)) row = r;
  }
  if (anim.framesByDir && anim.framesByDir[face] != null) {
    const fd = Number(anim.framesByDir[face]); if (Number.isFinite(fd) && fd > 0) frames = fd;
  }
  if (anim.startColByDir && anim.startColByDir[face] != null) {
    const sd = Number(anim.startColByDir[face]); if (Number.isFinite(sd) && sd >= 0) startCol = sd;
  }
  if (!seq && anim.seqByDir && Array.isArray(anim.seqByDir[face])) seq = anim.seqByDir[face].slice();

  row = Math.max(0, Math.min(rows - 1, row));

  if (animType === 'dead' && animDead) {
    if (!seq && Number.isFinite(animDead.startCol)) startCol = Number(animDead.startCol);
    if (!animDead.rowByDir && Number.isFinite(animDead.row)) {
      row = Math.max(0, Math.min(rows - 1, Number(animDead.row)));
    }
  }

  const t = performance.now() / 1000;
  const baseLen = Math.max(1, seq ? seq.length : frames);
  let f;
  if (anim.loop === false) {
    const idx = Math.floor(t * Math.max(0, fps));
    f = Math.min(idx, baseLen - 1);
    if (f < baseLen - 1) {
      m._animFrozen = false;
    }
  } else {
    f = m._animFrozen ? m._animFrozenFrame : Math.floor(t * Math.max(0, fps)) % baseLen;
  }

  if (animType === 'dead' && anim.loop === false && f >= baseLen - 1) {
    m._animFrozen = true;
    m._animFrozenFrame = baseLen - 1;
  } else if (animType === 'attack' && anim.loop === false && f >= baseLen - 1) {
    m._animFrozen = true;
    m._animFrozenFrame = baseLen - 1;
  } else if (anim.loop !== false) {
    m._animFrozen = false;
  }

  let col;
  if (seq && seq.length > 0) {
    const pick = Number(seq[f]);
    col = Number.isFinite(pick) ? Math.max(0, Math.min(cols - 1, pick)) : 0;
  } else {
    const rowCols = cols;
    if (startCol < 0) startCol = 0;
    if (startCol >= rowCols) startCol = Math.max(0, rowCols - 1);
    const maxFromStart = Math.max(1, rowCols - startCol);
    frames = Math.min(Math.max(1, frames), maxFromStart);
    col = startCol + f;
    if (col >= rowCols) col = rowCols - 1;
    if (col < 0) col = 0;
  }

  const EPS = Number.isFinite(Number(meta.frame?.bleedFix)) ? Number(meta.frame?.bleedFix) : 0.25;
  const sx = margin + col * (frameW + spacing) + EPS;
  const sy = margin + row * (frameH + spacing) + EPS;
  const sw = frameW - 2 * EPS;
  const sh = frameH - 2 * EPS;

  const anchorX = (meta.anchor?.x ?? 0.5);
  const anchorY = (meta.anchor?.y ?? 0.9);
  const dw = frameW, dh = frameH;
  const ox = Math.round(m.x - dw * anchorX);
  const oy = Math.round(m.y - dh * anchorY);

  const canFlipX = !anim.rowByDir && rows === 1 && face === 'west';

  ctx.save();
  if (canFlipX) {
    ctx.translate(ox + dw, oy);
    ctx.scale(-1, 1);
    ctx.drawImage(m.img, sx, sy, sw, sh, 0, 0, dw, dh);
  } else {
    ctx.drawImage(m.img, sx, sy, sw, sh, ox, oy, dw, dh);
  }
  ctx.restore();
}

/* ==================== Colisão e Spawns do Tiled ==================== */
function buildCollisionGridFromObjects(mapW, mapH, objs) {
  const cols = Math.floor(mapW / TILE);
  const rows = Math.floor(mapH / TILE);
  const grid = new Uint8Array(cols * rows);
  for (const o of objs) {
    const oType = String(o.type || '').toLowerCase();
    const isSolid = oType === 'solid' || (o.properties || []).some(p => p.name === 'solid' && (p.value === true || p.value === 1));
    if (!isSolid) continue;
    const x0 = Math.floor(o.x / TILE), y0 = Math.floor(o.y / TILE);
    const x1 = Math.floor((o.x + o.width - 1) / TILE);
    const y1 = Math.floor((o.y + o.height - 1) / TILE);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      if (cx >= 0 && cy >= 0 && cx < cols && cy < rows) grid[cy * cols + cx] = 1;
    }
  }
  return { grid, cols, rows };
}

function buildCollisionGridFromTiled(json) {
  const cols = json.width, rows = json.height;
  const grid = new Uint8Array(cols * rows);
  const collisionLayer = (json.layers || []).find(l => l.type === 'tilelayer' && l.name && l.name.toLowerCase().includes('collision'));
  if (collisionLayer && collisionLayer.data) {
    for (let i = 0; i < collisionLayer.data.length; i++) if (i < grid.length && collisionLayer.data[i]) grid[i] = 1;
  }
  return { grid, cols, rows };
}

function mapSpawnsFromTiledJSON(json) {
  const layer = (json.layers || []).find(
    (l) => l.type === "objectgroup" && l.name && l.name.toLowerCase() === "spawn"
  );
  if (!layer) return [];
  return (layer.objects || [])
    .filter((o) => ((o.class || o.type || "") + "").toLowerCase() === "spawn")
    .map((o) => {
      const p = {}; (o.properties || []).forEach((kv) => { p[kv.name] = kv.value; });
      const monsterKey = String(p.monsterKey || p.monster || "goblin");
      const count = Number(p.count || 1) || 1;
      const respawnSec = Number(p.respawnSec || p.respawn || 20) || 20;
      const w = o.width > 0 ? o.width : TILE;
      const h = o.height > 0 ? o.height : TILE;
      return {
        id: Number(o.id),
        monsterKey, count, respawnSec,
        x: o.x || 0, y: o.y || 0, w, h
      };
    });
}

/* ===================== Resolução de Sprite Player ===================== */
async function resolvePlayerSprite() {
  try {
    const me = await apiGet('/api/player/me');

    // >>> NOVO: sincroniza estado de herói sempre que carregarmos /me
    try { HeroState.setFromServer(me); } catch {}

    const heroes = Array.isArray(me.heroes) ? me.heroes : [];
    const teamIds = heroes.slice(0, 3).map(h => String(h.id));
    if (teamIds.length > 0) { try { window.Team.setActiveTeam(teamIds); } catch {} }

    const preferred =
      heroes.find(h => h.isStarter === 1 || h.isStarter === true) ||
      heroes[0] || null;

    if (preferred) {
      try { window.setActiveHero(preferred.id); } catch {}
      playerVis.heroKey = preferred.heroKey || preferred.key || null;
      const candidate = playerVis.heroKey ? `/sprites/characters/${playerVis.heroKey}.png` : null;
      if (candidate) {
        playerVis.img = loadImg(candidate);
        await ensureImgLoaded(playerVis.img).catch(() => {});
        if (imgReady(playerVis.img)) return;
      }
      if (preferred.imageUrl) {
        playerVis.img = loadImg(preferred.imageUrl);
        await ensureImgLoaded(playerVis.img).catch(() => {});
        if (imgReady(playerVis.img)) return;
      }
    }
  } catch (e) { console.warn('resolvePlayerSprite:', e.message); }

  playerVis.img = loadImg("/sprites/characters/player.png");
  ensureImgLoaded(playerVis.img).catch(() => {});
}


/* =========================== Respawn Manager ========================== */
function addMobFromSpawn(spDef) {
  const rawKey = spDef.monsterKey || spDef.monster || "goblin";
  const kindNorm = normKey(rawKey);
  const meta = asObj(findMetaFor(rawKey)) || null;

  // dentro de addMobFromSpawn(spDef)
  const m = {
    id: mobAutoId++,
    kind: kindNorm,
    rawKey,
    // centraliza no retângulo do spawn (sem aleatório)
    x: (spDef.x || 0) + ((spDef.w || TILE) / 2),
    y: (spDef.y || 0) + ((spDef.h || TILE) / 2),
    w: 32, h: 32,
    // velocidade fixa
    speed: 80,
    dirX: 0, dirY: 0, changeAt: 0,
    face: 'south',
    img: null,
    meta,
    bound: (spDef.w || spDef.h)
      ? { x: spDef.x || 0, y: spDef.y || 0, w: spDef.w || TILE, h: spDef.h || TILE }
      : null,
    spawnId: Number(spDef.id || spDef.spawn_id || spDef.spawnId || 0) || null,
    instanceId: null,
    dead: false,
    hidden: false,
    _animFrozen: false,
    _animFrozenFrame: 0,
  };


  loadMonsterImg(kindNorm, meta, rawKey).then(img => {
    if (!img) return;
    m.img = img;
    if (!m.meta || !m.meta.frame || !m.meta.grid) {
      const auto = inferMetaFromImage(img, rawKey);
      if (auto) m.meta = auto;
    }
  });

  mobs.push(m);
  if (m.spawnId != null) window.GameScene.registerMobSprite(m, { spawnId: m.spawnId });
  return m.id;
}

function buildSpawnersFromDefs(defs) {
  spawners.length = 0;
  defs.forEach(d => {
    const want = Math.max(1, Number(d.count || 1));
    const respawnMs = Math.max(1, Number(d.respawnSec || d.respawn || 20)) * 1000;
    spawners.push({
      def: d, want, respawnMs,
      nextAt: performance.now(),
      area: { x: d.x || 0, y: d.y || 0, w: d.w || TILE, h: d.h || TILE },
      liveIds: new Set()
    });
  });
}

function updateRespawns(now) {
  for (const sp of spawners) {
    for (const id of Array.from(sp.liveIds)) {
      if (!mobs.some(m => m.id === id)) sp.liveIds.delete(id);
    }
    while (sp.liveIds.size < sp.want && now >= sp.nextAt) {
      const id = addMobFromSpawn(sp.def);
      sp.liveIds.add(id);
      sp.nextAt = now + sp.respawnMs;
    }
  }
}

// === UI mínima: números de dano flutuantes ===
(function(){
  const ACTIVE = []; // {x,y,amt,t,life}
  const LIFE_MS = 900;

  function spawn({ x, y, amount, kind }) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    ACTIVE.push({ x, y, amt: Number(amount)||0, t: performance.now(), life: LIFE_MS, kind: String(kind||'') });
  }

  function render(ctx, camera, dt) {
    if (!ACTIVE.length) return;
    const now = performance.now();
    for (let i = ACTIVE.length - 1; i >= 0; i--) {
      const p = ACTIVE[i];
      const age = now - p.t;
      if (age >= p.life) { ACTIVE.splice(i,1); continue; }
      const alpha = 1 - (age / p.life);
      const rise = Math.min(22, age * 0.04);
      const sx = (p.x - camera.x) * (camera.getZoom?.()||1);
      const sy = (p.y - camera.y - rise) * (camera.getZoom?.()||1);

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // contorno simples
      ctx.fillStyle = 'black';
      ctx.fillText(String(p.amt), Math.round(sx)+1, Math.round(sy)+1);
      // dentro (vermelho padrão para dano recebido)
      ctx.fillStyle = (p.kind === 'from_mob') ? '#ff6767' : '#ffd54a';
      ctx.fillText(String(p.amt), Math.round(sx), Math.round(sy));
      ctx.restore();
    }
  }

  window.HeroDamageUI = { spawn, render };
})();


/* ================================ Boot ================================ */
(async function main() {
  await getCsrf().catch(() => {});
  await bootAuth();
  console.log('[ws-auth] autenticado, o servidor agora conhece seu player_id');
  await loadSpriteMeta();

  const maps = await apiGet("/api/admin/content/maps");
  if (!maps.some((m) => m.key === MAP_KEY)) throw new Error(`map ${MAP_KEY} não encontrado`);

  function normalizeApiJson(payload) {
    let v = payload;
    if (Array.isArray(v)) v = v[0];
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch {} }
    return v;
  }

  const rawObjs = await apiGet(`/api/admin/content/map/${MAP_KEY}/objects`);
  const objsNorm = normalizeApiJson(rawObjs);
  const objArr = Array.isArray(objsNorm)
    ? objsNorm
    : (objsNorm && Array.isArray(objsNorm.objects) ? objsNorm.objects : []);
  starts = objArr.filter(o => (o.type || '').toLowerCase() === 'start');

  const rawMap = await apiGet(`/api/admin/content/map/${MAP_KEY}/data`);
  mapData = normalizeApiJson(rawMap);

  tileset = (mapData && mapData.tilesets && mapData.tilesets[0]) || null;
  if (!tileset || !tileset.image) {
    console.warn("Tileset não embedado. No Tiled: 'Embed Tileset' e exporte novamente o JSON.");
  } else {
    tilesetImg = await loadTilesetImage(tileset.image);
  }

  groundLayer = (mapData.layers || []).find(
    (l) => l.type === "tilelayer" && l.name && l.name.toLowerCase() === "ground"
  );

  const mapW = (mapData.width || 64) * TILE;
  const mapH = (mapData.height || 64) * TILE;

  function hasSolidProp(o) { return (o.properties || []).some(p => p.name === 'solid' && (p.value === true || p.value === 1)); }
  const collBuild = objArr.some(o => String(o.type || '').toLowerCase() === 'solid' || hasSolidProp(o))
    ? buildCollisionGridFromObjects(mapW, mapH, objArr)
    : buildCollisionGridFromTiled(mapData);

  const cols = collBuild.cols || (mapData.width || 64);
  const rows = collBuild.rows || (mapData.height || 64);
  const worldW = cols * TILE;
  const worldH = rows * TILE;
  const grid = collBuild.grid || new Uint8Array(cols * rows);

  camera = new Camera2D({
    width: canvas.width,
    height: canvas.height,
    worldWidth: worldW,
    worldHeight: worldH
  });

  if (typeof camera.getZoom !== 'function') camera.getZoom = () => (camera.zoom && Number(camera.zoom)) || 1;
  if (typeof camera.setZoom !== 'function') camera.setZoom = (z) => { camera.zoom = Number(z) || 1; };
  if (typeof camera.screenToWorld !== 'function') camera.screenToWorld = (sx, sy) => {
    const z = camera.getZoom ? Number(camera.getZoom()) || 1 : 1;
    return { x: camera.x + (sx / z), y: camera.y + (sy / z) };
  };
  if (typeof camera.worldToScreen !== 'function') camera.worldToScreen = (wx, wy) => {
    const z = camera.getZoom ? Number(camera.getZoom()) || 1 : 1;
    return { x: (wx - camera.x) * z, y: (wy - camera.y) * z };
  };
  if (typeof camera.apply !== 'function') {
    camera.apply = (ctx, draw) => {
      ctx.save();
      const z = (typeof camera.getZoom === 'function') ? Number(camera.getZoom()) || 1 : 1;
      ctx.translate(-camera.x, -camera.y);
      ctx.scale(z, z);
      draw();
      ctx.restore();
    };
  }

  function applyCameraZoom() {
    const st = (window.GameSettings?.getState && window.GameSettings.getState()) || {};
    if (st.zoomByTiles) {
      const tilesY = Math.max(6, Number(st.tilesY || 13));
      const zRaw = canvas.height / (tilesY * TILE);
      const zMin = Number.isFinite(st.zoomMin) ? st.zoomMin : 0.5;
      const zMax = Number.isFinite(st.zoomMax) ? st.zoomMax : 4;
      const zClamped = Math.max(zMin, Math.min(zMax, zRaw));
      if (typeof camera.setZoom === 'function') camera.setZoom(zClamped);
    } else {
      const zRaw = Number(st.zoom || 1);
      const zMin = Number.isFinite(st.zoomMin) ? st.zoomMin : 0.5;
      const zMax = Number.isFinite(st.zoomMax) ? st.zoomMax : 4;
      const zClamped = Math.max(zMin, Math.min(zMax, zRaw));
      if (typeof camera.setZoom === 'function') camera.setZoom(zClamped);
    }
  }

  resize();

  const monsterBlockChecker = (cx, cy) => isTileBlockedByMonster(cx, cy);

  const controller = new PlayerController({
    speed: 140,
    collisionGrid: grid,
    cols, rows,
    // WS-only: publica cada passo válido
    onMoved: (x, y) => {
      try {
        localStorage.setItem(`lastPos:${MAP_KEY}`, JSON.stringify({ x, y, t: Date.now() }));
      } catch {}
      publishPos(x, y);
    },
  });

  if (typeof controller.setDynamicBlockChecker === 'function') {
    controller.setDynamicBlockChecker(monsterBlockChecker);
  }

  // expõe camera/controller/mapKey p/ outros módulos (combate, etc.)
  window.GameScene.camera = camera;
  window.GameScene.controller = controller;
  window.GameScene.mapKey = MAP_KEY;
  window.GameScene.monsterBlockChecker = monsterBlockChecker;

  // ==== Posição inicial: prioridade = pos_snap do servidor -> localStorage -> spawn ====
  // 2.1) tenta aplicar um pos_snap que pode ter chegado antes do controller existir
  let usedInitial = false;
  if (_earlySnap && (!_earlySnap.mapKey || _earlySnap.mapKey === MAP_KEY)) {
    try { controller.setPosition(_earlySnap.x | 0, _earlySnap.y | 0); usedInitial = true; } catch {}
    _earlySnap = null;
  }

  // 2.2) se ainda não usamos nada, tenta localStorage
  if (!usedInitial) {
    try {
      const raw = localStorage.getItem(`lastPos:${MAP_KEY}`);
      if (raw) {
        const { x, y } = JSON.parse(raw);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          controller.setPosition(x | 0, y | 0);
          usedInitial = true;
        }
      }
    } catch {}
  }

  // 2.3) fallback: spawn do mapa
  if (!usedInitial) {
    if (starts[0]) controller.setPosition(starts[0].x, starts[0].y);
    else controller.setPosition(TILE * 2 + TILE / 2, TILE * 2 + TILE / 2);
  }

  // 2.4) publica imediatamente a posição inicial para o servidor responder com pos_snap
  try {
    const p0 = controller.getPosition();
    publishPos(p0.x | 0, p0.y | 0);
  } catch {}

  // === A* e click-to-move (pode ficar logo depois da posição inicial)
  const astar = new AStarGrid(grid, cols, rows);
  if (typeof astar.setDynamicBlocker === 'function') {
    astar.setDynamicBlocker(monsterBlockChecker);
  }
  const clickMove = new ClickToMove({ canvas, camera, controller, grid });
  clickMove.setAStar(astar);

  // Input
  Input.attach(window, canvas);

  // seguir câmera e resolver sprite
  camera.follow(controller);
  await resolvePlayerSprite();


  // Spawns de mobs
  let spawnsList;
  try { spawnsList = await apiGet(`/api/admin/content/map/${MAP_KEY}/spawns`); } catch { spawnsList = []; }
  if (!Array.isArray(spawnsList) || spawnsList.length === 0) {
    spawns = mapSpawnsFromTiledJSON(mapData);
    console.log("spawns fallback (JSON):", spawns);
  } else {
    spawns = spawnsList;
    console.log("spawns do servidor:", spawns);
  }

  // Monta respawners e popula inicial
  buildSpawnersFromDefs(spawns);
  const now0 = performance.now();
  for (const s of spawners) {
    while (s.liveIds.size < s.want) s.liveIds.add(addMobFromSpawn(s.def));
    s.nextAt = now0 + s.respawnMs;
  }


  // === WS: loot
  onMessage('loot_spawned', (msg) => {
    loots.set(String(msg.id), { id: String(msg.id), x: msg.x, y: msg.y, items: msg.items || [] });
  });
  onMessage('loot_removed', (msg) => {
    loots.delete(String(msg.id));
  });

  // sinaliza que a cena está pronta (outros módulos podem iniciar)
  window.dispatchEvent(new CustomEvent('game:ready', { detail: { canvas, ctx, camera, controller } }));
  window.dispatchEvent(new Event('gamescene:ready'));

  // Loop principal
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    // Click-to-move (PRIORIZA LOOT)
    const m = Input.getMouse();
    if (Input.consumeClick()) {
      const rect = canvas.getBoundingClientRect();
      const sx = m.x - rect.left, sy = m.y - rect.top;
      const w = camera.screenToWorld(sx, sy);
      const loot = lootAtWorld(w.x, w.y);
      if (loot) {
        try { CombatActions?.pickupLoot?.(loot.id); } catch {}
      } else {
        clickMove.handleClick(sx, sy);
      }
    }

    // Teclado: 1 passo de 32x32 por tecla (N/S/L/O)
    const step = Input.getStepIntent && Input.getStepIntent();
    if (step) window.GameScene?.controller?.requestStep?.(step);
    window.GameScene?.controller?.update?.(dt, null);

    // Camera
    camera.update(dt);


    // ===== IA dos mobs em passos de 32x32 (DESATIVADA; servidor manda posição) =====
    const hasGrid = !!grid && Number.isFinite(cols) && Number.isFinite(rows);
    const cellOf   = (wx, wy) => ({ cx: Math.floor(wx / TILE), cy: Math.floor(wy / TILE) });
    const centerOf = (cx, cy) => ({ x: cx * TILE + TILE / 2, y: cy * TILE + TILE / 2 });
    const isBlocked = (cx, cy) => {
      if (!hasGrid) return false;
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return true;
      return grid[cy * cols + cx] === 1;
    };
    const inBound = (mob, cx, cy) => {
      if (!mob.bound) return true;
      const { x, y, w, h } = mob.bound;
      if (w <= TILE && h <= TILE) return true;
      const wx = cx * TILE + TILE / 2;
      const wy = cy * TILE + TILE / 2;
      return (wx >= x && wy >= y && wx <= x + w && wy <= y + h);
    };
    const faceFrom = (dx, dy) => (dx === 1 ? 'east' : dx === -1 ? 'west' : dy === 1 ? 'south' : 'north');

    // Toggle: se quiser testar local, troque para true
    if (ENABLE_LOCAL_MOB_AI) {
      // (cole aqui o bloco ANTES, se um dia quiser reativar a IA local)
    }


    updateRespawns(now);
    updateServerDrivenMonsters(now);

    // Render
    clear();
    camera.apply(ctx, () => {
      drawGround(camera);
      for (const l of loots.values()) drawLoot(l);
      for (const m of mobs) drawMob(m);
      drawPlayer(controller);
    });

    if (window.CombatUI && typeof window.CombatUI.render === 'function') {
      try { window.CombatUI.render(ctx, camera, dt); } catch (e) {}
    }

    // >>> ADICIONE ESTA LINHA:
    if (window.HeroDamageUI && typeof window.HeroDamageUI.render === 'function') {
      try { window.HeroDamageUI.render(ctx, camera, dt); } catch {}
    }

    window.dispatchEvent(new CustomEvent('game:frame', { detail: { ctx, camera, dt } }));

    if (hud) {
      const hudGameInfo = document.getElementById('hud-gameinfo');
      if (hudGameInfo) hudGameInfo.remove();
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
  document.addEventListener('settings:changed', () => { resize(); });
})().catch((err) => {
  console.error(err);
  if (hud) hud.textContent = "Erro: " + err.message;
});

/* ============================ util local ============================ */
function applyCameraZoom() {
  if (!camera) return;
  const st = (window.GameSettings?.getState && window.GameSettings.getState()) || {};
  if (st.zoomByTiles) {
    const tilesY = Math.max(6, Number(st.tilesY || 13));
    const zRaw = canvas.height / (tilesY * TILE);
    const zMin = Number.isFinite(st.zoomMin) ? st.zoomMin : 0.5;
    const zMax = Number.isFinite(st.zoomMax) ? st.zoomMax : 4;
    const zClamped = Math.max(zMin, Math.min(zMax, zRaw));
    camera.setZoom?.(zClamped);
  } else {
    const zRaw = Number(st.zoom || 1);
    const zMin = Number.isFinite(st.zoomMin) ? st.zoomMin : 0.5;
    const zMax = Number.isFinite(st.zoomMax) ? st.zoomMax : 4;
    const zClamped = Math.max(zMin, Math.min(zMax, zRaw));
    camera.setZoom?.(zClamped);
  }
}
