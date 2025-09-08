// client/js/combat/actions.js
import { apiPost } from '../api.js';

export const CombatActions = {
  async startAttack(targetId) {
    try {
      // Intenção de ataque; servidor é autoritário (aplica dano e broadcast WS)
      await apiPost('/api/combat/attack', { targetId: String(targetId) });
      window.dispatchEvent(new CustomEvent('combat:attack:start', { detail: { targetId: String(targetId) } }));
    } catch (e) {
      console.warn('[combat] startAttack failed:', e?.message || e);
    }
  },
  async stopAttack() {
    window.dispatchEvent(new Event('combat:attack:stop'));
  },
  async pickupLoot(lootId) {
    try {
      await apiPost('/api/loot/pickup', { lootId: String(lootId) });
      window.dispatchEvent(new CustomEvent('loot:picked', { detail: { lootId: String(lootId) } }));
    } catch (e) {
      console.warn('[loot] pickup failed:', e?.message || e);
    }
  },
};
window.CombatActions = CombatActions;
