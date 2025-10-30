// client/js/boot.js
import { API, getCsrf, apiGet } from './api.js';
import { doLogin, doRegister, doLogout } from './auth.js';
import { bindGachaUI } from './gacha.js';
import { initLoginFx, stopLoginFx, celebrate } from './login_fx.js';
import { i18n } from './i18n/core.js';
// (removido) import { bindProfileModal, setupInventoryOpen } from './player_profile.js';

// UI base
const authScreen = document.getElementById('authScreen');
const appMain    = document.getElementById('appMain');
const userInfo   = document.getElementById('userInfo');

// Auth form
const loginName   = document.getElementById('loginName');
const loginPass   = document.getElementById('loginPass');
const btnLogin    = document.getElementById('btnLogin');
const loginMsg    = document.getElementById('loginMsg');

const regName     = document.getElementById('regName');
const regPass     = document.getElementById('regPass');
const btnRegister = document.getElementById('btnRegister');
const regMsg      = document.getElementById('regMsg');

const btnLogout     = document.getElementById('btnLogout');
const btnLogoutTop  = document.getElementById('btnLogoutTop');
const mobileLogout  = document.getElementById('mobileLogout');

// Header buttons
const btnPlay   = document.getElementById('btnPlay');
const authClose = document.getElementById('authClose');

// Mobile menu
const btnHamb   = document.getElementById('btnHamb');
const mobMenu   = document.getElementById('mobileMenu');

// (Opcional) evitar submit nativo duplicado
document.getElementById('loginForm')?.addEventListener('submit', (ev) => ev.preventDefault());
document.getElementById('registerForm')?.addEventListener('submit', (ev) => ev.preventDefault());

// ===== Gacha refs =====
const ctx = {
  elGacha:    document.getElementById('btnGacha'),
  elGacha10:  document.getElementById('btnGacha10'),
  elBalance:  document.getElementById('balance'),
  elResult:   document.getElementById('result'),
  elInv:      document.getElementById('inventory'),

  overlay:   document.getElementById('summon'),
  rarBg:     document.getElementById('rarBg'),
  chestWrap: document.getElementById('chestWrap'),
  chestSvg:  document.getElementById('chestSvg'),
  burst:     document.getElementById('burst'),
  sparks:    document.getElementById('sparks'),

  resultPane: document.getElementById('resultPane'),
  multiPane:  document.getElementById('multiPane'),
  multiGrid:  document.getElementById('multiGrid'),
  multiHead:  document.getElementById('multiHead'),
  okbar:      document.getElementById('okbar'),

  btnOk:      document.getElementById('btnOk'),
  btnAgain:   document.getElementById('btnAgain'),
  btnAgain10: document.getElementById('btnAgain10'),
  againHint:  document.getElementById('againHint'),

  sumImg:  document.getElementById('sumImg'),
  sumName: document.getElementById('sumName'),
  rarTag:  document.getElementById('rarTag'),

  stAtk:   document.getElementById('stAtk'),
  stDef:   document.getElementById('stDef'),
  stSpd:   document.getElementById('stSpd'),
  stClass: document.getElementById('stClass'),
  stRole:  document.getElementById('stRole'),
  stType:  document.getElementById('stType'),
  stElem:  document.getElementById('stElem'),
  stWeap:  document.getElementById('stWeap'),

  closeX:    document.getElementById('closeX'),
  skipChk:   document.getElementById('chkSkip'),
  chestHint: document.getElementById('chestHint'),
  heroPane:  document.getElementById('heroPane'),
  halo:      document.getElementById('halo'),
  flashEl:   document.getElementById('flash'),

  coinCount: document.getElementById('coinCount'),
};

// ===== Estado de sessão =====
let __profile = null;
window.__isAuth = false;
let lastCoinsValue = 0;
let lastNameValue = '';

function clearMessage(el) {
  if (!el) return;
  delete el.dataset.i18nKey;
  delete el.dataset.i18nVars;
  el.textContent = '';
}

function setI18nMessage(el, key, vars) {
  if (!el || !key) return;
  el.dataset.i18nKey = key;
  if (vars) {
    el.dataset.i18nVars = JSON.stringify(vars);
  } else {
    delete el.dataset.i18nVars;
  }
  el.textContent = i18n.t(key, vars);
}

function setRawMessage(el, text) {
  if (!el) return;
  delete el.dataset.i18nKey;
  delete el.dataset.i18nVars;
  el.textContent = String(text ?? '');
}

function refreshMessages() {
  [loginMsg, regMsg].forEach((el) => {
    if (!el) return;
    const key = el.dataset.i18nKey;
    if (!key) return;
    let vars = {};
    if (el.dataset.i18nVars) {
      try { vars = JSON.parse(el.dataset.i18nVars); } catch { vars = {}; }
    }
    el.textContent = i18n.t(key, vars);
  });
}

// HUD centralizado
function updateHud(profileOrCoins) {
  const coins = typeof profileOrCoins === 'number'
    ? profileOrCoins
    : Number(profileOrCoins?.coins ?? 0);

  lastCoinsValue = coins;

  if (profileOrCoins && typeof profileOrCoins === 'object' && 'name' in profileOrCoins) {
    const candidate = String(profileOrCoins.name ?? '').trim();
    if (candidate) {
      window.__playerName = candidate;
      lastNameValue = candidate;
    }
  }

  const storedName = (window.__playerName || lastNameValue || '').toString();
  if (storedName) {
    lastNameValue = storedName;
  }

  const coinsFormatted = i18n.format.number(coins);
  const coinsLabel = i18n.t('app.coinsLabel', { value: coinsFormatted });
  const userInfoText = storedName
    ? i18n.t('app.userInfoNamed', { name: storedName, coins: coinsLabel })
    : coinsLabel;

  if (userInfo) {
    userInfo.textContent = userInfoText;
  }

  if (ctx.coinCount) ctx.coinCount.textContent = coinsFormatted;
  if (ctx.elBalance) ctx.elBalance.textContent = coinsLabel;

  try {
    document.dispatchEvent(new CustomEvent('coins-updated', { detail: { coins } }));
  } catch {}
}

// Mantido por compatibilidade
const gacha = bindGachaUI(ctx, { onHudUpdate: updateHud });

/* ========= helpers visual ========= */
function setLogoutVisibility(signed){
  const show = !!signed;
  btnLogoutTop?.classList.toggle('hidden', !show);
  mobileLogout?.classList.toggle('hidden', !show);
}
function setLoggedOutGlow(on){
  document.body.classList.toggle('logged-out', !!on);
}
function closeMobileMenu(){
  mobMenu?.classList.remove('open');
  btnHamb?.setAttribute('aria-expanded','false');
}

/* ========= Estados de tela ========= */
function showLanding(){
  appMain?.classList.add('hidden');
  authScreen?.classList.add('hidden');
  setLogoutVisibility(false);
  setLoggedOutGlow(true);
  closeMobileMenu();
  window.__isAuth = false;
  initLoginFx();
}

/**
 * Regras de navegação:
 *  - Se PODE selecionar starter (não escolheu ainda) -> /starter.html
 *  - Senão -> /app.html#house
 */
async function goToGameAccordingToStarter() {
  try {
    const st = await apiGet(`${API}/api/starter/status`); // { canSelect: boolean }
    if (st?.canSelect) {
      location.href = '/starter.html';
    } else {
      location.href = '/app.html#house';
    }
  } catch {
    // fallback conservador: shell na House
    location.href = '/app.html#house';
  }
}

async function showApp(profile) {
  stopLoginFx();
  __profile = profile;
  window.__isAuth = true;
  updateHud(profile);
  await gacha.init?.(profile);
  goToGameAccordingToStarter();
}

/* ========= Sessão ========= */
async function trySession() {
  await getCsrf();
  try {
    const me = await apiGet(`${API}/api/auth/me`);
    if (me?.profile) {
      await showApp(me.profile);
    } else {
      showLanding();
    }
  } catch {
    showLanding();
  }
}
i18n.onReady(() => {
  refreshMessages();
  updateHud({ coins: lastCoinsValue, name: lastNameValue });
  trySession();
});

i18n.onChange(() => {
  refreshMessages();
  updateHud({ coins: lastCoinsValue, name: lastNameValue });
});

/* ========= PLAY ========= */
if (btnPlay) {
  btnPlay.onclick = async () => {
    if (window.__isAuth && __profile) {
      goToGameAccordingToStarter();
    } else {
      authScreen?.classList.remove('hidden');
    }
  };
}

/* ========= Close do modal de auth ========= */
authClose?.addEventListener('click', () => authScreen?.classList.add('hidden'));

/* ========= Auth handlers ========= */
btnLogin?.addEventListener('click', async (ev) => {
  ev.preventDefault();
  clearMessage(loginMsg);

  if (window._loginBusy) return;
  window._loginBusy = true;

  try {
    const data = await doLogin(loginName.value.trim(), loginPass.value);
    if (data?.error) { setRawMessage(loginMsg, data.error); return; }

    // Confirma sessão
    const me = await fetch('/api/auth/me', { credentials: 'include' }).then(r => r.json());
    if (!me?.profile) { setI18nMessage(loginMsg, 'auth.sessionMissing'); return; }

    celebrate();
    await goToGameAccordingToStarter();
  } catch {
    setI18nMessage(loginMsg, 'auth.loginFailed');
  } finally {
    window._loginBusy = false;
  }
});

btnRegister?.addEventListener('click', async (ev) => {
  ev.preventDefault();
  clearMessage(regMsg);

  if (window._regBusy) return;
  window._regBusy = true;

  try {
    const res = await doRegister(regName.value.trim(), regPass.value);
    if (res?.error) { setRawMessage(regMsg, res.error); return; }

    celebrate();

    // Confere sessão
    const me = await fetch('/api/auth/me', { credentials: 'include' }).then(r => r.json());
    if (!me?.profile) { setI18nMessage(regMsg, 'auth.sessionMissing'); return; }

    await goToGameAccordingToStarter();
  } catch (e) {
    const msg = (e?.message || '').toLowerCase();
    if (msg.includes('já está em uso') || msg.includes('duplicate')) {
      setI18nMessage(regMsg, 'auth.nameTaken');
    } else {
      setI18nMessage(regMsg, 'auth.registerFailed');
    }
  } finally {
    window._regBusy = false;
  }
});

/* ========= Logout ========= */
async function handleLogout(){
  await doLogout();
  showLanding();
}
btnLogout?.addEventListener('click', handleLogout);
btnLogoutTop?.addEventListener('click', handleLogout);
mobileLogout?.addEventListener('click', handleLogout);

/* ========= Mobile menu ========= */
btnHamb?.addEventListener('click', () => {
  mobMenu?.classList.toggle('open');
  const open = mobMenu?.classList.contains('open');
  btnHamb?.setAttribute('aria-expanded', open ? 'true' : 'false');
});
window.addEventListener('resize', closeMobileMenu);
document.addEventListener('click', (e)=>{
  if (!mobMenu || !btnHamb) return;
  if (mobMenu.contains(e.target) || btnHamb.contains(e.target)) return;
  closeMobileMenu();
});
