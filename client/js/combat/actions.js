// client/js/combat/actions.js
import { apiPost } from '../api.js';

export const CombatActions = {
  /**
   * Inicia ataque (mantive como está, só melhorias de segurança leve)
   */
  async startAttack(arg) {
    try {
      let payload;
      if (typeof arg === 'object' && arg !== null) {
        const { heroId, targetInstanceId, weaponType } = arg;
        if (!targetInstanceId && !arg.targetId) throw new Error('targetInstanceId é obrigatório');
        payload = {
          heroId: heroId ?? null,
          targetInstanceId: String(targetInstanceId ?? arg.targetId),
          weaponType: weaponType ?? null,
        };
      } else {
        payload = { targetInstanceId: String(arg) };
      }

      await apiPost('/api/combat/attack/start', payload);
      window.dispatchEvent(new CustomEvent('combat:attack:start', {
        detail: { targetId: String(payload.targetInstanceId) }
      }));
    } catch (e) {
      console.warn('[combat] startAttack failed:', e?.message || e);
    }
  },

  /**
   * Para o ataque (sem mudanças)
   */
  async stopAttack(heroId = null) {
    try {
      await apiPost('/api/combat/attack/stop', heroId ? { heroId } : {});
    } catch (e) {
      console.warn('[combat] stopAttack failed:', e?.message || e);
    } finally {
      window.dispatchEvent(new Event('combat:attack:stop'));
    }
  },

  /**
   * PICKUP: envia heroId ativo quando disponível
   */
  async pickupLoot(lootId) {
    try {
      // Procura um heroId ativo em lugares comuns do seu front:
      const heroId =
        window.ActiveHeroId ||
        (window.Team && typeof window.Team.getActiveHeroId === 'function' && window.Team.getActiveHeroId()) ||
        (window.GameScene && window.GameScene.activeHeroId) ||
        (window.Player && window.Player.activeHeroId) ||
        null;

      const payload = { lootId: String(lootId) };
      if (heroId != null && heroId !== '') payload.heroId = String(heroId);

      const r = await apiPost('/api/loot/pickup', payload);
      window.dispatchEvent(new CustomEvent('loot:picked', {
        detail: { lootId: String(lootId), items: r?.placedToBackpack || r?.items || [] }
      }));
      return r;
    } catch (e) {
      console.warn('[loot] pickup failed:', e?.message || e);
      return null;
    }
  },
};

window.CombatActions = CombatActions;
