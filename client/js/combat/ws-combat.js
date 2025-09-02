// client/js/combat/ws-combat.js
console.log('[combat] ws module loaded');

// Resolve ws:// ou wss:// baseado na página atual
function wsUrl() {
  const loc = window.location;
  const proto = loc.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${loc.host}/ws`;
}

// Estado compartilhado (garante floaters sempre como array)
export const combatState = window.combatState || {
  monsters: new Map(),    // id -> { id, x, y, hp, maxHp, mapKey, monsterKey }
  floaters: [],           // [{x,y,text,ttl,vy}]
  selectedTargetId: null,
};
if (!Array.isArray(combatState.floaters)) combatState.floaters = [];
window.combatState = combatState;

let ws;

export function connectCombatWS() {
  try { ws = new WebSocket(wsUrl()); }
  catch (e) {
    console.warn('[ws] failed to open socket:', e?.message);
    setTimeout(connectCombatWS, 2000);
    return;
  }
  ws.onopen    = () => console.log('[ws] open');
  ws.onclose   = () => { console.log('[ws] closed, retrying...'); setTimeout(connectCombatWS, 1500); };
  ws.onerror   = (e) => console.warn('[ws] error', e);
  ws.onmessage = onWsMessage;
}

function onWsMessage(e) {
  let msg;
  try { msg = JSON.parse(e.data); } catch { return; }

  switch (msg.type) {
    case 'monster_hp': {
      // { id, hp, maxHp?, x?, y?, dmg? }
      const m = combatState.monsters.get(msg.id) || { id: msg.id };
      const prevHp = (typeof m.hp === 'number') ? m.hp : null;

      m.hp    = Number(msg.hp ?? m.hp ?? 1);
      m.maxHp = Number(msg.maxHp ?? m.maxHp ?? m.hp ?? 1);
      if (Number.isFinite(msg.x)) m.x = msg.x;
      if (Number.isFinite(msg.y)) m.y = msg.y;

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
      // { id, mapKey, monsterKey, hp, maxHp, x?, y? }
      const m = combatState.monsters.get(msg.id) || { id: msg.id };
      m.hp       = Number(msg.hp || 1);
      m.maxHp    = Number(msg.maxHp || m.hp || 1);
      m.mapKey   = msg.mapKey   ?? m.mapKey   ?? null;
      m.monsterKey = msg.monsterKey ?? m.monsterKey ?? null;
      if (Number.isFinite(msg.x)) m.x = msg.x;
      if (Number.isFinite(msg.y)) m.y = msg.y;
      combatState.monsters.set(m.id, m);

      // compat com versões antigas que chamavam createFloater()
      createFloaterForMonster(m, 'respawn');
      break;
    }
  }
}

function ensureFloaters() {
  if (!Array.isArray(combatState.floaters)) combatState.floaters = [];
}

function createFloaterForMonster(m, text) {
  if (!m) return;
  ensureFloaters();
  // se não temos x/y, ainda cria o floater — combat-ui posiciona no mob local
  const x = Number.isFinite(m.x) ? m.x + 16 : 16;
  const y = Number.isFinite(m.y) ? m.y - 8  : 8;
  combatState.floaters = combatState.floaters || [];
  combatState.floaters.push({ x, y, text, ttl: 900, vy: -0.035 });
}

// alias legado (alguns builds antigos chamam createFloater)
function createFloater(m, text) { createFloaterForMonster(m, text); }

/** Debug helpers globais */
window.Combat = window.Combat || {};
window.Combat.state   = combatState;
window.Combat.connect = connectCombatWS;
