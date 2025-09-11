// server/services/catalogCache.js
// In-memory cache for static catalog data (monsters, items, sprites)

const { all } = require('../models/db');

// Cache configuration
const CATALOG_CACHE_ENABLED = process.env.CATALOG_CACHE_ENABLED !== '0'; // default enabled
const CATALOG_CACHE_REFRESH_SEC = Number(process.env.CATALOG_CACHE_REFRESH_SEC || 120); // 2 minutes
const DEBUG_CATALOG_CACHE = process.env.DEBUG_CATALOG_CACHE === '1';

// Cache storage
const cache = {
  monsters: new Map(),
  items: new Map(),
  sprites: new Map(),
  lastUpdated: {
    monsters: null,
    items: null,
    sprites: null
  },
  lastCheck: 0
};

let refreshTimer = null;

/**
 * Warm up the cache by loading all catalog data
 */
async function warm() {
  if (!CATALOG_CACHE_ENABLED) {
    console.log('[catalog-cache] disabled by config');
    return;
  }

  console.log('[catalog-cache] warming up...');
  
  try {
    // Load monsters
    const monsters = await all('SELECT key, name, xp, "healthMax", speed, "flagsJSON", "elementsJSON", "attacksJSON", "defensesJSON", "lootJSON", "lookJSON", updated_at FROM monsters_master');
    cache.monsters.clear();
    let monsterCount = 0;
    for (const monster of monsters) {
      cache.monsters.set(monster.key, {
        ...monster,
        flags: safeParse(monster.flagsJSON),
        elements: safeParse(monster.elementsJSON),
        attacks: safeParse(monster.attacksJSON),
        defenses: safeParse(monster.defensesJSON),
        loot: safeParse(monster.lootJSON),
        look: safeParse(monster.lookJSON)
      });
      monsterCount++;
      if (monster.updated_at) {
        cache.lastUpdated.monsters = Math.max(cache.lastUpdated.monsters || 0, new Date(monster.updated_at).getTime());
      }
    }

    // Load items
    const items = await all('SELECT key, "dataJSON", updated_at FROM items_master');
    cache.items.clear();
    let itemCount = 0;
    for (const item of items) {
      cache.items.set(item.key, {
        key: item.key,
        data: safeParse(item.dataJSON)
      });
      itemCount++;
      if (item.updated_at) {
        cache.lastUpdated.items = Math.max(cache.lastUpdated.items || 0, new Date(item.updated_at).getTime());
      }
    }

    // Load sprites
    const sprites = await all('SELECT key, kind, "dataJSON", updated_at FROM sprites_master');
    cache.sprites.clear();
    let spriteCount = 0;
    for (const sprite of sprites) {
      cache.sprites.set(sprite.key, {
        key: sprite.key,
        kind: sprite.kind,
        data: safeParse(sprite.dataJSON)
      });
      spriteCount++;
      if (sprite.updated_at) {
        cache.lastUpdated.sprites = Math.max(cache.lastUpdated.sprites || 0, new Date(sprite.updated_at).getTime());
      }
    }

    cache.lastCheck = Date.now();
    
    console.log(`[catalog-cache] loaded ${monsterCount} monsters, ${itemCount} items, ${spriteCount} sprites`);
    
    // Start auto-refresh timer
    if (!refreshTimer) {
      refreshTimer = setInterval(checkForUpdates, CATALOG_CACHE_REFRESH_SEC * 1000);
    }
    
  } catch (error) {
    console.error('[catalog-cache] warm up failed:', error.message);
  }
}

/**
 * Check for updates and refresh cache if needed
 */
async function checkForUpdates() {
  if (!CATALOG_CACHE_ENABLED || cache.lastCheck === 0) return;

  try {
    // Check monsters
    const monsterUpdate = await all('SELECT MAX(updated_at) as max_updated FROM monsters_master');
    const latestMonsterTime = monsterUpdate[0]?.max_updated ? new Date(monsterUpdate[0].max_updated).getTime() : 0;
    
    if (latestMonsterTime > (cache.lastUpdated.monsters || 0)) {
      console.log('[catalog-cache] refreshing monsters...');
      const monsters = await all('SELECT key, name, xp, "healthMax", speed, "flagsJSON", "elementsJSON", "attacksJSON", "defensesJSON", "lootJSON", "lookJSON", updated_at FROM monsters_master WHERE updated_at > $1', [new Date(cache.lastUpdated.monsters || 0)]);
      for (const monster of monsters) {
        cache.monsters.set(monster.key, {
          ...monster,
          flags: safeParse(monster.flagsJSON),
          elements: safeParse(monster.elementsJSON),
          attacks: safeParse(monster.attacksJSON),
          defenses: safeParse(monster.defensesJSON),
          loot: safeParse(monster.lootJSON),
          look: safeParse(monster.lookJSON)
        });
      }
      cache.lastUpdated.monsters = latestMonsterTime;
    }

    // Check items
    const itemUpdate = await all('SELECT MAX(updated_at) as max_updated FROM items_master');
    const latestItemTime = itemUpdate[0]?.max_updated ? new Date(itemUpdate[0].max_updated).getTime() : 0;
    
    if (latestItemTime > (cache.lastUpdated.items || 0)) {
      console.log('[catalog-cache] refreshing items...');
      const items = await all('SELECT key, "dataJSON", updated_at FROM items_master WHERE updated_at > $1', [new Date(cache.lastUpdated.items || 0)]);
      for (const item of items) {
        cache.items.set(item.key, {
          key: item.key,
          data: safeParse(item.dataJSON)
        });
      }
      cache.lastUpdated.items = latestItemTime;
    }

    // Check sprites
    const spriteUpdate = await all('SELECT MAX(updated_at) as max_updated FROM sprites_master');
    const latestSpriteTime = spriteUpdate[0]?.max_updated ? new Date(spriteUpdate[0].max_updated).getTime() : 0;
    
    if (latestSpriteTime > (cache.lastUpdated.sprites || 0)) {
      console.log('[catalog-cache] refreshing sprites...');
      const sprites = await all('SELECT key, kind, "dataJSON", updated_at FROM sprites_master WHERE updated_at > $1', [new Date(cache.lastUpdated.sprites || 0)]);
      for (const sprite of sprites) {
        cache.sprites.set(sprite.key, {
          key: sprite.key,
          kind: sprite.kind,
          data: safeParse(sprite.dataJSON)
        });
      }
      cache.lastUpdated.sprites = latestSpriteTime;
    }

    cache.lastCheck = Date.now();
  } catch (error) {
    console.error('[catalog-cache] update check failed:', error.message);
  }
}

/**
 * Get monster by key from cache or database
 */
async function getMonster(key) {
  if (!CATALOG_CACHE_ENABLED) {
    // Fallback to database
    if (DEBUG_CATALOG_CACHE) console.log('[catalog-cache] MISS (disabled) monster:', key);
    const monster = await all('SELECT key, name, xp, "healthMax", speed, "flagsJSON", "elementsJSON", "attacksJSON", "defensesJSON", "lootJSON", "lookJSON" FROM monsters_master WHERE key = $1', [key]);
    if (monster[0]) {
      return {
        ...monster[0],
        flags: safeParse(monster[0].flagsJSON),
        elements: safeParse(monster[0].elementsJSON),
        attacks: safeParse(monster[0].attacksJSON),
        defenses: safeParse(monster[0].defensesJSON),
        loot: safeParse(monster[0].lootJSON),
        look: safeParse(monster[0].lookJSON)
      };
    }
    return null;
  }

  if (cache.monsters.has(key)) {
    return cache.monsters.get(key);
  }

  // Cache miss - try database
  if (DEBUG_CATALOG_CACHE) console.log('[catalog-cache] MISS monster:', key);
  const monster = await all('SELECT key, name, xp, "healthMax", speed, "flagsJSON", "elementsJSON", "attacksJSON", "defensesJSON", "lootJSON", "lookJSON" FROM monsters_master WHERE key = $1', [key]);
  if (monster[0]) {
    const parsed = {
      ...monster[0],
      flags: safeParse(monster[0].flagsJSON),
      elements: safeParse(monster[0].elementsJSON),
      attacks: safeParse(monster[0].attacksJSON),
      defenses: safeParse(monster[0].defensesJSON),
      loot: safeParse(monster[0].lootJSON),
      look: safeParse(monster[0].lookJSON)
    };
    cache.monsters.set(key, parsed);
    return parsed;
  }
  return null;
}

/**
 * Get item by key from cache or database
 */
async function getItem(key) {
  if (!CATALOG_CACHE_ENABLED) {
    // Fallback to database
    if (DEBUG_CATALOG_CACHE) console.log('[catalog-cache] MISS (disabled) item:', key);
    const item = await all('SELECT key, "dataJSON" FROM items_master WHERE key = $1', [key]);
    if (item[0]) {
      return {
        key: item[0].key,
        data: safeParse(item[0].dataJSON)
      };
    }
    return null;
  }

  if (cache.items.has(key)) {
    return cache.items.get(key);
  }

  // Cache miss - try database
  if (DEBUG_CATALOG_CACHE) console.log('[catalog-cache] MISS item:', key);
  const item = await all('SELECT key, "dataJSON" FROM items_master WHERE key = $1', [key]);
  if (item[0]) {
    const parsed = {
      key: item[0].key,
      data: safeParse(item[0].dataJSON)
    };
    cache.items.set(key, parsed);
    return parsed;
  }
  return null;
}

/**
 * Get sprite by key from cache or database
 */
async function getSprite(key) {
  if (!CATALOG_CACHE_ENABLED) {
    // Fallback to database
    if (DEBUG_CATALOG_CACHE) console.log('[catalog-cache] MISS (disabled) sprite:', key);
    const sprite = await all('SELECT key, kind, "dataJSON" FROM sprites_master WHERE key = $1', [key]);
    if (sprite[0]) {
      return {
        key: sprite[0].key,
        kind: sprite[0].kind,
        data: safeParse(sprite[0].dataJSON)
      };
    }
    return null;
  }

  if (cache.sprites.has(key)) {
    return cache.sprites.get(key);
  }

  // Cache miss - try database
  if (DEBUG_CATALOG_CACHE) console.log('[catalog-cache] MISS sprite:', key);
  const sprite = await all('SELECT key, kind, "dataJSON" FROM sprites_master WHERE key = $1', [key]);
  if (sprite[0]) {
    const parsed = {
      key: sprite[0].key,
      kind: sprite[0].kind,
      data: safeParse(sprite[0].dataJSON)
    };
    cache.sprites.set(key, parsed);
    return parsed;
  }
  return null;
}

/**
 * Get cache statistics
 */
function stats() {
  return {
    enabled: CATALOG_CACHE_ENABLED,
    monsters: cache.monsters.size,
    items: cache.items.size,
    sprites: cache.sprites.size,
    lastCheck: cache.lastCheck,
    refreshIntervalSec: CATALOG_CACHE_REFRESH_SEC,
    lastUpdated: cache.lastUpdated
  };
}

/**
 * Clear cache (for testing/debugging)
 */
function clear() {
  cache.monsters.clear();
  cache.items.clear();
  cache.sprites.clear();
  cache.lastUpdated = { monsters: null, items: null, sprites: null };
  cache.lastCheck = 0;
  console.log('[catalog-cache] cleared');
}

/**
 * Safe JSON parse with fallback
 */
function safeParse(str) {
  if (typeof str === 'object') return str;
  try {
    return JSON.parse(str || '{}');
  } catch {
    return {};
  }
}

module.exports = {
  warm,
  getMonster,
  getItem,
  getSprite,
  stats,
  clear
};