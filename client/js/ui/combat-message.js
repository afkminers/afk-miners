// client/js/ui/combat-message.js
// Simple floating message overlay for combat feedback (range/LOS warnings)

const CONTAINER_ID = 'combat-message-overlay';
const HIDE_DELAY_MS = 1600;
let hideTimer = null;

function ensureContainer() {
  let el = document.getElementById(CONTAINER_ID);
  if (el) return el;

  el = document.createElement('div');
  el.id = CONTAINER_ID;
  Object.assign(el.style, {
    position: 'absolute',
    top: '15%',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '6px 12px',
    borderRadius: '6px',
    background: 'rgba(0, 0, 0, 0.65)',
    color: '#fff',
    fontFamily: 'var(--hud-font, "Trebuchet MS", sans-serif)',
    fontSize: '15px',
    letterSpacing: '0.5px',
    textShadow: '0 0 4px rgba(0,0,0,0.8)',
    pointerEvents: 'none',
    opacity: '0',
    transition: 'opacity 160ms ease-in-out',
    zIndex: '9999',
    whiteSpace: 'nowrap',
  });

  document.body.appendChild(el);
  return el;
}

export function showCombatMessage(message) {
  if (!message) return;
  const el = ensureContainer();
  el.textContent = String(message);
  el.style.opacity = '1';

  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    el.style.opacity = '0';
  }, HIDE_DELAY_MS);
}

export function hideCombatMessage() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  const el = document.getElementById(CONTAINER_ID);
  if (el) {
    el.style.opacity = '0';
  }
}
