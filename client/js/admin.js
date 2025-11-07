const state = {
  user: null,
  posts: [],
  overrides: [],
  activeTab: 'posts',
  hasLoadedOverrides: false,
};

const dom = {
  status: document.getElementById('adminStatus'),
  banner: document.getElementById('adminBanner'),
  tabs: Array.from(document.querySelectorAll('.admin-tab')),
  panels: Array.from(document.querySelectorAll('.admin-panel')),
  toast: document.getElementById('adminToast'),
  posts: {
    pageSelect: document.getElementById('postsPageSelect'),
    localeSelect: document.getElementById('postsLocaleSelect'),
    refreshBtn: document.getElementById('postsRefresh'),
    list: document.getElementById('postsList'),
    form: document.getElementById('postForm'),
    formTitle: document.getElementById('postFormTitle'),
    hiddenId: document.getElementById('postId'),
    page: document.getElementById('formPage'),
    locale: document.getElementById('formLocale'),
    sort: document.getElementById('formSort'),
    published: document.getElementById('formPublished'),
    title: document.getElementById('formTitle'),
    tag: document.getElementById('formTag'),
    summary: document.getElementById('formSummary'),
    body: document.getElementById('formBody'),
    linkHref: document.getElementById('formLinkHref'),
    linkLabel: document.getElementById('formLinkLabel'),
    publishedAt: document.getElementById('formPublishedAt'),
    cancel: document.getElementById('postCancel'),
    submit: document.getElementById('postSubmit'),
  },
  overrides: {
    localeSelect: document.getElementById('i18nLocaleSelect'),
    prefixInput: document.getElementById('i18nPrefix'),
    refreshBtn: document.getElementById('i18nRefresh'),
    list: document.getElementById('i18nList'),
    form: document.getElementById('i18nForm'),
    formTitle: document.getElementById('i18nFormTitle'),
    hiddenId: document.getElementById('i18nId'),
    locale: document.getElementById('i18nFormLocale'),
    key: document.getElementById('i18nFormKey'),
    value: document.getElementById('i18nFormValue'),
    cancel: document.getElementById('i18nCancel'),
    submit: document.getElementById('i18nSubmit'),
  },
};

function showToast(message, type = 'info') {
  if (!dom.toast) return;
  dom.toast.textContent = message;
  dom.toast.className = `toast is-visible toast-${type}`;
  setTimeout(() => {
    dom.toast?.classList.remove('is-visible');
  }, 3200);
}

function showBanner(message, kind = 'info') {
  if (!dom.banner) return;
  dom.banner.textContent = message;
  dom.banner.classList.remove('error', 'success');
  dom.banner.hidden = false;
  if (kind === 'error') dom.banner.classList.add('error');
  if (kind === 'success') dom.banner.classList.add('success');
}

function hideBanner() {
  if (!dom.banner) return;
  dom.banner.hidden = true;
}

function toLocalDatetimeInput(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const tzOffset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - tzOffset * 60000);
  return local.toISOString().slice(0, 16);
}

async function apiFetch(url, options = {}) {
  const { method = 'GET', body, csrf = false } = options;
  if (!csrf) {
    const res = await fetch(url, {
      method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return res;
  }

  const csrfApi = window.CSRF;
  if (csrfApi?.ensureCsrfCookie) {
    await csrfApi.ensureCsrfCookie(false);
  }
  let token = csrfApi?.getCsrfToken ? await csrfApi.getCsrfToken() : null;

  const buildOptions = (tok) => {
    const headers = {
      'Content-Type': 'application/json',
    };
    if (tok) {
      headers['X-CSRF-Token'] = tok;
      headers['x-csrf-token'] = tok;
      headers['csrf-token'] = tok;
    }
    return {
      method,
      credentials: 'include',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    };
  };

  const withToken = (tok) => {
    const target = new URL(url, window.location.origin);
    if (tok) {
      target.searchParams.set('csrf', tok);
    }
    return target.toString();
  };

  let response = await fetch(withToken(token), buildOptions(token));
  if (response.status === 403 && csrfApi?.ensureCsrfCookie) {
    await csrfApi.ensureCsrfCookie(true);
    token = csrfApi?.getCsrfToken ? await csrfApi.getCsrfToken() : null;
    response = await fetch(withToken(token), buildOptions(token));
  }
  return response;
}

async function readJson(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (err) {
    return {};
  }
}

function handleAuthError(res) {
  if (res.status === 401) {
    showBanner('Faça login no jogo e recarregue esta página.', 'error');
    dom.status.textContent = 'Sessão expirada';
    return true;
  }
  if (res.status === 403) {
    showBanner('Acesso negado (admin). Adicione seu nome em ADMIN_NAMES.', 'error');
    dom.status.textContent = 'Acesso negado';
    return true;
  }
  return false;
}

async function loadPosts(showToastOnSuccess = false) {
  const page = dom.posts.pageSelect.value;
  const locale = dom.posts.localeSelect.value;
  try {
    const url = `/api/admin/posts?page=${encodeURIComponent(page)}&lang=${encodeURIComponent(locale)}`;
    const res = await apiFetch(url, { method: 'GET' });
    if (!res.ok) {
      if (handleAuthError(res)) return;
      const payload = await readJson(res);
      showToast(payload?.error || 'Falha ao carregar posts', 'error');
      return;
    }
    const data = await res.json();
    state.posts = Array.isArray(data) ? data : [];
    renderPosts();
    if (showToastOnSuccess) {
      showToast('Posts atualizados', 'info');
    }
  } catch (err) {
    console.error(err);
    showToast('Erro ao carregar posts', 'error');
  }
}

function renderPosts() {
  if (!dom.posts.list) return;
  dom.posts.list.innerHTML = '';
  if (!state.posts.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Nenhum post ainda para esta combinação.';
    dom.posts.list.appendChild(empty);
    return;
  }

  state.posts.forEach((post, index) => {
    const card = document.createElement('article');
    card.className = 'post-card';

    const header = document.createElement('div');
    header.className = 'post-card-header';

    const title = document.createElement('h3');
    title.textContent = post.title;
    header.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'post-meta';
    const parts = [];
    if (post.tag) parts.push(`Tag: ${post.tag}`);
    if (post.sort_index != null) parts.push(`sort ${post.sort_index}`);
    parts.push(post.is_published ? 'Publicado' : 'Rascunho');
    if (post.published_at) {
      parts.push(new Date(post.published_at).toLocaleString());
    }
    meta.textContent = parts.join(' • ');
    header.appendChild(meta);

    card.appendChild(header);

    if (post.summary) {
      const summary = document.createElement('p');
      summary.textContent = post.summary;
      card.appendChild(summary);
    }

    if (post.body_html) {
      const body = document.createElement('div');
      body.innerHTML = post.body_html;
      card.appendChild(body);
    }

    const actions = document.createElement('div');
    actions.className = 'post-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = 'Editar';
    editBtn.addEventListener('click', () => startEditPost(post));
    actions.appendChild(editBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Excluir';
    deleteBtn.addEventListener('click', () => deletePost(post.id));
    actions.appendChild(deleteBtn);

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.dataset.move = 'up';
    upBtn.textContent = '↑';
    upBtn.disabled = index === 0;
    upBtn.addEventListener('click', () => reorderPost(post.id, -1));
    actions.appendChild(upBtn);

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.dataset.move = 'down';
    downBtn.textContent = '↓';
    downBtn.disabled = index === state.posts.length - 1;
    downBtn.addEventListener('click', () => reorderPost(post.id, 1));
    actions.appendChild(downBtn);

    card.appendChild(actions);
    dom.posts.list.appendChild(card);
  });
}

function resetPostForm() {
  dom.posts.hiddenId.value = '';
  dom.posts.formTitle.textContent = 'Novo post';
  dom.posts.page.value = dom.posts.pageSelect.value;
  dom.posts.locale.value = dom.posts.localeSelect.value;
  dom.posts.sort.value = '0';
  dom.posts.published.value = 'true';
  dom.posts.title.value = '';
  dom.posts.tag.value = '';
  dom.posts.summary.value = '';
  dom.posts.body.value = '';
  dom.posts.linkHref.value = '';
  dom.posts.linkLabel.value = '';
  dom.posts.publishedAt.value = '';
}

function startEditPost(post) {
  dom.posts.hiddenId.value = post.id;
  dom.posts.formTitle.textContent = `Editar post #${post.id}`;
  dom.posts.page.value = post.page;
  dom.posts.locale.value = post.locale;
  dom.posts.sort.value = Number.isFinite(post.sort_index) ? post.sort_index : 0;
  dom.posts.published.value = post.is_published ? 'true' : 'false';
  dom.posts.title.value = post.title || '';
  dom.posts.tag.value = post.tag || '';
  dom.posts.summary.value = post.summary || '';
  dom.posts.body.value = post.body_html || '';
  dom.posts.linkHref.value = post.link_href || '';
  dom.posts.linkLabel.value = post.link_label || '';
  dom.posts.publishedAt.value = toLocalDatetimeInput(post.published_at);
  dom.posts.form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function submitPostForm(event) {
  event.preventDefault();
  const id = dom.posts.hiddenId.value;
  const payload = {
    page: dom.posts.page.value,
    locale: dom.posts.locale.value,
    title: dom.posts.title.value.trim(),
    summary: dom.posts.summary.value.trim(),
    body_html: dom.posts.body.value.trim() || null,
    tag: dom.posts.tag.value.trim() || null,
    link_href: dom.posts.linkHref.value.trim() || null,
    link_label: dom.posts.linkLabel.value.trim() || null,
    sort_index: Number(dom.posts.sort.value) || 0,
    is_published: dom.posts.published.value === 'true',
  };

  const publishedValue = dom.posts.publishedAt.value;
  if (publishedValue) {
    const date = new Date(publishedValue);
    if (Number.isNaN(date.getTime())) {
      showToast('Data de publicação inválida', 'error');
      return;
    }
    payload.published_at = date.toISOString();
  }

  const method = id ? 'PUT' : 'POST';
  const url = id ? `/api/admin/posts/${id}` : '/api/admin/posts';

  try {
    const res = await apiFetch(url, { method, body: payload, csrf: true });
    if (!res.ok) {
      if (handleAuthError(res)) return;
      const data = await readJson(res);
      showToast(data?.error || 'Falha ao salvar post', 'error');
      return;
    }
    await res.json();
    showToast('Post salvo com sucesso!', 'success');
    resetPostForm();
    await loadPosts();
  } catch (err) {
    console.error(err);
    showToast('Erro ao salvar post', 'error');
  }
}

async function deletePost(id) {
  if (!id) return;
  if (!window.confirm('Tem certeza que deseja excluir este post?')) return;
  try {
    const res = await apiFetch(`/api/admin/posts/${id}`, { method: 'DELETE', csrf: true });
    if (!res.ok) {
      if (handleAuthError(res)) return;
      const data = await readJson(res);
      showToast(data?.error || 'Falha ao excluir post', 'error');
      return;
    }
    showToast('Post excluído', 'success');
    if (dom.posts.hiddenId.value === String(id)) {
      resetPostForm();
    }
    await loadPosts();
  } catch (err) {
    console.error(err);
    showToast('Erro ao excluir post', 'error');
  }
}

async function reorderPost(id, direction) {
  const index = state.posts.findIndex((post) => post.id === id);
  if (index < 0) return;
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= state.posts.length) return;

  const reordered = state.posts.slice();
  const [item] = reordered.splice(index, 1);
  reordered.splice(newIndex, 0, item);

  const orderPayload = reordered.map((post, idx) => ({
    id: post.id,
    sort_index: (reordered.length - idx) * 100,
  }));

  try {
    const res = await apiFetch('/api/admin/posts/reorder', {
      method: 'PATCH',
      body: {
        page: dom.posts.pageSelect.value,
        locale: dom.posts.localeSelect.value,
        order: orderPayload,
      },
      csrf: true,
    });
    if (!res.ok) {
      if (handleAuthError(res)) return;
      const data = await readJson(res);
      showToast(data?.error || 'Falha ao reordenar', 'error');
      return;
    }
    showToast('Ordem atualizada', 'success');
    await loadPosts();
  } catch (err) {
    console.error(err);
    showToast('Erro ao reordenar', 'error');
  }
}

async function loadOverrides(showToastOnSuccess = false) {
  const locale = dom.overrides.localeSelect.value;
  const prefix = dom.overrides.prefixInput.value.trim();
  try {
    const params = new URLSearchParams({ lang: locale });
    if (prefix) params.set('prefix', prefix);
    const res = await apiFetch(`/api/admin/i18n?${params.toString()}`, { method: 'GET' });
    if (!res.ok) {
      if (handleAuthError(res)) return;
      const data = await readJson(res);
      showToast(data?.error || 'Falha ao carregar overrides', 'error');
      return;
    }
    const data = await res.json();
    state.overrides = Array.isArray(data) ? data : [];
    state.hasLoadedOverrides = true;
    renderOverrides();
    if (showToastOnSuccess) showToast('Overrides atualizados', 'info');
  } catch (err) {
    console.error(err);
    showToast('Erro ao carregar overrides', 'error');
  }
}

function renderOverrides() {
  if (!dom.overrides.list) return;
  dom.overrides.list.innerHTML = '';
  if (!state.overrides.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Nenhum override encontrado.';
    dom.overrides.list.appendChild(empty);
    return;
  }

  state.overrides.forEach((item) => {
    const card = document.createElement('article');
    card.className = 'post-card';

    const header = document.createElement('div');
    header.className = 'post-card-header';

    const title = document.createElement('h3');
    title.textContent = item.key;
    header.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'post-meta';
    const updated = item.updated_at ? new Date(item.updated_at).toLocaleString() : '';
    meta.textContent = `${item.locale} • atualizado ${updated}`;
    header.appendChild(meta);

    card.appendChild(header);

    const value = document.createElement('div');
    value.innerHTML = item.value || '';
    card.appendChild(value);

    const actions = document.createElement('div');
    actions.className = 'post-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = 'Editar';
    editBtn.addEventListener('click', () => startEditOverride(item));
    actions.appendChild(editBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Excluir';
    deleteBtn.addEventListener('click', () => deleteOverride(item.id));
    actions.appendChild(deleteBtn);

    card.appendChild(actions);
    dom.overrides.list.appendChild(card);
  });
}

function resetOverrideForm() {
  dom.overrides.hiddenId.value = '';
  dom.overrides.formTitle.textContent = 'Adicionar override';
  dom.overrides.locale.value = dom.overrides.localeSelect.value;
  dom.overrides.key.value = '';
  dom.overrides.value.value = '';
}

function startEditOverride(item) {
  dom.overrides.hiddenId.value = item.id;
  dom.overrides.formTitle.textContent = `Editar override #${item.id}`;
  dom.overrides.locale.value = item.locale;
  dom.overrides.key.value = item.key;
  dom.overrides.value.value = item.value;
  dom.overrides.form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function submitOverrideForm(event) {
  event.preventDefault();
  const id = dom.overrides.hiddenId.value;
  const payload = {
    locale: dom.overrides.locale.value,
    key: dom.overrides.key.value.trim(),
    value: dom.overrides.value.value.trim(),
  };

  if (!payload.key) {
    showToast('Informe a chave', 'error');
    return;
  }
  if (!payload.value) {
    showToast('Informe o valor', 'error');
    return;
  }

  const method = id ? 'PUT' : 'POST';
  const url = id ? `/api/admin/i18n/${id}` : '/api/admin/i18n';

  try {
    const res = await apiFetch(url, { method, body: payload, csrf: true });
    if (!res.ok) {
      if (handleAuthError(res)) return;
      const data = await readJson(res);
      showToast(data?.error || 'Falha ao salvar override', 'error');
      return;
    }
    await res.json();
    showToast('Override salvo', 'success');
    resetOverrideForm();
    await loadOverrides();
  } catch (err) {
    console.error(err);
    showToast('Erro ao salvar override', 'error');
  }
}

async function deleteOverride(id) {
  if (!id) return;
  if (!window.confirm('Remover este override?')) return;
  try {
    const res = await apiFetch(`/api/admin/i18n/${id}`, { method: 'DELETE', csrf: true });
    if (!res.ok) {
      if (handleAuthError(res)) return;
      const data = await readJson(res);
      showToast(data?.error || 'Falha ao excluir override', 'error');
      return;
    }
    showToast('Override removido', 'success');
    if (dom.overrides.hiddenId.value === String(id)) {
      resetOverrideForm();
    }
    await loadOverrides();
  } catch (err) {
    console.error(err);
    showToast('Erro ao excluir override', 'error');
  }
}

function setupTabs() {
  dom.tabs.forEach((button) => {
    button.addEventListener('click', () => {
      const tab = button.dataset.tab;
      if (!tab || tab === state.activeTab) return;
      state.activeTab = tab;
      dom.tabs.forEach((btn) => {
        const isActive = btn.dataset.tab === tab;
        btn.classList.toggle('is-active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
      dom.panels.forEach((panel) => {
        const isActive = panel.dataset.panel === tab;
        panel.classList.toggle('is-active', isActive);
        panel.toggleAttribute('hidden', !isActive);
      });
      if (tab === 'i18n' && !state.hasLoadedOverrides) {
        loadOverrides();
      }
    });
  });
}

function setupEvents() {
  dom.posts.pageSelect?.addEventListener('change', () => {
    loadPosts(true);
  });
  dom.posts.localeSelect?.addEventListener('change', () => {
    loadPosts(true);
  });
  dom.posts.refreshBtn?.addEventListener('click', () => loadPosts(true));
  dom.posts.cancel?.addEventListener('click', () => resetPostForm());
  dom.posts.form?.addEventListener('submit', submitPostForm);

  dom.overrides.localeSelect?.addEventListener('change', () => loadOverrides(true));
  dom.overrides.refreshBtn?.addEventListener('click', () => loadOverrides(true));
  dom.overrides.cancel?.addEventListener('click', () => resetOverrideForm());
  dom.overrides.form?.addEventListener('submit', submitOverrideForm);
}

async function checkAuth() {
  try {
    const res = await apiFetch('/api/auth/me', { method: 'GET' });
    if (!res.ok) {
      if (res.status === 401) {
        showBanner('Faça login no jogo e recarregue esta página.', 'error');
        dom.status.textContent = 'Não autenticado';
        return;
      }
      showBanner('Falha ao validar sessão.', 'error');
      dom.status.textContent = 'Erro ao validar sessão';
      return;
    }
    const data = await res.json();
    state.user = data?.profile || null;
    if (state.user?.name) {
      dom.status.textContent = `Logado como ${state.user.name}`;
    } else {
      dom.status.textContent = 'Sessão ativa';
    }
    hideBanner();
    await loadPosts();
  } catch (err) {
    console.error(err);
    showBanner('Erro ao validar sessão.', 'error');
    dom.status.textContent = 'Erro de rede';
  }
}

function init() {
  setupTabs();
  setupEvents();
  resetPostForm();
  resetOverrideForm();
  checkAuth();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
