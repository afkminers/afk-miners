// server/services/httpCache.js
// HTTP cache with TTL and ETag computation for assets endpoints

const crypto = require('crypto');

const DEBUG_HTTP_CACHE = process.env.DEBUG_HTTP_CACHE === '1';

// In-memory cache with TTL
const cache = new Map();

/**
 * Get value from cache if not expired
 */
function get(key) {
  const entry = cache.get(key);
  if (!entry) {
    if (DEBUG_HTTP_CACHE) console.log('[http-cache] MISS:', key);
    return null;
  }
  
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    if (DEBUG_HTTP_CACHE) console.log('[http-cache] EXPIRED:', key);
    return null;
  }
  
  if (DEBUG_HTTP_CACHE) console.log('[http-cache] HIT:', key);
  return entry;
}

/**
 * Set value in cache with TTL
 */
function set(key, value, ttlMs) {
  const expiresAt = Date.now() + ttlMs;
  const etag = makeEtagFromJSON(value);
  
  const entry = {
    value,
    etag,
    expiresAt,
    createdAt: Date.now()
  };
  
  cache.set(key, entry);
  if (DEBUG_HTTP_CACHE) console.log('[http-cache] SET:', key, 'TTL:', ttlMs, 'ETag:', etag);
  return entry;
}

/**
 * Generate weak ETag from JSON data
 */
function makeEtagFromJSON(value) {
  const str = JSON.stringify(value);
  const hash = crypto.createHash('sha256').update(str).digest('hex').substring(0, 16);
  return `W/"${hash}"`;
}

/**
 * Clear cache (for testing/debugging)
 */
function clear() {
  cache.clear();
  if (DEBUG_HTTP_CACHE) console.log('[http-cache] cleared');
}

/**
 * Get cache statistics
 */
function stats() {
  const entries = Array.from(cache.entries());
  const now = Date.now();
  
  return {
    total: entries.length,
    expired: entries.filter(([, entry]) => now > entry.expiresAt).length,
    valid: entries.filter(([, entry]) => now <= entry.expiresAt).length,
    keys: entries.map(([key]) => key)
  };
}

/**
 * Express middleware for handling ETag/304 responses
 */
function handleEtagResponse(req, res, cacheKey, data, ttlMs) {
  const ifNoneMatch = req.headers['if-none-match'];
  
  // Try to get from cache
  let entry = get(cacheKey);
  
  if (!entry) {
    // Cache miss - create new entry
    entry = set(cacheKey, data, ttlMs);
  }
  
  // Set ETag header
  res.set('ETag', entry.etag);
  res.set('Cache-Control', `public, max-age=${Math.floor(ttlMs / 1000)}`);
  
  // Check if client has matching ETag
  if (ifNoneMatch && ifNoneMatch === entry.etag) {
    // Client has current version - return 304 Not Modified
    res.status(304).end();
    return true;
  }
  
  // Return fresh data
  res.json(entry.value);
  return false;
}

module.exports = {
  get,
  set,
  makeEtagFromJSON,
  clear,
  stats,
  handleEtagResponse
};