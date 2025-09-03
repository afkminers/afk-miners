// client/js/combat/attack-controls.js
// ES Module: exporta startAttack/stopAttack e registra controles de ataque.
// Clique ESQUERDO resolve alvo no servidor e inicia ataque.
// Clique direito/ESC/blur: para o ataque.
// *** HUD DOM removido: overlay novo (render-combat.js) é o único que desenha ***

const TILE = 32;

/* =========================== CSRF / HTTP ============================ */
/** Estratégia CSRF (double-submit cookie): lê token do cookie "csrf".
 *  Semeia com /api/csrf quando necessário e re-tenta uma vez em 403. */
function readCookie(name) {
  const hit = document.cookie.split('; ').find(v => v.startsWith(name + '='));
  return hit ? decodeURIComponent(hit.split('=')[1]) : null;
}
async function seedCsrfCookie() {
  try { await fetch('/api/csrf', { credentials: 'include', cache: 'no-store' }); } catch {}
}
async function getFreshCsrf() {
  let tok = readCookie('csrf');
  if (!tok) { await seedCsrfCookie(); tok = readCookie('csrf'); }
  return tok;
}
// SHIM legado
async function getCsrf() { return getFreshCsrf(); }

async function postJSON(url, body) {
  let tok = await getFreshCsrf();
  if (!tok) throw new Error('csrf-missing');

  const doFetch = async (token) => {
    const u = new URL(url, location.origin);
    u.searchParams.set('csrf', token);
    return fetch(u.toString(), {
      method: 'POST',
      credentials: 'include',
      referrerPolicy: 'strict-origin-when-cross-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': token,
        'X-Requested-With': 'fetch',
      },
      body: JSON.stringify(body || {})
    });
  };

  let r = await doFetch(tok);
  if (r.status === 403) {
    await seedCsrfCookie();
    tok = readCookie('csrf') || tok;
    r = await doFetch(tok);
  }
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} @ ${url}`);
  return r.headers.get('content-length') === '0' ? {} : r.json();
}

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
  return { x: (sx) * scaleX, y: (sy) * scaleY };
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
});

/* ======================= Resolver alvo (servidor) ================== */
/** Retorna { id, x, y, monsterKey, hp, maxHp } ou null */
async function resolveServerTarget(px, py) {
  const map = window.GameScene?.mapKey || 'house';
  try {
    const q = new URLSearchParams({
      map,
      x: String(Math.round(px)),
      y: String(Math.round(py))
    });
    const m = await jget('/api/combat/nearest?' + q.toString());
    if (!m?.id) return null;
    return m;
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
      damage: 10
    });

    // Compatibilidade de formatos
    const id      = String(resp.id || resp.targetId || combatState.targetId);
    const hpNow   = Number(resp.hpAfter ?? resp.hp);
    const hpPrev  = Number(resp.hpBefore ?? (isFinite(hpNow) ? hpNow + Number(resp.dmg || 0) : NaN));
    const hpMax   = Number(resp.maxHp) || Math.max(100, Number(combatState.monsters.get(id)?.hpMax || 100));
    const dmg     = Number(resp.dmg ?? Math.max(0, (isFinite(hpPrev) && isFinite(hpNow)) ? (hpPrev - hpNow) : 0));
    const isDead  = !!resp.dead || hpNow <= 0;

    // Atualiza cache simples
    const m = combatState.monsters.get(id) || { id };
    if (isFinite(hpNow)) m.hp = Math.max(0, hpNow);
    m.hpMax = hpMax;
    combatState.monsters.set(id, m);

    // Notifica UI (overlay cuida dos floaters via WS)
    window.dispatchEvent(new CustomEvent('combat:hit', { detail: { id, dmg, hp: hpNow, maxHp: hpMax, dead: isDead } }));

    if (isDead) stopAttack();
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

  // ajuda o overlay a travar o box no alvo atual
  window.combatState.selectedTargetId = combatState.targetId;
  startLoop();

  window.dispatchEvent(new CustomEvent('combat:attack:start', { detail: { targetId: combatState.targetId } }));
}

export async function stopAttack() {
  combatState.attacking = false;
  combatState.targetId = null;
  window.combatState.selectedTargetId = null;

  if (combatState.loopHandle) { clearInterval(combatState.loopHandle); combatState.loopHandle = null; }
  try { await postJSON('/api/combat/attack/stop', {}); } catch {}
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
    const { x, y } = getMouseWorldFromEvent(e, canvas);
    console.log('[attack] click @', Math.round(x), Math.round(y));

    // *** ÚNICA fonte de verdade: servidor ***
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
    catch (err) { console.warn('[attack] start falhou:', err.message); }
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
  await seedCsrfCookie().catch(()=>{});
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(attachControls, 0);
  } else {
    window.addEventListener('DOMContentLoaded', attachControls);
  }
  window.addEventListener('game:ready', attachControls);
})();
