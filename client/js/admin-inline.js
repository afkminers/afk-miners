import { i18n } from './i18n/core.js';

const SUPPORTED_LOCALES = ['en', 'pt-BR'];

const uiText = {
  en: {
    editButton: 'Edit page',
    closePanel: 'Close',
    panelTitle: 'Admin quick edit',
    localeLabel: 'Content language',
    refresh: 'Refresh',
    save: 'Save',
    reset: 'Use default',
    usingDefault: 'Using default translation',
    overrideUpdated: (date) => `Override updated ${date}`,
    overrideSaved: 'Text saved!',
    overrideRemoved: 'Override removed, default restored.',
    overrideError: 'Failed to save text. Try again.',
    valueRequired: 'Value is required.',
    loading: 'Loading…',
    postsTitle: 'Create a post for this page',
    postLocale: 'Locale',
    postTitle: 'Title',
    postSummary: 'Summary',
    postBody: 'Body HTML',
    postTag: 'Tag',
    postLinkLabel: 'Link label',
    postLinkHref: 'Link URL',
    postPublishedAt: 'Published at',
    postIsPublished: 'Visible on website',
    postSortIndex: 'Sort index',
    postSubmit: 'Publish post',
    postSaved: 'Post saved! It will appear on the page shortly.',
    postError: 'Could not save the post. Check the fields and try again.',
    postRequired: 'Fill the required fields before saving.',
    adminOnly: 'Only visible to administrators.',
  },
  'pt-BR': {
    editButton: 'Editar página',
    closePanel: 'Fechar',
    panelTitle: 'Edição rápida (admin)',
    localeLabel: 'Idioma do conteúdo',
    refresh: 'Recarregar',
    save: 'Salvar',
    reset: 'Usar padrão',
    usingDefault: 'Usando tradução padrão',
    overrideUpdated: (date) => `Override atualizado em ${date}`,
    overrideSaved: 'Texto salvo com sucesso!',
    overrideRemoved: 'Override removido. Texto padrão restaurado.',
    overrideError: 'Não foi possível salvar o texto. Tente novamente.',
    valueRequired: 'Informe um valor antes de salvar.',
    loading: 'Carregando…',
    postsTitle: 'Criar postagem para esta página',
    postLocale: 'Idioma',
    postTitle: 'Título',
    postSummary: 'Resumo',
    postBody: 'Corpo (HTML)',
    postTag: 'Tag',
    postLinkLabel: 'Texto do link',
    postLinkHref: 'URL do link',
    postPublishedAt: 'Publicado em',
    postIsPublished: 'Visível no site',
    postSortIndex: 'Índice de ordenação',
    postSubmit: 'Publicar notícia',
    postSaved: 'Post salvo! Ele aparecerá na página em instantes.',
    postError: 'Não foi possível salvar o post. Verifique os campos e tente novamente.',
    postRequired: 'Preencha os campos obrigatórios antes de salvar.',
    adminOnly: 'Visível apenas para administradores.',
  },
};

const styleId = 'inline-admin-style';
let stylesInjected = false;

const adminState = {
  checked: false,
  isAdmin: false,
  profile: null,
};

const bundleCache = new Map();
const overridesCache = new Map(); // locale => Map(key, override)
const baseValuesCache = new Map(); // locale => Map(key, baseValue)
const effectiveValuesCache = new Map(); // locale => Map(key, effective)

const panelState = {
  config: null,
  elements: null,
  controls: new Map(),
  currentLocale: null,
  built: false,
};

let floatingButton = null;

function getActiveLang() {
  try {
    const lang = typeof i18n?.getLang === 'function' ? i18n.getLang() : null;
    if (lang) return lang;
  } catch (_) {}
  const htmlLang = document.documentElement?.lang;
  return htmlLang === 'pt-BR' ? 'pt-BR' : 'en';
}

function tUI(key) {
  const lang = getActiveLang();
  const dict = uiText[lang] || uiText['en'];
  const value = dict[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'function') return value;
  const fallback = uiText['en'][key];
  return typeof fallback === 'string' || typeof fallback === 'function' ? fallback : key;
}

function ensureStyles() {
  if (stylesInjected) return;
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    .inline-admin-button {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 1200;
      background: linear-gradient(#f7c96c, #de9034);
      color: #2a1712;
      border: 4px solid #2a1712;
      border-radius: 14px;
      padding: 10px 16px;
      font-family: 'Press Start 2P', 'Pixelify Sans', monospace;
      font-size: 12px;
      box-shadow: 0 4px 0 rgba(0,0,0,0.4);
      cursor: pointer;
    }
    .inline-admin-button:hover {
      filter: brightness(1.05);
      transform: translateY(-1px);
    }
    .inline-admin-panel {
      position: fixed;
      top: 84px;
      right: 24px;
      width: min(420px, 92vw);
      max-height: calc(100vh - 120px);
      background: rgba(16, 9, 13, 0.96);
      border: 4px solid #3a2026;
      border-radius: 18px;
      color: #fce9d6;
      z-index: 1199;
      display: none;
      flex-direction: column;
      box-shadow: 0 16px 0 rgba(0,0,0,0.6);
      overflow: hidden;
    }
    .inline-admin-panel.is-open {
      display: flex;
    }
    .inline-admin-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px;
      background: rgba(40, 20, 26, 0.8);
      border-bottom: 1px solid rgba(255,255,255,0.08);
      gap: 12px;
    }
    .inline-admin-header h2 {
      font-size: 13px;
      margin: 0;
    }
    .inline-admin-close {
      background: transparent;
      border: 0;
      color: inherit;
      cursor: pointer;
      font-family: inherit;
      font-size: 12px;
      text-decoration: underline;
    }
    .inline-admin-body {
      padding: 0 16px 16px;
      overflow-y: auto;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 18px;
    }
    .inline-admin-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
      flex-wrap: wrap;
    }
    .inline-admin-toolbar label {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
    }
    .inline-admin-toolbar select {
      background: #2b171f;
      color: #fce9d6;
      border: 2px solid #4a2730;
      border-radius: 8px;
      padding: 4px 8px;
      font-family: inherit;
      font-size: 12px;
    }
    .inline-admin-toolbar button {
      background: #432029;
      color: #fce9d6;
      border: 2px solid #6c3843;
      border-radius: 8px;
      padding: 6px 10px;
      font-family: inherit;
      font-size: 11px;
      cursor: pointer;
    }
    .inline-admin-fields {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .inline-admin-group {
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      padding: 12px;
      background: rgba(20, 12, 16, 0.7);
    }
    .inline-admin-group h3 {
      margin: 0 0 10px;
      font-size: 12px;
    }
    .inline-field {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 12px;
    }
    .inline-field label {
      font-size: 11px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .inline-field textarea,
    .inline-field input[type="text"],
    .inline-field input[type="url"] {
      background: #1e1015;
      color: #fce9d6;
      border: 2px solid #43252e;
      border-radius: 8px;
      padding: 8px;
      font-family: inherit;
      font-size: 12px;
      min-height: 40px;
      resize: vertical;
    }
    .inline-field textarea {
      min-height: 80px;
    }
    .inline-field-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .inline-field-actions button {
      background: #4a2730;
      color: #fce9d6;
      border: 2px solid #6c3843;
      border-radius: 8px;
      padding: 6px 10px;
      font-family: inherit;
      font-size: 11px;
      cursor: pointer;
    }
    .inline-field-actions button[data-variant="reset"] {
      background: transparent;
      border-color: #6c3843;
    }
    .inline-field small {
      font-size: 10px;
      color: rgba(255,255,255,0.6);
    }
    .inline-field[data-has-override="1"] small {
      color: #f7c96c;
    }
    .inline-admin-status {
      margin: 0;
      padding: 10px 16px;
      font-size: 11px;
      border-top: 1px solid rgba(255,255,255,0.08);
      background: rgba(40, 20, 26, 0.75);
    }
    .inline-admin-status[data-type="success"] {
      color: #72ff9f;
    }
    .inline-admin-status[data-type="error"] {
      color: #ff8d8d;
    }
    .inline-posts-form {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 10px;
    }
    .inline-posts-form label {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 11px;
    }
    .inline-posts-form input,
    .inline-posts-form textarea,
    .inline-posts-form select {
      background: #1e1015;
      color: #fce9d6;
      border: 2px solid #43252e;
      border-radius: 8px;
      padding: 8px;
      font-family: inherit;
      font-size: 12px;
    }
    .inline-posts-form textarea {
      min-height: 90px;
      resize: vertical;
    }
    .inline-posts-form button[type="submit"] {
      margin-top: 6px;
      align-self: flex-start;
      background: linear-gradient(#f7c96c, #de9034);
      color: #2a1712;
      border: 3px solid #2a1712;
      border-radius: 10px;
      padding: 8px 14px;
      font-family: inherit;
      font-size: 12px;
      cursor: pointer;
    }
    .inline-admin-note {
      font-size: 10px;
      color: rgba(255,255,255,0.55);
      margin-bottom: 8px;
    }
  `;
  document.head.appendChild(style);
  stylesInjected = true;
}

function resolveKey(messages, key) {
  if (!messages) return undefined;
  const parts = key.split('.');
  let node = messages;
  for (const part of parts) {
    if (node && typeof node === 'object' && Object.prototype.hasOwnProperty.call(node, part)) {
      node = node[part];
    } else {
      return undefined;
    }
  }
  return node;
}

async function loadBundle(locale) {
  if (bundleCache.has(locale)) {
    return bundleCache.get(locale);
  }
  try {
    let loader;
    if (locale === 'en') {
      loader = () => import('./i18n/en.js');
    } else if (locale === 'pt-BR') {
      loader = () => import('./i18n/pt-BR.js');
    }
    if (!loader) {
      bundleCache.set(locale, {});
      return {};
    }
    const mod = await loader();
    const data = mod?.default || mod?.messages || mod || {};
    bundleCache.set(locale, data || {});
    return data || {};
  } catch (err) {
    console.warn('[inline-admin] failed to load bundle for', locale, err);
    bundleCache.set(locale, {});
    return {};
  }
}

function mapOverrides(rows) {
  const map = new Map();
  rows.forEach((row) => {
    if (!row?.key) return;
    map.set(row.key, row);
  });
  return map;
}

async function fetchOverrides(locale, prefixes = ['']) {
  const unique = Array.from(new Set(prefixes && prefixes.length ? prefixes : ['']));
  const results = [];
  for (const prefix of unique) {
    try {
      const params = new URLSearchParams({ lang: locale });
      if (prefix) params.set('prefix', prefix);
      const res = await fetch(`/api/admin/i18n?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) {
        console.warn('[inline-admin] failed to load overrides', locale, prefix, res.status);
        continue;
      }
      const data = await res.json();
      if (Array.isArray(data)) {
        results.push(...data);
      }
    } catch (err) {
      console.warn('[inline-admin] override fetch error', err);
    }
  }
  return mapOverrides(results);
}

function readCookie(name) {
  return document.cookie
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.split('='))
    .filter(([key]) => key === name)
    .map(([, value]) => {
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    })[0] || null;
}

let csrfToken = null;

async function ensureCsrf(force = false) {
  if (!force && csrfToken) return csrfToken;
  if (!force) {
    const cookie = readCookie('csrf');
    if (cookie) {
      csrfToken = cookie;
      return csrfToken;
    }
  }
  try {
    const res = await fetch('/api/csrf', { credentials: 'include' });
    const header = res.headers.get('X-Csrf-Token');
    csrfToken = header || readCookie('csrf');
  } catch (err) {
    console.warn('[inline-admin] csrf fetch failed', err);
    csrfToken = readCookie('csrf');
  }
  return csrfToken;
}

async function csrfFetch(url, options) {
  const { method = 'POST', body } = options || {};
  let token = await ensureCsrf(false);
  if (!token) {
    token = await ensureCsrf(true);
  }
  const doRequest = async (tok) => fetch(url, {
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': tok || '',
      'x-csrf-token': tok || '',
      'csrf-token': tok || '',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let response = await doRequest(token);
  if (response.status === 403) {
    token = await ensureCsrf(true);
    response = await doRequest(token);
  }
  return response;
}

function formatDate(iso, locale) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale === 'pt-BR' ? 'pt-BR' : 'en-US', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(date);
  } catch (err) {
    return date.toLocaleString();
  }
}

function setStatus(message, type = 'info') {
  if (!panelState.elements?.status) return;
  panelState.elements.status.textContent = message || '';
  panelState.elements.status.dataset.type = type;
}

async function ensureLocaleValues(locale) {
  if (!SUPPORTED_LOCALES.includes(locale)) {
    return;
  }

  if (!baseValuesCache.has(locale)) {
    baseValuesCache.set(locale, new Map());
  }
  if (!effectiveValuesCache.has(locale)) {
    effectiveValuesCache.set(locale, new Map());
  }

  const config = panelState.config;
  if (!config) return;

  const bundle = await loadBundle(locale);
  const fallbackBundle = locale === 'en' ? null : await loadBundle('en');
  const overrides = await fetchOverrides(locale, config.prefixes);
  overridesCache.set(locale, overrides);

  const baseValues = baseValuesCache.get(locale);
  const effectiveValues = effectiveValuesCache.get(locale);
  baseValues.clear();
  effectiveValues.clear();

  const groups = config.groups && config.groups.length
    ? config.groups
    : [{ fields: config.fields || [] }];

  groups.forEach((group) => {
    (group.fields || []).forEach((field) => {
      const key = field.key;
      if (!key) return;
      const override = overrides.get(key);
      const base = resolveKey(bundle, key);
      const fallback = fallbackBundle ? resolveKey(fallbackBundle, key) : undefined;
      const baseValue = typeof base === 'string' ? base : (typeof fallback === 'string' ? fallback : '');
      baseValues.set(key, baseValue);
      effectiveValues.set(key, override?.value ?? baseValue ?? '');
    });
  });
}

function updateFieldUI(locale, key) {
  const control = panelState.controls.get(key);
  if (!control) return;
  const wrapper = control.closest('.inline-field');
  const overrides = overridesCache.get(locale) || new Map();
  const override = overrides.get(key);
  const effective = (effectiveValuesCache.get(locale) || new Map()).get(key) ?? '';
  control.value = effective;
  const meta = wrapper?.querySelector('[data-inline-meta]');
  if (wrapper) {
    wrapper.dataset.hasOverride = override ? '1' : '0';
  }
  if (meta) {
    if (override?.updated_at) {
      meta.textContent = tUI('overrideUpdated')(formatDate(override.updated_at, locale));
    } else {
      meta.textContent = tUI('usingDefault');
    }
  }
  const keyLabel = wrapper?.querySelector('[data-inline-key]');
  if (keyLabel) {
    keyLabel.textContent = key;
  }
}

async function refreshLocale(locale) {
  setStatus(tUI('loading'), 'info');
  await ensureLocaleValues(locale);
  panelState.controls.forEach((_, key) => {
    updateFieldUI(locale, key);
  });
  setStatus(tUI('adminOnly'), 'info');
}

async function saveField(locale, field, control) {
  const key = field.key;
  if (!key) return;
  const value = control.value.trim();
  if (!value) {
    setStatus(tUI('valueRequired'), 'error');
    control.focus();
    return;
  }
  setStatus(tUI('loading'), 'info');
  const overrides = overridesCache.get(locale) || new Map();
  const existing = overrides.get(key);
  try {
    const payload = { locale, key, value };
    const url = existing ? `/api/admin/i18n/${existing.id}` : '/api/admin/i18n';
    const method = existing ? 'PUT' : 'POST';
    const res = await csrfFetch(url, { method, body: payload });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      throw new Error(data?.error || 'save_failed');
    }
    overrides.set(key, data);
    overridesCache.set(locale, overrides);
    effectiveValuesCache.get(locale)?.set(key, data.value);
    updateFieldUI(locale, key);
    setStatus(tUI('overrideSaved'), 'success');
    if (locale === getActiveLang()) {
      try { i18n.setLang(locale); } catch (_) {}
    }
    document.dispatchEvent(new CustomEvent('cms-override-updated', { detail: { locale, key } }));
  } catch (err) {
    console.error('[inline-admin] save override failed', err);
    setStatus(tUI('overrideError'), 'error');
  }
}

async function resetField(locale, field) {
  const key = field.key;
  const overrides = overridesCache.get(locale) || new Map();
  const existing = overrides.get(key);
  if (!existing) {
    effectiveValuesCache.get(locale)?.set(key, baseValuesCache.get(locale)?.get(key) ?? '');
    updateFieldUI(locale, key);
    setStatus(tUI('overrideRemoved'), 'success');
    return;
  }
  setStatus(tUI('loading'), 'info');
  try {
    const res = await csrfFetch(`/api/admin/i18n/${existing.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error || 'delete_failed');
    }
    overrides.delete(key);
    overridesCache.set(locale, overrides);
    const baseValue = baseValuesCache.get(locale)?.get(key) ?? '';
    effectiveValuesCache.get(locale)?.set(key, baseValue);
    updateFieldUI(locale, key);
    setStatus(tUI('overrideRemoved'), 'success');
    if (locale === getActiveLang()) {
      try { i18n.setLang(locale); } catch (_) {}
    }
    document.dispatchEvent(new CustomEvent('cms-override-updated', { detail: { locale, key } }));
  } catch (err) {
    console.error('[inline-admin] delete override failed', err);
    setStatus(tUI('overrideError'), 'error');
  }
}

function toLocalInputValue(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const tz = date.getTimezoneOffset();
  const local = new Date(date.getTime() - tz * 60000);
  return local.toISOString().slice(0, 16);
}

function collectPostPayload(form, page) {
  const locale = form.querySelector('[data-post-locale]')?.value || 'en';
  const title = form.querySelector('[data-post-title]')?.value.trim() || '';
  const summary = form.querySelector('[data-post-summary]')?.value.trim() || '';
  const body = form.querySelector('[data-post-body]')?.value.trim() || '';
  const tag = form.querySelector('[data-post-tag]')?.value.trim() || null;
  const linkLabel = form.querySelector('[data-post-link-label]')?.value.trim() || null;
  const linkHref = form.querySelector('[data-post-link-href]')?.value.trim() || null;
  const publishedRaw = form.querySelector('[data-post-published]')?.value || '';
  const isPublished = form.querySelector('[data-post-visible]')?.checked ?? true;
  const sortIndex = Number(form.querySelector('[data-post-sort]')?.value || 0);
  let publishedAt;
  if (publishedRaw) {
    const date = new Date(publishedRaw);
    if (!Number.isNaN(date.getTime())) {
      publishedAt = date.toISOString();
    }
  }

  return {
    page,
    locale,
    title,
    summary,
    body_html: body || null,
    tag: tag || null,
    link_label: linkLabel || null,
    link_href: linkHref || null,
    is_published: Boolean(isPublished),
    sort_index: Number.isFinite(sortIndex) ? sortIndex : 0,
    published_at: publishedAt,
  };
}

async function submitPost(form, config) {
  const payload = collectPostPayload(form, config.page);
  if (!payload.title || !payload.summary) {
    setStatus(tUI('postRequired'), 'error');
    return;
  }
  try {
    setStatus(tUI('loading'), 'info');
    const res = await csrfFetch('/api/admin/posts', { method: 'POST', body: payload });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      throw new Error(data?.error || 'post_failed');
    }
    form.reset();
    if (config.defaultSort != null) {
      form.querySelector('[data-post-sort]').value = String(config.defaultSort);
    }
    setStatus(tUI('postSaved'), 'success');
    document.dispatchEvent(new CustomEvent('cms-posts-changed', {
      detail: { page: config.page, locale: payload.locale },
    }));
  } catch (err) {
    console.error('[inline-admin] post create failed', err);
    setStatus(tUI('postError'), 'error');
  }
}

function buildFields(config) {
  const groups = config.groups && config.groups.length
    ? config.groups
    : [{ title: null, fields: config.fields || [] }];

  const fieldsContainer = panelState.elements.fields;
  fieldsContainer.innerHTML = '';
  panelState.controls.clear();

  groups.forEach((group, index) => {
    const wrapper = document.createElement('section');
    wrapper.className = 'inline-admin-group';
    if (group.title) {
      const title = document.createElement('h3');
      const currentLang = getActiveLang();
      if (typeof group.title === 'string') {
        title.textContent = group.title;
      } else {
        title.textContent = group.title[currentLang] || group.title['en'] || Object.values(group.title)[0] || '';
      }
      wrapper.appendChild(title);
    } else if (index === 0) {
      const title = document.createElement('h3');
      title.textContent = tUI('panelTitle');
      wrapper.appendChild(title);
    }

    (group.fields || []).forEach((field) => {
      if (!field?.key) return;
      const fieldWrapper = document.createElement('div');
      fieldWrapper.className = 'inline-field';
      fieldWrapper.dataset.hasOverride = '0';
      const label = document.createElement('label');
      const labelText = document.createElement('span');
      const currentLang = getActiveLang();
      if (typeof field.label === 'string') {
        labelText.textContent = field.label;
      } else if (field.label && typeof field.label === 'object') {
        labelText.textContent = field.label[currentLang] || field.label['en'] || Object.values(field.label)[0] || field.key;
      } else {
        labelText.textContent = field.key;
      }
      label.appendChild(labelText);
      const keyLine = document.createElement('small');
      keyLine.dataset.inlineKey = '';
      label.appendChild(keyLine);

      let control;
      if (field.multiline !== false) {
        control = document.createElement('textarea');
      } else {
        control = document.createElement('input');
        control.type = 'text';
      }
      control.dataset.fieldKey = field.key;
      label.appendChild(control);
      fieldWrapper.appendChild(label);

      const meta = document.createElement('small');
      meta.dataset.inlineMeta = '';
      fieldWrapper.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'inline-field-actions';

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.textContent = tUI('save');
      saveBtn.addEventListener('click', () => saveField(panelState.currentLocale, field, control));
      actions.appendChild(saveBtn);

      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.dataset.variant = 'reset';
      resetBtn.textContent = tUI('reset');
      resetBtn.addEventListener('click', () => resetField(panelState.currentLocale, field));
      actions.appendChild(resetBtn);

      fieldWrapper.appendChild(actions);
      wrapper.appendChild(fieldWrapper);
      fieldsContainer.appendChild(wrapper);
      panelState.controls.set(field.key, control);
    });
  });
}

function buildPostsForm(config) {
  const section = panelState.elements.posts;
  if (!section || !config.posts?.enabled) return;
  section.innerHTML = '';

  const title = document.createElement('h3');
  title.textContent = tUI('postsTitle');
  section.appendChild(title);

  const note = document.createElement('p');
  note.className = 'inline-admin-note';
  note.textContent = tUI('adminOnly');
  section.appendChild(note);

  const form = document.createElement('form');
  form.className = 'inline-posts-form';
  form.noValidate = true;

  const localeLabel = document.createElement('label');
  localeLabel.textContent = tUI('postLocale');
  const localeSelect = document.createElement('select');
  localeSelect.dataset.postLocale = '';
  SUPPORTED_LOCALES.forEach((loc) => {
    const option = document.createElement('option');
    option.value = loc;
    option.textContent = loc;
    localeSelect.appendChild(option);
  });
  localeSelect.value = getActiveLang();
  localeLabel.appendChild(localeSelect);
  form.appendChild(localeLabel);

  const titleField = document.createElement('label');
  titleField.textContent = tUI('postTitle');
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.required = true;
  titleInput.dataset.postTitle = '';
  titleField.appendChild(titleInput);
  form.appendChild(titleField);

  const summaryField = document.createElement('label');
  summaryField.textContent = tUI('postSummary');
  const summaryInput = document.createElement('textarea');
  summaryInput.required = true;
  summaryInput.dataset.postSummary = '';
  summaryField.appendChild(summaryInput);
  form.appendChild(summaryField);

  const bodyField = document.createElement('label');
  bodyField.textContent = tUI('postBody');
  const bodyInput = document.createElement('textarea');
  bodyInput.dataset.postBody = '';
  bodyField.appendChild(bodyInput);
  form.appendChild(bodyField);

  const tagField = document.createElement('label');
  tagField.textContent = tUI('postTag');
  const tagInput = document.createElement('input');
  tagInput.type = 'text';
  tagInput.dataset.postTag = '';
  tagField.appendChild(tagInput);
  form.appendChild(tagField);

  const linkLabelField = document.createElement('label');
  linkLabelField.textContent = tUI('postLinkLabel');
  const linkLabelInput = document.createElement('input');
  linkLabelInput.type = 'text';
  linkLabelInput.dataset.postLinkLabel = '';
  linkLabelField.appendChild(linkLabelInput);
  form.appendChild(linkLabelField);

  const linkHrefField = document.createElement('label');
  linkHrefField.textContent = tUI('postLinkHref');
  const linkHrefInput = document.createElement('input');
  linkHrefInput.type = 'url';
  linkHrefInput.dataset.postLinkHref = '';
  linkHrefField.appendChild(linkHrefInput);
  form.appendChild(linkHrefField);

  const publishedField = document.createElement('label');
  publishedField.textContent = tUI('postPublishedAt');
  const publishedInput = document.createElement('input');
  publishedInput.type = 'datetime-local';
  publishedInput.dataset.postPublished = '';
  publishedInput.value = toLocalInputValue(new Date().toISOString());
  publishedField.appendChild(publishedInput);
  form.appendChild(publishedField);

  const visibilityField = document.createElement('label');
  const visibilityText = document.createElement('span');
  visibilityText.textContent = tUI('postIsPublished');
  const visibilityInput = document.createElement('input');
  visibilityInput.type = 'checkbox';
  visibilityInput.checked = true;
  visibilityInput.dataset.postVisible = '';
  visibilityField.appendChild(visibilityText);
  visibilityField.appendChild(visibilityInput);
  form.appendChild(visibilityField);

  const sortField = document.createElement('label');
  sortField.textContent = tUI('postSortIndex');
  const sortInput = document.createElement('input');
  sortInput.type = 'number';
  sortInput.dataset.postSort = '';
  sortInput.value = String(config.posts?.defaultSort ?? 0);
  sortField.appendChild(sortInput);
  form.appendChild(sortField);

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.textContent = tUI('postSubmit');
  form.appendChild(submit);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitPost(form, config.posts);
  });

  section.appendChild(form);
}

function buildPanel(config) {
  if (panelState.built) return;
  ensureStyles();
  panelState.config = config;
  const panel = document.createElement('aside');
  panel.className = 'inline-admin-panel';
  panel.setAttribute('aria-hidden', 'true');

  const header = document.createElement('div');
  header.className = 'inline-admin-header';
  const title = document.createElement('h2');
  title.textContent = tUI('panelTitle');
  header.appendChild(title);
  const close = document.createElement('button');
  close.className = 'inline-admin-close';
  close.type = 'button';
  close.textContent = tUI('closePanel');
  close.addEventListener('click', () => togglePanel(false));
  header.appendChild(close);
  panel.appendChild(header);

  const body = document.createElement('div');
  body.className = 'inline-admin-body';

  const textSection = document.createElement('section');
  const toolbar = document.createElement('div');
  toolbar.className = 'inline-admin-toolbar';
  const localeLabel = document.createElement('label');
  localeLabel.textContent = tUI('localeLabel');
  const localeSelect = document.createElement('select');
  localeSelect.dataset.localeSelector = '';
  SUPPORTED_LOCALES.forEach((loc) => {
    const option = document.createElement('option');
    option.value = loc;
    option.textContent = loc;
    localeSelect.appendChild(option);
  });
  localeSelect.value = getActiveLang();
  localeLabel.appendChild(localeSelect);
  toolbar.appendChild(localeLabel);

  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.textContent = tUI('refresh');
  refreshBtn.addEventListener('click', () => refreshLocale(panelState.currentLocale));
  toolbar.appendChild(refreshBtn);

  textSection.appendChild(toolbar);

  const fields = document.createElement('div');
  fields.className = 'inline-admin-fields';
  textSection.appendChild(fields);

  body.appendChild(textSection);

  const postsSection = document.createElement('section');
  postsSection.className = 'inline-admin-posts';
  if (!config.posts?.enabled) {
    postsSection.hidden = true;
  }
  body.appendChild(postsSection);

  panel.appendChild(body);

  const status = document.createElement('p');
  status.className = 'inline-admin-status';
  status.dataset.type = 'info';
  panel.appendChild(status);

  document.body.appendChild(panel);

  panelState.elements = {
    panel,
    localeSelect,
    refreshBtn,
    fields,
    posts: postsSection,
    status,
    headerTitle: title,
    closeBtn: close,
  };

  buildFields(config);
  if (config.posts?.enabled) {
    buildPostsForm(config);
  }

  localeSelect.addEventListener('change', async () => {
    panelState.currentLocale = localeSelect.value;
    await refreshLocale(panelState.currentLocale);
  });

  panelState.currentLocale = localeSelect.value;
  panelState.built = true;
  refreshLocale(panelState.currentLocale);
}

function togglePanel(force) {
  const shouldOpen = typeof force === 'boolean' ? force : !panelState.elements?.panel?.classList.contains('is-open');
  if (!panelState.elements?.panel) return;
  panelState.elements.panel.classList.toggle('is-open', shouldOpen);
  panelState.elements.panel.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
  if (shouldOpen) {
    setStatus(tUI('adminOnly'), 'info');
  }
}

async function ensureAdminSession() {
  if (adminState.checked) {
    return adminState.isAdmin;
  }
  adminState.checked = true;
  if (typeof window !== 'undefined' && window.__isAdmin) {
    adminState.isAdmin = true;
    return true;
  }
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (!res.ok) {
      adminState.isAdmin = false;
      return false;
    }
    const data = await res.json();
    adminState.profile = data?.profile || null;
    adminState.isAdmin = !!data?.isAdmin;
    return adminState.isAdmin;
  } catch (err) {
    console.warn('[inline-admin] auth check failed', err);
    adminState.isAdmin = false;
    return false;
  }
}

function updateUiTexts() {
  if (!panelState.elements) return;
  panelState.elements.headerTitle.textContent = tUI('panelTitle');
  panelState.elements.closeBtn.textContent = tUI('closePanel');
  const localeLabel = panelState.elements.panel.querySelector('.inline-admin-toolbar label');
  if (localeLabel) {
    const span = localeLabel.childNodes[0];
    if (span && span.nodeType === Node.TEXT_NODE) {
      span.textContent = `${tUI('localeLabel')} `;
    }
  }
  panelState.elements.refreshBtn.textContent = tUI('refresh');
  if (floatingButton) {
    floatingButton.textContent = tUI('editButton');
  }
  panelState.controls.forEach((control, key) => {
    const wrapper = control.closest('.inline-field');
    const labelText = wrapper?.querySelector('label span');
    let field = null;
    const groups = panelState.config?.groups || [];
    for (const group of groups) {
      const list = Array.isArray(group?.fields) ? group.fields : [];
      field = list.find((f) => f?.key === key);
      if (field) break;
    }
    if (!field && Array.isArray(panelState.config?.fields)) {
      field = panelState.config.fields.find((f) => f?.key === key) || null;
    }
    if (labelText && field) {
      if (typeof field.label === 'string') {
        labelText.textContent = field.label;
      } else if (field.label && typeof field.label === 'object') {
        const currentLang = getActiveLang();
        labelText.textContent = field.label[currentLang] || field.label['en'] || Object.values(field.label)[0] || key;
      }
    }
    const buttons = wrapper?.querySelectorAll('.inline-field-actions button');
    if (buttons?.[0]) buttons[0].textContent = tUI('save');
    if (buttons?.[1]) buttons[1].textContent = tUI('reset');
  });
  if (panelState.config?.posts?.enabled) {
    buildPostsForm(panelState.config);
  }
}

i18n.onChange(() => {
  updateUiTexts();
});

function createFloatingButton(config) {
  if (floatingButton) return floatingButton;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'inline-admin-button';
  button.textContent = tUI('editButton');
  button.addEventListener('click', () => {
    if (!panelState.built) {
      buildPanel(config);
    }
    togglePanel();
  });
  document.body.appendChild(button);
  floatingButton = button;
  return button;
}

export async function initInlineAdmin(config) {
  if (!config) return;
  const ready = async () => {
    const isAdmin = await ensureAdminSession();
    if (!isAdmin) return;
    createFloatingButton(config);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready, { once: true });
  } else {
    ready();
  }
}
