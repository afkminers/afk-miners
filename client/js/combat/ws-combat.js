// client/js/combat/ws-combat.js
console.log('[combat] ws module loaded');

function wsUrl() {
  const loc = window.location;
  const proto = loc.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${loc.host}/ws`;
}

// Estado global do combate
export const combatState = {
  monsters: new Map(),   // id -> { id, x, y, hp, maxHp, mapKey, monsterKey }
  floaters: [],          // [{x,y,text,ttl,vy}]
  selectedTargetId: null
};
window.combatState = combatState;

let ws;

export function connectCombatWS() {
  try {
    ws = new WebSocket(wsUrl());
  } catch (e) {
    console.warn('[ws] failed to open socket:', e?.message);
    setTimeout(connectCombatWS, 2000);
    return;
  }

  ws.onopen = () => console.log('[ws] open');
  ws.onclose = () => { console.log('[ws] closed, retrying...'); setTimeout(connectCombatWS, 1500); };
  ws.onerror = (e) => console.warn('[ws] error', e);
  ws.onmessage = onWsMessage;
}

function onWsMessage(e) {
  let msg;
  try { msg = JSON.parse(e.data); } catch { return; }

  switch (msg.type) {
    case 'monster_respawned': {
      // { id, mapKey, monsterKey, hp, maxHp, x, y }
      const id = String(msg.id);
      const m = combatState.monsters.get(id) || { id };
      m.mapKey = msg.mapKey || m.mapKey || null;
      m.monsterKey = msg.monsterKey || m.monsterKey || null;
      m.hp = Number(msg.hp ?? m.hp ?? 1);
      m.maxHp = Number(msg.maxHp ?? m.maxHp ?? m.hp ?? 1);
      if (typeof msg.x === 'number') m.x = msg.x;
      if (typeof msg.y === 'number') m.y = msg.y;
      combatState.monsters.set(id, m);

      // Notifica a cena para criar/atualizar sprite
      window.dispatchEvent(new CustomEvent('combat:monster_respawned', { detail: {
        id, monsterKey: m.monsterKey, x: m.x, y: m.y
      }}));

      createFloater(m, 'respawn', { ttl: 600, vy: -0.03 });
      break;
    }

    case 'monster_move': {
      // { id, x, y } — enviado pelo servidor a cada tick de movimento
      const id = String(msg.id);
      const m = combatState.monsters.get(id);
      if (!m) break;
      if (typeof msg.x === 'number') m.x = msg.x;
      if (typeof msg.y === 'number') m.y = msg.y;
      combatState.monsters.set(id, m);

      // Notifica a cena para mover sprite
      window.dispatchEvent(new CustomEvent('combat:monster_move', { detail: { id, x: m.x, y: m.y }}));
      break;
    }

    case 'monster_hp': {
      // { id, hp, maxHp?, dmg?, x?, y? }
      const id = String(msg.id);
      const m = combatState.monsters.get(id) || { id };
      const prevHp = (typeof m.hp === 'number') ? m.hp : null;

      m.hp = Number(msg.hp);
      m.maxHp = Number(msg.maxHp ?? m.maxHp ?? msg.hp ?? 1);
      if (typeof msg.x === 'number') m.x = msg.x;
      if (typeof msg.y === 'number') m.y = msg.y;

      combatState.monsters.set(id, m);

      const dmg = (typeof msg.dmg === 'number')
        ? msg.dmg
        : (prevHp != null ? Math.max(0, prevHp - m.hp) : 0);
      if (dmg > 0) createFloater(m, `-${dmg}`);
      break;
    }

    case 'monster_dead': {
      // { id, xp? }
      const id = String(msg.id);
      const m = combatState.monsters.get(id);
      if (m) {
        m.hp = 0;
        combatState.monsters.set(id, m);
        if (typeof msg.xp === 'number') createFloater(m, `+${msg.xp}xp`);
        window.dispatchEvent(new CustomEvent('combat:monster_dead', { detail: { id } }));
      }
      break;
    }

    // demais mensagens do servidor são ignoradas aqui
  }
}

function createFloater(m, text, opts = {}) {
  if (typeof m?.x !== 'number' || typeof m?.y !== 'number') return;
  combatState.floaters.push({
    x: m.x + 16,
    y: m.y - 8,
    text,
    ttl: opts.ttl ?? 900,
    vy: opts.vy ?? -0.035
  });
}
