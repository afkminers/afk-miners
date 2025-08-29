// client/js/api.js
export const API = ''; // vazio = mesma origem

let __csrf = null;

/** Busca e guarda o CSRF do servidor (precisa mandar cookies) */
export async function getCsrf(force = false) {
  if (__csrf && !force) return __csrf;

  const res = await fetch(`${API}/api/csrf`, {
    method: 'GET',
    credentials: 'include',        // <<< ESSENCIAL para setar o cookie "csrf"
    cache: 'no-store',
    headers: { 'Accept': 'application/json' }
  });

  if (!res.ok) throw new Error(`CSRF fetch failed: ${res.status}`);
  const data = await res.json().catch(() => ({}));

  // servidor pode devolver { csrfToken } ou { token }
  __csrf = data?.csrfToken || data?.token || data?.csrf;
  if (!__csrf) throw new Error('CSRF token ausente');
  return __csrf;
}

export async function apiGet(url) {
  const res = await fetch(url, {
    method: 'GET',
    credentials: 'include',        // <<< envia cookie "sid"
    cache: 'no-store',
    headers: { 'Accept': 'application/json' }
  });
  if (!res.ok) {
    let msg;
    try { msg = (await res.json())?.error; } catch {}
    throw new Error(msg || `GET ${url} -> ${res.status}`);
  }
  return res.json();
}

export async function apiPost(url, body = {}) {
  const csrf = await getCsrf();     // <<< garante header correto
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',         // <<< envia cookie "sid"
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-CSRF-Token': csrf          // <<< bate com o cookie "csrf"
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    let msg;
    try { msg = (await res.json())?.error; } catch {}
    throw new Error(msg || `POST ${url} -> ${res.status}`);
  }
  return res.json();
}
