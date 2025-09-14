// Overlay único de combate: hp bar, target box e floaters.
// NUNCA "adivinha" posição. Só desenha se houver sprite vinculada via GameScene.

import { getSocket, onMessage } from '../ws/singleton.js';

const state = {
  monsters: new Map(), // id -> { id, key, hp, maxHp, spawnId? }
  floaters: [],
  selectedTargetId: null,
};

const unbound = new Set(); // ids sem sprite vinculada

function getSpriteFor(id) {
  return window.GameScene?.getMobByInstanceId?.(String(id)) || null;
}
function bindBySpawn(id, spawnId) {
  return window.GameScene?.bindInstanceToSpawn?.(String(id), Number(spawnId)) || null;
}
function bindByKey(id, monsterKey) {
  return window.GameScene?.bindInstanceToAnySpriteByKey?.(String(id), String(monsterKey)) || null;
}

function ensureSpriteBind(id, key, spawnId) {
  let s = getSpriteFor(id);
  if (s) return s;
  if (spawnId != null) s = bindBySpawn(id, spawnId);
  if (!s && key) s = bindByKey(id, key);
  return s || null;
}

/* ---------------- Floater (dano/xp) ---------------- */
function pushFloaterAtSprite(sprite, text, ttl = 900, color = "rgba(255,0,0,0.92)", outline = "#fff") {
  if (!sprite) return;
  const meta = sprite.meta || {};
  const frameW = meta.frame?.width ?? 32;
  const frameH = meta.frame?.height ?? 32;
  const ax = meta.anchor?.x ?? 0.5;
  const ay = meta.anchor?.y ?? 0.9;
  const x = Math.round(sprite.x - frameW * ax + frameW * 0.5);
  const y = Math.round(sprite.y - frameH * ay - 10);
  state.floaters.push({ x, y, text, ttl, vy: -0.038, color, outline });
}

function updateAndDrawFloaters(ctx, dtMs) {
  const list = state.floaters;
  for (let i = list.length - 1; i >= 0; i--) {
    const f = list[i];
    f.ttl -= dtMs;
    if (f.ttl <= 0) { list.splice(i, 1); continue; }
    f.y += f.vy * dtMs;
    ctx.save();
    ctx.font = 'bold 12px "Trebuchet MS", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = f.outline || "#fff";
    ctx.strokeText(f.text, Math.round(f.x), Math.round(f.y));
    ctx.fillStyle = f.color || "rgba(255,0,0,0.9)";
    ctx.fillText(f.text, Math.round(f.x), Math.round(f.y));
    ctx.restore();
  }
}

/* --------------- Instala handlers de WS (singleton) --------------- */
function installWsHandlers() {
  getSocket(); // garante conexão
  onMessage('monster_respawned', (msg) => {
    const id = String(msg.id);
    const key = String(msg.monsterKey || 'monster');
    const maxHp = Number(msg.maxHp ?? msg.hp ?? 1);
    const hp = Number(msg.hp ?? maxHp);
    const spawnId = (msg.spawnId != null) ? Number(msg.spawnId) : null;

    const m = state.monsters.get(id) || { id };
    m.key = key;
    m.maxHp = maxHp;
    m.hp = hp;
    if (spawnId != null) m.spawnId = spawnId;
    state.monsters.set(id, m);

    const s = ensureSpriteBind(id, key, spawnId);
    if (s) {
      s.dead = false;
      s.hidden = false;
      s._animFrozen = false;
      s._animFrozenFrame = 0;
      unbound.delete(id);
    } else {
      unbound.add(id);
    }
  });

  onMessage('monster_hp', (msg) => {
    const id = String(msg.id);
    const m = state.monsters.get(id) || { id };
    const prevHp = (typeof m.hp === 'number') ? m.hp : null;

    m.key = String(msg.monsterKey || m.key || 'monster');
    m.maxHp = Number(msg.maxHp ?? m.maxHp ?? msg.hp ?? 1);
    m.hp = Number(msg.hp ?? m.hp ?? m.maxHp);
    state.monsters.set(id, m);

    const s = getSpriteFor(id) || ensureSpriteBind(id, m.key, m.spawnId);
    if (!s) unbound.add(id);

    const dmg = (typeof msg.dmg === 'number') ? msg.dmg : (prevHp != null ? Math.max(0, prevHp - m.hp) : 0);
    if (dmg > 0 && s) {
      const isCrit = dmg >= (m.maxHp / 2);
      pushFloaterAtSprite(s, `-${dmg}`, 950, isCrit ? "#fff176" : "#ff4444", isCrit ? "#000" : "#fff");
    }
  });

  onMessage('monster_dead', (msg) => {
    const id = String(msg.id);
    const xp = Number(msg.xp || 0);

    const m = state.monsters.get(id) || { id };
    m.hp = 0;
    state.monsters.set(id, m);

    const s = getSpriteFor(id);
    if (s) {
      if (xp > 0) pushFloaterAtSprite(s, `+${xp}xp`, 1200, "#66ff66", "#222");
      window.GameScene?.onMonsterDead?.(id);
    }
    setTimeout(() => {
      state.monsters.delete(id);
      unbound.delete(id);
    }, 0);
  });
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
        s.dead = false;
        s.hidden = false;
        s._animFrozen = false;
        s._animFrozenFrame = 0;
        unbound.delete(id);
      }
    }
  }, 300);
}

/* --------------- Draw helpers --------------- */

// Barra de HP colorida estilo Tibia
function getHpBarColor(pct) {
  if (pct > 0.75) return 'rgba(51, 246, 22, 1)'; // verde
  if (pct > 0.50) return 'rgba(170, 255, 110, 1)'; // verde claro
  if (pct > 0.25) return 'rgba(255, 191, 0, 1)'; // amarelo
  if (pct > 0.05) return 'rgba(255, 68, 68, 1)';  // vermelho
  return 'rgba(120, 20, 20, 1)'; // vermelho escuro
}

// Busca o nome do monstro pelo key no catálogo de monstros carregado no frontend
function getMonsterNameByKey(key) {
  try {
    const meta = (window.SPRITES_META && window.SPRITES_META[key]) ||
      (window.SPRITE_INDEX && window.SPRITE_INDEX.get && window.SPRITE_INDEX.get(key));
    if (meta && meta.name) return meta.name;
    if (window.SPRITES_META) {
      const tryKey = Object.keys(window.SPRITES_META).find(k =>
        k.toLowerCase() === key.toLowerCase());
      if (tryKey) return window.SPRITES_META[tryKey]?.name || key;
    }
    return key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
  } catch {
    return key;
  }
}

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
  const y = Math.round(sprite.y - frameH * ay - 8);

  // Barra de fundo
  ctx.save();
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.restore();

  const pct = Math.max(0, Math.min(1, (maxHp > 0 ? hp / maxHp : 0)));
  const wHp = Math.round(w * pct);
  ctx.save();
  ctx.fillStyle = getHpBarColor(pct);
  ctx.shadowColor = "transparent"; // sem blur!
  ctx.shadowBlur = 0;
  ctx.fillRect(x, y, wHp, h);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
  ctx.restore();
}

// Nome do monstro acima da barra de HP, cor acompanha barra, minimalista
function drawMonsterNameAtSprite(ctx, sprite, key, hp, maxHp) {
  const name = getMonsterNameByKey(key);
  if (!sprite || !name) return;
  const meta = sprite.meta || {};
  const frameW = meta.frame?.width ?? 32;
  const frameH = meta.frame?.height ?? 32;
  const ax = meta.anchor?.x ?? 0.5;
  const ay = meta.anchor?.y ?? 0.9;
  const x = Math.round(sprite.x - frameW * ax + frameW * 0.5);
  const y = Math.round(sprite.y - frameH * ay - 20);

  // Cor dinâmica igual a da barra de vida
  const pct = Math.max(0, Math.min(1, (maxHp > 0 ? hp / maxHp : 0)));
  const barColor = getHpBarColor(pct);

  ctx.save();
  ctx.font = 'bold 11.5px "Trebuchet MS", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#000';
  ctx.fillStyle = barColor;
  ctx.shadowColor = "transparent"; // sem blur
  ctx.shadowBlur = 0;
  ctx.strokeText(name, x, y);
  ctx.fillText(name, x, y);
  ctx.restore();
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

  ctx.save();
  ctx.shadowColor = "transparent"; // sem blur!
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'red';
  ctx.lineWidth = 2;
  ctx.strokeRect(ox, oy, frameW, frameH);
  ctx.restore();
}

/* --------------- Install API --------------- */
export default function installCombatOverlay() {
  installWsHandlers();
  startRebindLoop();

  window.addEventListener('gamescene:ready', () => {
    for (const m of state.monsters.values()) {
      const s = ensureSpriteBind(m.id, m.key, m.spawnId);
      if (s) unbound.delete(m.id); else unbound.add(m.id);
    }
  });

  window.addEventListener('combat:attack:start', () => {
    if (window.combatState?.targetId) state.selectedTargetId = window.combatState.targetId;
  });
  window.addEventListener('combat:attack:stop', () => { state.selectedTargetId = null; });

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

    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Space') return;
      const id = state.selectedTargetId || (window.combatState && window.combatState.targetId);
      if (id && window.CombatActions?.startAttack) {
        window.CombatActions.startAttack(id);
      }
    });
  }

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

  window.CombatUI = {
    render(ctx, camera, dt) {
      const needRebind = new Set();

      const drawAll = () => {
        for (const m of state.monsters.values()) {
          if (m.hp <= 0) continue;
          const s = ensureSpriteBind(m.id, m.key, m.spawnId);
          if (!s) { needRebind.add(m.id); continue; }
          drawHpBarAtSprite(ctx, s, m.hp, m.maxHp);
          drawMonsterNameAtSprite(ctx, s, m.key, m.hp, m.maxHp); // Nome acompanha cor da barra
        }
        drawTargetBox(ctx);
        updateAndDrawFloaters(ctx, dt * 1000);
      };

      if (camera?.apply) camera.apply(ctx, drawAll);
      else drawAll();

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
    },

    // Expose pickMobAtWorld for use by attack-controls.js
    pickMobAtWorld(pt) {
      return pickMobAtWorld(pt);
    }
  };
}