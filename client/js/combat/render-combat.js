// client/js/combat/render-combat.js
// Overlay único de combate: hp bar, target box e floaters.
// NUNCA "adivinha" posição. Só desenha se houver sprite vinculada via GameScene.

let ws = null;

const state = {
  monsters: new Map(), // id -> { id, key, hp, maxHp, spawnId? }
  floaters: [],
  selectedTargetId: null,
};

// ===== Rebind helper/estado =====
const unbound = new Set(); // ids que ainda não têm sprite vinculada

function ensureSpriteBind(id, key, spawnId) {
  let s = getSpriteFor(id);
  if (s) return s;
  if (spawnId != null) s = bindBySpawn(id, spawnId);
  if (!s && key) s = bindByKey(id, key);
  return s || null;
}

function wsUrl() {
  const loc = window.location;
  const proto = loc.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${loc.host}/ws`;
}

/* ---------------- Floater (dano/xp) ---------------- */
function pushFloaterAtSprite(sprite, text, ttl = 900) {
  if (!sprite) return;

  const meta = sprite.meta || {};
  const frameW = meta.frame?.width ?? 32;
  const frameH = meta.frame?.height ?? 32;
  const ax = meta.anchor?.x ?? 0.5;
  const ay = meta.anchor?.y ?? 0.9;

  // centraliza e sobe um pouco acima da cabeça
  const x = Math.round(sprite.x - frameW * ax + frameW * 0.5);
  const y = Math.round(sprite.y - frameH * ay - 8);

  state.floaters.push({ x, y, text, ttl, vy: -0.035 });
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

/* --------------- Bind helpers (GameScene) --------------- */
function getSpriteFor(id) {
  return window.GameScene?.getMobByInstanceId?.(String(id)) || null;
}

function bindBySpawn(id, spawnId) {
  return window.GameScene?.bindInstanceToSpawn?.(String(id), Number(spawnId)) || null;
}

function bindByKey(id, monsterKey) {
  return window.GameScene?.bindInstanceToAnySpriteByKey?.(String(id), String(monsterKey)) || null;
}

/* --------------- WS handler --------------- */
function onWsMessage(e) {
  let msg;
  try { msg = JSON.parse(e.data); } catch { return; }

  // Propaga toda msg do WS pra quem quiser ouvir (play.js/loot, etc.)
  window.dispatchEvent(new CustomEvent('ws:message', { detail: { msg } }));

  if (msg.type === 'monster_respawned') {
    const id = String(msg.id);
    const key = String(msg.monsterKey || 'monster');
    const maxHp = Number(msg.maxHp ?? msg.hp ?? 1);
    const hp = Number(msg.hp ?? maxHp);
    const spawnId = (msg.spawnId != null) ? Number(msg.spawnId) : null;

    const m = state.monsters.get(id) || { id };
    m.key = key; m.maxHp = maxHp; m.hp = hp; if (spawnId != null) m.spawnId = spawnId;
    state.monsters.set(id, m);

    // (re)vincula sprite se necessário
    const s = ensureSpriteBind(id, key, spawnId);
    if (s) {
      s.dead = false; s.hidden = false; s._animFrozen = false; s._animFrozenFrame = 0;
      unbound.delete(id);
    } else {
      unbound.add(id);
    }

  } else if (msg.type === 'monster_hp') {
    const id = String(msg.id);
    const m = state.monsters.get(id) || { id };
    const prevHp = (typeof m.hp === 'number') ? m.hp : null;

    m.key = String(msg.monsterKey || m.key || 'monster');
    m.maxHp = Number(msg.maxHp ?? m.maxHp ?? msg.hp ?? 1);
    m.hp = Number(msg.hp ?? m.hp ?? m.maxHp);
    state.monsters.set(id, m);

    // floater de dano ancorado na sprite correta
    const s = getSpriteFor(id) || ensureSpriteBind(id, m.key, m.spawnId);
    if (!s) unbound.add(id);

    const dmg = (typeof msg.dmg === 'number')
      ? msg.dmg
      : (prevHp != null ? Math.max(0, prevHp - m.hp) : 0);
    if (dmg > 0 && s) pushFloaterAtSprite(s, `-${dmg}`);

  } else if (msg.type === 'monster_dead') {
    const id = String(msg.id);
    const xp = Number(msg.xp || 0);

    const m = state.monsters.get(id) || { id };
    m.hp = 0;
    state.monsters.set(id, m);

    // congela sprite e mostra xp
    const s = getSpriteFor(id);
    if (s) {
      if (xp > 0) pushFloaterAtSprite(s, `+${xp}xp`, 1100);
      window.GameScene?.onMonsterDead?.(id);
    }

    // remove do overlay p/ não sobrar barra
    setTimeout(() => { state.monsters.delete(id); unbound.delete(id); }, 0);
  }
}

function connectCombatWS() {
  try { ws = new WebSocket(wsUrl()); }
  catch (e) { console.warn('[combat] ws open failed:', e?.message); setTimeout(connectCombatWS, 1500); return; }

  ws.onopen = () => console.log('[combat] ws overlay connected');
  ws.onclose = () => setTimeout(connectCombatWS, 1500);
  ws.onerror = (e) => console.warn('[combat] ws error', e);
  ws.onmessage = onWsMessage;
}

/* ===== Rebind loop ===== */
let rebindTimer = null;
function startRebindLoop() {
  if (rebindTimer) return;
  rebindTimer = setInterval(() => {
    if (!unbound.size) return;
    for (const id of Array.from(unbound)) {
      const m = state.monsters.get(id);
      if (!m || m.hp <= 0) { unbound.delete(id); continue; }
      const s = ensureSpriteBind(m.id, m.key, m.spawnId);
      if (s) {
        s.dead = false; s.hidden = false; s._animFrozen = false; s._animFrozenFrame = 0;
        unbound.delete(id);
      }
    }
  }, 300);
}

/* --------------- Draw helpers (sempre na posição da sprite vinculada) --------------- */
function drawHpBarAtSprite(ctx, sprite, hp, maxHp) {
  if (!sprite) return;

  const meta = sprite.meta || {};
  const frameW = meta.frame?.width ?? 32;
  const frameH = meta.frame?.height ?? 32;
  const ax = meta.anchor?.x ?? 0.5;
  const ay = meta.anchor?.y ?? 0.9;

  const w = frameW - 4;
  const h = 4;
  const x = Math.round(sprite.x - frameW * ax + 2);
  const y = Math.round(sprite.y - frameH * ay - 6);

  // fundo
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(x, y, w, h);

  // barra (verde de HP)
  const pct = Math.max(0, Math.min(1, (maxHp > 0 ? hp / maxHp : 0)));
  const wHp = Math.round(w * pct);
  ctx.fillStyle = 'rgba(51, 246, 22, 1)';
  ctx.fillRect(x, y, wHp, h);

  // borda
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
}

function drawTargetBox(ctx) {
  const id = (window.combatState && (window.combatState.selectedTargetId || window.combatState.targetId)) || state.selectedTargetId || null;
  if (!id) return;
  const s = getSpriteFor(id);
  if (!s) return;

  const meta = s.meta || {};
  const frameW = meta.frame?.width ?? 32;
  const frameH = meta.frame?.height ?? 32;
  const ax = meta.anchor?.x ?? 0.5;
  const ay = meta.anchor?.y ?? 0.9;

  const ox = Math.round(s.x - frameW * ax);
  const oy = Math.round(s.y - frameH * ay);

  ctx.strokeStyle = 'red';
  ctx.lineWidth = 2;
  ctx.strokeRect(ox, oy, frameW, frameH);
}

/* --------------- Install API --------------- */
export default function installCombatOverlay() {
  connectCombatWS();
  startRebindLoop();

  // re-tenta bind quando a GameScene sinaliza que terminou seu boot
  window.addEventListener('gamescene:ready', () => {
    for (const m of state.monsters.values()) {
      const s = ensureSpriteBind(m.id, m.key, m.spawnId);
      if (s) unbound.delete(m.id); else unbound.add(m.id);
    }
  });

  // manter selectedTargetId em dia (caso seu startAttack/stop disparem eventos)
  window.addEventListener('combat:attack:start', () => {
    if (window.combatState?.targetId) state.selectedTargetId = window.combatState.targetId;
  });
  window.addEventListener('combat:attack:stop', () => { state.selectedTargetId = null; });

  // ---------- Seleção por clique e Espaço para atacar ----------
  function pickMobAtWorld(pt) {
    const all = Array.from(state.monsters.values());
    for (const m of all) {
      const s = getSpriteFor(m.id);
      if (!s || s.hidden || s.dead) continue;
      const meta = s.meta || {};
      const frameW = meta.frame?.width ?? 32;
      const frameH = meta.frame?.height ?? 32;
      const ax = meta.anchor?.x ?? 0.5;
      const ay = meta.anchor?.y ?? 0.9;
      const ox = Math.round(s.x - frameW * ax);
      const oy = Math.round(s.y - frameH * ay);
      if (pt.x >= ox && pt.x <= ox + frameW && pt.y >= oy && pt.y <= oy + frameH) return m.id;
    }
    return null;
  }

  const canvas = window.GameScene?.canvas;
  if (canvas) {
    canvas.addEventListener('mouseup', (e) => {
      if (e.button !== 0) return;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const world = window.GameScene?.camera?.screenToWorld?.(sx, sy) || { x: sx, y: sy };
      const id = pickMobAtWorld(world);
      if (id) {
        state.selectedTargetId = String(id);
        if (!window.combatState) window.combatState = {};
        window.combatState.targetId = state.selectedTargetId;
        window.dispatchEvent(new CustomEvent('combat:attack:target', { detail: { id: state.selectedTargetId } }));
      }
    });

    // Tecla espaço para atacar o alvo selecionado
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Space') return;
      const id = state.selectedTargetId || (window.combatState && window.combatState.targetId);
      if (id && window.CombatActions?.startAttack) {
        window.CombatActions.startAttack(id);
      }
    });
  }

  // ---------- API pública do overlay ----------
  window.CombatUI = {
    render(ctx, camera, dt) {
      const needRebind = new Set();

      const drawAll = () => {
        // desenha HP somente se houver sprite vinculada e o bicho estiver vivo
        for (const m of state.monsters.values()) {
          if (m.hp <= 0) continue;
          const s = ensureSpriteBind(m.id, m.key, m.spawnId);
          if (!s) { needRebind.add(m.id); continue; }
          drawHpBarAtSprite(ctx, s, m.hp, m.maxHp);
        }

        drawTargetBox(ctx);

        // floaters sob a câmera
        updateAndDrawFloaters(ctx, dt * 1000);
      };

      if (camera?.apply) camera.apply(ctx, drawAll);
      else drawAll();

      // tentativa de rebind pós-draw
      if (needRebind.size) {
        for (const id of needRebind) {
          const m = state.monsters.get(id);
          if (m) ensureSpriteBind(m.id, m.key, m.spawnId);
        }
      }
    },

    getState() {
      return {
        ts: Date.now(),
        monsters: Array.from(state.monsters.values())
      };
    }
  };
}
