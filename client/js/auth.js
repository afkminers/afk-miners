// client/js/auth.js
// Corrigido: todos os requests usam credentials:'include' (envia/recebe cookie `sid`)
// e os POSTs levam o header X-CSRF-Token.

import { API, getCsrf } from './api.js';

/* Helpers HTTP com cookie + CSRF */
async function httpGet(url) {
  const r = await fetch(url, {
    method: 'GET',
    credentials: 'include',            // <-- envia/recebe o cookie `sid`
    headers: { 'Accept': 'application/json' },
    cache: 'no-store'
  });
  if (!r.ok) {
    // tenta retornar JSON pra msg amigável
    let err = {};
    try { err = await r.json(); } catch {}
    const msg = err?.error || `GET ${url} -> ${r.status}`;
    throw new Error(msg);
  }
  return r.json();
}

async function httpPost(url, body) {
  const csrf = await getCsrf();        // garante cookie+token do CSRF
  const r = await fetch(url, {
    method: 'POST',
    credentials: 'include',            // <-- envia/recebe o cookie `sid`
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-CSRF-Token': csrf || ''
    },
    body: JSON.stringify(body || {}),
    cache: 'no-store'
  });
  if (!r.ok) {
    // tenta retornar JSON de erro para mensagens amigáveis
    let err = {};
    try { err = await r.json(); } catch {}
    const msg = err?.error || `POST ${url} -> ${r.status}`;
    const e = new Error(msg);
    // expõe também o status para o caller tratar (ex.: 409)
    e.status = r.status;
    throw e;
  }
  return r.json();
}

/**
 * Checa sessão atual. Retorna o profile (ou null se não autenticado).
 */
export async function checkAuth() {
  try {
    await getCsrf(); // prepara CSRF e cookie
    const me = await httpGet(`${API}/api/auth/me`);
    return me?.profile || null;
  } catch {
    return null;
  }
}

/**
 * Login — não redireciona aqui; retorna o JSON para a página decidir.
 */
export async function doLogin(name, password) {
  await getCsrf();
  return httpPost(`${API}/api/auth/login`, { name, password });
}

/**
 * Registro — não redireciona aqui; retorna o JSON para a página decidir.
 * (se o backend responder 409, a exception terá e.status === 409)
 */
export async function doRegister(name, password) {
  await getCsrf();
  return httpPost(`${API}/api/auth/register`, { name, password });
}

/**
 * Logout (sem redirect automático; deixe a página decidir).
 */
export async function doLogout() {
  await getCsrf();
  return httpPost(`${API}/api/auth/logout`, {});
}
