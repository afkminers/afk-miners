// client/js/combat/attack-controls.js
// ES Module: exporta startAttack/stopAttack e registra os controles
// - Clique esquerdo: seleciona alvo (WS ou mob local) e inicia ataque
// - Clique direito: para o ataque
// - Emite eventos p/ UI: 'combat:attack:start' e 'combat:hit'

const TILE = 32;

/* =========================== CSRF / HTTP ============================ */
let CSRF = null;

// regex robusto p/ ler cookie
function readCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g,'\\$1') + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

async function getCsrf() {
  if (CSRF) return CSRF;

  // 1) tenta cookie
  CSRF = readCookie('csrf');

  // 2) garante cookie/headers chamando /api/csrf (alguns servidores devolvem no header/corpo)
  try {
    const r = await fetch('/api/csrf', { credentials: 'include' });
    const hdr = r.headers.get('x-csrf-token') || r.headers.get('X-CSRF-Token');
    let body = null; try { body = await r.clone().json(); } catch {}
    CSRF = hdr || body?.token || body?.csrf || body?.csrfToken || body?.csrf_token || CSRF || readCookie('csrf');
  } catch {
    // fica só com o cookie, se existir
    CSRF = CSRF || readCookie('csrf') || null;
  }

  return CSRF;
}

async function postJSON(url, body) {
  const tok = await getCsrf();
  const headers = { 'Content-Type': 'application/json' };
  // manda nos 2 formatos para compatibilidade
  if (tok) { headers['X-CSRF-Token'] = tok; headers['x-csrf-token'] = tok; }

  const r = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    referrerPolicy: 'strict-origin-when-cross-origin',
    headers,
    body: JSON.stringify(body || {}),
  });
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
  const scaleX = canvas.width / canvas.getBoundingClientRect().width;
  const scaleY = canvas.height / canvas.getBoundingClientRect().height;
  return { x: sx * scaleX, y: sy * scaleY };
}
function getMouseWorld(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  return screenToWorld(canvas, e.clientX - rect.left, e.clientY - rect.top);
}

/* ======================= Estado compartilhado ====================== */
const combatState = (window.combatState = window.combatState || {
  monsters: new Map(),   // id => { id,x,y,monsterKey,hp,hpMax }
  targetId: null,
  attacking: false,
  loopHandle: null,
});

/* ======================= Seleção de alvo ========================== */
function findClosestLocalMonster(px, py) {
  const mobs = (window.GameScene && window.GameScene.mobs) || [];
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

function findWsMonsterNear(px, py) {
  const R = 22;
  for (const [, m] of combatState.monsters) {
    if (typeof m.x === 'number' && typeof m.y === 'number') {
      const dx = (m.x || 0) - px, dy = (m.y || 0) - py;
      if ((dx * dx + dy * dy) <= R * R) return m;
    }
  }
  return null;
}

function pickTargetAt(px, py) {
  // 1) tenta um monstro vindo do WS
  const ws = findWsMonsterNear(px, py);
  if (ws) return { id: String(ws.id), x: ws.x, y: ws.y, monsterKey: ws.monsterKey || null };

  // 2) fallback: mob local + “cola” o primeiro id do WS (se existir)
  const local = findClosestLocalMonster(px, py);
  if (!local) return null;
  const first = combatState.monsters.keys().next();
  if (!first.done) return { id: String(first.value), x: local.x, y: local.y, monsterKey: local.monsterKey || null };
  return local;
}

/* ========================== Loop de ataque ========================= */
async function doHit() {
  if (!combatState.attacking || !combatState.targetId) return;
  try {
    const resp = await postJSON('/api/combat/hit', {
      targetInstanceId: combatState.targetId,
      damage: 5,
    });

    // atualiza cache local (caso o WS ainda não tenha atualizado)
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
  combatState.loopHandle = setInterval(doHit, 600); // ~1 hit/0,6s
}

/* =========================== API exportada ========================= */
export async function startAttack(targetId) {
  await postJSON('/api/combat/attack/start', { targetInstanceId: targetId });
  combatState.targetId = String(targetId);
  combatState.attacking = true;
  window.dispatchEvent(new CustomEvent('combat:attack:start'));
  startLoop();
}
export async function stopAttack() {
  combatState.attacking = false;
  combatState.targetId = null;
  if (combatState.loopHandle) { clearInterval(combatState.loopHandle); combatState.loopHandle = null; }
  try { await postJSON('/api/combat/attack/stop', {}); } catch {}
}

/* ====================== Controles do mouse ========================= */
function attachControls() {
  if (window.__ATTACK_CONTROLS_ATTACHED__) return; // evita duplicar listeners
  window.__ATTACK_CONTROLS_ATTACHED__ = true;

  const canvas = pickCanvas();
  if (!canvas) return;

  // aquece CSRF logo ao anexar
  getCsrf().catch(()=>{});

  // botão direito: parar
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    stopAttack();
  });

  // botão esquerdo: selecionar e iniciar
  canvas.addEventListener('mousedown', async (e) => {
    if (e.button !== 0) return;
    const { x, y } = getMouseWorld(e, canvas);
    const target = pickTargetAt(x, y);
    if (!target) return console.log('[attack] no target under cursor');
    try {
      await startAttack(target.id);
    } catch (err) {
      console.warn('[attack] start failed', err.message);
    }
  });

  // segurança: parar loop em blur/unload
  window.addEventListener('blur', () => stopAttack());
  window.addEventListener('beforeunload', () => stopAttack());

  console.log('[attack] controls ready');
}

/* ====================== Boot (garante ordem) ====================== */
(async () => {
  // aquece o CSRF cedo (gera o cookie se faltar)
  await getCsrf().catch(()=>{});

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(attachControls, 0);
  } else {
    window.addEventListener('DOMContentLoaded', attachControls);
  }
  window.addEventListener('game:ready', attachControls);
})();
