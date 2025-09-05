// client/js/combat/attack-controls.js
// ES Module: exporta startAttack/stopAttack e registra controles de ataque.
// Clique ESQUERDO resolve alvo no servidor e inicia ataque.
// Clique direito/ESC/blur: para o ataque.
// HUD é desenhado só pelo overlay (render-combat.js)

import { apiGet, apiPost, getCsrf } from '../api.js';

const TILE = 32;

/* ==================== Canvas / Câmera helpers ==================== */
function pickCanvas() {
  return (window.GameScene && window.GameScene.canvas)
      || document.getElementById('scene')
      || document.getElementById('view')
      || document.querySelector('canvas');
}
function pickCamera() {
  return (window.GameScene && window.GameScene.camera) || null;
}
function screenToWorld(canvas, sx, sy) {
  const cam = pickCamera();
  if (cam?.screenToWorld) return cam.screenToWorld(sx, sy);
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  return { x: sx * scaleX, y: sy * scaleY };
}
function worldToScreen(wx, wy) {
  const cam = pickCamera();
  if (cam?.worldToScreen) return cam.worldToScreen(wx, wy);
  return { x: Math.round(wx), y: Math.round(wy) };
}
function getMouseWorldFromEvent(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  const cx = (e.clientX ?? (e.touches && e.touches[0]?.clientX)) || 0;
  const cy = (e.clientY ?? (e.touches && e.touches[0]?.clientY)) || 0;
  return screenToWorld(canvas, cx - rect.left, cy - rect.top);
}

/* ======================= Estado compartilhado ====================== */
const combatState = (window.combatState = window.combatState || {
  monsters: new Map(),   // id => { id, hp, hpMax }
  targetId: null,
  attacking: false,
  loopHandle: null,
  selectedTargetId: null,
});

// herói ativo cacheado (obrigatório para atacar)
let ACTIVE_HERO = {
  id: null,
  heroClass: null, // "KNIGHT" | "ARCHER" | "MAGE" | etc
};

// mapeia classe -> arma padrão (ajuste conforme seu balance/config)
function weaponForClass(heroClass) {
  const c = String(heroClass || '').toUpperCase();
  if (c.includes('ARCH') || c === 'ARCHER' || c === 'HUNTER' || c === 'RANGER') return 'BOW';
  if (c.includes('MAGE') || c === 'SORCERER' || c === 'WIZARD' || c === 'DRUID') return 'STAFF';
  return 'SWORD'; // default para Knight/Warrior/qualquer outro
}

async function ensureActiveHero() {
  if (ACTIVE_HERO.id) return ACTIVE_HERO;

  // tenta descobrir pelo /api/player/me (já existe no projeto)
  try {
    const me = await apiGet('/api/player/me');
    const heroes = Array.isArray(me?.heroes) ? me.heroes : [];
    const main = heroes.find(h => h.isStarter === 1 || h.isStarter === true) || heroes[0];

    if (main) {
      ACTIVE_HERO.id = String(main.id ?? main.heroId);
      ACTIVE_HERO.heroClass = String(main.class ?? main.heroClass ?? '').toUpperCase() || null;
    }
  } catch {
    // sem herói => será bloqueado na hora do ataque
  }

  return ACTIVE_HERO;
}

// permite trocar o herói ativo via UI no futuro
export function setActiveHero(heroId, heroClass = null) {
  ACTIVE_HERO.id = heroId ? String(heroId) : null;
  ACTIVE_HERO.heroClass = heroClass ? String(heroClass).toUpperCase() : ACTIVE_HERO.heroClass;
}

/* ======================= Resolver alvo (servidor) ================== */
/** Retorna { id, x, y, monsterKey, hp, maxHp } ou null */
async function resolveServerTarget(px, py) {
  const map = window.GameScene?.mapKey || 'house';
  try {
    const q = new URLSearchParams({
      map,
      x: String(Math.round(px)),
      y: String(Math.round(py)),
    });
    const m = await apiGet('/api/combat/nearest?' + q.toString());
    return m?.id ? m : null;
  } catch {
    return null;
  }
}

/* ========================== Loop de ataque ========================= */
async function doHit() {
  if (!combatState.attacking || !combatState.targetId) return;

  const hero = await ensureActiveHero();
  if (!hero.id) { // sem herói -> aborta e limpa
    stopAttack();
    console.warn('[attack] sem heroId ativo; parei o loop');
    return;
  }

  try {
    const resp = await apiPost('/api/combat/hit', {
      // compat: alguns backends aceitam targetId, outros targetInstanceId
      targetInstanceId: combatState.targetId,
      targetId:         combatState.targetId,
      heroId:           hero.id,
      damage: 10
    });

    const id     = String(resp.id || resp.targetId || combatState.targetId);
    const hpNow  = Number(resp.hpAfter ?? resp.hp);
    const hpPrev = Number(resp.hpBefore ?? (isFinite(hpNow) ? hpNow + Number(resp.dmg || 0) : NaN));
    const hpMax  = Number(resp.maxHp) || Math.max(100, Number(combatState.monsters.get(id)?.hpMax || 100));
    const dmg    = Number(resp.dmg ?? Math.max(0, (isFinite(hpPrev) && isFinite(hpNow)) ? (hpPrev - hpNow) : 0));
    const isDead = !!resp.dead || (isFinite(hpNow) && hpNow <= 0);

    const m = combatState.monsters.get(id) || { id };
    if (isFinite(hpNow)) m.hp = Math.max(0, hpNow);
    m.hpMax = hpMax;
    combatState.monsters.set(id, m);

    window.dispatchEvent(new CustomEvent('combat:hit', {
      detail: { id, dmg, hp: hpNow, maxHp: hpMax, dead: isDead }
    }));

    if (isDead) stopAttack();
  } catch (e) {
    console.warn('[attack] hit failed', e?.message || e);
  }
}
function startLoop() {
  if (combatState.loopHandle) return;
  combatState.loopHandle = setInterval(doHit, 600);
}

/* =========================== API exportada ========================= */
export async function startAttack(targetId) {
  // garante herói ativo antes de iniciar
  const hero = await ensureActiveHero();
  if (!hero.id) {
    alert('Nenhum herói ativo encontrado para atacar.');
    return;
  }

  const weaponType = weaponForClass(hero.heroClass);

  const payload = {
    heroId:            String(hero.id),     // ← OBRIGATÓRIO
    weaponType:        String(weaponType),  // usado p/ alcance/velocidade
    targetInstanceId:  String(targetId),
    targetId:          String(targetId),    // compat com backends
  };

  await apiPost('/api/combat/attack/start', payload);

  combatState.targetId = String(targetId);
  combatState.attacking = true;
  window.combatState.selectedTargetId = combatState.targetId;
  startLoop();

  window.dispatchEvent(new CustomEvent('combat:attack:start', {
    detail: { targetId: combatState.targetId }
  }));
}

export async function stopAttack() {
  const hero = await ensureActiveHero();

  combatState.attacking = false;
  combatState.targetId = null;
  window.combatState.selectedTargetId = null;

  if (combatState.loopHandle) {
    clearInterval(combatState.loopHandle);
    combatState.loopHandle = null;
  }
  try {
    // manda heroId para o backend parar exatamente esse loop
    await apiPost('/api/combat/attack/stop', { heroId: hero?.id || null });
  } catch {}
  window.dispatchEvent(new CustomEvent('combat:attack:stop'));
}

/* ====================== Controles de ponteiro ====================== */
function attachControls() {
  if (window.__ATTACK_CONTROLS_ATTACHED__) return; // evita duplicar
  window.__ATTACK_CONTROLS_ATTACHED__ = true;

  const canvas = pickCanvas();
  if (!canvas) return;

  // parar com botão direito
  canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); stopAttack(); });

  const onPointerDown = async (e) => {
    if (e.button != null && e.button !== 0) return; // só esquerdo

    // garante herói ativo antes de tentar qualquer coisa
    const hero = await ensureActiveHero();
    if (!hero.id) { alert('Nenhum herói ativo encontrado.'); return; }

    const { x, y } = getMouseWorldFromEvent(e, canvas);
    console.log('[attack] click @', Math.round(x), Math.round(y));

    // *** única fonte de verdade: servidor ***
    const m = await resolveServerTarget(x, y);
    if (!m?.id) {
      console.log('[attack] nenhum alvo (server) — stop');
      stopAttack();
      return;
    }

    // cache leve de hp (opcional)
    const stat = combatState.monsters.get(String(m.id)) || { id: String(m.id) };
    if (Number.isFinite(m.hp)) stat.hp = Number(m.hp);
    if (Number.isFinite(m.maxHp)) stat.hpMax = Number(m.maxHp);
    combatState.monsters.set(String(m.id), stat);

    try { await startAttack(String(m.id)); }
    catch (err) { console.warn('[attack] start falhou:', err?.message || err); }
  };

  canvas.addEventListener('mousedown', onPointerDown);
  canvas.addEventListener('touchstart', onPointerDown, { passive: true });

  // para ataque em situações de perda de foco
  window.addEventListener('blur', () => stopAttack());
  window.addEventListener('beforeunload', () => stopAttack());

  console.log('[attack] controls ready');
}

/* ====================== Boot (garante ordem) ====================== */
(async () => {
  // semeia CSRF antes do 1º POST
  await getCsrf().catch(()=>{});
  // já tenta descobrir o herói para evitar o primeiro alerta
  await ensureActiveHero().catch(()=>{});
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(attachControls, 0);
  } else {
    window.addEventListener('DOMContentLoaded', attachControls);
  }
  window.addEventListener('game:ready', attachControls);
})();
