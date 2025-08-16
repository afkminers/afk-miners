// client/js/boot.js
import { API, getCsrf, apiGet } from './api.js';
import { doLogin, doRegister, doLogout } from './auth.js';
import { bindGachaUI } from './gacha.js';
import { initLoginFx, stopLoginFx, celebrate } from './login_fx.js';

// UI base
const authScreen = document.getElementById('authScreen');
const appMain    = document.getElementById('appMain');
const userInfo   = document.getElementById('userInfo');

// Auth form
const loginName  = document.getElementById('loginName');
const loginPass  = document.getElementById('loginPass');
const btnLogin   = document.getElementById('btnLogin');
const loginMsg   = document.getElementById('loginMsg');

const regName    = document.getElementById('regName');
const regPass    = document.getElementById('regPass');
const btnRegister= document.getElementById('btnRegister');
const regMsg     = document.getElementById('regMsg');

const btnLogout  = document.getElementById('btnLogout');
const btnLogoutTop = document.getElementById('btnLogoutTop'); // topo direito

// Header buttons
const btnPlay    = document.getElementById('btnPlay');
const authClose  = document.getElementById('authClose');

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

// HUD centralizado
function updateHud(profileOrCoins) {
  const coins = typeof profileOrCoins === 'number'
    ? profileOrCoins
    : Number(profileOrCoins?.coins ?? 0);

  const name  = (window.__playerName || profileOrCoins?.name || '').toString();
  if (name) window.__playerName = name;
  if (userInfo) userInfo.textContent = name ? `${name} • Coins ${coins}` : `Coins ${coins}`;

  if (ctx.coinCount) ctx.coinCount.textContent = coins;
  if (ctx.elBalance) ctx.elBalance.textContent = `Moedas: ${coins}`;
}

// liga gacha com callback de HUD
const gacha = bindGachaUI(ctx, { onHudUpdate: updateHud });

/* ========= helpers visual ========= */
function setLogoutVisibility(signed){
  const show = !!signed;
  btnLogoutTop?.classList.toggle('hidden', !show);
}
function setLoggedOutGlow(on){
  document.body.classList.toggle('logged-out', !!on);
}

/* ========= Estados de tela ========= */
function showLanding(){
  // Landing = sem app e sem modal aberto; com FX rodando ao fundo.
  appMain.classList.add('hidden');
  authScreen.classList.add('hidden');
  setLogoutVisibility(false);
  setLoggedOutGlow(true);
  initLoginFx();
}
async function showApp(profile) {
  stopLoginFx();
  authScreen.classList.add('hidden');
  appMain.classList.remove('hidden');
  setLogoutVisibility(true);
  setLoggedOutGlow(false);
  updateHud(profile);
  await gacha.init(profile);
}

/* ========= Sessão ========= */
async function trySession() {
  await getCsrf();
  const me = await apiGet(`${API}/api/auth/me`);
  if (me?.profile) showApp(me.profile);
  else showLanding(); // não abre o modal automaticamente
}
trySession();

/* ========= Play/Close do modal ========= */
if (btnPlay) {
  btnPlay.onclick = () => {
    authScreen.classList.remove('hidden');
    // já estamos na landing com FX ligado
  };
}
if (authClose) {
  authClose.onclick = () => {
    authScreen.classList.add('hidden');
  };
}

/* ========= Auth handlers ========= */
btnLogin.onclick = async () => {
  loginMsg.textContent = '';
  const data = await doLogin(loginName.value.trim(), loginPass.value);
  if (data?.error) { loginMsg.textContent = data.error; return; }
  celebrate();          // faíscas de sucesso
  await trySession();
};

btnRegister.onclick = async () => {
  regMsg.textContent = '';
  const data = await doRegister(regName.value.trim(), regPass.value);
  if (data?.error) { regMsg.textContent = data.error; return; }
  celebrate();          // faíscas de sucesso
  await trySession();
};

async function handleLogout(){
  await doLogout();
  showLanding();
}
btnLogout?.addEventListener('click', handleLogout);
btnLogoutTop?.addEventListener('click', handleLogout);
