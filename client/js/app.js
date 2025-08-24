// client/js/app.js
// Controla a tela do jogo (House) e os botões de painéis.

import { openSkills, openHeroes, openInventory, openSummon } from './app_panels.js';

/* -------------------- HTTP helpers + CSRF -------------------- */
let CSRF = null;
async function getCsrf(){
  if (CSRF) return CSRF;
  try{
    const r = await fetch('/api/csrf',{credentials:'include',headers:{'Accept':'application/json'},cache:'no-store'});
    const hdr = r.headers.get('x-csrf-token')||r.headers.get('X-CSRF-Token');
    let body=null; try{ body = await r.json(); }catch{}
    CSRF = hdr || body?.token || body?.csrf || body?.csrfToken || null;
  }catch{}
  return CSRF;
}
async function jget(u){
  const r = await fetch(u,{credentials:'include',headers:{'Accept':'application/json'},cache:'no-store'});
  if(r.status===401){ location.href='/index.html'; throw new Error('401'); }
  if(!r.ok) throw new Error(await r.text());
  return r.json();
}
async function jpost(u,body){
  const tok = await getCsrf().catch(()=>null);
  const r = await fetch(u,{method:'POST',credentials:'include',
    headers:{'Content-Type':'application/json','Accept':'application/json', ...(tok?{'x-csrf-token':tok}:{})},
    body: JSON.stringify(body||{})});
  if(r.status===401){ location.href='/index.html'; throw new Error('401'); }
  if(r.status===403){ CSRF=null; await getCsrf().catch(()=>null); return jpost(u,body); }
  if(!r.ok) throw new Error(await r.text());
  return r.json();
}

/* -------------------- UI refs -------------------- */
const canvas   = document.getElementById('view'); // <— ID que play.js espera
const hud      = document.getElementById('hud');
const btnLogout    = document.getElementById('btnLogout');
const btnSkills    = document.getElementById('btnSkills');
const btnHeroes    = document.getElementById('btnHeroes');
const btnInventory = document.getElementById('btnInventory');
const btnSummon    = document.getElementById('btnSummon');

/* -------------------- Chat stub -------------------- */
const chatLog   = document.getElementById('chatLog');
const chatForm  = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
function chatPush(who,msg){
  const line=document.createElement('div');
  line.textContent=`${who}: ${msg}`;
  chatLog.appendChild(line);
  chatLog.scrollTop=chatLog.scrollHeight;
}
chatForm?.addEventListener('submit', (e)=>{
  e.preventDefault();
  const v = chatInput.value.trim();
  if(!v) return;
  chatPush('Você', v);
  chatInput.value = '';
});

/* -------------------- Cena House (mapa) -------------------- */
let currentScene = null;
async function mountSceneHouse(){
  if(currentScene?.unmount) try{ currentScene.unmount(); }catch{}
  try{
    const mod = await import('/js/scenes/house.js');
    currentScene = await mod.mount({ canvas, hud, params:{ map:'house' } });
  }catch(err){
    console.error('Falha ao carregar cena house.js', err);
    const ctx = canvas?.getContext?.('2d');
    if (ctx){
      ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.fillStyle='#0b1220'; ctx.fillRect(0,0,canvas.width,canvas.height);
    }
    if (hud) hud.textContent = 'HOUSE — erro ao carregar cena';
  }
}

/* -------------------- Botões topo -------------------- */
btnSkills?.addEventListener('click',   (e)=>{ e.preventDefault(); openSkills();   });
btnHeroes?.addEventListener('click',   (e)=>{ e.preventDefault(); openHeroes();   });
btnInventory?.addEventListener('click',(e)=>{ e.preventDefault(); openInventory();});
btnSummon?.addEventListener('click',   (e)=>{ e.preventDefault(); openSummon();   });

/* -------------------- Logout -------------------- */
btnLogout?.addEventListener('click', async ()=> {
  try{ await jpost('/api/auth/logout',{}); }catch{}
  location.href = '/index.html';
});

/* -------------------- Guard Starter & boot -------------------- */
(async function boot(){
  await getCsrf().catch(()=>null);
  try{
    const st = await jget('/api/starter/status'); // {canSelect:boolean}
    if(st?.canSelect){ location.href='/starter.html'; return; }
  }catch(e){ /* segue mesmo assim */ }
  await mountSceneHouse();
})();
