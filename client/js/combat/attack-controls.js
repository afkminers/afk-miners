//client/js/combat/attack-controls.js
import { apiGet, apiPost, getCsrf } from '../api.js';
import { HeroState } from '../state/hero-state.js';
import { showCombatMessage, hideCombatMessage } from '../ui/combat-message.js';



const combatState = (window.combatState = window.combatState || {
  monsters: new Map(),
  targetId: null,
  attacking: false,
  loopHandle: null,
  selectedTargetId: null,

  lastWarningCode: null,
  lastWarningAt: 0,

});

// Check environment flag for RMB attack mode
const ATTACK_USE_RMB = true; // Default to true as per requirements
const RANGE_WARNING_COOLDOWN_MS = 900;
const LOS_WARNING_COOLDOWN_MS = 1200;

function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickCanvas() {
  return (window.GameScene && window.GameScene.canvas)
      || document.getElementById('scene')
      || document.getElementById('view')
      || document.querySelector('canvas');
}
function pickCamera() { return (window.GameScene && window.GameScene.camera) || null; }
function screenToWorld(canvas, sx, sy) {
  const cam = pickCamera();
  if (cam?.screenToWorld) return cam.screenToWorld(sx, sy);
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width/rect.width, scaleY = canvas.height/rect.height;
  return { x: sx*scaleX, y: sy*scaleY };
}
function getMouseWorldFromEvent(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  const cx = (e.clientX ?? (e.touches && e.touches[0]?.clientX)) || 0;
  const cy = (e.clientY ?? (e.touches && e.touches[0]?.clientY)) || 0;
  return screenToWorld(canvas, cx - rect.left, cy - rect.top);
}

/**
 * Local picking function that uses the existing pickMobAtWorld from render-combat.js
 * Returns monster ID if found, null otherwise
 */
function localPickUnderCursor(worldPos) {
  // Try to use the existing pickMobAtWorld function from render-combat.js
  if (window.CombatUI && typeof window.CombatUI.pickMobAtWorld === 'function') {
    return window.CombatUI.pickMobAtWorld(worldPos);
  }
  
  // Fallback: implement basic local picking by iterating through combat state monsters
  if (!window.combatState?.monsters) return null;
  
  const all = Array.from(window.combatState.monsters.values());
  for (const m of all) {
    const s = window.GameScene?.getMobByInstanceId?.(String(m.id));
    if (!s || s.hidden || s.dead) continue;
    
    const meta = s.meta || {};
    const frameW = meta.frame?.width ?? 32;
    const frameH = meta.frame?.height ?? 32;
    const ax = meta.anchor?.x ?? 0.5;
    const ay = meta.anchor?.y ?? 0.9;
    const ox = Math.round(s.x - frameW * ax);
    const oy = Math.round(s.y - frameH * ay);
    
    if (worldPos.x >= ox && worldPos.x <= ox + frameW && 
        worldPos.y >= oy && worldPos.y <= oy + frameH) {
      return m.id;
    }
  }
  return null;
}

let ACTIVE_HERO = { id: null, heroClass: null };
function weaponForClass(heroClass) {
  const c = String(heroClass || '').toUpperCase();
  if (c.includes('ARCH')) return 'BOW';
  if (c.includes('MAGE') || c === 'WIZARD' || c === 'DRUID') return 'STAFF';
  return 'SWORD';
}
async function ensureActiveHero() {
  if (ACTIVE_HERO.id) return ACTIVE_HERO;
  try {
    const me = await apiGet('/api/player/me');

    // >>> NOVO: manter estado global sincronizado (idempotente)
    try { HeroState.setFromServer(me); } catch {}

    const heroes = Array.isArray(me?.heroes) ? me.heroes : [];
    const main = heroes.find(h => h.isStarter === 1 || h.isStarter === true) || heroes[0];
    if (main) {
      ACTIVE_HERO.id = String(main.id ?? main.heroId);
      ACTIVE_HERO.heroClass = String(main.class ?? main.heroClass ?? '').toUpperCase() || null;
    }
  } catch {}
  return ACTIVE_HERO;
}


function emitCombatWarning(code, message) {
  if (!message) return;
  const now = Date.now();
  if (combatState.lastWarningCode === code && now - (combatState.lastWarningAt || 0) < 700) {
    return;
  }
  combatState.lastWarningCode = code;
  combatState.lastWarningAt = now;
  showCombatMessage(message);
}

function clearCombatWarnings() {
  combatState.lastWarningCode = null;
  combatState.lastWarningAt = 0;
  hideCombatMessage();
}

function resolveWarningFromPayload(payload) {
  if (!payload) return null;
  if (Array.isArray(payload.warnings) && payload.warnings.length) {
    const first = payload.warnings.find(w => w && (w.message || w.code)) || payload.warnings[0];
    if (first) {
      return {
        code: String(first.code || payload.error || 'warn'),
        message: first.message || payload.message || null,
      };
    }
  }
  const code = payload.error ? String(payload.error) : null;
  const message = payload.message || null;
  if (!code && !message) return null;
  return { code: code || 'warn', message };
}

function friendlyMessage(code, fallback) {
  const c = String(code || '').toLowerCase();
  if (c === 'out_of_range' || c === 'out-of-range') return fallback || 'Você está longe do alvo.';
  if (c === 'no_los' || c === 'no-los') return fallback || 'Sem linha de visão com o alvo.';
  if (c === 'no-weapon-equipped') return fallback || 'Equipe uma arma para atacar.';
  if (c === 'map-diff') return fallback || 'Alvo está em outro local.';
  if (c === 'hero-dead') return fallback || 'Seu herói está morto.';
  return fallback || null;
}

function handleCombatWarning(payload, opts = {}) {
  const info = resolveWarningFromPayload(payload);
  if (!info) return false;

  const code = info.code || 'warn';
  const message = friendlyMessage(code, info.message);

  const lower = String(code).toLowerCase();
  if (lower === 'map-diff' || lower === 'no-weapon-equipped' || lower === 'hero-not-found' || lower === 'hero-dead') {
    emitCombatWarning(code, message || 'Ação não permitida.');
    stopAttack({ keepWarnings: true });
    return true;
  }

  if (lower === 'out_of_range' || lower === 'out-of-range' || lower === 'no_los' || lower === 'no-los') {
    emitCombatWarning(code, message || 'Ação não permitida.');
    return true;
  }

  if (opts.stopOnFail) {
    emitCombatWarning(code, message || 'Ação não permitida.');
    stopAttack({ keepWarnings: true });
    return true;
  }

  if (message) emitCombatWarning(code, message);
  return true;
}


/** resolve alvo no servidor; retorna { id, x, y, hp, maxHp } ou null */
async function resolveServerTarget(pxClick, pyClick) {
  const map = window.GameScene?.mapKey || 'house';

  // posição atual do player (se disponível)
  let px = null, py = null;
  try {
    const ctrl = window.GameScene?.controller;
    if (ctrl?.getPosition) { const p = ctrl.getPosition(); px = Math.round(p.x); py = Math.round(p.y); }
  } catch {}

  const qs = new URLSearchParams({
    map,
    x: String(Math.round(pxClick)),
    y: String(Math.round(pyClick)),
    ...(px != null && py != null ? { px: String(px), py: String(py) } : {})
  });

  try {
    const m = await apiGet('/api/combat/nearest?' + qs.toString());
    return m?.id ? m : null;
  } catch { return null; }
}

function getHeroWorldPos() {
  try {
    const ctrl = window.GameScene?.controller;
    if (ctrl && typeof ctrl.getPosition === 'function') {
      return ctrl.getPosition();
    }
  } catch {}
  return null;
}

function messageFromWarning(warning, fallback) {
  if (!warning) return fallback;
  if (typeof warning === 'string') return warning;
  if (warning.message) return warning.message;
  return fallback;
}

function hasWarning(resp, code) {
  if (!resp) return false;
  const list = resp.warnings;
  if (!Array.isArray(list)) return false;
  return list.some((w) => (typeof w === 'string' ? w === code : w?.code === code));
}

function extractWarning(resp, code) {
  if (!resp) return null;
  const list = resp.warnings;
  if (!Array.isArray(list)) return null;
  for (const w of list) {
    if (typeof w === 'string') {
      if (w === code) return { code, message: null };
    } else if (w?.code === code) {
      return w;
    }
  }
  return null;
}

function composeRangeMessage(ctx) {
  if (!ctx) return 'Você está longe do alvo.';
  const rangeTiles = safeNumber(ctx?.range?.tiles);
  const distTiles = safeNumber(ctx?.distance?.tiles);
  if (rangeTiles != null && distTiles != null) {
    return `Alvo fora do alcance (${distTiles} > ${rangeTiles} sqm).`;
  }
  const distPx = safeNumber(ctx?.distance?.px);
  const rangePx = safeNumber(ctx?.range?.px);
  if (distPx != null && rangePx != null) {
    return `Alvo fora do alcance (${Math.round(distPx)} > ${Math.round(rangePx)} px).`;
  }
  return 'Alvo fora do alcance.';
}

function pushCombatLog(line) {
  if (!line) return;
  if (window.Chat?.pushLog) {
    window.Chat.pushLog(`[Combate] ${line}`);
  } else {
    console.log('[Combate]', line);
  }
}

function warnRange(resp = {}, opts = {}) {
  const now = Date.now();
  if (now - (combatState.lastRangeWarningAt || 0) < RANGE_WARNING_COOLDOWN_MS) return;
  combatState.lastRangeWarningAt = now;

  const warning = opts.warning || extractWarning(resp, 'out_of_range');
  const baseMsg = messageFromWarning(warning, resp?.message || composeRangeMessage(resp));
  pushCombatLog(baseMsg);

  const heroPos = getHeroWorldPos();
  if (window.CombatRangeHint?.show) {
    window.CombatRangeHint.show(baseMsg, { worldPos: heroPos, duration: 1400, fontSize: 15 });
  }
}

function warnLos(resp = {}, opts = {}) {
  const now = Date.now();
  if (now - (combatState.lastLosWarningAt || 0) < LOS_WARNING_COOLDOWN_MS) return;
  combatState.lastLosWarningAt = now;

  const warning = opts.warning || extractWarning(resp, 'no_los');
  const baseMsg = messageFromWarning(warning, resp?.message || 'Sem linha de visão com o alvo.');
  pushCombatLog(baseMsg);

  const heroPos = getHeroWorldPos();
  if (window.CombatRangeHint?.show) {
    window.CombatRangeHint.show(baseMsg, { worldPos: heroPos, duration: 1400, fontSize: 15 });
  }
}

/** Local sprite picking with robust fallbacks for missing metadata */
function pickMobAtWorld(pt) {
  const K = 64; // default sprite size
  const all = Array.from((window.combatState?.monsters || new Map()).values());
  
  for (const m of all) {
    const s = window.GameScene?.getMobByInstanceId?.(String(m.id));
    if (!s || s.hidden || s.dead) continue;
    
    const meta = s.meta || {};
    // Use meta.frame if available, fallback to s.width/s.height, then default
    let frameW = meta.frame?.width;
    let frameH = meta.frame?.height;
    
    if (!frameW || !frameH) {
      frameW = s.width || K;
      frameH = s.height || K;
    }
    
    const ax = meta.anchor?.x ?? 0.5;
    const ay = meta.anchor?.y ?? 0.9;
    
    const ox = Math.round(s.x - frameW * ax);
    const oy = Math.round(s.y - frameH * ay);
    
    if (pt.x >= ox && pt.x <= ox + frameW && pt.y >= oy && pt.y <= oy + frameH) {
      return m.id;
    }
  }
  return null;
}

async function doHit() {
  if (!combatState.attacking || !combatState.targetId) return;
  const hero = await ensureActiveHero();
  if (!hero.id) { stopAttack(); return; }

  try {
    const resp = await apiPost('/api/combat/hit', {
      targetInstanceId: combatState.targetId,
      targetId:         combatState.targetId,
      heroId:           hero.id,
      damage: 10
    });


    if (!resp?.ok) {
      if (handleCombatWarning(resp)) return;
      return;
    }

    clearCombatWarnings();


    const id     = String(resp.id || resp.targetId || combatState.targetId);
    const hpNow  = Number(resp.hpAfter ?? resp.hp);
    const hpPrev = Number(resp.hpBefore ?? (isFinite(hpNow) ? hpNow + Number(resp.dmg || 0) : 0));
    const hpMax  = Number(resp.maxHp) || Math.max(100, Number(combatState.monsters.get(id)?.hpMax || 100));
    const dmg    = Number(resp.dmg ?? Math.max(0, (isFinite(hpPrev)&&isFinite(hpNow)) ? (hpPrev-hpNow) : 0));
    const dead   = !!resp.dead || (isFinite(hpNow) && hpNow <= 0);

    const m = combatState.monsters.get(id) || { id };
    if (isFinite(hpNow)) m.hp = Math.max(0, hpNow);
    m.hpMax = hpMax;
    combatState.monsters.set(id, m);

    window.dispatchEvent(new CustomEvent('combat:hit', { detail:{ id, dmg, hp:hpNow, maxHp:hpMax, dead } }));
    if (dead) stopAttack();
  } catch (e) {
    const msg = String(e?.message || '');
    console.warn('[attack] hit failed', msg);
    // >>> NOVO: se o servidor disser que o alvo não está vivo/é inválido, cancela o loop
    if (msg.includes('400') || /not alive|invalid target|not found/i.test(msg)) {
      stopAttack();
    }
  }
}

function startLoop(){ if (!combatState.loopHandle) combatState.loopHandle = setInterval(doHit, 600); }

export async function startAttack(targetId) {
  const hero = await ensureActiveHero();
  if (!hero.id) { alert('Nenhum herói ativo encontrado para atacar.'); return; }

  // >>> garante CSRF fresquinho ANTES do POST (evita "CSRF inválido")
  try { await getCsrf(); } catch {}

  const payload = {
    heroId:            String(hero.id),
    weaponType:        String(weaponForClass(hero.heroClass)),
    targetInstanceId:  String(targetId),
    targetId:          String(targetId),
  };

  try {
    const resp = await apiPost('/api/combat/attack/start', payload);
    if (!resp?.ok) {

      if (handleCombatWarning(resp, { stopOnFail: true })) return;
      console.warn('[attack] start recusado:', resp?.error || 'start-rejected');
      return;
    }

    if (Array.isArray(resp.warnings) && resp.warnings.length) {
      handleCombatWarning(resp);
    } else if (resp?.message) {
      handleCombatWarning({ error: 'info', message: resp.message });
    } else {
      clearCombatWarnings();

    }
  } catch (err) { console.warn('[attack] start falhou:', err?.message || err); return; }

  combatState.targetId = String(targetId);
  combatState.attacking = true;
  window.combatState.selectedTargetId = combatState.targetId;
  startLoop();
  window.dispatchEvent(new CustomEvent('combat:attack:start', { detail:{ targetId: combatState.targetId } }));
}

export async function stopAttack(options = {}) {
  const opts = (options && typeof options === 'object') ? options : {};
  const hero = await ensureActiveHero();
  combatState.attacking = false;
  combatState.targetId = null;
  window.combatState.selectedTargetId = null;

  if (!opts.keepWarnings) clearCombatWarnings();

  if (combatState.loopHandle) { clearInterval(combatState.loopHandle); combatState.loopHandle = null; }
  try { await apiPost('/api/combat/attack/stop', { heroId: hero?.id || null }); } catch {}
  window.dispatchEvent(new CustomEvent('combat:attack:stop'));
}

function attachControls() {
  if (window.__ATTACK_CONTROLS_ATTACHED__) return;
  window.__ATTACK_CONTROLS_ATTACHED__ = true;

  const canvas = pickCanvas(); if (!canvas) return;

  // Handle context menu - prevent browser menu but allow our RMB logic
  const suppressContextMenu = (e) => {
    if (!ATTACK_USE_RMB) return;
    const target = e.target;
    if (target === canvas || canvas.contains(target)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  document.addEventListener('contextmenu', suppressContextMenu, true);
  canvas.addEventListener('contextmenu', suppressContextMenu);

  const onPointerDown = async (e) => {
    const hero = await ensureActiveHero(); 
    if (!hero.id) { 
      alert('Nenhum herói ativo encontrado.'); 
      return; 
    }

    // Check if we should use RMB mode
    if (ATTACK_USE_RMB) {
      // Right mouse button (button === 2) starts attack
      if (e.button === 2) {
        const { x, y } = getMouseWorldFromEvent(e, canvas);
        console.log('[attack] RMB click @', Math.round(x), Math.round(y));

        // 1. First try local picking
        const localId = localPickUnderCursor({ x, y });
        if (localId) {
          console.log('[attack] local pick found:', localId);
          const stat = combatState.monsters.get(String(localId)) || { id: String(localId) };
          combatState.monsters.set(String(localId), stat);
          await startAttack(String(localId));
          return;
        }

        // 2. Fallback to server targeting
        console.log('[attack] local pick failed, trying server...');
        const m = await resolveServerTarget(x, y);
        if (!m?.id) { 
          console.log('[attack] no server target - canceling attack'); 
          stopAttack(); 
          return; 
        }

        const stat = combatState.monsters.get(String(m.id)) || { id: String(m.id) };
        if (Number.isFinite(m.hp)) stat.hp = Number(m.hp);
        if (Number.isFinite(m.maxHp)) stat.hpMax = Number(m.maxHp);
        combatState.monsters.set(String(m.id), stat);

        await startAttack(String(m.id));
        return;
      } 
      // Right-click on empty space or other mouse buttons cancel attack
      else if (e.button === 2 || e.button === 0) {
        console.log('[attack] RMB on empty space or left-click - canceling attack');
        stopAttack();
        return;
      }
    } else {
      // Legacy mode: left-click only
      if (e.button != null && e.button !== 0) return;
      
      const { x, y } = getMouseWorldFromEvent(e, canvas);
      console.log('[attack] legacy click @', Math.round(x), Math.round(y));

      const m = await resolveServerTarget(x, y);
      if (!m?.id) { console.log('[attack] nenhum alvo (server) — stop'); stopAttack(); return; }

      const stat = combatState.monsters.get(String(m.id)) || { id: String(m.id) };
      if (Number.isFinite(m.hp)) stat.hp = Number(m.hp);
      if (Number.isFinite(m.maxHp)) stat.hpMax = Number(m.maxHp);
      combatState.monsters.set(String(m.id), stat);

      await startAttack(String(m.id));
    }
  };

  canvas.addEventListener('mousedown', onPointerDown);
  canvas.addEventListener('touchstart', onPointerDown, { passive: true });

  // Add ESC key listener to cancel attacks
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' || e.key === 'Escape') {
      console.log('[attack] ESC pressed - canceling attack');
      stopAttack();
    }
  });

  window.addEventListener('blur', () => stopAttack());
  window.addEventListener('beforeunload', () => stopAttack());

  console.log('[attack] controls ready (RMB mode:', ATTACK_USE_RMB, ')');
}

(async () => {
  await getCsrf().catch(()=>{});
  await ensureActiveHero().catch(()=>{});
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(attachControls, 0);
  } else {
    window.addEventListener('DOMContentLoaded', attachControls);
  }
  window.addEventListener('game:ready', attachControls);
})();
