import { i18n } from './core.js';

const FLAG_SVGS = {
  en: '<svg viewBox="0 0 18 12" aria-hidden="true" focusable="false"><rect width="18" height="12" fill="#b22234"/><g fill="#fff"><rect y="2" width="18" height="1"/><rect y="5" width="18" height="1"/><rect y="8" width="18" height="1"/><rect y="11" width="18" height="1"/></g><rect width="7" height="6" fill="#3c3b6e"/><g fill="#fff" transform="scale(0.24)"><g transform="translate(2,2)"><polygon points="1,0 1.309,0.951 2.236,0.691 1.618,1.5 2.236,2.309 1.309,2.049 1,3 0.691,2.049 -0.236,2.309 0.382,1.5 -0.236,0.691 0.691,0.951"/></g><g transform="translate(8,2)"><polygon points="1,0 1.309,0.951 2.236,0.691 1.618,1.5 2.236,2.309 1.309,2.049 1,3 0.691,2.049 -0.236,2.309 0.382,1.5 -0.236,0.691 0.691,0.951"/></g><g transform="translate(14,2)"><polygon points="1,0 1.309,0.951 2.236,0.691 1.618,1.5 2.236,2.309 1.309,2.049 1,3 0.691,2.049 -0.236,2.309 0.382,1.5 -0.236,0.691 0.691,0.951"/></g><g transform="translate(2,8)"><polygon points="1,0 1.309,0.951 2.236,0.691 1.618,1.5 2.236,2.309 1.309,2.049 1,3 0.691,2.049 -0.236,2.309 0.382,1.5 -0.236,0.691 0.691,0.951"/></g><g transform="translate(8,8)"><polygon points="1,0 1.309,0.951 2.236,0.691 1.618,1.5 2.236,2.309 1.309,2.049 1,3 0.691,2.049 -0.236,2.309 0.382,1.5 -0.236,0.691 0.691,0.951"/></g><g transform="translate(14,8)"><polygon points="1,0 1.309,0.951 2.236,0.691 1.618,1.5 2.236,2.309 1.309,2.049 1,3 0.691,2.049 -0.236,2.309 0.382,1.5 -0.236,0.691 0.691,0.951"/></g></g></svg>',
  'pt-BR': '<svg viewBox="0 0 18 12" aria-hidden="true" focusable="false"><rect width="18" height="12" fill="#009b3a"/><polygon points="9,2 16,6 9,10 2,6" fill="#ffdf00"/><circle cx="9" cy="6" r="2.5" fill="#002776"/><path d="M6.8 5.7a3.2 3.2 0 0 1 4.4 0" stroke="#fff" stroke-width="0.4" fill="none"/></svg>',
};

const LABEL_KEYS = {
  en: 'lang.en',
  'pt-BR': 'lang.pt-BR',
};

function updateFlag(target, lang) {
  if (!target) return;
  target.innerHTML = FLAG_SVGS[lang] || '';
}

function updateOption(option, lang) {
  if (!option) return;
  const optionLang = option.getAttribute('data-lang-option');
  const isActive = optionLang === lang;
  option.setAttribute('aria-checked', isActive ? 'true' : 'false');
  option.classList.toggle('is-active', isActive);
  const flag = option.querySelector('[data-option-flag]');
  if (flag) {
    flag.innerHTML = FLAG_SVGS[optionLang] || '';
  }
  const name = option.querySelector('[data-lang-name]');
  if (name) {
    const key = LABEL_KEYS[optionLang] || LABEL_KEYS.en;
    name.textContent = i18n.t(key);
  }
  option.setAttribute('aria-label', i18n.t('lang.changeTo', {
    lang: i18n.t(LABEL_KEYS[optionLang] || LABEL_KEYS.en),
  }));
}

function setupMenu(root) {
  const button = root.querySelector('[data-lang-button]');
  const menu = root.querySelector('[data-lang-menu]');
  const options = Array.from(root.querySelectorAll('[data-lang-option]'));
  const flagTarget = root.querySelector('[data-lang-flag]');

  if (!button || !menu || options.length === 0) return;

  let open = false;

  function setOpen(next) {
    open = next;
    menu.hidden = !open;
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    menu.setAttribute('aria-hidden', open ? 'false' : 'true');
    button.classList.toggle('is-open', open);
    if (open) {
      const currentLang = i18n.getLang();
      const currentOption = options.find((opt) => opt.getAttribute('data-lang-option') === currentLang) || options[0];
      currentOption.focus();
    }
  }

  function closeMenu() {
    if (!open) return;
    setOpen(false);
    button.focus();
  }

  function handleOutsideClick(ev) {
    if (!open) return;
    if (!root.contains(ev.target)) {
      setOpen(false);
    }
  }

  document.addEventListener('click', handleOutsideClick);

  button.addEventListener('click', () => {
    setOpen(!open);
  });

  button.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' || ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      if (!open) {
        setOpen(true);
      }
    }
  });

  menu.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      closeMenu();
    }
  });

  options.forEach((option) => {
    option.addEventListener('click', () => {
      const lang = option.getAttribute('data-lang-option');
      i18n.setLang(lang);
      closeMenu();
    });
    option.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        const lang = option.getAttribute('data-lang-option');
        i18n.setLang(lang);
        closeMenu();
      }
    });
  });

  function refresh(lang) {
    updateFlag(flagTarget, lang);
    button.setAttribute('aria-label', i18n.t('lang.menu'));
    button.setAttribute('title', i18n.t('lang.menu'));
    const srCurrent = root.querySelector('[data-lang-current]');
    if (srCurrent) {
      srCurrent.textContent = i18n.t(LABEL_KEYS[lang] || LABEL_KEYS.en);
    }
    options.forEach((opt) => updateOption(opt, lang));
  }

  i18n.onReady((lang) => {
    refresh(lang);
  });

  i18n.onChange((lang) => {
    refresh(lang);
  });
}

i18n.onReady(() => {
  const roots = document.querySelectorAll('[data-lang-root]');
  roots.forEach((root) => setupMenu(root));
});
