// server/services/idlePoolCloser.js
// Monitors database idle time and closes pool to enable Neon scale-to-zero

const DB_IDLE_CLOSE_MINUTES = Number(process.env.DB_IDLE_CLOSE_MINUTES || 0); // disabled by default

let lastRequestTime = Date.now();
let idleTimer = null;
let poolClosed = false;

/**
 * Update last request timestamp
 */
function updateLastRequest() {
  lastRequestTime = Date.now();
  poolClosed = false;
  
  // Reset timer if pool is still open
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  
  if (DB_IDLE_CLOSE_MINUTES > 0) {
    idleTimer = setTimeout(checkIdle, DB_IDLE_CLOSE_MINUTES * 60 * 1000);
  }
}

/**
 * Check if we should close the pool due to inactivity
 */
function checkIdle() {
  const now = Date.now();
  const idleMs = now - lastRequestTime;
  const idleMinutes = idleMs / (1000 * 60);
  
  if (idleMinutes >= DB_IDLE_CLOSE_MINUTES && !poolClosed) {
    console.log(`[idle-pool-closer] closing pool after ${idleMinutes.toFixed(1)} minutes of inactivity`);
    
    try {
      const { closePool } = require('../models/db');
      if (closePool) {
        closePool();
        poolClosed = true;
        console.log('[idle-pool-closer] pool closed successfully');
      }
    } catch (error) {
      console.warn('[idle-pool-closer] failed to close pool:', error.message);
    }
  }
  
  idleTimer = null;
}

/**
 * Initialize idle pool closer if enabled
 */
function init() {
  if (DB_IDLE_CLOSE_MINUTES <= 0) {
    console.log('[idle-pool-closer] disabled (DB_IDLE_CLOSE_MINUTES=0)');
    return;
  }
  
  console.log(`[idle-pool-closer] enabled, will close pool after ${DB_IDLE_CLOSE_MINUTES} minutes of inactivity`);
  updateLastRequest();
}

/**
 * Express middleware to track request activity
 */
function trackActivity(req, res, next) {
  updateLastRequest();
  next();
}

/**
 * Get current status
 */
function getStatus() {
  const now = Date.now();
  const idleMs = now - lastRequestTime;
  
  return {
    enabled: DB_IDLE_CLOSE_MINUTES > 0,
    idleCloseMinutes: DB_IDLE_CLOSE_MINUTES,
    lastRequestTime,
    idleMs,
    idleMinutes: idleMs / (1000 * 60),
    poolClosed,
    nextCheckIn: idleTimer ? (DB_IDLE_CLOSE_MINUTES * 60 * 1000 - idleMs) : null
  };
}

module.exports = {
  init,
  trackActivity,
  updateLastRequest,
  getStatus
};