// client/js/auth.js
import { API, getCsrf, apiGet, apiPost } from './api.js';

/**
 * Checa sessão atual. Retorna o profile (ou null se não autenticado).
 */
export async function checkAuth() {
  await getCsrf();
  try {
    const me = await apiGet(`${API}/api/auth/me`);
    return me?.profile || null;
  } catch {
    return null;
  }
}

/**
 * Login e redireciona para /starter.html em caso de sucesso.
 */
export async function doLogin(name, password) {
  await getCsrf();
  const res = await apiPost(`${API}/api/auth/login`, { name, password });
  try {
    // sucesso -> manda para seleção de herói
    window.location.href = '/starter.html';
  } catch {
    /* ignore */
  }
  return res;
}

/**
 * Registro e redireciona para /starter.html em caso de sucesso.
 */
export async function doRegister(name, password) {
  await getCsrf();
  const res = await apiPost(`${API}/api/auth/register`, { name, password });
  try {
    // sucesso -> manda para seleção de herói
    window.location.href = '/starter.html';
  } catch {
    /* ignore */
  }
  return res;
}

/**
 * Logout (sem redirect automático; deixe a página decidir).
 */
export async function doLogout() {
  await getCsrf();
  return apiPost(`${API}/api/auth/logout`, {});
}
