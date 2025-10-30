// client/js/pages/overview.js
import { initPageChrome } from './common-nav.js';

function setupHeroCta() {
  const heroButton = document.querySelector('.hero-banner .cta-button');
  if (!heroButton) return;
  heroButton.addEventListener('click', () => {
    window.sessionStorage.setItem('afk-last-entry', String(Date.now()));
  });
}

function focusMain() {
  const main = document.getElementById('content');
  if (!main) return;
  try {
    main.focus({ preventScroll: true });
  } catch (_) {
    main.focus();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initPageChrome('/overview');
  setupHeroCta();
  focusMain();
});
