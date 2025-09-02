// client/js/combat/attack-controls.js
// ES Module: exporta startAttack/stopAttack e registra os controles
// - Clique esquerdo: seleciona alvo (WS ou mob local) e inicia ataque
// - Clique direito: para o ataque
// - Emite eventos p/ UI: 'combat:attack:start' e 'combat:hit'

const TILE = 32;

// ===== Canvas e Câmera (tolerante à ordem de carregamento) =====
function pickCanvas() {
  return (window.GameScene && window.GameScene.canvas)
      || document.getElementById('scene')
      || document.getElementById('view')
      || document.querySelector('canvas');
}
function pickCamera() {
  return (window.GameScene && window.GameScene.camera) || null;
}

// ===== CSRF / POST helper =====
let CSRF = null;
async function getCsrf() {
  if (CSRF) return CSRF;
  try {
    const r = await fetch('/api/csrf', { credentials: 'include' });
    const h = r.headers.get('x-csrf-token') || r.headers.get('X-CSRF-Token');
    let b = null; try { b = await r.json(); } catch {}
    CSRF = h || b?.token || b?.csrf || b?.csrfToken || b?.csrf_token || null;
  } catch {}
  return CSRF;
}
async function postJSON(url, body) {
  const tok = await getCsrf();
  const headers = { 'Content-Type': 'application/json' };
  if (tok) headers['X-CSRF-Token'] = tok;
  const r = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers,
    referrerPolicy: 'strict-origin-when-cross-origin',
    body: JSON.stringify(body || {})
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} @ ${url}`);
  return r.json();
}

// ===== Estado compartilhado =====
const combatState = (window.combatState = window.combatState || {
  monsters: new Map(),   // id => { id,x,y,monsterKey,hp,hpMax }
  targetId: null,
  attacking: false,
  loopHandle: null,
});

// ===== Util: coordenadas =====
function screenToWorld(canvas, sx, sy) {
  // usa a câmera do play.js (tem suporte a zoom)
  const cam = pickCamera();
  if (cam && typeof cam.screenToWorld === 'function') {
    return cam.screenToWorld(sx, sy);
  }
  // fallback: sem câmera (raríssimo aqui)
  const scaleX = canvas.width / canvas.getBoundingClientRect().width;
  const scaleY = canvas.height / canvas.getBoundingClientRect().height;
  return { x: sx * scaleX, y: sy * scaleY };
}
function getMouseWorld(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  return screenToWorld(canvas, sx, sy);
}

// ===== Seleção de alvo =====
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
  for (const [id, m] of combatState.monsters) {
    if (typeof m.x === 'number' && typeof m.y === 'number') {
      const dx = (m.x || 0) - px, dy = (m.y || 0) - py;
      if ((dx * dx + dy * dy) <= R * R) return m;
    }
  }
  return null;
}
function pickTargetAt(px, py) {
  // 1) Tenta um monstro vindo do WS (se tiver posição)
  const ws = findWsMonsterNear(px, py);
  if (ws) return { id: String(ws.id), x: ws.x, y: ws.y, monsterKey: ws.monsterKey || null };

  // 2) Se os do WS não têm posição, usa o mob local + “cola” o primeiro ID WS
  const local = findClosestLocalMonster(px, py);
  if (!local) return null;
  const first = combatState.monsters.keys().next();
  if (!first.done) return { id: String(first.value), x: local.x, y: local.y, monsterKey: local.monsterKey || null };
  return local;
}

// ===== Loop de ataque =====
async function doHit() {
  if (!combatState.attacking || !combatState.targetId) return;
  try {
    const resp = await postJSON('/api/combat/hit', {
      targetInstanceId: combatState.targetId,
      damage: 5
    });

    // Atualiza cache local (caso o WS não o faça)
    const m = combatState.monsters.get(resp.targetId) || { id: resp.targetId };
    m.hp = resp.hpAfter;
    m.hpMax = Math.max(m.hpMax || 100, resp.hpBefore || 100);
    combatState.monsters.set(resp.targetId, m);

    // Notifica UI
    window.dispatchEvent(new CustomEvent('combat:hit', { detail: resp }));

    if (resp.dead) {
      combatState.attacking = false;
      combatState.targetId = null;
      if (combatState.loopHandle) { clearInterval(combatState.loopHandle); combatState.loopHandle = null; }
    }
  } catch (e) {
    console.warn('[attack] hit failed', e.message);
  }
}
function startLoop() {
  if (combatState.loopHandle) return;
  combatState.loopHandle = setInterval(doHit, 600); // ~1 hit a cada 0,6s
}

// ===== API exportada =====
export async function startAttack(targetId) {
  await postJSON('/api/combat/attack/start', { targetInstanceId: targetId });
  combatState.targetId = String(targetId);
  combatState.attacking = true;

  // evento p/ UI travar alvo sob o cursor (ou manter o atual)
  window.dispatchEvent(new CustomEvent('combat:attack:start'));

  startLoop();
}
export async function stopAttack() {
  combatState.attacking = false;
  combatState.targetId = null;
  if (combatState.loopHandle) { clearInterval(combatState.loopHandle); combatState.loopHandle = null; }
  try { await postJSON('/api/combat/attack/stop', {}); } catch {}
}

// ===== Controles do mouse =====
function attachControls() {
  const canvas = pickCanvas();
  if (!canvas) return;

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
    if (!target) {
      console.log('[attack] no target under cursor');
      return;
    }
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

// Anexa quando o jogo avisar que está pronto (garante câmera/canvas)
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  // pode ser que GameScene já exista
  setTimeout(() => attachControls(), 0);
} else {
  window.addEventListener('DOMContentLoaded', () => attachControls());
}
window.addEventListener('game:ready', () => attachControls());
