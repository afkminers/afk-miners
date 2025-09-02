// client/js/combat/attack-controls.js
import { combatState } from './ws-combat.js';

async function fetchCsrf() {
  try {
    const r = await fetch('/api/csrf', { credentials: 'include' });
    const hdr = r.headers.get('x-csrf-token') || r.headers.get('X-CSRF-Token');
    let body = null; try { body = await r.json(); } catch {}
    return hdr || body?.token || body?.csrf || body?.csrfToken || body?.csrf_token || null;
  } catch { return null; }
}

let MY_HERO_ID = null;
async function resolveHeroId() {
  if (MY_HERO_ID) return MY_HERO_ID;
  const r = await fetch('/api/player/me', { credentials: 'include' });
  const me = await r.json();
  const heroes = Array.isArray(me.heroes) ? me.heroes : [];
  const starter = heroes.find(h => h.isStarter === 1 || h.isStarter === true) || heroes[0];
  MY_HERO_ID = starter?.id || starter?.heroId || null;
  return MY_HERO_ID;
}

async function startAttack(heroId, targetInstanceId, weaponType='SWORD') {
  const csrf = await fetchCsrf();
  await fetch('/api/combat/attack/start', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type':'application/json', 'X-CSRF-Token': csrf || '' },
    body: JSON.stringify({ heroId, targetInstanceId, weaponType })
  });
  combatState.selectedTargetId = targetInstanceId;
}

async function stopAttack(heroId) {
  const csrf = await fetchCsrf();
  await fetch('/api/combat/attack/stop', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type':'application/json', 'X-CSRF-Token': csrf || '' },
    body: JSON.stringify({ heroId })
  });
  combatState.selectedTargetId = null;
}

// ---------- seleção por clique “em cima” do monstro ----------
function getWorldFromEvent(ev) {
  const canvas = window.GameScene?.canvas;
  const camera = window.GameScene?.camera;
  if (!canvas || !camera) return null;

  const rect = canvas.getBoundingClientRect();
  const sx = ev.clientX - rect.left;
  const sy = ev.clientY - rect.top;

  const hasScreenToWorld = typeof camera.screenToWorld === 'function';
  if (hasScreenToWorld) return camera.screenToWorld(sx, sy);

  // fallback se não tiver util
  const z = typeof camera.getZoom === 'function' ? (Number(camera.getZoom()) || 1) : 1;
  return { x: camera.x + (sx / z), y: camera.y + (sy / z) };
}

function hitTestMonster(m, wx, wy) {
  // retângulo do monstro 32x32 começando em (m.x, m.y)
  return (wx >= m.x && wx < m.x + 32 && wy >= m.y && wy < m.y + 32);
}

function pickMonsterAt(wx, wy) {
  // dá preferência a quem estiver por último iterado (tanto faz aqui)
  for (const m of combatState.monsters.values()) {
    if (typeof m.x !== 'number' || typeof m.y !== 'number') continue;
    if (hitTestMonster(m, wx, wy)) return m;
  }
  return null;
}

const canvas = window.GameScene?.canvas || document.getElementById('view');
if (canvas) {
  canvas.addEventListener('mousedown', async (ev) => {
    // Botão esquerdo: selecionar e bater
    if (ev.button === 0) {
      const w = getWorldFromEvent(ev);
      if (!w) return;
      const chosen = pickMonsterAt(w.x, w.y);
      if (!chosen) return;

      const heroId = await resolveHeroId();
      if (!heroId) { console.warn('[attack] heroId not found'); return; }
      startAttack(heroId, chosen.id, 'SWORD').catch(err => console.warn('startAttack err:', err?.message));
    }

    // Botão direito: parar
    if (ev.button === 2) {
      const heroId = await resolveHeroId();
      if (!heroId) return;
      stopAttack(heroId).catch(err => console.warn('stopAttack err:', err?.message || err));
    }
  });

  // prevenir menu do botão direito no canvas
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

// Expor helpers (opcional)
window.Attack = { startAttack, stopAttack };

export { startAttack, stopAttack };
