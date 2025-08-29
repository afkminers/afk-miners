// client/js/boot.js
import { API, getCsrf, apiGet } from './api.js';
import { doLogin, doRegister, doLogout } from './auth.js';
import { bindGachaUI } from './gacha.js';
import { initLoginFx, stopLoginFx, celebrate } from './login_fx.js';
import { bindProfileModal, setupInventoryOpen } from './player_profile.js';

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

// HUD centralizado
function updateHud(profileOrCoins) {
  const coins = typeof profileOrCoins === 'number'
    ? profileOrCoins
    : Number(profileOrCoins?.coins ?? 0);

  const name = (window.__playerName || profileOrCoins?.name || '').toString();
  if (name) window.__playerName = name;

  if (userInfo) {
    userInfo.textContent = name
      ? `${name} • Coins ${coins}`
      : `Coins ${coins}`;
  }

  if (ctx.coinCount) ctx.coinCount.textContent = coins;
  if (ctx.elBalance) ctx.elBalance.textContent = `Moedas: ${coins}`;

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
trySession();

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
  loginMsg.textContent = '';

  if (window._loginBusy) return;
  window._loginBusy = true;

  try {
    const data = await doLogin(loginName.value.trim(), loginPass.value);
    if (data?.error) { loginMsg.textContent = data.error; return; }

    // Confirma sessão
    const me = await fetch('/api/auth/me', { credentials: 'include' }).then(r => r.json());
    if (!me?.profile) { loginMsg.textContent = 'Sessão não criada. Tente novamente.'; return; }

    celebrate();
    await goToGameAccordingToStarter();
  } catch {
    loginMsg.textContent = 'Falha ao autenticar.';
  } finally {
    window._loginBusy = false;
  }
});

btnRegister?.addEventListener('click', async (ev) => {
  ev.preventDefault();
  regMsg.textContent = '';

  if (window._regBusy) return;
  window._regBusy = true;

  try {
    const res = await doRegister(regName.value.trim(), regPass.value);
    if (res?.error) { regMsg.textContent = res.error; return; }

    celebrate();

    // Confere sessão
    const me = await fetch('/api/auth/me', { credentials: 'include' }).then(r => r.json());
    if (!me?.profile) { regMsg.textContent = 'Sessão não criada. Tente novamente.'; return; }

    await goToGameAccordingToStarter();
  } catch (e) {
    const msg = (e?.message || '').toLowerCase();
    if (msg.includes('já está em uso') || msg.includes('duplicate')) {
      regMsg.textContent = 'Nome já está em uso.';
    } else {
      regMsg.textContent = 'Falha ao registrar.';
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
