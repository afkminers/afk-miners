// client/js/app_panels.js
// Cria painéis dockados dentro de um "stack" (left/right). Não sobrepõem o viewport.

async function jget(u){
  const r = await fetch(u,{credentials:'include',headers:{'Accept':'application/json'},cache:'no-store'});
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function mkPanel({title, stack, key}){
  // evita duplicar
  const existing = stack.querySelector(`.panel[data-key="${key}"]`);
  if (existing){ existing.scrollIntoView({block:'nearest'}); return existing; }

  const el = document.createElement('div');
  el.className = 'panel';
  el.dataset.key = key;
  el.innerHTML = `
    <header>
      <h3>${title}</h3>
      <div class="btns">
        <button data-act="close">Close</button>
      </div>
    </header>
    <div class="body"></div>
  `;
  stack.appendChild(el);

  el.querySelector('[data-act="close"]').onclick = ()=> el.remove();
  return el;
}

/* -------------------- Skills -------------------- */
export function openSkills(stack){
  const p = mkPanel({ title:'Skills', stack, key:'skills' });
  const body = p.querySelector('.body');
  body.innerHTML = `
    <div>Em breve: árvore de skills e progresso.</div>
  `;
}

/* -------------------- Heroes -------------------- */
export async function openHeroes(stack){
  const p = mkPanel({ title:'Heroes', stack, key:'heroes' });
  const body = p.querySelector('.body');
  body.textContent = 'Carregando...';

  try{
    // Se você tiver endpoint: /api/player/heroes
    let list = [];
    try { list = await jget('/api/player/heroes'); } catch {}

    if (!Array.isArray(list) || !list.length){
      body.innerHTML = `
        <div>Sem heróis</div>
        <small>Faça summons para obter heróis.</small>
        <p style="margin-top:8px">Clique em um herói para abrir o perfil.</p>
      `;
      return;
    }

    const ul = document.createElement('div');
    ul.style.display='grid';
    ul.style.gap='8px';
    list.forEach(h=>{
      const row = document.createElement('div');
      row.style.display='flex';
      row.style.justifyContent='space-between';
      row.style.alignItems='center';
      row.style.padding='8px';
      row.style.background='#0d1628';
      row.style.border='1px solid #0f1a2e';
      row.style.borderRadius='8px';
      row.innerHTML = `<div>${h.name||h.heroKey}</div><small>${(h.rarity||'').toUpperCase()}</small>`;
      ul.appendChild(row);
    });
    body.innerHTML='';
    body.appendChild(ul);
  }catch(e){
    body.textContent='Erro ao carregar heroes';
  }
}

/* -------------------- Inventory (ITENS) -------------------- */
export async function openInventory(stack){
  const p = mkPanel({ title:'Inventory', stack, key:'inventory' });
  const body = p.querySelector('.body');
  body.textContent = 'Carregando...';

  try{
    // Se existir: /api/player/inventory
    let inv = null;
    try { inv = await jget('/api/player/inventory'); } catch {}

    if (!inv || !Array.isArray(inv.items) || !inv.items.length){
      body.innerHTML = `<div>Inventário vazio.</div><small>Em breve: itens, materiais e craft.</small>`;
      return;
    }

    const ul = document.createElement('div');
    ul.style.display='grid'; ul.style.gap='8px';
    inv.items.forEach(it=>{
      const row=document.createElement('div');
      row.style.display='flex'; row.style.justifyContent='space-between';
      row.style.alignItems='center'; row.style.padding='8px';
      row.style.background='#0d1628'; row.style.border='1px solid #0f1a2e'; row.style.borderRadius='8px';
      row.innerHTML = `<div>${it.name}</div><small>x${it.qty||1}</small>`;
      ul.appendChild(row);
    });
    body.innerHTML=''; body.appendChild(ul);
  }catch(e){
    body.textContent='Erro ao carregar inventory';
  }
}

/* -------------------- Summon (se quiser versão painel) -------------------- */
export function openSummonPanel(stack){
  const p = mkPanel({ title:'Summon', stack, key:'summon-panel' });
  const body = p.querySelector('.body');
  body.innerHTML = `
    <div>Para uma experiência retrô caprichada, usamos o <b>modal</b> (botão no topo).<br>
    Se preferir, posso embutir o banner e botões aqui também.</div>
  `;
}
