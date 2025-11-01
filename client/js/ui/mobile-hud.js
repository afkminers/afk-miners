function noop() {}

function togglePressed(btn, pressed) {
  if (!btn) return;
  if (pressed) btn.classList.add('is-pressed');
  else btn.classList.remove('is-pressed');
}

export function installMobileHud({
  onTarget = noop,
  onBag = noop,
  onMenu = noop,
  onAttackStart = noop,
  onAttackStop = noop,
  metrics = noop,
} = {}) {
  const root = document.getElementById('mobileHud');
  if (!root) return null;

  root.hidden = false;
  root.dataset.active = '1';

  const attackBtn = root.querySelector('[data-action="attack"]');
  const targetBtn = root.querySelector('[data-action="target"]');
  const bagBtn = root.querySelector('[data-action="bag"]');
  const menuBtn = root.querySelector('[data-action="menu"]');

  const safe = root.querySelector('.mobile-hud__safe');

  function updateOrientation() {
    const portrait = window.innerHeight >= window.innerWidth;
    root.dataset.orientation = portrait ? 'portrait' : 'landscape';
  }

  updateOrientation();
  window.addEventListener('resize', updateOrientation);
  window.addEventListener('orientationchange', updateOrientation);

  function handlePress(btn, cbDown, cbUp) {
    if (!btn) return;
    btn.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      togglePressed(btn, true);
      btn.setPointerCapture?.(event.pointerId);
      cbDown(event);
    });
    btn.addEventListener('pointerup', (event) => {
      togglePressed(btn, false);
      cbUp(event);
    });
    btn.addEventListener('pointercancel', () => togglePressed(btn, false));
    btn.addEventListener('click', (event) => event.preventDefault());
  }

  handlePress(attackBtn, () => {
    const targetId = window.combatState?.targetId || null;
    if (!targetId) return;
    metrics('hud_attack');
    onAttackStart(targetId);
  }, () => {
    onAttackStop();
  });

  if (targetBtn) {
    targetBtn.addEventListener('click', (event) => {
      event.preventDefault();
      metrics('hud_target');
      onTarget();
    });
  }

  if (bagBtn) {
    bagBtn.addEventListener('click', (event) => {
      event.preventDefault();
      metrics('hud_bag');
      onBag();
    });
  }

  if (menuBtn) {
    menuBtn.addEventListener('click', (event) => {
      event.preventDefault();
      metrics('hud_menu');
      onMenu();
    });
  }

  function setAttackEnabled(value) {
    if (attackBtn) attackBtn.disabled = !value;
  }

  function setTargetEnabled(value) {
    if (targetBtn) targetBtn.disabled = !value;
  }

  function destroy() {
    window.removeEventListener('resize', updateOrientation);
    window.removeEventListener('orientationchange', updateOrientation);
    root.dataset.active = '0';
    root.hidden = true;
  }

  return {
    root,
    safe,
    setAttackEnabled,
    setTargetEnabled,
    updateOrientation,
    destroy,
  };
}

export function attachDefaultHudActions(api) {
  if (!api) return;
  const metrics = (kind) => {
    if (!window.MobileInputStats) window.MobileInputStats = { events: {} };
    const stats = window.MobileInputStats;
    stats.events[kind] = (stats.events[kind] || 0) + 1;
    window.dispatchEvent(new CustomEvent('mobile:event', { detail: { kind } }));
  };

  const hud = installMobileHud({
    onTarget: () => {
      api.onTarget?.();
    },
    onBag: () => {
      api.onBag?.();
    },
    onMenu: () => {
      api.onMenu?.();
    },
    onAttackStart: (targetId) => {
      api.onAttackStart?.(targetId);
    },
    onAttackStop: () => {
      api.onAttackStop?.();
    },
    metrics,
  });
  return hud;
}
