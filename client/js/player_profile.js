// client/js/player_profile.js
export function bindProfileModal() {
  const overlay = document.getElementById('profileModal');
  const closeBtn = overlay.querySelector('.pf-close');
  const okBtn = document.getElementById('pf-ok');

  const el = {
    img: document.getElementById('pf-img'),
    rarity: document.getElementById('pf-rarity'),
    name: document.getElementById('pf-name'),
    meta: document.getElementById('pf-meta'),
    atk: document.getElementById('pf-atk'),
    def: document.getElementById('pf-def'),
    spd: document.getElementById('pf-spd'),
  };

  function cap(s){ if(!s) return '—'; return String(s).replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()); }

  function fill(hero){
    const rarity=(hero.rarity||'COMMON').toUpperCase();
    el.img.src = hero.imageUrl || `img/heroes/${hero.heroKey}.png`;
    el.img.alt = hero.name || 'hero portrait';
    el.rarity.textContent = rarity.replace('_',' ');
    el.rarity.className = 'pf-rarity rar-'+rarity;
    el.name.textContent = hero.name || '—';
    el.meta.textContent = [hero.class,hero.role,hero.attack_type,hero.element,hero.weapon_pref]
      .filter(Boolean).map(cap).join(' • ');
    el.atk.textContent = hero.attack ?? 0;
    el.def.textContent = hero.defense ?? 0;
    el.spd.textContent = hero.speed ?? 0;
  }

  function open(hero){
    if (!hero) return;
    fill(hero);
    overlay.style.display = '';
    overlay.classList.add('show');
    overlay.setAttribute('aria-hidden','false');
    // acessibilidade: foco no OK
    setTimeout(()=> document.getElementById('pf-ok')?.focus(), 0);
  }
  function close(){
    overlay.classList.remove('show');
    overlay.setAttribute('aria-hidden','true');
    overlay.style.display = 'none';
  }

  closeBtn.onclick = close;
  okBtn.onclick = close;
  overlay.addEventListener('click',(e)=>{ if(e.target===overlay) close(); });
  window.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && overlay.classList.contains('show')) close(); });

  return { open, close };
}

/**
 * Integração com a grade do Inventory:
 * chame setupInventoryOpen(invContainer, getInventoryArray, modal.open)
 */
export function setupInventoryOpen(invContainer, getInventory, openFn){
  function resolveCard(target){
    const card = target.closest('.card');
    if(!card) return null;
    const id = card.getAttribute('data-id');
    if(!id) return null;
    const inv = getInventory?.() || [];
    const hero = inv.find?.(x => String(x.id)===String(id));
    return hero || null;
  }
  invContainer.addEventListener('click',(e)=>{
    const hero = resolveCard(e.target);
    if(hero) openFn(hero);
  });
  invContainer.addEventListener('keydown',(e)=>{
    if(e.key==='Enter'||e.key===' '){
      const hero = resolveCard(e.target);
      if(hero){ e.preventDefault(); openFn(hero); }
    }
  });
}
