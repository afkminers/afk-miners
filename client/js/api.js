// client/js/api.js
// Helpers centralizados para chamadas HTTP com sessão + CSRF
// - Sempre envia cookies (credentials:'include')
// - Busca e cacheia o token CSRF
// - Em caso de 403 por CSRF inválido, renova o token e tenta 1x de novo

export const API = ''; // vazio = mesma origem (http://localhost:3000). Ajuste se precisar.

let __csrf = null;
let __csrfFetchedAt = 0;

/** Lê um possível token CSRF de headers diversas. */
function readCsrfFromHeaders(res) {
  // alguns servidores devolvem X-CSRF-Token no header
  return (
    res.headers?.get?.('x-csrf-token') ||
    res.headers?.get?.('X-CSRF-Token') ||
    null
  );
}

/** Busca e guarda o CSRF do servidor (precisa mandar cookies) */
export async function getCsrf(force = false) {
  const FRESH_MS = 60 * 1000; // 1 min de validade local
  if (__csrf && !force && Date.now() - __csrfFetchedAt < FRESH_MS) {
    return __csrf;
  }

  const res = await fetch(`${API}/api/csrf`, {
    method: 'GET',
    credentials: 'include', // ESSENCIAL para setar o cookie "csrf" e manter "sid"
    cache: 'no-store',
    headers: { 'Accept': 'application/json' }
  });

  if (!res.ok) throw new Error(`CSRF fetch failed: ${res.status}`);

  // tenta header primeiro
  let token = readCsrfFromHeaders(res);

  // tenta corpo JSON depois
  if (!token) {
    try {
      const data = await res.json();
      token = data?.csrfToken || data?.token || data?.csrf || null;
    } catch (_) {
      // ignore — alguns servidores não mandam corpo
    }
  }

  if (!token) throw new Error('CSRF token ausente');

  __csrf = token;
  __csrfFetchedAt = Date.now();
  return __csrf;
}

/** Interno: executa a request e trata erros comuns. */
async function doFetch(url, options = {}) {
  const res = await fetch(url, options);

  // tenta decodificar payload de erro (se houver)
  if (!res.ok) {
    let payload = null;
    try { payload = await res.clone().json(); } catch (_e) {}
    const errMsg =
      payload?.error ||
      payload?.message ||
      `${options.method || 'GET'} ${url} -> ${res.status}`;

    const error = new Error(errMsg);
    error.status = res.status;
    error.payload = payload;
    throw error;
  }

  // pode não ter corpo (204), então só tenta JSON
  try { return await res.json(); } catch { return null; }
}

/** Interno: monta headers padrão (Accept/JSON + CSRF quando necessário) */
async function buildHeaders(method, extra = {}) {
  const base = {
    'Accept': 'application/json',
    'X-Requested-With': 'fetch',
    ...extra
  };

  // GET/HEAD/OPTIONS não precisam de CSRF
  const m = String(method || 'GET').toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return base;

  // Demais métodos: garante CSRF
  const token = await getCsrf();
  return { ...base, 'X-CSRF-Token': token, 'Content-Type': base['Content-Type'] || 'application/json' };
}

/**
 * Request genérico (com retry 1x se CSRF inválido/expirado)
 * @param {string} method
 * @param {string} url - pode ser relativo (/api/...)
 * @param {object|null} body - será serializado em JSON
 * @param {object} opts - { headers, noRetry }
 */
export async function apiRequest(method, url, body = null, opts = {}) {
  const fullUrl = url.startsWith('http') ? url : `${API}${url}`;
  const headers = await buildHeaders(method, opts.headers || {});
  const init = {
    method,
    credentials: 'include',
    cache: 'no-store',
    headers,
  };
  if (body != null) init.body = typeof body === 'string' ? body : JSON.stringify(body);

  try {
    return await doFetch(fullUrl, init);
  } catch (err) {
    // Se foi 403 por CSRF, tenta renovar uma vez
    const isCsrfProblem =
      err?.status === 403 ||
      err?.status === 419 ||
      /csrf/i.test(String(err?.message)) ||
      /csrf/i.test(String(err?.payload?.error || ''));

    if (isCsrfProblem && !opts.noRetry) {
      await getCsrf(true); // força renovar
      const retryHeaders = await buildHeaders(method, opts.headers || {});
      const retryInit = { ...init, headers: retryHeaders };
      return doFetch(fullUrl, retryInit);
    }
    throw err;
  }
}

// Atalhos
export async function apiGet(url, opts = {}) {
  return apiRequest('GET', url, null, opts);
}
export async function apiPost(url, body = {}, opts = {}) {
  return apiRequest('POST', url, body, opts);
}
export async function apiPut(url, body = {}, opts = {}) {
  return apiRequest('PUT', url, body, opts);
}
export async function apiPatch(url, body = {}, opts = {}) {
  return apiRequest('PATCH', url, body, opts);
}
export async function apiDelete(url, body = null, opts = {}) {
  // alguns servidores exigem body em DELETE; se não precisar, passe null
  return apiRequest('DELETE', url, body, opts);
}
