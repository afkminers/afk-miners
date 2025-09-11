// server/services/loot.js
// Serviço de loot "em memória" + broadcast por mapa.
// Mantém o jogo funcionando agora, sem exigir tabelas extras.

const { v4: uuidv4 } = require('uuid');
const { broadcastToMap } = require('../ws/bus');

// Config com defaults seguros
const LOOT_EXPIRE_SECONDS = Number(process.env.LOOT_EXPIRE_SECONDS || 120);
const LOOT_CLEANUP_EVERY_SECONDS = Number(process.env.LOOT_CLEANUP_EVERY_SECONDS || 30);

// Estrutura em memória:
// MAP_LOOT[mapKey] = Map( lootId -> { id, mapKey, x, y, items:[{key,amount}], expiresAt:ms } )
const MAP_LOOT = new Map();

// util
function nowMs() { return Date.now(); }
function ensureMap(mapKey) {
  const k = String(mapKey || 'house');
  if (!MAP_LOOT.has(k)) MAP_LOOT.set(k, new Map());
  return MAP_LOOT.get(k);
}

// ======= API =======

// cria um loot (pode ser usado ao matar monstro; hoje não é obrigatório)
async function createLootFromKill({ mapKey, x, y, items }) {
  const lootMap = ensureMap(mapKey);
  const id = uuidv4();
  const entry = {
    id,
    mapKey: String(mapKey || 'house'),
    x: Number(x) || 0,
    y: Number(y) || 0,
    items: Array.isArray(items) ? items.map(i => ({ key: String(i.key), amount: Number(i.amount) || 1 })) : [],
    expiresAt: nowMs() + LOOT_EXPIRE_SECONDS * 1000
  };

  if (entry.items.length === 0) return null;

  lootMap.set(id, entry);

  // avisa clientes do mapa
  try { broadcastToMap(entry.mapKey, { type: 'loot_spawned', id, x: entry.x, y: entry.y, items: entry.items }); } catch {}

  return entry;
}

// coleta um loot
async function pickupLoot(lootId, heroId) {
  // procura em todos os mapas (barato: é memória e pouco volume)
  for (const [mapKey, lootMap] of MAP_LOOT.entries()) {
    if (lootMap.has(lootId)) {
      const entry = lootMap.get(lootId);

      // remove da memória
      lootMap.delete(lootId);

      try { broadcastToMap(mapKey, { type: 'loot_removed', id: lootId }); } catch {}

      return {
        mapKey,
        x: entry.x,
        y: entry.y,
        items: entry.items.slice(), // [{key, amount}]
        heroId: heroId ? String(heroId) : null
      };
    }
  }
  return null;
}

// lista loots ativos de um mapa
async function getMapLoot(mapKey) {
  const lootMap = ensureMap(mapKey);
  const out = [];
  const t = nowMs();
  for (const entry of lootMap.values()) {
    if (entry.expiresAt && t >= entry.expiresAt) continue; // limpeza vai tirar, mas já não mostramos
    out.push({ id: entry.id, x: entry.x, y: entry.y, items: entry.items });
  }
  return out;
}

// limpeza de expirados (opcional, roda em background)
async function cleanupExpiredOnce() {
  const t = nowMs();
  for (const [mapKey, lootMap] of MAP_LOOT.entries()) {
    for (const [lootId, entry] of lootMap.entries()) {
      if (entry.expiresAt && t >= entry.expiresAt) {
        lootMap.delete(lootId);
        try { broadcastToMap(mapKey, { type: 'loot_removed', id: lootId }); } catch {}
      }
    }
  }
}

function startCleanupLoop() {
  const every = Math.max(5, LOOT_CLEANUP_EVERY_SECONDS) * 1000;
  setInterval(() => { cleanupExpiredOnce().catch(() => {}); }, every);
  return true;
}

module.exports = {
  createLootFromKill,
  pickupLoot,
  getMapLoot,
  startCleanupLoop,

  // expõe memória (debug)
  _memory: MAP_LOOT,
};
