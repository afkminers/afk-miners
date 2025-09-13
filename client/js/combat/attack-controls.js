//client/js/combat/attack-controls.js
import { apiGet, apiPost, getCsrf } from '../api.js';

const combatState = (window.combatState = window.combatState || {
  monsters: new Map(),
  targetId: null,
  attacking: false,
  loopHandle: null,
  selectedTargetId: null,
});

// Check environment flag for RMB attack mode
const ATTACK_USE_RMB = true; // Default to true as per requirements

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
    const heroes = Array.isArray(me?.heroes) ? me.heroes : [];
    const main = heroes.find(h => h.isStarter === 1 || h.isStarter === true) || heroes[0];
    if (main) {
      ACTIVE_HERO.id = String(main.id ?? main.heroId);
      ACTIVE_HERO.heroClass = String(main.class ?? main.heroClass ?? '').toUpperCase() || null;
    }
  } catch {}
  return ACTIVE_HERO;
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
  } catch (e) { console.warn('[attack] hit failed', e?.message || e); }
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
    if (!resp?.ok) { console.warn('[attack] start recusado:', resp?.error || 'start-rejected'); return; }
  } catch (err) { console.warn('[attack] start falhou:', err?.message || err); return; }

  combatState.targetId = String(targetId);
  combatState.attacking = true;
  window.combatState.selectedTargetId = combatState.targetId;
  startLoop();
  window.dispatchEvent(new CustomEvent('combat:attack:start', { detail:{ targetId: combatState.targetId } }));
}

export async function stopAttack() {
  const hero = await ensureActiveHero();
  combatState.attacking = false;
  combatState.targetId = null;
  window.combatState.selectedTargetId = null;
  if (combatState.loopHandle) { clearInterval(combatState.loopHandle); combatState.loopHandle = null; }
  try { await apiPost('/api/combat/attack/stop', { heroId: hero?.id || null }); } catch {}
  window.dispatchEvent(new CustomEvent('combat:attack:stop'));
}

function attachControls() {
  if (window.__ATTACK_CONTROLS_ATTACHED__) return;
  window.__ATTACK_CONTROLS_ATTACHED__ = true;

  const canvas = pickCanvas(); if (!canvas) return;

  // Handle context menu - prevent browser menu but allow our RMB logic
  canvas.addEventListener('contextmenu', (e) => { 
    e.preventDefault(); 
    // Don't stop attack immediately here - let the mousedown handler decide
  });

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
