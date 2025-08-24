// client/js/app_panels.js
// Painéis dockáveis simples + chamadas com CSRF (para Summon).

/* ---------- HTTP + CSRF ---------- */
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
async function apiJson(method, url, body){
  const tok = await getCsrf().catch(()=>null);
  const r = await fetch(url,{
    method, credentials:'include',
    headers:{ 'Accept':'application/json','Content-Type':'application/json', ...(tok?{'x-csrf-token':tok}:{}) },
    body: body?JSON.stringify(body):undefined
  });
  if (r.status === 403) {
    CSRF = null; await getCsrf().catch(()=>null);
    const r2 = await fetch(url,{
      method, credentials:'include',
      headers:{ 'Accept':'application/json','Content-Type':'application/json', ...(CSRF?{'x-csrf-token':CSRF}:{}) },
      body: body?JSON.stringify(body):undefined
    });
    if (!r2.ok) throw new Error(await r2.text());
    return r2.json();
  }
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
const jget  = (u)=> apiJson('GET', u);
const jpost = (u,b)=> apiJson('POST',u,b);

/* ---------- infra de painel ---------- */
const panelsRootId = 'dockArea';
function ensureRoot(){
  let root = document.getElementById(panelsRootId);
  if (!root){
    root = document.createElement('div');
    root.id = panelsRootId;
    root.style.position='relative';
    root.style.padding='8px';
    document.body.appendChild(root);
  }
  return root;
}
function makePanel(title){
  const root = ensureRoot();
  const wrap = document.createElement('div');
  wrap.className = 'dock-panel';
  wrap.style.background='#0f172a';
  wrap.style.border='1px solid #0b1220';
  wrap.style.borderRadius='10px';
  wrap.style.padding='10px';
  wrap.style.margin='8px';
  wrap.style.minWidth='280px';
  wrap.style.boxShadow='0 8px 18px rgba(0,0,0,.35)';

  wrap.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <strong style="color:#e6eaf2">${title}</strong>
      <div>
        <button class="btnDock" style="margin-right:6px">Dock</button>
        <button class="btnClose">Close</button>
      </div>
    </div>
    <div class="content" style="color:#cdd6f4"></div>
  `;

  // fecha de verdade
  wrap.querySelector('.btnClose').onclick = ()=> wrap.remove();

  // dock/undock simples (troca position)
  let undocked = false;
  wrap.querySelector('.btnDock').onclick = ()=>{
    undocked = !undocked;
    if (undocked){
      wrap.style.position='absolute';
      wrap.style.right='12px';
      wrap.style.bottom='12px';
      wrap.style.zIndex='40';
    } else {
      wrap.style.position='static';
    }
  };

  root.appendChild(wrap);
  return {wrap, content: wrap.querySelector('.content')};
}

/* ---------- HEROES ---------- */
export async function openHeroes(){
  const {content} = makePanel('Heroes');
  try{
    // tenta alguns endpoints conhecidos no teu zip
    let heroes=null;
    try{ heroes = await jget('/api/player/heroes'); }catch{}
    if (!heroes) try{ heroes = await jget('/api/hero/list'); }catch{}
    if (!Array.isArray(heroes)) heroes = [];

    if (!heroes.length){
      content.innerHTML = `
        <div style="opacity:.8">Sem heróis</div>
        <div style="opacity:.6">Faça summons para obter heróis.</div>
        <div style="margin-top:8px;opacity:.6">Clique em um herói para abrir o perfil.</div>`;
      return;
    }

    const ul = document.createElement('ul');
    ul.style.listStyle='none'; ul.style.padding='0'; ul.style.margin='0';
    for (const h of heroes){
      const li = document.createElement('li');
      li.textContent = (h.name||h.heroKey||'hero').toString();
      li.style.padding='6px 0'; li.style.borderBottom='1px solid #0b1220';
      ul.appendChild(li);
    }
    content.appendChild(ul);
  }catch(e){
    content.textContent = 'Erro ao carregar heróis.';
    console.error(e);
  }
}

/* ---------- INVENTORY (itens) ---------- */
export async function openInventory(){
  const {content} = makePanel('Inventory');
  try{
    let inv=null;
    try{ inv = await jget('/api/player/inventory'); }catch{}
    if (!inv) try{ inv = await jget('/api/inventory'); }catch{}
    if (!Array.isArray(inv)) inv = [];

    if (!inv.length){
      content.innerHTML = `<div style="opacity:.7">Vazio. Em breve: itens, materiais e craft.</div>`;
      return;
    }

    const ul = document.createElement('ul');
    ul.style.listStyle='none'; ul.style.padding='0'; ul.style.margin='0';
    for (const it of inv){
      const li = document.createElement('li');
      li.textContent = (it.name||it.key||'item').toString();
      li.style.padding='6px 0'; li.style.borderBottom='1px solid #0b1220';
      ul.appendChild(li);
    }
    content.appendChild(ul);
  }catch(e){
    content.textContent = 'Erro ao carregar inventário.';
    console.error(e);
  }
}

/* ---------- SKILLS (placeholder) ---------- */
export function openSkills(){
  const {content} = makePanel('Skills');
  content.innerHTML = `<div style="opacity:.8">Em breve: árvore de skills e progresso.</div>`;
}

/* ---------- SUMMON (com CSRF) ---------- */
export async function openSummon(){
  const {content} = makePanel('Summon');
  const btn1 = document.createElement('button');
  btn1.textContent = 'Summon ×1 (100)';
  btn1.style.marginRight='8px';
  const btn10 = document.createElement('button');
  btn10.textContent = 'Summon ×10';

  const result = document.createElement('div');
  result.style.marginTop='10px';
  result.style.whiteSpace='pre-wrap';

  async function doPull(n=1){
    result.textContent = 'Summoning...';
    try{
      const data = await jpost('/api/gacha/pull', { count:n });
      result.textContent = JSON.stringify(data, null, 2);
    }catch(e){
      result.textContent = 'Erro: '+(e?.message||e);
      console.error(e);
    }
  }

  btn1.onclick  = ()=> doPull(1);
  btn10.onclick = ()=> doPull(10);

  content.append(btn1, btn10, result);
}
