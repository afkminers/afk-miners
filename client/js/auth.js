import { API, getCsrf, apiGet, apiPost } from './api.js';

export async function checkAuth() {
  await getCsrf();
  try {
    const me = await apiGet(`${API}/api/auth/me`);
    return me?.profile || null; // no server, /api/auth/me exige requireAuth (feito via index.js)
  } catch { return null; }
}

export async function doLogin(name, password) {
  await getCsrf();
  return apiPost(`${API}/api/auth/login`, { name, password });
}

export async function doRegister(name, password) {
  await getCsrf();
  return apiPost(`${API}/api/auth/register`, { name, password });
}

export async function doLogout() {
  await getCsrf();
  return apiPost(`${API}/api/auth/logout`, {});
}
