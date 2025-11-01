const SUPPORTED_LANGS = ['en', 'pt-BR'];
const FALLBACK_LANG = 'en';
const bundleCache = Object.create(null);

let currentLang = FALLBACK_LANG;
let ready = false;
let pending = Promise.resolve();
let activeMessages = {};
let fallbackMessages = {};
let readyDispatched = false;
let numberFormatter = new Intl.NumberFormat(FALLBACK_LANG);
let dateFormatter = new Intl.DateTimeFormat(FALLBACK_LANG);

const readyCallbacks = [];
const changeCallbacks = [];

function normalizeLang(input) {
  const value = String(input || '').trim();
  if (!value) return FALLBACK_LANG;
  const lower = value.toLowerCase();
  if (lower === 'pt-br' || lower === 'pt' || lower === 'pt_br') return 'pt-BR';
  if (lower.startsWith('en')) return 'en';
  if (SUPPORTED_LANGS.includes(value)) return value;
  return FALLBACK_LANG;
}

function readCookieLang() {
  if (typeof document === 'undefined') return null;
  const cookies = document.cookie ? document.cookie.split(';') : [];
  for (const part of cookies) {
    const [name, rawValue] = part.split('=').map((x) => x.trim());
    if (name === 'lang' && rawValue) {
      try {
        return decodeURIComponent(rawValue);
      } catch {
        return rawValue;
      }
    }
  }
  return null;
}

function detectInitialLang() {
  let lang = null;
  try {
    lang = window.localStorage.getItem('lang');
  } catch {}
  if (!lang) {
    lang = readCookieLang();
  }
  if (!lang && typeof navigator !== 'undefined') {
    lang = navigator.language || (Array.isArray(navigator.languages) ? navigator.languages[0] : '');
  }
  return normalizeLang(lang);
}

function persistLang(lang) {
  try {
    window.localStorage.setItem('lang', lang);
  } catch {}
  try {
    document.cookie = `lang=${encodeURIComponent(lang)}; path=/; max-age=31536000`;
  } catch {}
}

function setDocumentLanguage(lang) {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  if (html) {
    html.lang = lang;
    html.dir = 'ltr';
  }
}

async function importBundle(lang) {
  if (!SUPPORTED_LANGS.includes(lang)) return {};
  if (!bundleCache[lang]) {
    if (lang === 'en') {
      bundleCache[lang] = import('./en.js').then((mod) => mod.default || mod.messages || {});
    } else if (lang === 'pt-BR') {
      bundleCache[lang] = import('./pt-BR.js').then((mod) => mod.default || mod.messages || {});
    } else {
      bundleCache[lang] = Promise.resolve({});
    }
  }
  try {
    return await bundleCache[lang];
  } catch (err) {
    console.warn('[i18n] Failed to load bundle for', lang, err);
    return {};
  }
}

function deepMerge(target, source) {
  if (!source || typeof source !== 'object') {
    return target;
  }
  const out = Array.isArray(target) ? target.slice() : { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = deepMerge(out[key] && typeof out[key] === 'object' ? out[key] : {}, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function resolveKey(messages, key) {
  if (!messages) return undefined;
  const parts = String(key).split('.');
  let node = messages;
  for (const part of parts) {
    if (node && Object.prototype.hasOwnProperty.call(node, part)) {
      node = node[part];
    } else {
      return undefined;
    }
  }
  return node;
}

function interpolate(template, vars = {}) {
  if (typeof template !== 'string') return template;
  return template.replace(/\{(\w+)\}/g, (_, token) => {
    if (Object.prototype.hasOwnProperty.call(vars, token)) {
      const value = vars[token];
      return value == null ? '' : String(value);
    }
    return `{${token}}`;
  });
}

function applyTranslations(root = document) {
  if (typeof document === 'undefined') return;
  const scope = root || document;
  scope.querySelectorAll?.('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    const value = i18n.t(key);
    if (value == null) return;
    if (el.hasAttribute('data-i18n-html')) {
      el.innerHTML = value;
    } else {
      el.textContent = value;
    }
  });

  scope.querySelectorAll?.('[data-i18n-attr]').forEach((el) => {
    const attrList = el.getAttribute('data-i18n-attr');
    if (!attrList) return;
    attrList.split(',').map((p) => p.trim()).filter(Boolean).forEach((attr) => {
      const cleaned = attr.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      const datasetKey = `i18n${cleaned.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')}`;
      const directAttr = `data-i18n-${attr}`;
      let key = null;
      if (Object.prototype.hasOwnProperty.call(el.dataset, datasetKey)) {
        key = el.dataset[datasetKey];
      } else if (el.hasAttribute(directAttr)) {
        key = el.getAttribute(directAttr);
      } else {
        key = el.getAttribute('data-i18n');
      }
      if (!key) return;
      const value = i18n.t(key);
      if (value == null) return;
      el.setAttribute(attr, value);
    });
  });
}

function updateFormatters(lang) {
  try {
    numberFormatter = new Intl.NumberFormat(lang);
  } catch {
    numberFormatter = new Intl.NumberFormat(FALLBACK_LANG);
  }
  try {
    dateFormatter = new Intl.DateTimeFormat(lang);
  } catch {
    dateFormatter = new Intl.DateTimeFormat(FALLBACK_LANG);
  }
}

function dispatchEvent(type, detail) {
  if (typeof document === 'undefined') return;
  try {
    document.dispatchEvent(new CustomEvent(type, { detail }));
  } catch {}
}

async function changeLanguage(nextLang) {
  const normalized = normalizeLang(nextLang);
  if (ready && normalized === currentLang) {
    return currentLang;
  }

  const fallback = await importBundle(FALLBACK_LANG);
  fallbackMessages = fallback || {};

  let messages = fallbackMessages;
  if (normalized !== FALLBACK_LANG) {
    const specific = await importBundle(normalized);
    messages = deepMerge(fallbackMessages, specific);
  }

  activeMessages = messages || {};
  currentLang = normalized;
  persistLang(currentLang);
  setDocumentLanguage(currentLang);
  updateFormatters(currentLang);
  applyTranslations(document);

  if (!ready) {
    ready = true;
    if (!readyDispatched) {
      readyDispatched = true;
      readyCallbacks.splice(0).forEach((cb) => {
        try { cb(currentLang); } catch (err) { console.error(err); }
      });
      dispatchEvent('i18n:ready', { lang: currentLang });
    }
  }

  changeCallbacks.forEach((cb) => {
    try { cb(currentLang); } catch (err) { console.error(err); }
  });
  dispatchEvent('i18n:change', { lang: currentLang });

  schedulePrefetch();

  return currentLang;
}

let prefetchScheduled = false;
function schedulePrefetch() {
  if (!ready || prefetchScheduled) return;
  prefetchScheduled = true;
  if (typeof window === 'undefined') return;
  window.requestAnimationFrame(() => {
    const alt = currentLang === 'en' ? 'pt-BR' : 'en';
    if (!SUPPORTED_LANGS.includes(alt)) return;
    if (typeof document !== 'undefined') {
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.as = 'script';
      try {
        link.href = new URL(`./${alt}.js`, import.meta.url).href;
      } catch {
        link.href = `js/i18n/${alt}.js`;
      }
      document.head?.appendChild(link);
    }
    importBundle(alt);
  });
}

const i18n = {
  getLang() {
    return currentLang;
  },
  setLang(lang) {
    pending = pending.then(() => changeLanguage(lang));
    return pending;
  },
  onReady(cb) {
    if (typeof cb !== 'function') return;
    if (ready) {
      try { cb(currentLang); } catch (err) { console.error(err); }
    } else {
      readyCallbacks.push(cb);
    }
  },
  onChange(cb) {
    if (typeof cb !== 'function') return;
    changeCallbacks.push(cb);
  },
  t(key, vars) {
    if (!key) return '';
    const value = resolveKey(activeMessages, key);
    if (value !== undefined) {
      return typeof value === 'string' ? interpolate(value, vars) : value;
    }
    const fallbackValue = resolveKey(fallbackMessages, key);
    if (fallbackValue !== undefined) {
      if (typeof fallbackValue === 'string') {
        console.warn(`[i18n] Missing "${key}" in ${currentLang}, falling back to en`);
        return interpolate(fallbackValue, vars);
      }
      return fallbackValue;
    }
    console.warn(`[i18n] Missing key: ${key}`);
    return key;
  },
  format: {
    number(value, options) {
      if (options) {
        try {
          return new Intl.NumberFormat(currentLang, options).format(value);
        } catch {
          return numberFormatter.format(value);
        }
      }
      return numberFormatter.format(value);
    },
    date(value, options) {
      const date = value instanceof Date ? value : new Date(value);
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
      if (options) {
        try {
          return new Intl.DateTimeFormat(currentLang, options).format(date);
        } catch {
          return dateFormatter.format(date);
        }
      }
      return dateFormatter.format(date);
    },
  },
  _applyTranslations: applyTranslations,
};

if (typeof window !== 'undefined') {
  window.i18n = i18n;
}

const initialLang = detectInitialLang();
setDocumentLanguage(initialLang);
i18n.setLang(initialLang);

if (typeof document !== 'undefined' && document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    applyTranslations(document);
  });
}

export { i18n };
export default i18n;
