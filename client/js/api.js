// client/js/api.js
// Helpers centralizados para chamadas HTTP com sessão + CSRF
// - Sempre envia cookies (credentials:'include')
// - Lê o CSRF do cookie 'csrf' (fonte da verdade) e mantém cache só como fallback
// - Em caso de 403/419 por CSRF inválido/expirado, renova o token e tenta 1x de novo

export const API = ''; // vazio = mesma origem (http://localhost:3000). Ajuste se precisar.

let __csrfCache = null;        // cache apenas como fallback
let __csrfFetchedAt = 0;

/* ======================== Utils ======================== */
function readCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

// token atual preferindo o COOKIE (sempre atualizado pelo servidor)
function currentCsrf() {
  return readCookie('csrf') || __csrfCache || null;
}

/** tenta extrair token de possíveis headers de resposta */
function readCsrfFromHeaders(res) {
  if (!res || !res.headers) return null;
  return (
    res.headers.get?.('x-csrf-token') ||
    res.headers.get?.('X-CSRF-Token') ||
    res.headers.get?.('x-csrf') ||
    res.headers.get?.('X-CSRF') ||
    null
  );
}

/* ======================== CSRF ======================== */
/** Busca e guarda/atualiza o CSRF no cookie e em cache. */
export async function getCsrf(force = false) {
  const FRESH_MS = 60 * 1000; // 1 min de “validade” local
  const fromCookie = currentCsrf();

  if (!force && fromCookie && Date.now() - __csrfFetchedAt < FRESH_MS) {
    return fromCookie;
  }

  const res = await fetch(`${API}/api/csrf`, {
    method: 'GET',
    credentials: 'include', // essencial para setar/atualizar cookie "csrf"
    cache: 'no-store',
    headers: { 'Accept': 'application/json' }
  });

  if (!res.ok) throw new Error(`CSRF fetch failed: ${res.status}`);

  // alguns backends devolvem também no header/corpo
  let headerToken = readCsrfFromHeaders(res);
  let bodyToken = null;
  try {
    const data = await res.clone().json();
    bodyToken = data?.csrfToken || data?.token || data?.csrf || null;
  } catch (_) { /* ignore */ }

  // depois do /api/csrf o cookie é a fonte da verdade
  const tok = readCookie('csrf') || headerToken || bodyToken || null;
  if (!tok) throw new Error('CSRF token ausente');

  __csrfCache = tok;
  __csrfFetchedAt = Date.now();
  return tok;
}

/* ======================== Fetch genérico ======================== */
/**
 * doFetch:
 * - preserva response na exceção (err.response)
 * - anexa parsed JSON/text no err.body / err.payload para o caller usar
 */
async function doFetch(url, init) {
  const res = await fetch(url, init);

  // tenta extrair corpo (json preferencialmente, fallback para texto)
  let parsed = null;
  try {
    parsed = await res.clone().json();
  } catch (_) {
    try { parsed = await res.clone().text(); } catch (_) { parsed = null; }
  }

  if (!res.ok) {
    const payload = parsed;
    const err = new Error(
      (payload && typeof payload === 'object' && (payload.error || payload.message)) ||
      (typeof payload === 'string' ? payload : `${init.method || 'GET'} ${url} -> ${res.status}`)
    );
    err.status = res.status;
    err.response = res;
    // legacy / convenience: both names available
    err.payload = payload;
    err.body = payload;
    throw err;
  }

  // Success: retorna JSON quando possível, senão texto, senão null
  if (parsed !== null) return parsed;
  try {
    return await res.text();
  } catch (_) {
    return null;
  }
}

function isJsonBody(body) {
  return body != null && typeof body !== 'string' && !(body instanceof FormData);
}

/** Monta headers padrão + CSRF (quando necessário) */
async function buildHeaders(method, extra = {}, body) {
  const m = String(method || 'GET').toUpperCase();
  const base = {
    'Accept': 'application/json',
    'X-Requested-With': 'fetch',
    ...extra
  };

  // define Content-Type apenas quando for JSON (não para FormData)
  if (isJsonBody(body) && !base['Content-Type']) {
    base['Content-Type'] = 'application/json';
  }

  // Para métodos que modificam estado, envia CSRF do COOKIE
  if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') {
    const tk = currentCsrf() || await getCsrf(); // garante existir
    if (tk) base['x-csrf-token'] = tk; // header em lowercase (express é case-insensitive)
  }

  return base;
}

/**
 * Request genérico (com retry 1x se CSRF inválido/expirado)
 * @param {string} method
 * @param {string} url - pode ser relativo (/api/...)
 * @param {object|string|FormData|null} body
 * @param {object} opts - { headers, noRetry }
 */
export async function apiRequest(method, url, body = null, opts = {}) {
  const fullUrl = url.startsWith('http') ? url : `${API}${url}`;
  const headers = await buildHeaders(method, opts.headers || {}, body);
  const init = {
    method: String(method || 'GET').toUpperCase(),
    credentials: 'include',
    cache: 'no-store',
    headers
  };

  if (body != null) {
    init.body = isJsonBody(body) ? JSON.stringify(body) : body;
  }

  try {
    return await doFetch(fullUrl, init);
  } catch (err) {
    // Se foi 403/419 (ou mensagem indicando CSRF), renova e tenta 1x
    const looksLikeCsrf =
      err?.status === 403 ||
      err?.status === 419 ||
      /csrf/i.test(String(err?.message)) ||
      /csrf/i.test(String(err?.payload?.error || '')) ||
      /csrf/i.test(String(err?.body?.error || ''));

    if (looksLikeCsrf && !opts.noRetry) {
      try { await getCsrf(true); } catch (_) {}
      const retryHeaders = await buildHeaders(method, opts.headers || {}, body);
      const retryInit = { ...init, headers: retryHeaders };
      return doFetch(fullUrl, retryInit);
    }
    throw err;
  }
}

/* ======================== Atalhos ======================== */
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
  return apiRequest('DELETE', url, body, opts);
}