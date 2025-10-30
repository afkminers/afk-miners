// client/js/pages/common-nav.js

function markActiveLinks(currentPath) {
  const links = document.querySelectorAll('.nav-link');
  const normalized = currentPath.replace(/\/$/, '');
  links.forEach((link) => {
    const href = String(link.getAttribute('href') || '').replace(/\/$/, '');
    if (!href) return;
    const isActive = href === normalized;
    link.classList.toggle('is-active', isActive);
    if (isActive) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });

  document.querySelectorAll('#mobileMenu a').forEach((link) => {
    const href = String(link.getAttribute('href') || '').replace(/\/$/, '');
    const isActive = href === normalized;
    link.classList.toggle('is-active', isActive);
    if (isActive) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });
}

function setupMobileMenu() {
  const btn = document.getElementById('btnHamb');
  const menu = document.getElementById('mobileMenu');
  if (!btn || !menu) return;

  btn.setAttribute('aria-expanded', 'false');
  menu.classList.remove('open');
  menu.setAttribute('aria-hidden', 'true');

  btn.addEventListener('click', () => {
    const isOpen = menu.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(isOpen));
    menu.setAttribute('aria-hidden', String(!isOpen));
  });

  menu.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      menu.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
      menu.setAttribute('aria-hidden', 'true');
    });
  });
}

function updateFooterYear() {
  const el = document.querySelector('[data-year]');
  if (el) {
    el.textContent = new Date().getFullYear();
  }
}

export function initPageChrome(currentPath) {
  setupMobileMenu();
  markActiveLinks(currentPath);
  updateFooterYear();
}
