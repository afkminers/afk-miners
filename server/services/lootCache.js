// server/services/lootCache.js
// In-memory TTL cache for GET /api/map/:mapKey/loot endpoint responses

const lootService = require('./loot');

// Cache configuration
const LOOT_CACHE_ENABLED = process.env.LOOT_CACHE_ENABLED !== '0'; // default enabled
const LOOT_CACHE_TTL_SEC = Number(process.env.LOOT_CACHE_TTL_SEC || 5); // 5 seconds default
const DEBUG_LOOT_CACHE = process.env.DEBUG_LOOT_CACHE === '1';

// Cache storage: Map<mapKey, {data, expiresAt}>
const cache = new Map();

// Stats tracking
let stats = {
  hits: 0,
  misses: 0,
  sets: 0,
  evictions: 0
};

/**
 * Get cached loot data for a map, or fetch and cache if not available/expired
 */
async function getMapLoot(mapKey) {
  if (!LOOT_CACHE_ENABLED) {
    if (DEBUG_LOOT_CACHE) {
      console.log('[loot-cache] disabled, bypassing cache');
    }
    return await lootService.getMapLoot(mapKey);
  }

  const now = Date.now();
  const cached = cache.get(mapKey);

  // Check if we have valid cached data
  if (cached && cached.expiresAt > now) {
    stats.hits++;
    if (DEBUG_LOOT_CACHE) {
      console.log(`[loot-cache] HIT for map ${mapKey}`);
    }
    return cached.data;
  }

  // Cache miss or expired - fetch fresh data
  stats.misses++;
  if (DEBUG_LOOT_CACHE) {
    console.log(`[loot-cache] MISS for map ${mapKey} (${cached ? 'expired' : 'not found'})`);
  }

  const freshData = await lootService.getMapLoot(mapKey);
  
  // Cache the result
  const expiresAt = now + (LOOT_CACHE_TTL_SEC * 1000);
  cache.set(mapKey, {
    data: freshData,
    expiresAt
  });
  stats.sets++;

  if (DEBUG_LOOT_CACHE) {
    console.log(`[loot-cache] CACHED map ${mapKey} for ${LOOT_CACHE_TTL_SEC}s`);
  }

  return freshData;
}

/**
 * Invalidate cache for a specific map
 */
function invalidateMap(mapKey) {
  const deleted = cache.delete(mapKey);
  if (deleted) {
    stats.evictions++;
    if (DEBUG_LOOT_CACHE) {
      console.log(`[loot-cache] INVALIDATED map ${mapKey}`);
    }
  }
  return deleted;
}

/**
 * Clear all cached data
 */
function clear() {
  const size = cache.size;
  cache.clear();
  stats.evictions += size;
  if (DEBUG_LOOT_CACHE) {
    console.log(`[loot-cache] CLEARED all ${size} entries`);
  }
}

/**
 * Get cache statistics
 */
function getStats() {
  const hitRate = stats.hits + stats.misses > 0 
    ? (stats.hits / (stats.hits + stats.misses) * 100).toFixed(1)
    : '0.0';

  return {
    enabled: LOOT_CACHE_ENABLED,
    ttlSec: LOOT_CACHE_TTL_SEC,
    entries: cache.size,
    hits: stats.hits,
    misses: stats.misses,
    sets: stats.sets,
    evictions: stats.evictions,
    hitRate: `${hitRate}%`
  };
}

/**
 * Clean up expired entries (called periodically)
 */
function cleanupExpired() {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [mapKey, entry] of cache.entries()) {
    if (entry.expiresAt <= now) {
      cache.delete(mapKey);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    stats.evictions += cleaned;
    if (DEBUG_LOOT_CACHE) {
      console.log(`[loot-cache] cleaned up ${cleaned} expired entries`);
    }
  }
  
  return cleaned;
}

// Start cleanup timer if cache is enabled
if (LOOT_CACHE_ENABLED) {
  const cleanupInterval = Math.max(LOOT_CACHE_TTL_SEC * 1000, 10000); // at least 10s
  setInterval(cleanupExpired, cleanupInterval);
  
  if (DEBUG_LOOT_CACHE) {
    console.log(`[loot-cache] initialized with TTL=${LOOT_CACHE_TTL_SEC}s, cleanup every ${cleanupInterval}ms`);
  }
}

module.exports = {
  getMapLoot,
  invalidateMap,
  clear,
  getStats,
  cleanupExpired
};