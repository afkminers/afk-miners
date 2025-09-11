// client/js/api_tick_example.js
// Example usage of the new /api/game/tick endpoint to reduce polling overhead

/**
 * Example of how to migrate from multiple polling endpoints to single aggregated tick
 * 
 * BEFORE (multiple polls):
 * - GET /api/player/pos every 1s
 * - GET /api/chat/global every 3s  
 * - GET /api/map/{map}/loot every 2s
 * - GET /api/combat/status every 1s
 * - GET /api/backpack every 5s
 * 
 * AFTER (single poll):
 * - GET /api/game/tick every 2s with all data combined
 */

class GameTickClient {
  constructor(options = {}) {
    this.pollInterval = options.pollInterval || 2000; // 2 seconds
    this.baseUrl = options.baseUrl || '';
    this.lastChatId = 0;
    this.isPolling = false;
    this.pollTimer = null;
    this.onUpdate = options.onUpdate || ((data) => console.log('Game tick:', data));
    this.onError = options.onError || ((error) => console.error('Game tick error:', error));
  }

  /**
   * Start polling the aggregated game tick endpoint
   */
  start() {
    if (this.isPolling) return;
    
    this.isPolling = true;
    console.log('[GameTick] Starting aggregated polling every', this.pollInterval, 'ms');
    
    // Initial fetch
    this.fetchTick();
    
    // Set up polling
    this.pollTimer = setInterval(() => {
      this.fetchTick();
    }, this.pollInterval);
  }

  /**
   * Stop polling
   */
  stop() {
    if (!this.isPolling) return;
    
    this.isPolling = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    console.log('[GameTick] Stopped polling');
  }

  /**
   * Fetch aggregated game state
   */
  async fetchTick() {
    if (!this.isPolling) return;

    try {
      const params = new URLSearchParams();
      
      // Only fetch new chat messages
      if (this.lastChatId > 0) {
        params.set('sinceChatId', this.lastChatId.toString());
      }
      
      // Optional: disable sections you don't need
      // params.set('includeLoot', 'false');
      // params.set('includeCombat', 'false');
      
      const url = `${this.baseUrl}/api/game/tick${params.toString() ? '?' + params.toString() : ''}`;
      const response = await fetch(url, {
        credentials: 'include' // Include cookies for auth
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Update last chat ID for incremental updates
      if (data.chat && data.chat.length > 0) {
        this.lastChatId = Math.max(...data.chat.map(msg => msg.id));
      }
      
      // Call update handler
      this.onUpdate(data);
      
    } catch (error) {
      this.onError(error);
    }
  }

  /**
   * Force immediate tick fetch
   */
  async forceTick() {
    return this.fetchTick();
  }
}

// Example usage:
if (typeof window !== 'undefined') {
  // Browser environment
  window.GameTickClient = GameTickClient;
  
  // Example initialization
  window.initGameTick = function() {
    const gameTickClient = new GameTickClient({
      pollInterval: 2000,
      onUpdate: (data) => {
        // Update game state
        if (data.pos) {
          console.log('Player position:', data.pos);
          // updatePlayerPosition(data.pos);
        }
        
        if (data.hero) {
          console.log('Hero data:', data.hero);
          // updateHeroUI(data.hero);
        }
        
        if (data.chat && data.chat.length > 0) {
          console.log('New chat messages:', data.chat);
          // appendChatMessages(data.chat);
        }
        
        if (data.loot) {
          console.log('Loot on map:', data.loot);
          // updateLootDisplay(data.loot);
        }
        
        if (data.combat) {
          console.log('Combat entities:', data.combat);
          // updateCombatEntities(data.combat);
        }
        
        if (data.backpack) {
          console.log('Backpack contents:', data.backpack);
          // updateBackpackUI(data.backpack);
        }
      },
      onError: (error) => {
        console.error('Game tick failed:', error);
        // Maybe fall back to individual endpoints or show error to user
      }
    });
    
    // Start polling when player is authenticated
    gameTickClient.start();
    
    // Stop polling when player logs out or tab becomes inactive
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        gameTickClient.stop();
      } else {
        gameTickClient.start();
      }
    });
    
    return gameTickClient;
  };
}

// Node.js export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GameTickClient;
}

/**
 * Migration guide:
 * 
 * 1. Replace multiple setInterval calls with single GameTickClient
 * 2. Update your UI handlers to work with the aggregated data structure
 * 3. Use sinceChatId parameter to get only new chat messages
 * 4. Disable unused sections (loot/combat) when not needed
 * 5. Handle errors gracefully with fallback to individual endpoints
 * 
 * Benefits:
 * - Reduces API calls from ~10-15 per minute to ~30 per minute total
 * - Lower database load from fewer connection/query cycles
 * - Better performance on mobile/slow connections
 * - Easier to implement rate limiting if needed
 */