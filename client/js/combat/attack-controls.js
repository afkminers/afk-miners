// client/js/combat/attack-controls.js
// ES Module: exporta startAttack/stopAttack e registra controles de ataque.
// - Clique esquerdo: resolve alvo (servidor primeiro) e inicia ataque
// - Clique direito/ESC/blur: para o ataque

const TILE = 32;

/* =========================== CSRF / HTTP ============================ */
/**
 * Estratégia CSRF: double-submit cookie
 * - Lemos o token SEMPRE do cookie "csrf".
 * - Se não houver cookie, chamamos /api/csrf para semear.
 * - Em 403, resemeamos e tentamos 1x de novo.
 */
function readCookie(name) {
  const hit = document.cookie.split('; ').find(v => v.startsWith(name + '='));
  return hit ? decodeURIComponent(hit.split('=')[1]) : null;
}

async function seedCsrfCookie() {
  try {
    await fetch('/api/csrf', { credentials: 'include', cache: 'no-store' });
  } catch {}
}

async function getFreshCsrf() {
  let tok = readCookie('csrf');
  if (!tok) {
    await seedCsrfCookie();
    tok = readCookie('csrf');
  }
  return tok;
}

// SHIM para código legado que ainda chama getCsrf()
async function getCsrf() { return getFreshCsrf(); }

async function postJSON(url, body) {
  let tok = await getFreshCsrf();
  if (!tok) throw new Error('csrf-missing');

  const doFetch = async (token) => {
    const u = new URL(url, location.origin);
    u.searchParams.set('csrf', token); // alguns middlewares validam também na query
    return fetch(u.toString(), {
      method: 'POST',
      credentials: 'include',
      referrerPolicy: 'strict-origin-when-cross-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': token,        // header único e estável
        'X-Requested-With': 'fetch',
      },
      body: JSON.stringify(body || {})
    });
  };

  let r = await doFetch(tok);
  if (r.status === 403) {
    // token pode ter sido rotacionado — reseed + retry 1x
    await seedCsrfCookie();
    tok = readCookie('csrf') || tok;
    r = await doFetch(tok);
  }

  if (!r.ok) throw new Error(`${r.status} ${r.statusText} @ ${url}`);
  // alguns endpoints podem devolver "{}"
  return r.headers.get('content-length') === '0' ? {} : r.json();
}

// helper GET simples
async function jget(url) {
  const r = await fetch(url, { credentials: 'include', cache: 'no-store' });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} @ ${url}`);
  return r.json();
}

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
function getMouseWorldFromEvent(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  const cx = (e.clientX ?? (e.touches && e.touches[0]?.clientX)) || 0;
  const cy = (e.clientY ?? (e.touches && e.touches[0]?.clientY)) || 0;
  return screenToWorld(canvas, cx - rect.left, cy - rect.top);
}

/* ======================= Estado compartilhado ====================== */
const combatState = (window.combatState = window.combatState || {
  monsters: new Map(),   // id => { id,x,y,monsterKey,hp,hpMax }
  targetId: null,
  attacking: false,
  loopHandle: null,
});

/* ======================= Seleção de alvo ========================== */
// tenta pegar do overlay WS (se ele tiver X/Y)
function findWsMonsterNear(px, py) {
  const R = 28; // px
  try {
    const st = window.CombatUI?.getState?.();
    const list = Array.isArray(st?.monsters) ? st.monsters : [];
    for (const m of list) {
      const x = Number(m.x), y = Number(m.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const dx = x - px, dy = y - py;
      if (dx*dx + dy*dy <= R*R) return { id: String(m.id), x, y, monsterKey: m.key || m.monsterKey || null };
    }
  } catch {}
  return null;
}

// mobs locais renderizados pela cena (sempre têm X/Y)
function findClosestLocalMonster(px, py) {
  const mobs = (window.GameScene && window.GameScene.mobs) || [];
  if (!mobs.length) return null;
  let best = null, bestD = Infinity;
  for (const m of mobs) {
    const dx = (m.x || 0) - px, dy = (m.y || 0) - py;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = m; }
  }
  if (!best) return null;
  if (!best.id) best.id = 'local-' + Math.random().toString(36).slice(2);
  return { id: String(best.id), x: best.x, y: best.y, monsterKey: best.kind || best.key || null };
}

function pickTargetAt(px, py) {
  const ws = findWsMonsterNear(px, py);
  if (ws) return ws;
  return findClosestLocalMonster(px, py);
}

/**
 * Resolve alvo no servidor (fonte da verdade) — ignora (0,0) de WS
 */
async function resolveServerTarget(px, py) {
  const map = window.GameScene?.mapKey || 'house';
  try {
    const q = new URLSearchParams({
      map,
      x: String(Math.round(px)),
      y: String(Math.round(py))
    });
    const resp = await jget('/api/combat/nearest?' + q.toString());
    return resp?.id ? String(resp.id) : null;
  } catch {
    return null;
  }
}

/* ========================== Loop de ataque ========================= */
async function doHit() {
  if (!combatState.attacking || !combatState.targetId) return;
  try {
    const resp = await postJSON('/api/combat/hit', {
      targetInstanceId: combatState.targetId,
      damage: 5
    });
    const m = combatState.monsters.get(resp.targetId) || { id: resp.targetId };
    m.hp = resp.hpAfter;
    m.hpMax = Math.max(m.hpMax || 100, resp.hpBefore || 100);
    combatState.monsters.set(resp.targetId, m);
    window.dispatchEvent(new CustomEvent('combat:hit', { detail: resp }));
    if (resp.dead) stopAttack();
  } catch (e) {
    console.warn('[attack] hit failed', e.message);
  }
}
function startLoop() {
  if (combatState.loopHandle) return;
  combatState.loopHandle = setInterval(doHit, 600);
}

/* =========================== API exportada ========================= */
export async function startAttack(targetId) {
  await postJSON('/api/combat/attack/start', { targetInstanceId: targetId });
  combatState.targetId = String(targetId);
  combatState.attacking = true;
  window.dispatchEvent(new CustomEvent('combat:attack:start', { detail: { targetId: combatState.targetId } }));
  startLoop();
}
export async function stopAttack() {
  combatState.attacking = false;
  combatState.targetId = null;
  if (combatState.loopHandle) { clearInterval(combatState.loopHandle); combatState.loopHandle = null; }
  try { await postJSON('/api/combat/attack/stop', {}); } catch { /* ignora 403/teardown */ }
}

/* ====================== Controles de ponteiro ====================== */
function attachControls() {
  if (window.__ATTACK_CONTROLS_ATTACHED__) return; // evita duplicar
  window.__ATTACK_CONTROLS_ATTACHED__ = true;

  const canvas = pickCanvas();
  if (!canvas) return;

  // parar com botão direito
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    stopAttack();
  });

  const onPointerDown = async (e) => {
    if (e.button != null && e.button !== 0) return; // só esquerdo
    const { x, y } = getMouseWorldFromEvent(e, canvas);
    console.log('[attack] click @', Math.round(x), Math.round(y));

    // 1) resolve alvo no servidor (mais confiável)
    let targetId = await resolveServerTarget(x, y);

    // 2) fallback local/WS se servidor não retornar nada
    if (!targetId) {
      const t = pickTargetAt(x, y);
      targetId = t?.id || null;
    }

    if (!targetId) {
      console.log('[attack] nenhum alvo — stop');
      stopAttack();
      return;
    }
    try {
      await startAttack(targetId);
    } catch (err) {
      console.warn('[attack] start falhou:', err.message);
    }
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
  // aquece o cookie CSRF (não quebra se /api/csrf estiver off)
  await seedCsrfCookie().catch(()=>{});
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(attachControls, 0);
  } else {
    window.addEventListener('DOMContentLoaded', attachControls);
  }
  window.addEventListener('game:ready', attachControls);
})();
