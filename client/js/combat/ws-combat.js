// Stub: overlay novo lida com WS e desenho.
// Mantemos combatState só para compat com outros módulos que importem.

export const combatState = window.combatState || {
  monsters: new Map(),
  floaters: [],
  selectedTargetId: null,
};
window.combatState = combatState;

export function connectCombatWS() {
  // no-op (render-combat abre o WS)
  console.log('[ws-combat stub] using new overlay WS');
}

export default { connectCombatWS, combatState };
