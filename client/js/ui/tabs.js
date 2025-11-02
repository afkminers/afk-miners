const TAB_STORAGE_KEY = 'hudTabActive';
const TAB_LIST_KEY = 'hudTabs';
const TABS = ['inventory', 'skills', 'quests'];

function activateTab(root, tabId) {
  const buttons = root.querySelectorAll('[data-tab]');
  const panels = root.querySelectorAll('[data-panel]');
  buttons.forEach((btn) => {
    const isActive = btn.dataset.tab === tabId;
    btn.setAttribute('aria-selected', String(isActive));
    btn.dataset.active = isActive ? 'true' : 'false';
  });
  panels.forEach((panel) => {
    const isActive = panel.dataset.panel === tabId;
    panel.hidden = !isActive;
  });
  try {
    localStorage.setItem(TAB_STORAGE_KEY, tabId);
    localStorage.setItem(TAB_LIST_KEY, TABS.join('|'));
  } catch (_) {}
}

function initTabs(root) {
  if (!root) return null;
  const stored = (() => {
    try { return localStorage.getItem(TAB_STORAGE_KEY); } catch (_) { return null; }
  })();
  const defaultTab = TABS.includes(stored) ? stored : TABS[0];
  root.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const tab = target.closest('[data-tab]');
    if (!tab) return;
    const tabId = tab.dataset.tab;
    if (!tabId) return;
    event.preventDefault();
    activateTab(root, tabId);
  });
  activateTab(root, defaultTab);
  return {
    activate(tabId) {
      if (tabId && TABS.includes(tabId)) activateTab(root, tabId);
    },
    current() {
      const btn = root.querySelector('[data-tab][data-active="true"]');
      return btn ? btn.dataset.tab : null;
    },
  };
}

window.HudTabs = {
  init: initTabs,
  activate: (tabId) => {
    const root = document.querySelector('[data-hud-tabs]');
    if (root) activateTab(root, tabId);
  },
};

document.addEventListener('DOMContentLoaded', () => {
  const root = document.querySelector('[data-hud-tabs]');
  if (root) initTabs(root);
});

export { initTabs, activateTab };
