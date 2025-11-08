// csrf.js — helpers globais de HTTP com CSRF robusto
(() => {
  const CSRF_COOKIE = 'csrf';
  const state = { token: null };

  function readCookie(name) {
    if (typeof document === 'undefined') return null;
    return (
      document.cookie
        .split(';')
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => p.split('='))
        .filter(([key]) => key === name)
        .map(([, value]) => {
          try {
            return decodeURIComponent(value);
          } catch {
            return value;
          }
        })[0] || null
    );
  }

  // GET /api/csrf -> seta cookie + retorna token (também em header)
  async function fetchCsrf() {
    const res = await fetch('/api/csrf', {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });

    const hdr =
      res.headers.get('X-CSRF-Token') ||
      res.headers.get('x-csrf-token') ||
      res.headers.get('csrf-token');

    let bodyToken = null;
    try {
      const json = await res.json();
      bodyToken = json?.csrfToken || json?.csrf || json?.token || null;
    } catch {
      bodyToken = null;
    }

    const ck = readCookie(CSRF_COOKIE);
    state.token = hdr || bodyToken || ck || null;
    return state.token;
  }

  // force=true => SEMPRE chama /api/csrf pra rotacionar token
  async function ensureCsrfCookie(force = false) {
    if (!force) {
      const c = readCookie(CSRF_COOKIE);
      if (c) {
        state.token = c;
        return c;
      }
      if (state.token) return state.token;
    }
    return await fetchCsrf();
  }

  async function getCsrfToken() {
    if (state.token) return state.token;
    return await ensureCsrfCookie(false);
  }

  async function jget(url) {
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText} @ ${url}`);
    }
    return res.json();
  }

  async function jpost(url, body, extraOpts = {}) {
    // garante cookie presente
    await ensureCsrfCookie(false);
    let tok = await getCsrfToken();

    const doFetch = async (token) => {
      const u = new URL(url, location.origin);
      if (token && !u.searchParams.has('csrf')) {
        u.searchParams.set('csrf', token);
      }

      const baseHeaders = {
        'Content-Type': 'application/json',
        'X-Requested-With': 'fetch',
      };

      if (token) {
        // *** APENAS UM HEADER ***
        baseHeaders['x-csrf-token'] = token;
      }

      return fetch(u.toString(), {
        method: 'POST',
        credentials: 'include',
        headers: { ...baseHeaders, ...(extraOpts.headers || {}) },
        body: JSON.stringify(body || {}),
        ...extraOpts,
      });
    };

    // primeira tentativa
    let res = await doFetch(tok);

    // se 403, força token novo e tenta de novo
    if (res.status === 403) {
      state.token = null;
      await ensureCsrfCookie(true);
      tok = await getCsrfToken();
      res = await doFetch(tok);
    }

    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText} @ ${url}`);
    }
    return res.json();
  }

  // expõe de forma namespaced
  window.CSRF = {
    get token() {
      return state.token;
    },
    fetchCsrf,
    ensureCsrfCookie,
    getCsrfToken,
    jget,
    jpost,
  };

  // compat (globais antigos)
  window.fetchCsrf = fetchCsrf;
  window.ensureCsrfCookie = ensureCsrfCookie;
  window.getCsrfToken = getCsrfToken;
  window.jget = jget;
  window.jpost = jpost;
})();
