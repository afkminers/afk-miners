// client/js/gacha.js
import { API, getCsrf, apiGet, apiPost } from './api.js';

export function bindGachaUI(ctx, opts = {}) {
  const onHudUpdate = opts.onHudUpdate || (() => {});
  let player = null;
  let summonCost = 100;

  // ===== HEROES =====
  let __heroes = [];
  const heroesEl = document.getElementById('heroesGrid') || document.getElementById('inventory');

  // ---------- helpers visuais ----------
  function playSfx(id){ const el=document.getElementById('sfx-'+id); if(!el) return; el.currentTime=0; el.play().catch(()=>{}); }
  function playClick(){ const el=document.getElementById('sfx-click'); if(!el) return; el.currentTime=0; el.play().catch(()=>{}); }
  function flash(){ ctx.flashEl?.classList.add('show'); setTimeout(()=>ctx.flashEl?.classList.remove('show'),140); }
  function setRarityBg(r){ if(!ctx.rarBg) return; ctx.rarBg.className='rar-bg '+r; }
  function openOverlay(){ ctx.overlay.classList.add('show'); ctx.overlay.setAttribute('aria-hidden','false'); }
  function closeOverlay(){ ctx.overlay.classList.remove('show'); ctx.overlay.setAttribute('aria-hidden','true'); }
  function cap(s){ if(!s) return '—'; return String(s).replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()); }
  function lockButtons(lock=true){
    [ctx.elGacha, ctx.btnAgain, ctx.btnAgain10].forEach(b=>{ if(b) b.disabled = lock; });
  }

  // ---------- FX simples ----------
  const pixCanvas=document.getElementById('pixFx');
  const pCtx=pixCanvas?.getContext?.('2d',{alpha:true});
  let pixRAF=0,pixArr=[];
  function startPix(){ if(!pixCanvas||!pCtx) return; resizePix(); pixArr=[]; for(let i=0;i<30;i++) pixArr.push(spawnPix()); cancelAnimationFrame(pixRAF); loopPix(); window.addEventListener('resize',resizePix); }
  function stopPix(){ if(!pixCanvas||!pCtx) return; cancelAnimationFrame(pixRAF); pCtx.clearRect(0,0,pixCanvas.width,pixCanvas.height); window.removeEventListener('resize',resizePix); }
  function resizePix(){ if(!pixCanvas) return; const r=pixCanvas.parentElement.getBoundingClientRect(); pixCanvas.width=Math.max(1,Math.floor(r.width)); pixCanvas.height=Math.max(1,Math.floor(r.height)); }
  function spawnPix(){ return { x:Math.random()*pixCanvas.width, y:pixCanvas.height+Math.random()*40, s:2+(Math.random()<.25?2:0), spd:0.45+Math.random()*0.75, col:Math.random()<.5?'#fff':'#ffd36c' }; }
  function loopPix(){ if(!pCtx||!pixCanvas) return; pCtx.clearRect(0,0,pixCanvas.width,pixCanvas.height); for(const p of pixArr){ p.y-=p.spd; if(p.y<-6){ p.x=Math.random()*pixCanvas.width; p.y=pixCanvas.height+12; } pCtx.fillStyle=p.col; pCtx.fillRect(Math.round(p.x),Math.round(p.y),p.s,p.s);} pixRAF=requestAnimationFrame(loopPix); }

  function spawnSparks(){
    if(!ctx.sparks) return;
    ctx.sparks.innerHTML='';
    for(let i=0;i<12;i++){
      const s=document.createElement('div');
      s.className='spark show';
      s.style.left=(56+(Math.random()*18-9))+'%';
      s.style.top =(58+(Math.random()*8-4))+'%';
      s.style.background=i%2?'#fff':'#ffd36c';
      ctx.sparks.appendChild(s);
      setTimeout(()=>s.remove(),650);
    }
  }

  async function wait(ms,skippable=false){
    return new Promise(res=>{
      if(!skippable){ setTimeout(res,ms); return; }
      const t=setTimeout(done,ms);
      function done(){ ctx.overlay.removeEventListener('click',skipOnce); window.removeEventListener('keydown',keySkip); clearTimeout(t); res(); }
      function skipOnce(e){ if(e.button===0){ playClick(); done(); } }
      function keySkip(){ playClick(); done(); }
      ctx.overlay.addEventListener('click',skipOnce);
      window.addEventListener('keydown',keySkip);
    });
  }

  async function playChestSequence(rarity){
    ctx.okbar.classList.add('hidden');
    if (ctx.chestHint) ctx.chestHint.style.display='block';
    ctx.resultPane.classList.add('hidden');
    ctx.multiPane.classList.add('hidden');
    ctx.chestWrap.classList.remove('hidden');
    ctx.burst.classList.remove('show');
    ctx.chestSvg.classList.remove('open');
    ctx.chestSvg.classList.add('shake'); await wait(1600,true); ctx.chestSvg.classList.remove('shake');
    await wait(1200,true);
    ctx.chestSvg.classList.add('open'); playSfx(rarity); flash(); spawnSparks(); ctx.burst.classList.add('show');
    await wait(400); ctx.burst.classList.remove('show'); if (ctx.chestHint) ctx.chestHint.style.display='none';
  }

  // ---------- painel de resultado ----------
  function fillPanel(hero){
    const rarity=(hero.rarity||'COMMON').toUpperCase();
    const imgUrl = hero.imageUrl || `img/heroes/${hero.heroKey || 'unknown'}.png`;
    if (ctx.sumImg) { ctx.sumImg.src=imgUrl; ctx.sumImg.alt=hero.name||'hero'; }
    if (ctx.sumName) ctx.sumName.textContent=hero.name||'—';
    if (ctx.rarTag) { ctx.rarTag.textContent=rarity.replace('_',' '); ctx.rarTag.className='rar-tag rar-'+rarity; }
    if (ctx.stAtk) ctx.stAtk.textContent=hero.attack ?? 0;
    if (ctx.stDef) ctx.stDef.textContent=hero.defense ?? 0;
    if (ctx.stSpd) ctx.stSpd.textContent=hero.speed ?? 0;
    if (ctx.stClass) ctx.stClass.textContent=cap(hero.class);
    if (ctx.stRole)  ctx.stRole .textContent=cap(hero.role);
    if (ctx.stType)  ctx.stType .textContent=cap(hero.attack_type);
    if (ctx.stElem)  ctx.stElem .textContent=cap(hero.element);
    if (ctx.stWeap)  ctx.stWeap .textContent=cap(hero.weapon_pref);
    setRarityBg(rarity);
    if (ctx.halo) ctx.halo.className='halo '+rarity;
  }

  function setAgainState(enabled,hint=false){
    if (ctx.btnAgain)   ctx.btnAgain.disabled   = !enabled;
    if (ctx.btnAgain10) ctx.btnAgain10.disabled = !enabled;
    if (ctx.againHint)  ctx.againHint.style.display = hint ? 'block':'none';
    if (ctx.btnAgain)   ctx.btnAgain.textContent = `SUMMON AGAIN (${summonCost})`;
  }

  // ---------- UI dos cards ----------
  function heroCardMarkup(h,{animate=false}={}){
    const rarity=(h.rarity||'').toUpperCase();
    const key = h.heroKey || 'unknown';
    const img=h.imageUrl||`img/heroes/${key}.png`;
    const metaLine=[h.class,h.role,h.attack_type,h.element].filter(Boolean).map(x=>x.replace(/_/g,' ')).join(' • ');
    return `
      <div class="card ${rarity} ${animate?'drop':''}" data-id="${h.id||''}" data-key="${key}" tabindex="0" role="button" aria-label="${h.name||'Hero'} (${rarity.replace('_',' ')})">
        <div class="badge">${rarity.replace('_',' ')}</div>
        <div class="portrait"><img src="${img}" alt="${h.name||'Hero'}" style="image-rendering:pixelated"></div>
        <div class="meta">
          <div class="name">${h.name||'—'}</div>
          <div class="rarity">${metaLine}</div>
          <div class="stats">⚔️ ${h.attack??0} &nbsp; 🛡️ ${h.defense??0} &nbsp; ⚡ ${h.speed??0}</div>
        </div>
      </div>
    `;
  }

  function renderHeroes(){
    if(!heroesEl) return;
    heroesEl.innerHTML=(__heroes||[]).map(h=>heroCardMarkup(h)).join('');
    const invMirror=document.getElementById('inventory');
    if(invMirror && invMirror!==heroesEl) invMirror.innerHTML=heroesEl.innerHTML;
    document.dispatchEvent(new Event('heroes:rendered'));
    document.dispatchEvent(new CustomEvent('inventory:rendered',{detail:{inventory:__heroes}}));
  }

  // ---------- API ----------
  async function refreshFromServer(){
    const data=await apiGet(`${API}/api/player/me`);
    if(data?.error) return;
    player=data.profile||player;
    onHudUpdate(player);
    const list=Array.isArray(data.heroes)?data.heroes:Array.isArray(data.inventory)?data.inventory:[];
    __heroes=list;
    window.AFK_HEROES=__heroes;
    window.AFK_INVENTORY=__heroes;
    renderHeroes();
  }

  async function doSummonAPI(){
    // sempre garantir CSRF antes de POST
    await getCsrf();
    const data=await apiPost(`${API}/api/gacha`,{});
    if(typeof data.cost==='number') summonCost=data.cost;
    if(data.error) return { error:data.error, cost:summonCost, newBalance:data.newBalance };
    const coins=data?.newBalance?.coins;
    if(typeof coins==='number') onHudUpdate({ coins, name:player?.name });
    return data;
  }

  async function playOneSummonAndReveal(data){
    if(data.error){
      if (ctx.elResult) ctx.elResult.textContent=data.error;
      setAgainState(false,true);
      return;
    }
    const rarity=(data.hero.rarity||'COMMON').toUpperCase();
    if(!ctx.skipChk?.checked){ await playChestSequence(rarity); } else { playSfx(rarity); flash(); }
    ctx.chestWrap.classList.add('hidden');
    fillPanel(data.hero);
    ctx.resultPane.classList.remove('hidden');
    ctx.multiPane.classList.add('hidden');
    ctx.okbar.classList.remove('hidden');
    ctx.heroPane.classList.add('revealed');
    startPix();

    __heroes.unshift(data.hero);
    renderHeroes();

    const canAgain=(data?.newBalance?.coins??player?.coins??0)>=summonCost;
    setAgainState(canAgain,!canAgain);
  }

  // tenta batch endpoint (?count=), senão faz fallback sequencial
  async function playMultiSummon(count){
    ctx.okbar.classList.add('hidden');
    ctx.resultPane.classList.add('hidden');
    ctx.chestWrap.classList.add('hidden');
    ctx.multiPane.classList.remove('hidden');
    ctx.multiGrid.innerHTML='';
    let results = [];
    let batchWorked = false;

    try{
      await getCsrf();
      const data = await apiPost(`${API}/api/gacha?count=${count}`, {});
      if (!data || data.error || !Array.isArray(data.pulls)) throw new Error(data?.error || 'Batch indisponível');
      batchWorked = true;
      results = data.pulls.map(h => ({ hero: h, newBalance: data.newBalance }));
      if(typeof data.cost==='number') summonCost=data.cost;
      const coins=data?.newBalance?.coins;
      if(typeof coins==='number') onHudUpdate({ coins, name:player?.name });
    }catch{
      // fallback: sequencial
      for(let i=0;i<count;i++){
        const r=await doSummonAPI();
        if(r.error){ if (ctx.elResult) ctx.elResult.textContent=r.error; break; }
        results.push(r);
      }
    }

    for(const r of results){
      const h = batchWorked ? r.hero : r.hero;
      const rarity=(h.rarity||'COMMON').toUpperCase();
      const card=document.createElement('div');
      card.className=`mini ${rarity} pop`;
      const img = h.imageUrl || `img/heroes/${h.heroKey||'unknown'}.png`;
      card.innerHTML = `
        <span class="mini-tag">${rarity.replace('_',' ')}</span>
        <img class="mini-img" src="${img}" alt="${h.name||'Hero'}"
             style="image-rendering:pixelated;width:96px;height:96px;object-fit:contain;border-radius:8px">
        <div class="mini-name" style="font-weight:800">${h.name||'—'}</div>
      `;
      ctx.multiGrid.appendChild(card);
      __heroes.unshift(h);
      playSfx(rarity);
      await new Promise(res=>setTimeout(res,120));
    }

    renderHeroes();

    const last = results.at(-1);
    const coinsLeft = (batchWorked ? last?.newBalance?.coins : last?.newBalance?.coins) ?? player?.coins ?? 0;
    const canAgain = Number(coinsLeft) >= summonCost;
    setAgainState(canAgain,!canAgain);
    ctx.okbar.classList.remove('hidden');
  }

  async function startSummon(count=1,isMulti=false){
    if(!player) return;
    openOverlay();
    lockButtons(true);
    ctx.okbar.classList.add('hidden');
    ctx.resultPane.classList.add('hidden');
    ctx.multiPane.classList.add('hidden');
    ctx.chestWrap.classList.remove('hidden');
    ctx.chestSvg.classList.remove('open');
    ctx.burst.classList.remove('show');
    if (ctx.chestHint) ctx.chestHint.style.display='none';
    ctx.heroPane.classList.remove('revealed');
    stopPix();

    try{
      if(isMulti||count>1){ await playMultiSummon(count); }
      else{
        const data=await doSummonAPI();
        await playOneSummonAndReveal(data);
      }
    }catch(e){
      if (ctx.elResult) ctx.elResult.textContent = e?.message || 'Falha ao girar gacha';
      ctx.burst.classList.remove('show');
      if (ctx.chestHint) ctx.chestHint.style.display='none';
      ctx.okbar.classList.remove('hidden');
    }finally{
      lockButtons(false);
    }
  }

  // ---------- binds ----------
  function hardCloseOverlay(){
    ctx.burst.classList.remove('show');
    ctx.chestSvg.classList.remove('open');
    if (ctx.chestHint) ctx.chestHint.style.display='none';
    stopPix();
    closeOverlay();
  }
  if (ctx.closeX) ctx.closeX.onclick=hardCloseOverlay;
  if (ctx.btnOk)  ctx.btnOk.onclick=hardCloseOverlay;
  window.addEventListener('keydown',e=>{ if(e.key==='Escape'&&ctx.overlay.classList.contains('show')) hardCloseOverlay(); });
  ctx.overlay.addEventListener('click',e=>{ if(e.target===ctx.overlay) hardCloseOverlay(); });

  if (ctx.elGacha)    ctx.elGacha.onclick   = async()=>{ await startSummon(1); };
  if (ctx.btnAgain)   ctx.btnAgain.onclick  = async()=>{ await startSummon(1); };
  if (ctx.btnAgain10) ctx.btnAgain10.onclick= async()=>{ await startSummon(10,true); };

  // ---------- init ----------
  async function init(profile){
    player=profile;
    onHudUpdate(player);
    await getCsrf();          // pega CSRF no boot para evitar 403/500
    await refreshFromServer();
    const canAgain=Number(player?.coins||0)>=summonCost;
    setAgainState(canAgain,!canAgain);
  }

  function getHeroes(){ return __heroes; }
  function getInventory(){ return __heroes; }

  return { init, getHeroes, getInventory };
}
