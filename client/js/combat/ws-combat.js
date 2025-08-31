// client/js/combat/ws-combat.js
console.log('[combat] ws module loaded');

// Resolve ws:// ou wss:// baseado na página atual
function wsUrl() {
  const loc = window.location;
  const proto = loc.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${loc.host}/ws`;
}

export const combatState = {
  monsters: new Map(),  // id -> { id, x, y, hp, maxHp, mapKey, monsterKey }
  floaters: [],         // [{x,y,text,ttl,vy}]
  selectedTargetId: null
};

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
  ws.onclose = () => {
    console.log('[ws] closed, retrying...');
    setTimeout(connectCombatWS, 1500);
  };
  ws.onerror = (e) => console.warn('[ws] error', e);
  ws.onmessage = onWsMessage;
}

function onWsMessage(e) {
  let msg;
  try { msg = JSON.parse(e.data); } catch { return; }

  switch (msg.type) {
    case 'monster_hp': {
      const m = combatState.monsters.get(msg.id) || { id: msg.id };
      const prevHp = (typeof m.hp === 'number') ? m.hp : null;

      m.hp = Number(msg.hp ?? m.hp ?? 1);
      m.maxHp = Number(msg.maxHp ?? m.maxHp ?? m.hp ?? 1);
      if (typeof msg.x === 'number') m.x = msg.x;
      if (typeof msg.y === 'number') m.y = msg.y;

      combatState.monsters.set(m.id, m);

      const dmg = (typeof msg.dmg === 'number')
        ? msg.dmg
        : (prevHp != null ? Math.max(0, prevHp - m.hp) : 0);

      if (dmg > 0) createFloaterForMonster(m, `-${dmg}`);
      break;
    }

    case 'monster_dead': {
      const m = combatState.monsters.get(msg.id);
      if (m) {
        m.hp = 0;
        combatState.monsters.set(m.id, m);
        if (typeof msg.xp === 'number') createFloaterForMonster(m, `+${msg.xp}xp`);
      }
      break;
    }

    case 'monster_respawned': {
      // { id, mapKey, monsterKey, hp, maxHp, x, y }
      const m = combatState.monsters.get(msg.id) || { id: msg.id };
      m.hp = Number(msg.hp || 1);
      m.maxHp = Number(msg.maxHp || m.hp || 1);
      m.mapKey = msg.mapKey || m.mapKey || null;
      m.monsterKey = msg.monsterKey || m.monsterKey || null;
      if (typeof msg.x === 'number') m.x = msg.x;
      if (typeof msg.y === 'number') m.y = msg.y;
      combatState.monsters.set(m.id, m);

      createFloaterForMonster(m, 'respawn');
      break;
    }
  }
}

function createFloaterForMonster(m, text) {
  if (typeof m.x !== 'number' || typeof m.y !== 'number') return;
  combatState.floaters.push({
    x: m.x + 16,   // centro do tile 32x32
    y: m.y - 8,
    text,
    ttl: 900,      // ms
    vy: -0.035     // px/ms
  });
}

/** Expor no escopo global para facilitar debug no console */
window.Combat = window.Combat || {};
window.Combat.state = combatState;
window.Combat.connect = connectCombatWS;
