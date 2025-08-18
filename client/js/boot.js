// client/js/boot.js
import { API, getCsrf, apiGet } from './api.js';
import { doLogin, doRegister, doLogout } from './auth.js';
import { bindGachaUI } from './gacha.js';
import { initLoginFx, stopLoginFx, celebrate } from './login_fx.js';
import { bindProfileModal, setupInventoryOpen } from './player_profile.js'; // PERFIL

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

// Referências gacha
const ctx = {
  elGacha:   document.getElementById('btnGacha'),
  elBalance: document.getElementById('balance'),
  elResult:  document.getElementById('result'),
  elInv:     document.getElementById('inventory'),

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

// liga gacha com callback de HUD
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
  appMain.classList.add('hidden');
  authScreen.classList.add('hidden');
  setLogoutVisibility(false);
  setLoggedOutGlow(true);
  closeMobileMenu();
  window.__isAuth = false;
  initLoginFx();
}

let __profileModalBound = false;

async function showApp(profile) {
  stopLoginFx();
  authScreen.classList.add('hidden');
  appMain.classList.remove('hidden');
  setLogoutVisibility(true);
  setLoggedOutGlow(false);
  closeMobileMenu();

  __profile = profile;
  window.__isAuth = true;

  updateHud(profile);
  await gacha.init(profile);

  // === Bind do modal de perfil (uma única vez)
  if (!__profileModalBound) {
    __profileModalBound = true;
    const modal = bindProfileModal();
    const invEl = document.getElementById('inventory');
    const getInv = () => (gacha.getInventory ? gacha.getInventory() : (window.AFK_INVENTORY || []));
    if (invEl) {
      setupInventoryOpen(invEl, getInv, modal.open);
      document.addEventListener('inventory:rendered', () => {
        setupInventoryOpen(invEl, getInv, modal.open);
      });
    }
  }
}

/* ========= Sessão ========= */
async function trySession() {
  await getCsrf();
  const me = await apiGet(`${API}/api/auth/me`);
  if (me?.profile) showApp(me.profile);
  else showLanding();
}
trySession();

/* ========= PLAY ========= */
if (btnPlay) {
  btnPlay.onclick = () => {
    if (window.__isAuth && __profile) {
      showApp(__profile);
    } else {
      authScreen.classList.remove('hidden');
    }
  };
}

/* ========= Close do modal de auth ========= */
if (authClose) {
  authClose.onclick = () => authScreen.classList.add('hidden');
}

/* ========= Auth handlers ========= */
btnLogin.onclick = async () => {
  loginMsg.textContent = '';
  const data = await doLogin(loginName.value.trim(), loginPass.value);
  if (data?.error) { loginMsg.textContent = data.error; return; }
  celebrate();
  await trySession();
};

btnRegister.onclick = async () => {
  regMsg.textContent = '';
  const data = await doRegister(regName.value.trim(), regPass.value);
  if (data?.error) { regMsg.textContent = data.error; return; }
  celebrate();
  await trySession();
};

async function handleLogout(){
  await doLogout();
  showLanding();
}
btnLogout?.addEventListener('click', handleLogout);
btnLogoutTop?.addEventListener('click', handleLogout);
mobileLogout?.addEventListener('click', handleLogout);

/* ========= Mobile menu ========= */
btnHamb?.addEventListener('click', () => {
  mobMenu.classList.toggle('open');
  const open = mobMenu.classList.contains('open');
  btnHamb.setAttribute('aria-expanded', open ? 'true' : 'false');
});
window.addEventListener('resize', closeMobileMenu);
document.addEventListener('click', (e)=>{
  if (!mobMenu || !btnHamb) return;
  if (mobMenu.contains(e.target) || btnHamb.contains(e.target)) return;
  closeMobileMenu();
});
