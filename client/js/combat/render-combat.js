// client/js/combat/render-combat.js
// Conecta WS + overlay de combate (HP bar, target box, floaters)
// Agora desenha SOMENTE a barra do ALVO selecionado (Tibia-like).

const RADIUS_CLICK = 24; // não crítico aqui
let ws = null;

// Estado interno (visível via window.CombatUI.getState())
const state = {
  monsters: new Map(), // id -> { id, key, x, y, hp, maxHp, dead }
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

  let best = null, bestScore = -1;
  const want = normKey(monsterKey || '');

  for (const m of mobs) {
    if (!m) continue;
    if (alreadyClaimed.has(m.id)) continue; // já foi usado
    if (m.hidden || m.dead) continue;

    const keyOk = want ? (normKey(m.kind || m.key) === want) : true;
    const score = keyOk ? 2 : 1; // preferir match de key
    if (score > bestScore) { bestScore = score; best = m; }
  }

  if (!best) return null;
  claimedLocalMobIds.set(monsterId, best.id);
  return { x: best.x, y: best.y };
}

function ensurePosForMonster(m) {
  const xOk = Number.isFinite(m.x) && m.x !== 0;
  const yOk = Number.isFinite(m.y) && m.y !== 0;
  if (xOk && yOk) return m;

  // se o jogo expuser a sprite por id, preferir ela
  const mobById = window.GameScene?.getMobByInstanceId?.(m.id);
  if (mobById && Number.isFinite(mobById.x) && Number.isFinite(mobById.y)) {
    m.x = mobById.x; m.y = mobById.y;
    return m;
  }

  const pos = borrowLocalPosition(m.id, m.key);
  if (pos) { m.x = pos.x; m.y = pos.y; }
  return m;
}

function onWsMessage(e) {
  let msg;
  try { msg = JSON.parse(e.data); } catch { return; }

  if (msg.type === 'monster_respawned') {
    const m = state.monsters.get(msg.id) || { id: msg.id };
    m.key = msg.monsterKey || m.key || 'monster';
    m.dead = false;
    m.hp = Number(msg.hp ?? m.hp ?? 1);
    m.maxHp = Number(msg.maxHp ?? m.maxHp ?? m.hp ?? 1);
    if (Number.isFinite(msg.x)) m.x = Number(msg.x);
    if (Number.isFinite(msg.y)) m.y = Number(msg.y);

    ensurePosForMonster(m);
    state.monsters.set(m.id, m);

    // liberar qualquer binding antigo e reemprestar quando necessário
    claimedLocalMobIds.delete(m.id);

  } else if (msg.type === 'monster_hp') {
    const m = state.monsters.get(msg.id) || { id: msg.id };
    m.key = msg.monsterKey || m.key || 'monster';
    const prevHp = (typeof m.hp === 'number') ? m.hp : null;

    m.dead = false;
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
      m.dead = true;
      state.monsters.set(m.id, m);
      // solta binding para não “reciclar” a mesma sprite
      claimedLocalMobIds.delete(m.id);

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
  if (!m || m.dead) return;
  if (m.hp == null || m.maxHp == null) return;

  // usa posição da sprite se existir
  const mobById = window.GameScene?.getMobByInstanceId?.(m.id);
  const px = Number.isFinite(mobById?.x) ? mobById.x : m.x;
  const py = Number.isFinite(mobById?.y) ? mobById.y : m.y;

  if (!Number.isFinite(px) || !Number.isFinite(py)) return;

  const w = 28, h = 4;
  const x = Math.round(px + 2);
  const y = Math.round(py - 6);

  // fundo
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(x, y, w, h);

  // hp (vermelho tibia-like)
  const pct = Math.max(0, Math.min(1, m.hp / (m.maxHp || 1)));
  const wHp = Math.round(w * pct);
  ctx.fillStyle = '#d11';
  ctx.fillRect(x, y, wHp, h);

  // borda
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
}

function drawTargetBox(ctx, m) {
  if (!m || m.dead) return;

  // idem: segue a sprite se existir
  const mobById = window.GameScene?.getMobByInstanceId?.(m.id);
  const px = Number.isFinite(mobById?.x) ? mobById.x : m.x;
  const py = Number.isFinite(mobById?.y) ? mobById.y : m.y;

  if (!Number.isFinite(px) || !Number.isFinite(py)) return;

  ctx.strokeStyle = 'red';
  ctx.lineWidth = 2;
  ctx.strokeRect(Math.round(px), Math.round(py), 32, 32);
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

  window.CombatUI = {
    render(ctx, camera, dt) {
      const gs = window.GameScene;
      if (!gs) return;

      const targetId =
        window.combatState?.targetId ||
        window.combatState?.selectedTargetId ||
        null;

      const drawOnlyTarget = () => {
        if (targetId) {
          const m = state.monsters.get(String(targetId));
          if (m) {
            drawHpBar(ctx, m);
            drawTargetBox(ctx, m);
          }
        }
      };

      if (gs.camera?.apply) gs.camera.apply(ctx, drawOnlyTarget);
      else drawOnlyTarget();

      updateAndDrawFloaters(ctx, dt * 1000);
      state.lastTs = performance.now();
    },
    getState() {
      // array plana (debug)
      return {
        ts: Date.now(),
        monsters: Array.from(state.monsters.values()).map(m => ({
          id: m.id, key: m.key || 'monster',
          x: m.x ?? 0, y: m.y ?? 0,
          hp: m.hp, maxHp: m.maxHp, dead: !!m.dead
        }))
      };
    }
  };
}
