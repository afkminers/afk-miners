// client/js/combat/render-combat.js
// Conecta WS + overlay de combate (HP bar, target box, floaters)
// Se o servidor mandar x/y=0 ou ausentes, tentamos "emprestar" posição de um mob local.

const RADIUS_CLICK = 24; // usado só p/ debug/hit interno, não é crítico aqui

let ws = null;

// Estado interno (visível via window.CombatUI.getState())
const state = {
  monsters: new Map(), // id -> { id, key, x, y, hp, maxHp }
  floaters: [],
  lastTs: 0
};

// Índice auxiliar para "emprestar" posição local a WS monsters sem x,y
const claimedLocalMobIds = new Map(); // monsterId -> localMobId

function normKey(s) {
  return String(s || '').trim().toLowerCase();
}

// Tenta achar um mob local não-alegado ainda, preferindo o mesmo "monsterKey"
function borrowLocalPosition(monsterId, monsterKey) {
  const mobs = (window.GameScene && window.GameScene.mobs) || [];
  if (!mobs.length) return null;

  // Evitar re-usar o mesmo mob pra vários WS ids
  const alreadyClaimed = new Set(claimedLocalMobIds.values());

  let best = null, bestScore = -1, idx = -1;
  const want = normKey(monsterKey || '');

  for (let i = 0; i < mobs.length; i++) {
    const m = mobs[i];
    if (!m) continue;
    // pule mobs já usados
    if ([...alreadyClaimed].some(id => id === m.id)) continue;

    const keyOk = want ? (normKey(m.kind || m.key) === want) : true;
    const score = keyOk ? 2 : 1; // preferir match de key

    if (score > bestScore) { bestScore = score; best = m; idx = i; }
  }

  if (!best) best = mobs[0];
  if (!best) return null;

  claimedLocalMobIds.set(monsterId, best.id);
  return { x: best.x, y: best.y };
}

function ensurePosForMonster(m) {
  const xOk = Number.isFinite(m.x) && m.x !== 0;
  const yOk = Number.isFinite(m.y) && m.y !== 0;
  if (xOk && yOk) return m;

  const pos = borrowLocalPosition(m.id, m.key);
  if (pos) { m.x = pos.x; m.y = pos.y; }
  return m;
}

function onWsMessage(e) {
  let msg;
  try { msg = JSON.parse(e.data); } catch { return; }

  // mensagens relevantes
  if (msg.type === 'monster_respawned') {
    const m = state.monsters.get(msg.id) || { id: msg.id };
    m.key = msg.monsterKey || m.key || 'monster';
    m.hp = Number(msg.hp ?? m.hp ?? 1);
    m.maxHp = Number(msg.maxHp ?? m.maxHp ?? m.hp ?? 1);
    m.x = (Number.isFinite(msg.x) ? Number(msg.x) : m.x);
    m.y = (Number.isFinite(msg.y) ? Number(msg.y) : m.y);

    ensurePosForMonster(m);
    state.monsters.set(m.id, m);

  } else if (msg.type === 'monster_hp') {
    const m = state.monsters.get(msg.id) || { id: msg.id };
    m.key = msg.monsterKey || m.key || 'monster';
    const prevHp = (typeof m.hp === 'number') ? m.hp : null;

    m.hp = Number(msg.hp ?? m.hp ?? 1);
    m.maxHp = Number(msg.maxHp ?? m.maxHp ?? m.hp ?? 1);
    if (Number.isFinite(msg.x)) m.x = Number(msg.x);
    if (Number.isFinite(msg.y)) m.y = Number(msg.y);

    ensurePosForMonster(m);
    state.monsters.set(m.id, m);

    // floater de dano (opcional)
    const dmg = (typeof msg.dmg === 'number')
      ? msg.dmg
      : (prevHp != null ? Math.max(0, prevHp - m.hp) : 0);
    if (dmg > 0 && Number.isFinite(m.x) && Number.isFinite(m.y)) {
      state.floaters.push({
        x: m.x + 16, y: m.y - 8,
        text: `-${dmg}`, ttl: 900, vy: -0.035
      });
    }

  } else if (msg.type === 'monster_dead') {
    const m = state.monsters.get(msg.id);
    if (m) {
      m.hp = 0;
      state.monsters.set(m.id, m);
      if (Number.isFinite(m.x) && Number.isFinite(m.y) && Number.isFinite(msg.xp)) {
        state.floaters.push({ x: m.x + 16, y: m.y - 8, text: `+${msg.xp}xp`, ttl: 900, vy: -0.035 });
      }
    }
  }
}

function wsUrl() {
  const loc = window.location;
  const proto = loc.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${loc.host}/ws`;
}

function connectCombatWS() {
  try { ws = new WebSocket(wsUrl()); }
  catch (e) { console.warn('[combat] ws open failed:', e?.message); setTimeout(connectCombatWS, 1500); return; }

  ws.onopen = () => console.log('[combat] ws module loaded');
  ws.onclose = () => { setTimeout(connectCombatWS, 1500); };
  ws.onerror = (e) => console.warn('[combat] ws error', e);
  ws.onmessage = onWsMessage;
}

// =================== DRAW HELPERS ===================
function drawHpBar(ctx, m) {
  if (!m || m.hp == null || m.maxHp == null) return;
  if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) return;

  const w = 28, h = 4;
  const x = Math.round(m.x + 2);
  const y = Math.round(m.y - 6);

  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(x, y, w, h);

  const pct = Math.max(0, Math.min(1, m.hp / (m.maxHp || 1)));
  const wHp = Math.round(w * pct);
  ctx.fillStyle = 'lime';
  ctx.fillRect(x, y, wHp, h);

  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
}

function drawTargetBox(ctx) {
  const id = (window.combatState && window.combatState.targetId) || null;
  if (!id) return;
  const m = state.monsters.get(id);
  if (!m || !Number.isFinite(m.x) || !Number.isFinite(m.y)) return;

  ctx.strokeStyle = 'red';
  ctx.lineWidth = 2;
  ctx.strokeRect(Math.round(m.x), Math.round(m.y), 32, 32);
}

function updateAndDrawFloaters(ctx, dtMs) {
  const list = state.floaters;
  for (let i = list.length - 1; i >= 0; i--) {
    const f = list[i];
    f.ttl -= dtMs;
    if (f.ttl <= 0) { list.splice(i, 1); continue; }
    f.y += f.vy * dtMs;

    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,0,0,0.9)';
    ctx.fillText(f.text, Math.round(f.x), Math.round(f.y));
  }
}

// =================== INSTALL ===================
export default function installCombatOverlay() {
  connectCombatWS();

  // Expor hooks de render e inspeção
  window.CombatUI = {
    render(ctx, camera, dt) {
      const gs = window.GameScene;
      if (!gs) return;

      const drawAll = () => {
        for (const m of state.monsters.values()) {
          if (Number.isFinite(m.x) && Number.isFinite(m.y)) drawHpBar(ctx, m);
        }
        drawTargetBox(ctx);
      };

      if (gs.camera?.apply) gs.camera.apply(ctx, drawAll);
      else drawAll();

      updateAndDrawFloaters(ctx, dt * 1000);
      state.lastTs = performance.now();
    },
    getState() {
      // array plana (mais fácil pra debugar no console)
      return {
        ts: Date.now(),
        monsters: Array.from(state.monsters.values()).map(m => ({
          id: m.id, key: m.key || 'monster',
          x: m.x ?? 0, y: m.y ?? 0,
          hp: m.hp, maxHp: m.maxHp
        }))
      };
    }
  };
}
