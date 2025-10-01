// server/combat/geom.js - VERSÃO FINAL CORRIGIDA
const TILE = 32;
const EPS = 0; // ✅ REMOVIDA margem de erro (causava ataques fora de alcance)

const DISTANCE_ALIASES = new Set(['BOW', 'CROSSBOW', 'SPEAR', 'JAVELIN', 'THROWING_KNIFE', 'DISTANCE']);
const MAGIC_ALIASES = new Set(['MAGIC', 'WAND', 'ROD', 'TOME', 'STAFF']);

function toTile(v) {
  return Math.floor(v / TILE);
}

/** Chebyshev em TILES - converte DEPOIS de calcular distância em PX */
function chebyshevTiles(ax, ay, bx, by) {
  // ✅ CORREÇÃO: calcula distância em pixels PRIMEIRO, depois converte para tiles
  const distPx = chebyPx(ax, ay, bx, by);
  return Math.floor(distPx / TILE);
}

/** Chebyshev em PIXELS (padrão Tibia: max entre dx e dy) */
function chebyPx(ax, ay, bx, by) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function resolveRangeTiles(weaponType, heroClass, K) {
  const table = (K && K.WEAPON_RANGE_TILES) || {};
  const rawKey = String(weaponType || '').toUpperCase();
  const key = rawKey || 'SWORD';

  let rangeTiles = Number(table[key]);
  
  if (!Number.isFinite(rangeTiles)) {
    if (DISTANCE_ALIASES.has(key) && Number.isFinite(table.DISTANCE)) {
      rangeTiles = Number(table.DISTANCE);
    } else if (MAGIC_ALIASES.has(key) && Number.isFinite(table.MAGIC)) {
      rangeTiles = Number(table.MAGIC);
    }
  }

  if (!Number.isFinite(rangeTiles) && Number.isFinite(table.SWORD)) {
    rangeTiles = Number(table.SWORD);
  }

  if (!Number.isFinite(rangeTiles) || rangeTiles <= 0) {
    rangeTiles = 1;
  }

  // ✅ Classe NÃO limita alcance (removido CLASS_RANGE_CAP)
  return Math.max(1, rangeTiles);
}

/** 
 * Alcance por arma comparando em PIXELS (estilo Tibia)
 * ✅ CORREÇÃO: sem margem de erro (EPS = 0)
 */
function inReachPx(attacker, target, weaponType, K, heroClass = null) {
  const rangeTiles = resolveRangeTiles(weaponType, heroClass, K);
  const rangePx = rangeTiles * TILE;
  const distPx = chebyPx(attacker.x, attacker.y, target.x, target.y);
  
  // ✅ CORREÇÃO: comparação estrita sem margem de erro
  // Tibia: se alcance é 5 tiles (160px), distância máxima aceita é exatamente 160px
  return distPx <= rangePx;
}

module.exports = {
  TILE,
  EPS,
  toTile,
  chebyshevTiles,
  chebyPx,
  inReachPx,
  resolveRangeTiles,
};
