// client/js/app.js
// Layout “Tibia”: stacks laterais, chat fixo, viewport central com prioridade.
// Abre Skills/Heroes/Inventory sempre dockado (sem cobrir a área jogável).
import { openSkills, openHeroes, openInventory, openSummonPanel } from './app_panels.js';

/* ---------- HTTP helpers + CSRF ---------- */
let CSRF = null;
async function getCsrf(){
  if (CSRF) return CSRF;
  try{
    const r = await fetch('/api/csrf',{credentials:'include',headers:{'Accept':'application/json'},cache:'no-store'});
    const hdr = r.headers.get('x-csrf-token') || r.headers.get('X-CSRF-Token');
    let body=null; try{ body = await r.json(); }catch{}
    CSRF = hdr || body?.token || body?.csrf || body?.csrfToken || null;
  }catch{}
  return CSRF;
}
async function jget(u){
  const r = await fetch(u,{credentials:'include',headers:{'Accept':'application/json'},cache:'no-store'});
  if (r.status === 401){ location.href='/index.html'; throw new Error('401'); }
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function jpost(u,body){
  const tok = await getCsrf().catch(()=>null);
  const r = await fetch(u,{method:'POST',credentials:'include',
    headers:{'Content-Type':'application/json','Accept':'application/json', ...(tok?{'x-csrf-token':tok}:{})},
    body: JSON.stringify(body||{})});
  if (r.status === 401){ location.href='/index.html'; throw new Error('401'); }
  if (r.status === 403){ CSRF=null; await getCsrf().catch(()=>null); return jpost(u,body); }
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

/* ---------- Refs ---------- */
const canvas  = document.getElementById('scene');
const hud     = document.getElementById('hud');
const leftS   = document.getElementById('leftStack');
const rightS  = document.getElementById('rightStack');
const splitL  = document.getElementById('splitLeft');
const splitR  = document.getElementById('splitRight');
const chatDock= document.getElementById('chatDock');

const btnSkills    = document.getElementById('btnSkills');
const btnHeroes    = document.getElementById('btnHeroes');
const btnInventory = document.getElementById('btnInventory');
const btnSummon    = document.getElementById('btnSummon');
const btnLogout    = document.getElementById('btnLogout');

const summonModal  = document.getElementById('summonModal');
const summonClose  = summonModal?.querySelector('.close');

/* ---------- Chat básico ---------- */
const chatLog   = document.getElementById('chatLog');
const chatForm  = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
function chatPush(who,msg){ const line=document.createElement('div'); line.textContent=`${who}: ${msg}`; chatLog.appendChild(line); chatLog.scrollTop=chatLog.scrollHeight; }
chatForm?.addEventListener('submit',(e)=>{ e.preventDefault(); const v=chatInput.value.trim(); if(!v) return; chatPush('Você',v); chatInput.value=''; });

/* ---------- Cena House ---------- */
let currentScene = null;
async function mountSceneHouse(){
  if(currentScene?.unmount) try{ currentScene.unmount(); }catch{}
  try{
    const mod = await import('/js/scenes/house.js');
    currentScene = await mod.mount({ canvas, hud, params:{ map:'house' } });
    applyViewport();
  }catch(e){
    console.error('Falha ao carregar cena house.js', e);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#0b1220'; ctx.fillRect(0,0,canvas.width,canvas.height);
    hud.textContent='HOUSE — erro ao carregar cena';
  }
}

/* ---------- Viewport: respeita stacks laterais e chat ---------- */
function getInt(v){ return parseInt(getComputedStyle(document.documentElement).getPropertyValue(v))||0; }

function applyViewport(){
  // tamanho disponível do centerStage
  const center = document.getElementById('centerStage');
  const rect = center.getBoundingClientRect();

  // margem interna
  const pad = 16;
  const wCSS = Math.max(400, rect.width  - pad);
  const hCSS = Math.max(240, rect.height - pad);

  const dpr = Math.max(1, Math.min(window.devicePixelRatio||1, 3));
  canvas.style.width  = `${wCSS}px`;
  canvas.style.height = `${hCSS}px`;

  const w = Math.round(wCSS*dpr), h=Math.round(hCSS*dpr);
  if (canvas.width!==w || canvas.height!==h){ canvas.width=w; canvas.height=h; }
  try{ currentScene?.resize?.(wCSS, hCSS, dpr); }catch{}
}
window.addEventListener('resize', applyViewport);

/* ---------- Splitters (arrasta para redimensionar as sidebars) ---------- */
function makeVSplitter(splitEl, side){
  let dragging=false, startX=0, startW=0;

  function onDown(e){
    dragging=true;
    startX = e.clientX;
    const root = document.documentElement;
    startW = parseInt(getComputedStyle(root).getPropertyValue(side==='left'?'--leftW':'--rightW'))|| (side==='left'?300:320);
    document.body.style.userSelect='none';
  }
  function onMove(e){
    if(!dragging) return;
    const dx = e.clientX - startX;
    const newW = Math.max(200, Math.min(520, side==='left' ? (startW + dx) : (startW - dx)));
    document.documentElement.style.setProperty(side==='left'?'--leftW':'--rightW', newW+'px');
    applyViewport();
  }
  function onUp(){ dragging=false; document.body.style.userSelect=''; }

  splitEl.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}
makeVSplitter(splitL,'left');
makeVSplitter(splitR,'right');

/* ---------- Abrir painéis (sempre dockados) ---------- */
btnSkills   ?.addEventListener('click', ()=> openSkills(rightS));
btnHeroes   ?.addEventListener('click', ()=> openHeroes(leftS));
btnInventory?.addEventListener('click', ()=> openInventory(rightS));

/* ---------- Summon como MODAL ---------- */
btnSummon?.addEventListener('click', ()=>{
  summonModal.hidden = false;
});
summonClose?.addEventListener('click', ()=> summonModal.hidden = true);
summonModal?.addEventListener('click', (e)=>{ if(e.target===summonModal) summonModal.hidden = true; });

/* ---------- Logout ---------- */
btnLogout?.addEventListener('click', async ()=>{
  try{ await jpost('/api/auth/logout',{}); }catch{}
  location.href='/index.html';
});

/* ---------- Boot (guard starter + cena) ---------- */
(async function boot(){
  await getCsrf().catch(()=>null);
  try{
    const st = await jget('/api/starter/status');
    if (st?.canSelect){ location.href='/starter.html'; return; }
  }catch{}

  await mountSceneHouse();
  applyViewport();
})();
