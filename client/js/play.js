// /client/js/play.js
// Cena jogável genérica (House/PvP): usa ?map=<key> (padrão house).
// Agora 100% WS para posição: cliente publica (publishPos) e aceita correção (pos_snap).
// Input (WASD/Numpad/Mouse) + PlayerController + Camera2D + AStarGrid + ClickToMove.
// Requests HTTP centralizadas em client/js/api.js (CSRF automático).

import { getCsrf, apiGet } from './api.js';
import { CombatActions } from './combat/actions.js';
import { publishPos, setMapKey } from './pos-publisher.js';
import { onMessage, authenticate } from './ws/singleton.js';
import { i18n } from './i18n/core.js';
import { HeroState } from './state/hero-state.js';
import { Camera2D } from './engine/camera2d.js';
import { PlayerController } from './engine/player_controller.js';
import { ClickToMove } from './engine/click_to_move.js';
import { AStarGrid } from './engine/pathfinder.js';
import { Input } from './engine/input.js';
import { TILE, toTile, tileCenter, footColliderPx } from './engine/movement_contract.js';



const QS = new URLSearchParams(location.search);
const MAP_KEY = QS.get('map') || 'house';
const TILE_SIZE = Number(window.TILE_SIZE || 32);
const playerVis = { w: 32, h: 32, img: null, heroKey: null, anchorX: 0.5, anchorY: 0.9 };
// Desliga a IA local de mobs; posição deve vir do servidor
const ENABLE_LOCAL_MOB_AI = false;

// ======= Estado de outros jogadores visíveis no mapa =======
const otherPlayers = new Map(); // playerId -> { id, name, x, y, mapKey, lastSeenAt }
const OTHER_PLAYER_TTL_MS = 5000;

function upsertOtherPlayer(msg) {
  if (!msg) return;
  const rawId = msg.id != null ? String(msg.id) : '';
  if (!rawId) return;

  const myId = window.MyPlayerId ? String(window.MyPlayerId) : null;
  if (myId && myId === rawId) return; // ignora minhas próprias mensagens

  const mapKey = String(msg.mapKey || MAP_KEY || 'house');
  if (mapKey !== MAP_KEY) return; // só desenha quem está no mesmo mapa

  const x = Number(msg.x);
  const y = Number(msg.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;

  const prev = otherPlayers.get(rawId) || {};
  otherPlayers.set(rawId, {
    id: rawId,
    name: String(msg.name || prev.name || ''),
    x,
    y,
    mapKey,
    lastSeenAt: performance.now(),
  });
}

function getOtherPlayersSnapshot() {
  const now = performance.now();
  const list = [];
  for (const [id, p] of otherPlayers.entries()) {
    const age = now - (p.lastSeenAt || 0);
    if (age > OTHER_PLAYER_TTL_MS) {
      otherPlayers.delete(id);
      continue;
    }
    list.push(p);
  }
  return list;
}

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

// atualiza cache de outros jogadores quando o servidor manda posição
onMessage('pos', (msg) => {
  try {
    upsertOtherPlayer(msg);
  } catch (err) {
    console.warn('[play] failed to upsert other player pos', err);
  }
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

    // normaliza id do player
    const id = String(p?.id || p?.playerId || '');

    // deixa o id disponível globalmente para ignorar a própria posição no WS
    if (id && id !== 'undefined' && id !== 'null') {
      window.MyPlayerId = id;
    }

    // devolve o shape que o singleton espera
    return {
      id,
      name: p?.name || p?.username || 'Player',
    };
  });
}

// <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

// HP em tempo real -> HUD
const LOG_FALLBACKS = {
  'chat.logMobHitYou': '[Damage] {mob} hit you for {amount} (HP: {current}/{max})',
  'chat.logYouHitTarget': '[You] dealt {amount} to {target} (target HP: {hp})',
};

function normalizeHeroId(raw) {
  if (raw == null) return null;
  const id = String(raw).trim();
  if (!id || id === 'undefined' || id === 'null') return null;
  return id;
}

function resolveHeroId(raw) {
  const direct = normalizeHeroId(raw);
  if (direct) return direct;

  const candidates = [
    window.ActiveHeroId,
    window.Team?.getActiveHeroId?.(),
    window.GameScene?.activeHeroId,
    window.Player?.activeHeroId,
    window.CurrentHeroId,
    HeroState?.id,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeHeroId(candidate);
    if (normalized) return normalized;
  }

  return null;
}

function interpolate(template, vars = {}) {
  if (typeof template !== 'string') return template;
  return template.replace(/\{(\w+)\}/g, (_, token) => {
    if (Object.prototype.hasOwnProperty.call(vars, token)) {
      const value = vars[token];
      return value == null ? '' : String(value);
    }
    return `{${token}}`;
  });
}

function formatNumberLocale(value) {
  if (value == null || value === '—') return '—';
  if (typeof i18n?.format?.number === 'function') {
    try {
      return i18n.format.number(Number(value));
    } catch {
      return String(value);
    }
  }
  if (Number.isFinite(Number(value))) return String(Number(value));
  return String(value);
}

function translateLog(key, vars) {
  if (i18n && typeof i18n.t === 'function') {
    try {
      const result = i18n.t(key, vars);
      if (result && result !== key) return result;
    } catch {}
  }
  const fallback = LOG_FALLBACKS[key];
  if (fallback) return interpolate(fallback, vars);
  return key;
}

function resolveMobName(raw) {
  if (!raw && raw !== 0) return 'Mob ?';
  const value = String(raw).trim();
  if (!value) return 'Mob ?';
  if (/mob\s+/i.test(value)) return value;
  return `Mob ${value}`;
}

// … (helpers já definidos acima: normalizeHeroId, resolveHeroId, etc.)

onMessage('hero_hp', (msg) => {
  // Só mexe na HUD se o dano for do MEU herói ativo local
  const myId   = resolveHeroId(); // pega do estado local (ActiveHeroId/Team/HeroState)
  const target = normalizeHeroId(msg.heroId ?? msg.id ?? msg.targetHeroId);

  if (!myId || !target || myId !== target) {
    // Ignora updates de HP de outros jogadores/heróis
    return;
  }

  if (window.HUD_ApplyHeroHpUpdate) {
    window.HUD_ApplyHeroHpUpdate(myId, Number(msg.hp), Number(msg.maxHp));
  }

  // Loga o dano só quando for comigo (mantém seu chat limpo)
  const mobName = resolveMobName(msg.byMob ?? msg.instanceId);
  const amount  = formatNumberLocale(msg.dmg);
  const current = formatNumberLocale(msg.hp);
  const max     = formatNumberLocale(msg.maxHp);
  const line    = translateLog('chat.logMobHitYou', { mob: mobName, amount, current, max });
  if (window.Chat?.pushLog) window.Chat.pushLog(line); else console.log('[LOG]', line);
});


// Respawn -> força refresh HUD imediato
onMessage('hero_respawn', (msg) => {
  if (window.HUD_ApplyHeroHpUpdate) {
    const hid = resolveHeroId(msg.heroId ?? msg.id ?? msg.targetHeroId);
    if (hid) window.HUD_ApplyHeroHpUpdate(hid, Number(msg.hp), Number(msg.hp));
  }
});

// Log genérico de combate (quando implementarmos no server)
onMessage('combat_log', (m) => {
  let line = '';
  if (m.to) {
    const amount = formatNumberLocale(m.amount);
    const hpAfter = m.hpAfter != null ? formatNumberLocale(m.hpAfter) : '—';
    const max = m.maxHp != null ? formatNumberLocale(m.maxHp) : null;
    const hp = max ? `${hpAfter}/${max}` : hpAfter;
    line = translateLog('chat.logYouHitTarget', {
      amount,
      target: m.to,
      hp,
    });
  } else {
    const mobName = resolveMobName(m.byMob ?? m.instanceId);
    const amount = formatNumberLocale(m.amount);
    const current = formatNumberLocale(m.hpAfter);
    const max = formatNumberLocale(m.maxHp);
    line = translateLog('chat.logMobHitYou', { mob: mobName, amount, current, max });
  }
  if (window.Chat?.pushLog) window.Chat.pushLog(line); else console.log('[LOG]', line);
});

// == NOVO: evento rico dizendo "quem bateu" ==
onMessage('hero_hit', (msg) => {
  // Atualiza HUD de HP do herói
  if (window.HUD_ApplyHeroHpUpdate) {
    const hid = resolveHeroId(msg.heroId ?? msg.id ?? msg.targetHeroId);
    if (hid) {
      const cur = Number(msg.hp);
      const max = Number(msg.hpMax ?? msg.maxHp ?? msg.hp_max ?? msg.maxhp);
      window.HUD_ApplyHeroHpUpdate(hid, cur, max);
    }
  }

  // Nome do bicho que bateu (cai em chaves até achar algo útil)
  const mobName =
    msg?.monster?.name ||
    msg?.monster?.key ||
    msg?.monsterKey ||
    `Mob ${msg?.monster?.id ?? msg?.instanceId ?? '?'}`;

  const amount = Number(msg.dmg ?? msg.amount ?? 0);
  const currentHp = msg.hp != null ? formatNumberLocale(msg.hp) : '—';
  const maxHp = msg.hpMax ?? msg.maxHp ?? msg.hp_max ?? msg.maxhp;
  const maxHpFormatted = maxHp != null ? formatNumberLocale(maxHp) : '—';

  // Log de combate
  const line = translateLog('chat.logMobHitYou', {
    mob: mobName,
    amount: formatNumberLocale(amount),
    current: currentHp,
    max: maxHpFormatted,
  });
  if (window.Chat?.pushLog) window.Chat.pushLog(line); else console.log('[LOG]', line);

  // Dano flutuante acima do herói atingido
  if (window.HeroDamageUI) {
    const spawn = typeof window.HeroDamageUI.spawn === 'function' ? window.HeroDamageUI.spawn : null;
    const spawnAtHero = typeof window.HeroDamageUI.spawnAtHero === 'function' ? window.HeroDamageUI.spawnAtHero : null;

    let hx = null;
    let hy = null;
    const heroPos = getHeroWorldPosition(msg.heroId);
    if (heroPos) { hx = heroPos.x; hy = heroPos.y; }

    if ((!Number.isFinite(hx) || !Number.isFinite(hy)) && window.GameScene?.controller?.getPosition) {
      const p = window.GameScene.controller.getPosition();
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) { hx = p.x; hy = p.y; }
    }

    if (Number.isFinite(hx) && Number.isFinite(hy) && spawn) {
      spawn({ x: hx, y: hy, amount, kind: 'from_mob' });
    } else if (spawnAtHero) {
      spawnAtHero(amount, 'from_mob', msg.heroId);
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
window.GameScene.playerVis = playerVis;

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
const SERVER_MONSTER_STATE = new Map(); // id -> { sprite, x, y, spawnId, monsterKey, mapKey, dead, renderX, renderY, animSpeedMultiplier, isMoving, blockedTiles, lastServerAt }
const UNBOUND_SERVER_MONSTERS = new Set(); // ids aguardando sprite
const MONSTER_BLOCKED_TILES = new Map(); // "cx,cy" -> Set(instanceId)
const HERO_BLOCK_STATE = { tiles: new Set(), lastX: null, lastY: null };
let _serverMonsterRetryScheduled = false;

const SERVER_MONSTER_STEP_MS = 350;
const SERVER_MONSTER_MIN_TWEEN_MS = 180;
const SERVER_MONSTER_MAX_TWEEN_MS = 520;
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
      blockedTiles: new Set(),
      lastServerAt: null,
      face: 'south',
      action: 'idle',
      actionUntil: null,
      meta: null,
    };
    SERVER_MONSTER_STATE.set(key, state);
  }
  return state;
}

function resolveServerMoveSnapshot(move, now = performance.now()) {
  if (!move || !Number.isFinite(move.startAt)) return null;
  const totalDuration = Number.isFinite(move.totalDuration)
    ? move.totalDuration
    : (Number.isFinite(move.duration) ? move.duration : 0);
  if (totalDuration <= 0) {
    return {
      x: Number.isFinite(move.toX) ? move.toX : move.fromX,
      y: Number.isFinite(move.toY) ? move.toY : move.fromY,
      face: move.finalFace || move.face || move.initialFace || null,
      done: true,
    };
  }

  const elapsed = now - move.startAt;
  const segments = Array.isArray(move.segments) ? move.segments : null;
  if (!segments || !segments.length) {
    const ratio = Math.max(0, Math.min(1, elapsed / totalDuration));
    return {
      x: move.fromX + (move.toX - move.fromX) * ratio,
      y: move.fromY + (move.toY - move.fromY) * ratio,
      face: ratio >= 1 ? (move.finalFace || move.face || null) : (move.face || move.initialFace || null),
      done: ratio >= 1,
    };
  }

  let accumulated = 0;
  let lastFace = move.initialFace || move.face || null;
  const totalSegments = segments.reduce((sum, seg) => sum + Math.max(0, Number(seg.duration)), 0);
  const limit = totalSegments > 0 ? totalSegments : totalDuration;
  const clampedElapsed = Math.max(0, Math.min(elapsed, limit));

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const segDur = Math.max(0, Number(seg.duration));
    const segStart = accumulated;
    const segEnd = segStart + segDur;

    if (clampedElapsed < segEnd || i === segments.length - 1) {
      const segElapsed = Math.max(0, Math.min(segDur, clampedElapsed - segStart));
      const segRatio = segDur > 0 ? segElapsed / segDur : 1;
      const x = seg.fromX + (seg.toX - seg.fromX) * segRatio;
      const y = seg.fromY + (seg.toY - seg.fromY) * segRatio;
      const activeFace = seg.face || lastFace;
      const finished = elapsed >= limit && i === segments.length - 1 && segRatio >= 1;
      return {
        x,
        y,
        face: finished ? (move.finalFace || activeFace || null) : (activeFace || null),
        done: finished,
      };
    }

    accumulated = segEnd;
    if (seg.face) lastFace = seg.face;
  }

  const finalSeg = segments[segments.length - 1];
  return {
    x: finalSeg ? finalSeg.toX : move.toX,
    y: finalSeg ? finalSeg.toY : move.toY,
    face: move.finalFace || lastFace || null,
    done: true,
  };
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

  const snap = resolveServerMoveSnapshot(mv, now);
  if (!snap) {
    return {
      x: Number.isFinite(sprite.x) ? sprite.x : NaN,
      y: Number.isFinite(sprite.y) ? sprite.y : NaN,
    };
  }
  return { x: snap.x, y: snap.y };
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

function clearHeroBlocking() {
  if (!HERO_BLOCK_STATE || !HERO_BLOCK_STATE.tiles) return;
  if (!HERO_BLOCK_STATE.tiles.size) return;
  HERO_BLOCK_STATE.tiles.clear();
  HERO_BLOCK_STATE.lastX = null;
  HERO_BLOCK_STATE.lastY = null;
}

function heroSpriteMeta() {
  const frameW = Number.isFinite(playerVis?.w) && playerVis.w > 0 ? playerVis.w : TILE;
  const frameH = Number.isFinite(playerVis?.h) && playerVis.h > 0 ? playerVis.h : TILE;
  let anchorX = Number.isFinite(playerVis?.anchorX) ? playerVis.anchorX : 0.5;
  let anchorY = Number.isFinite(playerVis?.anchorY) ? playerVis.anchorY : 0.9;
  anchorX = Math.max(0, Math.min(1, anchorX));
  anchorY = Math.max(0, Math.min(1, anchorY));
  return { frameW, frameH, anchorX, anchorY };
}

function heroFootboxTiles(px, py) {
  if (!Number.isFinite(px) || !Number.isFinite(py)) return [];
  if (!featureMovement()) {
    const cx = legacyToTile(px);
    const cy = legacyToTile(py);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return [];
    return [monsterTileKey(cx, cy)];
  }
  const collider = footColliderPx(px, py);
  const minCx = toTile(collider.x);
  const maxCx = toTile(collider.x + collider.w - 0.0001);
  const minCy = toTile(collider.y);
  const maxCy = toTile(collider.y + collider.h - 0.0001);
  const tiles = [];
  for (let ty = minCy; ty <= maxCy; ty++) {
    for (let tx = minCx; tx <= maxCx; tx++) {
      tiles.push(monsterTileKey(tx, ty));
    }
  }
  return tiles;
}

function updateHeroBlocking(px, py) {
  if (!HERO_BLOCK_STATE || !HERO_BLOCK_STATE.tiles) return;
  if (!Number.isFinite(px) || !Number.isFinite(py)) {
    clearHeroBlocking();
    return;
  }

  const lastX = HERO_BLOCK_STATE.lastX;
  const lastY = HERO_BLOCK_STATE.lastY;
  if (Number.isFinite(lastX) && Number.isFinite(lastY)) {
    const dx = Math.abs(px - lastX);
    const dy = Math.abs(py - lastY);
    if (dx < 0.1 && dy < 0.1) return;
  }

  const nextKeys = new Set(heroFootboxTiles(px, py));
  const current = HERO_BLOCK_STATE.tiles;

  let changed = false;
  const removals = [];
  for (const key of current) {
    if (!nextKeys.has(key)) removals.push(key);
  }
  for (const key of removals) {
    current.delete(key);
    changed = true;
  }

  for (const key of nextKeys) {
    if (!current.has(key)) {
      current.add(key);
      changed = true;
    }
  }

  HERO_BLOCK_STATE.lastX = px;
  HERO_BLOCK_STATE.lastY = py;
  if (!changed) return;
}

function removeMonsterFromTile(state) {
  if (!state) return;
  if (!state.blockedTiles) state.blockedTiles = new Set();
  if (state.blockedTiles.size === 0) return;
  for (const key of state.blockedTiles) {
    const set = MONSTER_BLOCKED_TILES.get(key);
    if (!set) continue;
    set.delete(state.id);
    if (!set.size) MONSTER_BLOCKED_TILES.delete(key);
  }
  state.blockedTiles.clear();
}

function updateMonsterBlocking(state, worldX, worldY) {
  if (!state) return;
  if (!state.blockedTiles) state.blockedTiles = new Set();
  removeMonsterFromTile(state);

  const sprite = state.sprite || null;
  const metaCandidate = sprite?.meta || state.meta || (state.monsterKey ? findMetaFor(state.monsterKey) : null) || null;
  if (metaCandidate && !state.meta) state.meta = metaCandidate;
  if (sprite && metaCandidate && !sprite.meta) sprite.meta = metaCandidate;

  const px = Number.isFinite(worldX)
    ? worldX
    : (Number.isFinite(state.x)
        ? state.x
        : (Number.isFinite(sprite?.x) ? sprite.x : NaN));
  const py = Number.isFinite(worldY)
    ? worldY
    : (Number.isFinite(state.y)
        ? state.y
        : (Number.isFinite(sprite?.y) ? sprite.y : NaN));
  if (!Number.isFinite(px) || !Number.isFinite(py)) return;

  const cx = tileCoord(px);
  const cy = tileCoord(py);

  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;

  const key = monsterTileKey(cx, cy);
  let set = MONSTER_BLOCKED_TILES.get(key);
  if (!set) {
    set = new Set();
    MONSTER_BLOCKED_TILES.set(key, set);
  }
  set.add(state.id);
  state.blockedTiles.add(key);
}

function clearMonsterBlocking(id) {
  const state = SERVER_MONSTER_STATE.get(String(id));
  if (!state) return;
  removeMonsterFromTile(state);
}

function isTileBlockedByMonster(cx, cy, opts = {}) {
  const ignoreHero = !!(opts && typeof opts === 'object' && opts.ignoreHero);
  const key = monsterTileKey(cx, cy);
  if (!ignoreHero && HERO_BLOCK_STATE?.tiles?.has?.(key)) return true;
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
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  const dist = Math.hypot(dx, dy);

  let segments = null;
  let tweenDur = computeTweenDuration(dx, dy);
  let baseTweenDur = tweenDur;

  if (!forceTeleport && absDx >= 1 && absDy >= 1) {
    const horizontalFirst = absDx >= absDy;
    const segs = [];
    const stepDurX = absDx >= 1 ? computeTweenDuration(dx, 0) : 0;
    const stepDurY = absDy >= 1 ? computeTweenDuration(0, dy) : 0;
    const faceX = dx > 0 ? 'east' : 'west';
    const faceY = dy > 0 ? 'south' : 'north';

    if (horizontalFirst) {
      if (absDx >= 1) {
        segs.push({
          fromX: prevX,
          fromY: prevY,
          toX: x,
          toY: prevY,
          duration: stepDurX,
          face: faceX,
        });
      }
      if (absDy >= 1) {
        segs.push({
          fromX: x,
          fromY: prevY,
          toX: x,
          toY: y,
          duration: stepDurY,
          face: faceY,
        });
      }
    } else {
      if (absDy >= 1) {
        segs.push({
          fromX: prevX,
          fromY: prevY,
          toX: prevX,
          toY: y,
          duration: stepDurY,
          face: faceY,
        });
      }
      if (absDx >= 1) {
        segs.push({
          fromX: prevX,
          fromY: y,
          toX: x,
          toY: y,
          duration: stepDurX,
          face: faceX,
        });
      }
    }

    const segTotal = segs.reduce((sum, seg) => sum + Math.max(0, Number(seg.duration)), 0);
    if (segs.length && segTotal > 0) {
      segments = segs;
      baseTweenDur = segTotal;
      tweenDur = baseTweenDur;
    }
  }

  const prevServerAt = Number.isFinite(state.lastServerAt) ? state.lastServerAt : null;
  const serverDelta = (prevServerAt != null) ? Math.max(30, now - prevServerAt) : null;
  if (serverDelta != null && Number.isFinite(serverDelta)) {
    const cap = Math.max(SERVER_MONSTER_MIN_TWEEN_MS, Math.min(SERVER_MONSTER_MAX_TWEEN_MS, serverDelta * 0.92));
    if (tweenDur > cap) tweenDur = cap;
  }

  if (segments && tweenDur !== baseTweenDur) {
    const scale = tweenDur / Math.max(1, baseTweenDur);
    segments = segments.map(seg => ({
      fromX: seg.fromX,
      fromY: seg.fromY,
      toX: seg.toX,
      toY: seg.toY,
      face: seg.face,
      duration: Math.max(1, Number(seg.duration) * scale),
    }));
    tweenDur = segments.reduce((sum, seg) => sum + seg.duration, 0);
  }

  if (segments && segments.length && typeof options.face === 'string' && options.face) {
    segments = segments.map(seg => ({
      fromX: seg.fromX,
      fromY: seg.fromY,
      toX: seg.toX,
      toY: seg.toY,
      duration: seg.duration,
      face: options.face,
    }));
  }

  const movementAmount = segments ? (absDx + absDy) : dist;
  const shouldTeleport = forceTeleport || !Number.isFinite(movementAmount) || movementAmount < 1;

  let animMultiplier = SERVER_MONSTER_IDLE_ANIM;
  let isMoving = false;
  let face = (typeof options.face === 'string' && options.face) || state.face || (sprite?.face) || 'south';
  const travelForSpeed = movementAmount;
  if (!shouldTeleport && tweenDur > 0 && movementAmount >= 1) {
    const pxPerSec = travelForSpeed / (tweenDur / 1000);
    if (Number.isFinite(pxPerSec) && SERVER_MONSTER_BASE_SPEED > 0) {
      const ratio = pxPerSec / SERVER_MONSTER_BASE_SPEED;
      const clamped = Math.max(SERVER_MONSTER_MIN_ANIM, Math.min(SERVER_MONSTER_MAX_ANIM, ratio));
      animMultiplier = Number.isFinite(clamped) ? clamped : SERVER_MONSTER_IDLE_ANIM;
    } else {
      animMultiplier = 1;
    }
    isMoving = true;
    if (!segments) {
      face = updateSpriteFacingFromDelta(sprite, dx, dy, face);
    }
  } else if (sprite && face) {
    sprite.face = face;
  }

  const finalFace = segments && segments.length ? (segments[segments.length - 1].face || face) : face;
  const initialFace = segments && segments.length ? (segments[0].face || finalFace) : finalFace;

  state.x = x;
  state.y = y;
  state.dead = false;
  state.animSpeedMultiplier = isMoving ? animMultiplier : SERVER_MONSTER_IDLE_ANIM;
  state.face = finalFace;

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
      setMonsterAction(state, sprite, 'idle', { face: finalFace });
      state.renderX = x;
      state.renderY = y;
    } else {
      const fromX = prevX;
      const fromY = prevY;
      setMonsterAction(state, sprite, 'walk', { face: finalFace, until: now + tweenDur });
      sprite._serverMove = {
        fromX,
        fromY,
        toX: x,
        toY: y,
        startAt: now,
        duration: tweenDur,
        totalDuration: tweenDur,
        segments: segments || null,
        finalFace,
        initialFace,
      };
      sprite.x = fromX;
      sprite.y = fromY;
      state.renderX = fromX;
      state.renderY = fromY;
      if (segments && segments.length && initialFace) {
        sprite.face = initialFace;
      }
    }
  } else {
    state.sprite = null;
    state.renderX = x;
    state.renderY = y;
    if (isMoving) {
      setMonsterAction(state, null, 'walk', { face: finalFace, until: now + tweenDur });
    } else {
      setMonsterAction(state, null, 'idle', { face: finalFace });
    }
  }

  updateMonsterBlocking(state, x, y);
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
      const snap = resolveServerMoveSnapshot(mv, now);
      if (snap) {
        if (Number.isFinite(snap.x)) sprite.x = snap.x;
        if (Number.isFinite(snap.y)) sprite.y = snap.y;
        state.renderX = Number.isFinite(sprite.x) ? sprite.x : state.renderX;
        state.renderY = Number.isFinite(sprite.y) ? sprite.y : state.renderY;
        if (snap.face) {
          sprite.face = snap.face;
          state.face = snap.face;
        }

        if (snap.done) {
          sprite._serverMove = null;
          if (!Number.isFinite(state.animSpeedMultiplier) || state.animSpeedMultiplier !== SERVER_MONSTER_IDLE_ANIM) {
            state.animSpeedMultiplier = SERVER_MONSTER_IDLE_ANIM;
          }
          setMonsterAction(state, sprite, 'idle', { face: sprite.face || state.face });
          sprite._animSpeedMultiplier = SERVER_MONSTER_IDLE_ANIM;
        }
      } else {
        sprite._serverMove = null;
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
  const msgFace = (typeof msg.face === 'string' && msg.face) ? msg.face : null;
  const face = msgFace || state.face || sprite?.face || null;
  if (sprite && Number.isFinite(x) && Number.isFinite(y)) {
    applyServerPosition(id, sprite, x, y, { forceTeleport: true, face });
  } else if (Number.isFinite(x) && Number.isFinite(y)) {
    applyServerPosition(id, null, x, y, { forceTeleport: true, face });
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
  const msgFace = (typeof msg.face === 'string' && msg.face) ? msg.face : null;
  const face = msgFace || state.face || sprite?.face || null;
  if (sprite) {
    applyServerPosition(id, sprite, x, y, { face });
    if (sprite.face) state.face = sprite.face;
  } else {
    applyServerPosition(id, null, x, y, { face });
    if (face) state.face = face;
  }
  if (!state.face && face) state.face = face;
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

  const msgFace = (typeof msg.face === 'string' && msg.face) ? msg.face : null;
  const monsterFace = (typeof msg.monster?.face === 'string' && msg.monster.face) ? msg.monster.face : null;
  let face = monsterFace || msgFace || sprite?.face || state.face || 'south';
  if (heroPos && Number.isFinite(mx) && Number.isFinite(my)) {
    const dx = heroPos.x - mx;
    const dy = heroPos.y - my;
    face = pickFaceFromDelta(dx, dy, face);
  }

  const msgInterval = Number(msg.attackIntervalMs ?? msg.attackMs ?? msg.attack_ms);
  const monsterInterval = Number(msg.monster?.attackIntervalMs ?? msg.monster?.attackInterval ?? msg.monster?.attack_ms);
  let attackDuration = Number.isFinite(msgInterval) && msgInterval > 0
    ? msgInterval
    : Number.isFinite(monsterInterval) && monsterInterval > 0
      ? monsterInterval
      : 520;
  attackDuration = Math.max(260, Math.min(attackDuration, 6000));

  setMonsterAction(state, sprite, 'attack', { face, until: now + attackDuration });
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
    face: (typeof msg.face === 'string' && msg.face) ? msg.face : null,
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
window.GameScene.heroBlockedTiles = HERO_BLOCK_STATE.tiles;
window.GameScene.updateHeroBlocking = updateHeroBlocking;
window.GameScene.clearHeroBlocking = clearHeroBlocking;
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
        fps: 4,
        frames: Math.min(4, cols),
        startCol: 0,
        rowByDir: directionalRows || undefined,
        row: baseDirRow,
        loop: true
      },
      idle: (rows >= 1)
        ? {
            fps: 1,
            frames: 1,
            row: baseDirRow,
            loop: false,
            rowByDir: directionalRows || undefined,
            startCol: 0,
          }
        : null,
      dead: (rows >= 2)
        ? {
            fps: 3,
            frames: Math.min(4, cols),
            row: Math.max(0, deadRowIndex),
            loop: false,
            startCol: 0,
          }
        : null,
      attack: (rows >= 10)
        ? {
            fps: 6,
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

/* ========================= Loot / Corpses ======================== */
const loots = new Map(); // id -> { id, mapKey, tileX, tileY, x, y, itemKey, amount }
const corpses = new Map(); // id -> { id, mapKey, tileX, tileY, posX, posY, ownerPlayerId, ownerHeroId, isEmpty }
window.GameScene.loots = loots;
window.GameScene.corpses = corpses;

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
    const anchorX = Number.isFinite(playerVis.anchorX) ? playerVis.anchorX : 0.5;
    const anchorY = Number.isFinite(playerVis.anchorY) ? playerVis.anchorY : 0.9;
    const ox = Math.round(p.x - playerVis.w * anchorX);
    const oy = Math.round(p.y - playerVis.h * anchorY);
    ctx.drawImage(playerVis.img, ox, oy, playerVis.w, playerVis.h);
  } else {
    ctx.save();
    ctx.fillStyle = "#f59e0b";
    const size = 32;
    const half = size / 2;
    ctx.fillRect(p.x - half, p.y - half, size, size);
    ctx.restore();
  }
}

function drawOtherPlayer(player) {
  if (!player) return;
  const x = Number(player.x);
  const y = Number(player.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;

  if (imgReady(playerVis.img)) {
    const anchorX = Number.isFinite(playerVis.anchorX) ? playerVis.anchorX : 0.5;
    const anchorY = Number.isFinite(playerVis.anchorY) ? playerVis.anchorY : 0.9;
    const ox = Math.round(x - playerVis.w * anchorX);
    const oy = Math.round(y - playerVis.h * anchorY);

    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.drawImage(playerVis.img, ox, oy, playerVis.w, playerVis.h);
    ctx.restore();
  } else {
    ctx.save();
    ctx.fillStyle = "#38bdf8"; // outro jogador = cor diferente
    const size = 32;
    const half = size / 2;
    ctx.fillRect(x - half, y - half, size, size);
    ctx.restore();
  }

  if (player.name) {
    ctx.save();
    ctx.font = '8px "Press Start 2P", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillText(player.name, x + 1, y - 24 + 1);

    ctx.fillStyle = '#f9fafb';
    ctx.fillText(player.name, x, y - 24);
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
    anim = { fps: 4, frames: cols, row: 0, startCol: 0, loop: true };
    if (animType !== 'dead') animType = 'static';
  }

  if (!Number.isFinite(m._animSpeedMultiplier)) m._animSpeedMultiplier = SERVER_MONSTER_IDLE_ANIM;

  const freezeIdle = animType === 'idle' && !isMoving;
  if (!m.dead && action !== 'dead') m._animFrozen = false;

  let fps = Number(anim.fps);
  if (!Number.isFinite(fps) || fps < 0) fps = 4;
  if (animType === 'walk') {
    const speedMult = Math.max(0, Number(m._animSpeedMultiplier));
    const mult = speedMult > 0 ? Math.max(SERVER_MONSTER_MIN_ANIM, Math.min(SERVER_MONSTER_MAX_ANIM, speedMult)) : 1;
    fps = Math.min(5, Math.max(2, fps * mult));
  } else if (animType === 'idle') {
    fps = Math.min(2, Math.max(1, fps));
  } else if (animType === 'attack') {
    fps = Math.min(6, Math.max(3, fps));
  } else if (animType === 'dead') {
    fps = Math.min(3, Math.max(2, fps));
  } else if (animType === 'static') {
    fps = 0;
  }

  if (freezeIdle) {
    fps = 0;
  }

  let seq = Array.isArray(anim.seq) ? anim.seq.slice() : null;
  let frames = Number(anim.frames);
  let startCol = Number(anim.startCol);
  if (!Number.isFinite(frames) || frames <= 0) frames = cols;
  if (!Number.isFinite(startCol) || startCol < 0) startCol = 0;

  const inheritedRowByDir =
    (!anim.rowByDir && (animType === 'idle' || animType === 'static') && animWalk?.rowByDir)
      ? animWalk.rowByDir
      : null;
  let row = Number(anim.row); if (!Number.isFinite(row)) row = 0;
  const rowByDir = anim.rowByDir || inheritedRowByDir;
  if (rowByDir && rowByDir[face] != null) {
    const r = Number(rowByDir[face]); if (Number.isFinite(r)) row = r;
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
  if (freezeIdle) {
    m._animFrozenFrame = 0;
    f = 0;
  } else if (anim.loop === false) {
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

  const canFlipX = !rowByDir && rows === 1 && face === 'west';

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

/* ================================ Boot ================================ */
(async function main() {
  await getCsrf().catch(() => {});
  await bootAuth();
  console.log('[ws-auth] autenticado, o servidor agora conhece seu player_id');
  await loadSpriteMeta();
  clearHeroBlocking();

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

  const monsterBlockChecker = (cx, cy) => isTileBlockedByMonster(cx, cy, { ignoreHero: true });

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

  if (controller && typeof controller.setPosition === 'function') {
    const originalSetPosition = controller.setPosition.bind(controller);
    controller.setPosition = function patchedSetPosition(x, y) {
      originalSetPosition(x, y);
      if (Number.isFinite(x) && Number.isFinite(y)) updateHeroBlocking(x, y);
    };
  }

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


  function addGroundLootEntry(raw) {
    if (!raw) return;
    const data = raw.item ? raw.item : raw;
    const mapKey = data.mapKey || data.map_key || null;
    if (mapKey && String(mapKey) !== MAP_KEY) return;
    const id = String(data.id);
    const tileX = Number.isFinite(Number(data.tileX ?? data.tile_x)) ? Number(data.tileX ?? data.tile_x) : null;
    const tileY = Number.isFinite(Number(data.tileY ?? data.tile_y)) ? Number(data.tileY ?? data.tile_y) : null;
    const px = Number.isFinite(data.x) ? Number(data.x) : (tileX != null ? tileX * TILE_SIZE + TILE_SIZE / 2 : null);
    const py = Number.isFinite(data.y) ? Number(data.y) : (tileY != null ? tileY * TILE_SIZE + TILE_SIZE / 2 : null);
    const entry = {
      id,
      mapKey: mapKey || MAP_KEY,
      tileX: tileX != null ? tileX : Math.floor((px ?? 0) / TILE_SIZE),
      tileY: tileY != null ? tileY : Math.floor((py ?? 0) / TILE_SIZE),
      x: Number.isFinite(px) ? px : ((tileX ?? 0) * TILE_SIZE + TILE_SIZE / 2),
      y: Number.isFinite(py) ? py : ((tileY ?? 0) * TILE_SIZE + TILE_SIZE / 2),
      itemKey: data.itemKey || data.item_key || (Array.isArray(data.items) && data.items[0]?.key) || null,
      amount: Number(data.amount ?? data.qty ?? (Array.isArray(data.items) ? data.items[0]?.amount ?? data.items[0]?.qty : 1)) || 1,
    };
    loots.set(id, entry);
    try { window.dispatchEvent(new CustomEvent('ground-item:update', { detail: entry })); } catch {}
  }

  function removeGroundLootEntry(raw) {
    const id = raw && raw.itemId ? raw.itemId : raw && raw.id ? raw.id : raw && raw.lootId ? raw.lootId : raw;
    if (id == null) return;
    const key = String(id);
    const prev = loots.get(key) || null;
    loots.delete(key);
    try { window.dispatchEvent(new CustomEvent('ground-item:removed', { detail: { id: key, previous: prev } })); } catch {}
  }

  function registerCorpseEntry(raw) {
    if (!raw) return;
    const data = raw.corpse ? raw.corpse : raw;
    const mapKey = data.mapKey || data.map_key || null;
    if (mapKey && String(mapKey) !== MAP_KEY) return;
    const id = String(data.id);
    const corpse = {
      id,
      mapKey: mapKey || MAP_KEY,
      tileX: Number.isFinite(Number(data.tileX ?? data.tile_x)) ? Number(data.tileX ?? data.tile_x) : null,
      tileY: Number.isFinite(Number(data.tileY ?? data.tile_y)) ? Number(data.tileY ?? data.tile_y) : null,
      posX: Number.isFinite(data.posX) ? Number(data.posX) : Number.isFinite(data.pos_x) ? Number(data.pos_x) : null,
      posY: Number.isFinite(data.posY) ? Number(data.posY) : Number.isFinite(data.pos_y) ? Number(data.pos_y) : null,
      ownerPlayerId: data.ownerPlayerId || data.owner_player_id || null,
      ownerHeroId: data.ownerHeroId || data.owner_hero_id || null,
      expiresAt: data.expiresAt || data.expires_at || null,
      isEmpty: data.isEmpty === true || data.is_fully_looted === true,
    };
    corpses.set(id, corpse);
    try { window.dispatchEvent(new CustomEvent('corpse:spawn', { detail: corpse })); } catch {}
  }

  function updateCorpseEntry(raw) {
    if (!raw) return;
    const id = raw.corpseId || raw.id;
    if (!id) return;
    const key = String(id);
    const corpse = corpses.get(key);
    if (!corpse) return;
    if (raw.isEmpty != null) corpse.isEmpty = !!raw.isEmpty;
    if (raw.ownerPlayerId) corpse.ownerPlayerId = raw.ownerPlayerId;
    if (raw.ownerHeroId) corpse.ownerHeroId = raw.ownerHeroId;
    corpses.set(key, corpse);
    try { window.dispatchEvent(new CustomEvent('corpse:updated', { detail: corpse })); } catch {}
  }

  function removeCorpseEntry(raw) {
    if (!raw) return;
    const id = raw.corpseId || raw.id || raw;
    if (!id) return;
    const key = String(id);
    const prev = corpses.get(key) || null;
    corpses.delete(key);
    try { window.dispatchEvent(new CustomEvent('corpse:removed', { detail: { id: key, corpse: prev } })); } catch {}
  }

  // === WS: loot/corpses ===
  onMessage('ground-item:spawn', (msg) => { addGroundLootEntry(msg); });
  onMessage('ground-item:removed', (msg) => { removeGroundLootEntry(msg); });
  // Legacy support (older servers)
  onMessage('loot_spawned', (msg) => { addGroundLootEntry(msg); });
  onMessage('loot_removed', (msg) => { removeGroundLootEntry(msg); });

  onMessage('corpse:spawn', (msg) => { registerCorpseEntry(msg); });
  onMessage('corpse:updated', (msg) => { updateCorpseEntry(msg); });
  onMessage('corpse:removed', (msg) => { removeCorpseEntry(msg); });

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
    const ctrlInstance = window.GameScene?.controller;
    ctrlInstance?.update?.(dt, null);
    if (ctrlInstance?.getPosition) {
      const pos = ctrlInstance.getPosition();
      if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
        updateHeroBlocking(pos.x, pos.y);
      }
    }

    // Camera
    camera.update(dt);


    // ===== IA dos mobs em passos de 32x32 (DESATIVADA; servidor manda posição) =====
    const hasGrid = !!grid && Number.isFinite(cols) && Number.isFinite(rows);
    const cellOf   = (wx, wy) => ({ cx: tileCoord(wx), cy: tileCoord(wy) });
    const centerOf = (cx, cy) => ({ x: tileCenterPx(cx), y: tileCenterPx(cy) });
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

      // desenha outros jogadores primeiro…
      const others = getOtherPlayersSnapshot();
      for (const p of others) {
        drawOtherPlayer(p);
      }

      // …e por último o próprio player (fica "por cima")
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
const featureMovement = () => typeof window !== 'undefined' && !!window.FEATURE_MOVEMENT_GRID_V1;
const legacyToTile = (px) => Math.floor(px / TILE);
const tileCoord = (px) => (featureMovement() ? toTile(px) : legacyToTile(px));
const tileCenterPx = (t) => (featureMovement() ? tileCenter(t) : t * TILE + TILE / 2);
