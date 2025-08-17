export const API = location.origin;
let csrfToken = '';

export async function getCsrf() {
  const res = await fetch(`${API}/api/csrf`, { credentials: 'include' });
  const data = await res.json();
  csrfToken = data.csrfToken || '';
}

export async function apiGet(url) {
  const res = await fetch(url, { credentials: 'include' });
  return res.json();
}

export async function apiPost(url, body = {}) {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(body),
  });
  return res.json();
}
