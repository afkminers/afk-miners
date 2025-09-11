// server/middleware/endpoint-metrics.js
// Lightweight middleware to track endpoint usage patterns for optimization

const routeCounts = new Map();
let lastLogTime = Date.now();

// Configuration
const ENDPOINT_METRICS_INTERVAL_MS = Number(process.env.ENDPOINT_METRICS_INTERVAL_MS || 60000); // 60s default
const ENDPOINT_METRICS_TOP_N = Number(process.env.ENDPOINT_METRICS_TOP_N || 10);
const ENDPOINT_METRICS_PROD = process.env.ENDPOINT_METRICS_PROD === '1';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Skip logging in production unless explicitly enabled
const shouldLog = NODE_ENV !== 'production' || ENDPOINT_METRICS_PROD;

/**
 * Middleware to track endpoint usage
 */
function endpointMetrics(req, res, next) {
  const route = `${req.method} ${req.path}`;
  
  // Track the request
  const current = routeCounts.get(route) || 0;
  routeCounts.set(route, current + 1);
  
  // Check if it's time to log
  const now = Date.now();
  if (shouldLog && (now - lastLogTime) >= ENDPOINT_METRICS_INTERVAL_MS) {
    logTopEndpoints();
    lastLogTime = now;
  }
  
  next();
}

/**
 * Log top N endpoints by request count
 */
function logTopEndpoints() {
  if (routeCounts.size === 0) return;
  
  const sorted = Array.from(routeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, ENDPOINT_METRICS_TOP_N);
  
  const total = Array.from(routeCounts.values()).reduce((sum, count) => sum + count, 0);
  
  console.log('[endpoint-metrics] Top endpoints (last 60s):');
  sorted.forEach(([route, count], idx) => {
    const pct = ((count / total) * 100).toFixed(1);
    console.log(`  ${idx + 1}. ${route}: ${count} (${pct}%)`);
  });
  
  // Reset counters
  routeCounts.clear();
}

/**
 * Get current metrics (for debugging/admin)
 */
function getMetrics() {
  return {
    routes: Object.fromEntries(routeCounts),
    total: Array.from(routeCounts.values()).reduce((sum, count) => sum + count, 0),
    intervalMs: ENDPOINT_METRICS_INTERVAL_MS,
    enabled: shouldLog
  };
}

module.exports = { endpointMetrics, getMetrics };