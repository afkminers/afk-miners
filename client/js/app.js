/* -------------------- HTTP helpers + CSRF -------------------- */
let CSRF = null;
async function getCsrf(){
  if (CSRF) return CSRF;
  const r = await fetch('/api/csrf', {
    credentials:'include',
    headers:{ 'Accept':'application/json' },
    cache:'no-store'
  });
  const hdr = r.headers.get('x-csrf-token') || r.headers.get('X-CSRF-Token');
  let body=null; try{ body = await r.json(); }catch{}
  CSRF = hdr || body?.token || body?.csrf || body?.csrfToken || null;
  if(!CSRF) throw new Error('csrf');
  return CSRF;
}
async function jget(u){
  const r = await fetch(u, {
    credentials:'include',
    headers:{ 'Accept':'application/json' },
    cache:'no-store'
  });
  if(r.status===401){ location.href='/index.html'; throw new Error('401'); }
  if(!r.ok) throw new Error(await r.text());
  return r.json();
}
async function jpost(u,body){
  const tok = await getCsrf();
  const r = await fetch(u, {
    method:'POST',
    credentials:'include',
    headers:{
      'Content-Type':'application/json',
      'Accept':'application/json',
      'x-csrf-token':tok
    },
    body: JSON.stringify(body||{})
  });
  if(r.status===401){ location.href='/index.html'; throw new Error('401'); }
  if(r.status===403){ CSRF=null; await getCsrf(); return jpost(u,body); }
  if(!r.ok) throw new Error(await r.text());
  return r.json();
}

/* -------------------- UI refs -------------------- */
const canvas   = document.getElementById('scene');
const hud      = document.getElementById('hud');
const overlays = document.getElementById('overlays');
document.getElementById('btnLogout').onclick = async () => {
  await jpost('/api/auth/logout', {});
  location.href='/index.html';
};

/* -------------------- Panels (overlays) -------------------- */
const PanelManager = (()=> {
  let open = {};
  function mount(id, title, innerHTML){
    if(open[id]) return;
    const el = document.createElement('div');
    el.className='modal'; el.dataset.id=id;
    el.innerHTML = `
      <header><h3>${title}</h3><button class="close">x</button></header>
      <div class="body">${innerHTML}</div>
    `;
    el.querySelector('.close').onclick = ()=>unmount(id);
    overlays.appendChild(el); open[id]=el;
  }
  function unmount(id){ const el=open[id]; if(!el) return; el.remove(); delete open[id]; }
  return { mount, unmount };
})();
document.querySelectorAll('[data-panel]').forEach(b=>{
  b.onclick = ()=>{
    const id = b.dataset.panel;
    if(id==='skills')     PanelManager.mount('skills','Skills', `<div>…(TODO: skills)</div>`);
    if(id==='heroes')     PanelManager.mount('heroes','Heroes', `<div>…(TODO: heroes)</div>`);
    if(id==='inventory')  PanelManager.mount('inventory','Inventory', `<div>…(TODO: inventory)</div>`);
    if(id==='summon')     PanelManager.mount('summon','Summon', `<div>…(TODO: summon)</div>`);
  };
});

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
chatForm.onsubmit = (e)=>{
  e.preventDefault();
  const v=chatInput.value.trim();
  if(!v) return;
  chatPush('Você', v);
  chatInput.value='';
  // TODO: enviar ao servidor (global / default)
};

/* -------------------- Router + Scenes -------------------- */
let currentScene = null;

async function mountScene(name, params){
  if(currentScene?.unmount){
    try{ currentScene.unmount(); }catch{}
    currentScene = null;
  }

  if(name === 'house'){
    // Cena da House (lobby) — wrapper que usa a cena de mapa
    const mod = await import('/js/scenes/house.js');
    currentScene = await mod.mount({ canvas, hud, params });
    return;
  }

  if(name === 'explore'){
    // Cena genérica de mapa (caso você queira abrir outros mapas)
    const mod = await import('/js/scenes/explore.js');
    currentScene = await mod.mount({ canvas, hud, params });
    return;
  }

  // cenas ainda não implementadas
  hud.textContent = `Carregando…`;
  const ctx = canvas.getContext('2d'); ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#111'; ctx.fillRect(0,0,canvas.width,canvas.height);
  hud.textContent = `${name.toUpperCase()} — em breve`;
}

function parseHash(){
  const h = location.hash || '#/house';
  const [path,q] = h.slice(1).split('?');
  const params = Object.fromEntries(new URLSearchParams(q||'').entries());
  return { path, params };
}

async function onRouteChange(){
  const { path, params } = parseHash();

  if(path === '/house'){
    await mountScene('house', { map: 'house' });
  }
  else if(path === '/explore'){         // opcional: abrir outros mapas
    await mountScene('explore', { map: params.map || 'house' });
  }
  else if(path === '/training'){
    await mountScene('training', {});
  }
  else if(path === '/pvp'){
    await mountScene('pvp', {});
  }
  else if(path === '/dungeon'){
    await mountScene('dungeon', {});
  }
  else {
    location.hash = '#/house';
  }
}

addEventListener('hashchange', onRouteChange);
document.querySelectorAll('[data-route]').forEach(b=>{
  b.onclick = ()=> location.hash = b.dataset.route;
});

/* -------------------- Guard de Starter (1ª vez) -------------------- */
(async function boot(){
  await getCsrf();
  const st = await jget('/api/starter/status'); // { canSelect:boolean }
  if(st.canSelect){
    // Nunca escolheu → vai escolher
    location.href = '/starter.html';
    return;
  }
  // Já tem starter → abre o lobby (House)
  if(!location.hash) location.hash = '#/house';
  onRouteChange();
})();
