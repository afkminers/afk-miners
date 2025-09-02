// client/js/combat/attack-controls.js
// ES Module: exporta startAttack/stopAttack e registra controles de ataque.
// - Clique esquerdo: resolve alvo (servidor) e inicia ataque
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
  // fallback 1:1
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
  monsters: new Map(),   // id => { id,x,y,monsterKey,hp,hpMax }
  targetId: null,
  targetMeta: null,      // { x, y, monsterKey }
  attacking: false,
  loopHandle: null,
  hudRAF: 0,
});

/* ======================= HUD (DOM) ================================ */
const $hudRoot  = () => document.getElementById('targetHud');
const $hpFill   = () => document.getElementById('hpFill');
const $hpText   = () => document.getElementById('hpText');

function renderTargetHud() {
  const hud = $hudRoot();
  if (!hud) return;
  const tId = combatState.targetId;
  if (!tId || !combatState.targetMeta) { hud.style.display = 'none'; return; }

  const stats = combatState.monsters.get(tId);
  const hpNow = Number(stats?.hp ?? 0);
  const hpMax = Math.max(1, Number(stats?.hpMax ?? 1));
  const pct = Math.max(0, Math.min(1, hpNow / hpMax));

  // posiciona acima do monstro
  const { x, y } = combatState.targetMeta;
  const scr = worldToScreen(x, y);
  hud.style.left = scr.x + 'px';
  hud.style.top  = (scr.y - 22) + 'px';
  hud.style.display = 'block';

  if ($hpFill()) $hpFill().style.width = (pct * 100) + '%';
  if ($hpText()) $hpText().textContent = `${hpNow|0}/${hpMax|0}`;
}
function startHudLoop() {
  const step = () => {
    renderTargetHud();
    combatState.hudRAF = window.requestAnimationFrame(step);
  };
  if (!combatState.hudRAF) combatState.hudRAF = window.requestAnimationFrame(step);
}
function stopHudLoop() {
  if (combatState.hudRAF) { cancelAnimationFrame(combatState.hudRAF); combatState.hudRAF = 0; }
  const hud = $hudRoot(); if (hud) hud.style.display = 'none';
}

/* ============== Dano flutuante (fallback DOM imediato) ============ */
// Se você já for desenhar no canvas (play.js), pode ignorar este fallback.
// Esta versão gera uma DIV que sobe e desaparece.
function spawnFloatDamageDOM(value, wx, wy) {
  const root = document.getElementById('clientShell');
  if (!root) return;
  const p = worldToScreen(wx, wy);
  const el = document.createElement('div');
  el.textContent = `-${value}`;
  el.style.cssText = `
    position:absolute; left:${p.x}px; top:${p.y - 10}px;
    transform:translate(-50%,-50%);
    font:bold 14px monospace; color:#fff; text-shadow:0 1px 2px #000;
    opacity:1; pointer-events:none; z-index:10000;
    transition: transform .8s linear, opacity .8s linear;
  `;
  root.appendChild(el);
  // força layout e anima
  requestAnimationFrame(() => {
    el.style.transform = `translate(-50%,-80px)`;
    el.style.opacity = '0';
  });
  setTimeout(() => el.remove(), 820);
}

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
 * Retorna { id, x, y, monsterKey, hp, maxHp } ou null
 */
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

    // Atualiza stats
    const m = combatState.monsters.get(id) || { id };
    if (isFinite(hpNow)) m.hp = Math.max(0, hpNow);
    m.hpMax = hpMax;
    combatState.monsters.set(id, m);

    // Dano flutuante (fallback DOM; se tiver versão canvas, ela pode interceptar evento abaixo)
    spawnFloatDamageDOM(dmg || 0, combatState.targetMeta?.x ?? 0, combatState.targetMeta?.y ?? 0);
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
  startLoop();
  startHudLoop();
  window.dispatchEvent(new CustomEvent('combat:attack:start', { detail: { targetId: combatState.targetId } }));
}
export async function stopAttack() {
  combatState.attacking = false;
  combatState.targetId = null;
  combatState.targetMeta = null;
  if (combatState.loopHandle) { clearInterval(combatState.loopHandle); combatState.loopHandle = null; }
  stopHudLoop();
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

    // 1) servidor (verdadeiro)
    let m = await resolveServerTarget(x, y);

    // 2) fallback local/WS
    if (!m) {
      const t = pickTargetAt(x, y);
      if (t) m = { id: t.id, x: t.x, y: t.y, monsterKey: t.monsterKey, hp: 0, maxHp: 100 };
    }

    if (!m?.id) { console.log('[attack] nenhum alvo — stop'); stopAttack(); return; }

    // guarda meta + hp inicial na HUD
    combatState.targetMeta = { x: Number(m.x)||0, y: Number(m.y)||0, monsterKey: m.monsterKey||null };
    const stat = combatState.monsters.get(String(m.id)) || { id: String(m.id) };
    stat.hp = Number(m.hp ?? stat.hp ?? 0);
    stat.hpMax = Number(m.maxHp ?? stat.hpMax ?? 100);
    combatState.monsters.set(String(m.id), stat);
    renderTargetHud();

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
