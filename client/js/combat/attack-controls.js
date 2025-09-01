// client/js/combat/attack-controls.js
// Clique-para-atacar robusto: resolve heroId, lida com overlay no DOM, várias fontes de mobs e ids.
import { combatState } from './ws-combat.js';

const DEBUG_ATTACK = true;

let HERO_ID = null;

/* ========================= CSRF ========================= */
let CSRF_TOKEN = null;
async function fetchCsrf() {
  if (CSRF_TOKEN) return CSRF_TOKEN;
  try {
    const r = await fetch('/api/csrf', { credentials: 'include' });
    const h = r.headers.get('x-csrf-token') || r.headers.get('X-CSRF-Token');
    let b = null;
    try { const j = await r.json(); b = j.token || j.csrf || j.csrfToken || j.csrf_token || null; } catch {}
    CSRF_TOKEN = h || b || null;
  } catch {}
  return CSRF_TOKEN;
}
async function postJson(url, body) {
  const tok = await fetchCsrf();
  const r = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(tok ? { 'X-CSRF-Token': tok } : {}) },
    body: JSON.stringify(body || {}),
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  try { return await r.json(); } catch { return {}; }
}

/* ====================== heroId (cache) ====================== */
function cachedHeroId() {
  if (window.MyHeroId) return String(window.MyHeroId);
  try {
    const v = localStorage.getItem('myHeroId');
    if (v) return String(v);
  } catch {}
  return null;
}
function cacheHeroId(id) {
  HERO_ID = String(id);
  window.MyHeroId = HERO_ID;
  try { localStorage.setItem('myHeroId', HERO_ID); } catch {}
  if (DEBUG_ATTACK) console.log('[attack] cached heroId =', HERO_ID);
}

/* ----------- tenta extrair 1º herói válido de um payload qualquer ----------- */
function pickHeroFrom(any) {
  if (!any) return null;
  const arr =
    Array.isArray(any) ? any :
    Array.isArray(any.heroes) ? any.heroes :
    Array.isArray(any.items) ? any.items :
    Array.isArray(any.data) ? any.data :
    null;
  if (!arr || !arr.length) return null;

  for (const h of arr) {
    const id = h?.id ?? h?.heroId ?? h?.hero_id ?? null;
    if (id) return String(id);
  }
  return null;
}

/* ----------- resolver que tenta várias rotas conhecidas ----------- */
async function resolveHeroId() {
  if (HERO_ID) return HERO_ID;

  const cached = cachedHeroId();
  if (cached) { HERO_ID = cached; return HERO_ID; }

  try {
    const me = await fetch('/api/player/me', { credentials: 'include' }).then(r => r.ok ? r.json() : null);
    if (DEBUG_ATTACK) console.log('[attack] /api/player/me =>', me);
    const heroes = me?.heroes || me?.profile?.heroes || null;
    const picked = pickHeroFrom(heroes ? heroes : (Array.isArray(me) ? me : null));
    if (picked) { cacheHeroId(picked); return HERO_ID; }
  } catch {}

  const candidates = [
    '/api/player/heroes',
    '/api/hero/active',
    '/api/hero/mine',
    '/api/heroes/mine',
    '/api/heroes',
    '/api/characters/mine',
  ];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) continue;
      const j = await res.json().catch(()=>null);
      if (DEBUG_ATTACK) console.log('[attack] try', url, '=>', j);
      const picked = pickHeroFrom(j) || pickHeroFrom(j && j.result) || pickHeroFrom([j]);
      if (picked) { cacheHeroId(picked); return HERO_ID; }
    } catch {}
  }

  if (DEBUG_ATTACK) console.warn('[attack] resolveHeroId: nenhum herói encontrado.');
  HERO_ID = null;
  return null;
}

/* ======================== Picking helpers ======================== */
// pega o canvas principal (ou o que tiver a prop .getContext)
function getCanvas() {
  return window.GameScene?.canvas
      || document.querySelector('canvas')
      || null;
}

// converte clique da página para coords relativas ao canvas e depois para “mundo”
function pageToWorld(clientX, clientY) {
  const canvas = getCanvas();
  const camera = window.GameScene?.camera || {};
  if (!canvas) return null;

  const rect = canvas.getBoundingClientRect();
  const sx = clientX - rect.left;
  const sy = clientY - rect.top;

  if (typeof camera.screenToWorld === 'function') {
    return camera.screenToWorld(sx, sy);
  }
  return { x: sx + (camera.x || 0), y: sy + (camera.y || 0) };
}

function getMobArrays() {
  const GS = window.GameScene || {};
  const lists = [];

  if (Array.isArray(GS.mobs)) lists.push(GS.mobs);
  if (Array.isArray(GS.monsters)) lists.push(GS.monsters);
  if (Array.isArray(GS.entities)) {
    // filtra entidades tipo “mob/monster”
    lists.push(GS.entities.filter(e => {
      const t = String(e.type || e.kind || e.category || '').toLowerCase();
      return t.includes('mob') || t.includes('monster');
    }));
  }
  return lists;
}

function getInstanceId(m) {
  return m?.instanceId ?? m?.instance_id ?? m?.id ?? null;
}

// calcula hitbox com base no sprite, se existir; senão 32x32 com folga
function getHitbox(m) {
  const w = (m?.sprite?.width  ?? m?.w ?? 32);
  const h = (m?.sprite?.height ?? m?.h ?? 32);
  // âncora centro/baixo: expande um pouco para facilitar clique
  const expand = 6;
  const x = (m.x || 0) - Math.floor((w/2)) - expand;
  const y = (m.y || 0) - (h) + 4 - expand;
  const hw = w + expand*2;
  const hh = h + expand*2;
  return { x, y, w: hw, h: hh };
}

function pickMobAt(wx, wy) {
  const lists = getMobArrays();
  for (const arr of lists) {
    for (let i = arr.length - 1; i >= 0; i--) {
      const m = arr[i];
      const id = getInstanceId(m);
      if (!id) continue;
      const hb = getHitbox(m);
      if (wx >= hb.x && wx <= hb.x + hb.w && wy >= hb.y && wy <= hb.y + hb.h) {
        return m;
      }
    }
  }
  return null;
}

/* ======================== Ataque ======================== */
async function startAttack(heroId, targetInstanceId, weaponType = 'SWORD') {
  if (!heroId)           { if (DEBUG_ATTACK) console.warn('[attack] heroId not found'); return; }
  if (!targetInstanceId) { if (DEBUG_ATTACK) console.warn('[attack] targetInstanceId missing'); return; }
  try {
    await postJson('/api/combat/attack/start', { heroId, targetInstanceId, weaponType });
    combatState.selectedTargetId = targetInstanceId;
    if (DEBUG_ATTACK) console.log('[attack] start', { heroId, targetInstanceId, weaponType });
  } catch (e) {
    console.warn('[attack] start failed:', e?.message);
  }
}
async function stopAttack(heroId) {
  if (!heroId) return;
  try {
    await postJson('/api/combat/attack/stop', { heroId });
    combatState.selectedTargetId = null;
    if (DEBUG_ATTACK) console.log('[attack] stop', { heroId });
  } catch (e) {
    console.warn('[attack] stop failed:', e?.message);
  }
}

/* ===================== Listeners ===================== */
function handleDown(ev) {
  // aceita pointer/mouse; extrai clientX/Y de qualquer um
  const clientX = (ev.clientX ?? ev.pageX ?? ev.x);
  const clientY = (ev.clientY ?? ev.pageY ?? ev.y);
  if (ev.button != null && ev.button !== 0) return; // só botão esquerdo

  const p = pageToWorld(clientX, clientY);
  if (!p) return;

  const mob = pickMobAt(p.x, p.y);
  if (!mob) {
    if (DEBUG_ATTACK) console.log('[attack] click no vazio', p);
    return;
  }

  const id = getInstanceId(mob);
  if (!id) return;

  resolveHeroId().then(heroId => {
    if (!heroId) { if (DEBUG_ATTACK) console.warn('[attack] heroId not found'); return; }
    startAttack(heroId, String(id), 'SWORD');
  });
}

function attachListeners() {
  const canvas = getCanvas();
  // 1) no canvas, se existir
  if (canvas) {
    canvas.addEventListener('mousedown', handleDown);
    canvas.addEventListener('pointerdown', handleDown);
  }
  // 2) no documento (cobre casos de overlay por cima do canvas)
  document.addEventListener('mousedown', handleDown, true);
  document.addEventListener('pointerdown', handleDown, true);


  // ESC para parar
  window.addEventListener('keydown', async (e) => {
    if (e.key !== 'Escape') return;
    const heroId = await resolveHeroId();
    if (heroId) stopAttack(heroId);
  });

  if (DEBUG_ATTACK) console.log('[attack] listeners attached');
}

if (document.readyState === 'complete') {
  attachListeners();
} else {
  window.addEventListener('load', attachListeners, { once: true });
  window.addEventListener('game:ready', attachListeners, { once: true });
}

export { startAttack, stopAttack };
