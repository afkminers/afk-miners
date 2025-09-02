// csrf.js — helpers globais de HTTP com CSRF robusto
(() => {
  const state = { token: null };

  function readCookie(name) {
    const hit = document.cookie.split('; ').find(v => v.startsWith(name + '='));
    return hit ? decodeURIComponent(hit.split('=')[1]) : null;
  }

  // GET /api/csrf -> seta cookie e retorna o token (também em header X-Csrf-Token)
  async function fetchCsrf() {
    const r = await fetch('/api/csrf', { credentials: 'include' });
    // mesmo se 200 sem body, usamos header/cookie
    const hdr = r.headers.get('X-Csrf-Token');
    const ck = readCookie('csrf');
    state.token = hdr || ck || null;
    return state.token;
  }

  // Quando force=true, SEMPRE chama o endpoint para rotacionar token
  async function ensureCsrfCookie(force = false) {
    if (!force) {
      const c = readCookie('csrf');
      if (c) { state.token = c; return c; }
    }
    return await fetchCsrf();
  }

  async function getCsrfToken() {
    if (state.token) return state.token;
    return await ensureCsrfCookie();
  }

  async function jget(url) {
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} @ ${url}`);
    return r.json();
  }

  async function jpost(url, body, extraOpts = {}) {
    // garante cookie presente
    await ensureCsrfCookie(false);
    let tok = await getCsrfToken();

    const doFetch = async (token) => {
      const u = new URL(url, location.origin);
      if (token && !u.searchParams.has('csrf')) u.searchParams.set('csrf', token);

      const baseHeaders = {
        'Content-Type': 'application/json',
        'X-Requested-With': 'fetch',
        // redundantes para diferentes middlewares
        'X-CSRF-Token': token || '',
        'x-csrf-token': token || '',
        'csrf-token':  token || '',
      };

      return fetch(u.toString(), {
        method: 'POST',
        credentials: 'include',
        headers: { ...baseHeaders, ...(extraOpts.headers || {}) },
        body: JSON.stringify(body || {}),
        ...extraOpts,
      });
    };

    // primeira tentativa
    let r = await doFetch(tok);

    // se 403, força RENOVAÇÃO real e tenta 1x novamente
    if (r.status === 403) {
      state.token = null;                 // zera cache
      await ensureCsrfCookie(true);       // <-- força GET /api/csrf
      tok = await getCsrfToken();
      r = await doFetch(tok);
    }

    if (!r.ok) throw new Error(`${r.status} ${r.statusText} @ ${url}`);
    return r.json();
  }

  // expõe de forma namespaced (evita colisão com jpost de outros arquivos)
  window.CSRF = {
    get token() { return state.token; },
    fetchCsrf,
    ensureCsrfCookie,
    getCsrfToken,
    jget,
    jpost,
  };

  // compat (se alguém usa global solto)
  window.fetchCsrf = fetchCsrf;
  window.ensureCsrfCookie = ensureCsrfCookie;
  window.getCsrfToken = getCsrfToken;
  window.jget = jget;
  window.jpost = jpost;
})();
