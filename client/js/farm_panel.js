// client/js/farm_panel.js
(function(){
  // ===== HTTP helpers (com CSRF à prova) =====
  async function getCsrf() {
    // força servidor a (re)emitir o cookie e evita 304
    await fetch('/api/csrf', { credentials:'include', cache:'no-store' });

    // 1) cookie (fluxo padrão do teu middleware)
    const m = document.cookie.match(/(?:^|;\s*)csrf=([^;]+)/);
    if (m) return decodeURIComponent(m[1]);

    // 2) headers/body (fallback)
    const r = await fetch('/api/csrf', { credentials:'include', cache:'no-store' });
    const h = new Map(r.headers.entries());
    const headTok =
      h.get('x-csrf-token') || h.get('x-xsrf-token') || h.get('csrf-token') || h.get('x-csrf');
    if (headTok) return headTok;
    try {
      const j = await r.clone().json();
      if (j?.token || j?.csrf || j?.csrfToken) return j.token || j.csrf || j.csrfToken;
    } catch(_) {}
    throw new Error('CSRF não encontrado');
  }
  async function jget(url){
    const r = await fetch(url, { credentials:'include', cache:'no-store' });
    if(!r.ok){ throw new Error(await r.text()); }
    return r.json();
  }
  async function jpost(url, body){
    const tok = await getCsrf();
    const r = await fetch(url, {
      method:'POST', credentials:'include',
      headers:{ 'Content-Type':'application/json', 'x-csrf-token': tok },
      body: JSON.stringify(body || {})
    });
    if(!r.ok){ throw new Error(await r.text()); }
    return r.json();
  }

  // ===== mini utils =====
  const fmtTime = (isoOrSql) => isoOrSql ? new Date(isoOrSql).toLocaleTimeString() : '—';
  const secLeft = (ts) => {
    if (!ts) return null;
    const now = Date.now();
    const t = new Date(ts).getTime();
    return Math.max(0, Math.ceil((t - now)/1000));
  };
  const pretty  = (o) => { try { return JSON.stringify(o,null,2); } catch { return String(o); } };
  const el = (tag, attrs={}, children=[]) => {
    const e = document.createElement(tag);
    for (const [k,v] of Object.entries(attrs)) {
      if (k==='class') e.className = v;
      else if (k==='style' && v && typeof v==='object') Object.assign(e.style, v);
      else e.setAttribute(k, v);
    }
    (Array.isArray(children)?children:[children]).forEach(c=>{
      if (c==null) return;
      e.appendChild(typeof c==='string' ? document.createTextNode(c) : c);
    });
    return e;
  };

  // ===== estado do painel =====
  let panel = null;
  let selectedPlotId = null;
  let autoTimer = null; // loop de auto-harvest
  let lastFarmState = null;

  // ===== abrir painel =====
  async function openFarm(){
    if (!panel) {
      panel = el('div', { id:'farmPanel' }, [
        el('div', { class:'farm-card' }, [
          el('div', { class:'farm-header' }, [
            el('div', { class:'farm-title' }, [
              el('h3', {}, 'Farm'),
              el('small', { id:'farmLast' , style:'margin-left:8px; opacity:.6' }, '')
            ]),
            el('div', { class:'farm-actions' }, [
              el('button', { id:'farmRefresh', class:'farm-btn' }, 'Refresh'),
              el('button', { id:'farmAdd',     class:'farm-btn' }, '+ Plot'),
              el('button', { id:'farmPlant',   class:'farm-btn' }, 'Plant Wheat'),
              el('button', { id:'farmHarvest', class:'farm-btn' }, 'Harvest'),
              el('button', { id:'farmAuto',    class:'farm-btn' }, 'Auto-Harvest'),
              el('button', { id:'farmClose',   class:'farm-btn' }, 'Fechar')
            ])
          ]),
          el('div', { class:'farm-grid' }, [
            // Coluna: Plots (lista clicável)
            el('div', { class:'farm-col' }, [
              el('h4', {}, 'Plots'),
              el('div', { class:'farm-list-wrap' }, [
                el('table', { class:'farm-table' }, [
                  el('thead', {}, el('tr',{},[
                    el('th',{},'#'),
                    el('th',{},'Crop'),
                    el('th',{},'Stage'),
                    el('th',{},'Ripe'),
                    el('th',{},'Next')
                  ])),
                  el('tbody',{ id:'farmTbody' })
                ])
              ])
            ]),
            // Coluna: Detalhes / Estado
            el('div', { class:'farm-col' }, [
              el('h4', {}, 'Detalhes'),
              el('pre', { id:'farmInfo', class:'farm-pre' }, '{}')
            ]),
            // Coluna: Inventário (seeds e produtos)
            el('div', { class:'farm-col' }, [
              el('h4', {}, 'Inventory (AFK)'),
              el('pre', { id:'farmInv', class:'farm-pre' }, '[]')
            ])
          ])
        ]),
        el('style', {}, `
#farmPanel{position:fixed; right:12px; bottom:12px; z-index:9999; max-width:980px; font-family:Inter, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, 'Helvetica Neue', Arial;}
.farm-card{background:#101214;color:#e6eef6;border:1px solid rgba(255,255,255,.08);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.45);overflow:hidden}
.farm-header{display:flex;align-items:center;justify-content:space-between;background:#0b0f14;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.06)}
.farm-title{display:flex;align-items:center;gap:4px}
.farm-header h3{margin:0;font-size:14px;letter-spacing:.4px}
.farm-actions{display:flex;gap:8px}
.farm-btn{background:#1b2533;color:#d9e4f2;border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:6px 10px;cursor:pointer}
.farm-btn:hover{background:#223046}
.farm-btn:disabled{opacity:.5; cursor:not-allowed}
.farm-grid{display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px;padding:10px}
.farm-col h4{margin:0 0 6px 0;font-size:12px;color:#aab8c5}
.farm-pre{margin:0;background:#0b0f14;border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:8px;max-height:240px;overflow:auto;font-size:12px}
.farm-list-wrap{border:1px solid rgba(255,255,255,.06);border-radius:8px;overflow:auto;max-height:240px;background:#0b0f14}
.farm-table{width:100%;border-collapse:collapse;font-size:12px}
.farm-table thead th{position:sticky; top:0; background:#0f1622; text-align:left; padding:6px; border-bottom:1px solid rgba(255,255,255,.06); font-weight:600}
.farm-table tbody td{padding:6px;border-bottom:1px solid rgba(255,255,255,.04)}
.farm-row{cursor:pointer}
.farm-row:hover{background:#0f1a27}
.farm-row.selected{background:#0e2236}
        `)
      ]);
      document.body.appendChild(panel);

      // wire events
      panel.querySelector('#farmClose').addEventListener('click', ()=>{ stopAuto(); panel.remove(); panel=null; });
      panel.querySelector('#farmRefresh').addEventListener('click', renderAll);
      panel.querySelector('#farmAdd').addEventListener('click', onAddPlot);
      panel.querySelector('#farmPlant').addEventListener('click', ()=>onPlant('wheat'));
      panel.querySelector('#farmHarvest').addEventListener('click', onHarvest);
      panel.querySelector('#farmAuto').addEventListener('click', toggleAuto);
    }
    await renderAll();
  }

  // ===== ações =====
  async function renderAll(){
    try{
      const state = await jget('/api/farm/state');
      const inv   = await jget('/api/afk/state');
      lastFarmState = state;
      renderPlots(state);
      renderInfo(state);
      renderInv(inv);
      const stamp = new Date().toLocaleTimeString();
      panel.querySelector('#farmLast').textContent = `Last: ${stamp}`;
      updateButtons();
    }catch(e){
      alert('Farm refresh error: ' + e.message);
    }
  }

  function renderPlots(state){
    const tbody = panel.querySelector('#farmTbody');
    tbody.innerHTML = '';
    const plots = state.plots || [];
    plots.forEach((p, idx)=>{
      const tr = el('tr', { class:'farm-row' });
      const left = secLeft(p.next_at);
      tr.innerHTML = `
        <td>${idx+1}</td>
        <td>${p.crop_key || '-'}</td>
        <td>${p.stage ?? '-'}</td>
        <td>${p.ripe ? '✔' : '—'}</td>
        <td>${p.ripe ? '—' : (left!=null ? `${left}s` : '—')}</td>
      `;
      tr.addEventListener('click', ()=>{
        selectedPlotId = p.id;
        [...tbody.querySelectorAll('tr')].forEach(r=>r.classList.remove('selected'));
        tr.classList.add('selected');
        renderInfo({ plots:[p] }, true);
        updateButtons();
      });
      if (p.id === selectedPlotId) tr.classList.add('selected');
      tbody.appendChild(tr);
    });
    updateButtons();
  }

  function renderInfo(state, single=false){
    const info = panel.querySelector('#farmInfo');
    if (single) {
      info.textContent = pretty(state.plots[0] || {});
      return;
    }
    info.textContent = pretty({
      count: (state.plots||[]).length,
      plots: (state.plots||[]).map(p=>({ id:p.id, crop:p.crop_key, stage:p.stage, ripe:p.ripe, next_at:p.next_at }))
    });
    updateButtons();
  }

  function renderInv(afkState){
    const inv = panel.querySelector('#farmInv');
    const inventory = afkState.inventory || [];
    const subset = inventory.filter(x => /seed_|grain|carrot|wheat/i.test(x.item_type));
    inv.textContent = pretty(subset.length ? subset : inventory);
  }

  function updateButtons(){
    const btnPlant   = panel.querySelector('#farmPlant');
    const btnHarvest = panel.querySelector('#farmHarvest');
    const btnAuto    = panel.querySelector('#farmAuto');

    let canPlant = false, canHarvest = false;

    if (selectedPlotId && lastFarmState){
      const p = (lastFarmState.plots || []).find(x => x.id === selectedPlotId);
      if (p){
        canPlant   = !p.crop_key || p.stage === 0;
        canHarvest = !!p.ripe;

        const last = panel.querySelector('#farmLast');
        const left = secLeft(p.next_at);
        if (!p.ripe && left!=null) last.textContent = `Next in: ${left}s`;
      }
    }

    btnPlant.disabled   = !canPlant;
    btnHarvest.disabled = !canHarvest;
    if (!autoTimer) btnAuto.textContent = 'Auto-Harvest';
  }

  async function onAddPlot(){
    try{
      const r = await jpost('/api/farm/plot/create', { x:0, y:0 });
      selectedPlotId = r.id;
      await renderAll();
      alert('Plot criado: ' + r.id);
    }catch(e){
      alert('Erro ao criar plot: ' + e.message);
    }
  }

  async function onPlant(cropKey){
    if (!selectedPlotId) return alert('Selecione um plot primeiro.');
    const p = (lastFarmState?.plots||[]).find(x=>x.id===selectedPlotId);
    if (!p) return alert('Plot não encontrado.');
    if (p.crop_key && p.stage > 0) return alert('Este plot já está plantado. Aguarde a colheita.');

    try{
      const r = await jpost('/api/farm/plant', { plot_id: selectedPlotId, crop_key: cropKey });
      await renderAll();
      alert(`Plantado ${cropKey} no plot ${selectedPlotId}`);
    }catch(e){
      const msg = e.message || '';
      if (msg.includes('no_seed')) return alert('Sem sementes suficientes (seed_'+cropKey+').');
      alert('Erro ao plantar: ' + msg);
    }
  }

  async function onHarvest(){
    if (!selectedPlotId) return alert('Selecione um plot primeiro.');
    const p = (lastFarmState?.plots||[]).find(x=>x.id===selectedPlotId);
    if (!p) return alert('Plot não encontrado.');
    if (!p.ripe) return alert('Ainda não está maduro. Veja o tempo restante na coluna "Next".');

    try{
      const r = await jpost('/api/farm/harvest', { plot_id: selectedPlotId });
      await renderAll();
      alert('Colhido: ' + pretty(r));
    }catch(e){
      alert('Erro ao colher: ' + e.message);
    }
  }

  // ===== Auto-Harvest (loop) =====
  function stopAuto(){
    if (autoTimer) { clearInterval(autoTimer); autoTimer=null; }
    const btn = panel?.querySelector('#farmAuto');
    if (btn) btn.textContent = 'Auto-Harvest';
  }

  function toggleAuto(){
    const btn = panel.querySelector('#farmAuto');
    if (autoTimer) { stopAuto(); return; }
    if (!selectedPlotId) { alert('Selecione um plot primeiro.'); return; }

    btn.textContent = 'Auto-Harvest (ON)';
    autoTimer = setInterval(async ()=>{
      try{
        const s = await jget('/api/farm/state');
        lastFarmState = s;
        const p = (s.plots||[]).find(x=>x.id===selectedPlotId);
        if (!p) return;

        if (p.ripe) {
          await jpost('/api/farm/harvest', { plot_id: selectedPlotId });
          await renderAll();
        } else {
          const last = panel.querySelector('#farmLast');
          const left = secLeft(p.next_at);
          if (left!=null) last.textContent = `Next in: ${left}s`;
          updateButtons();
        }
      }catch(e){
        console.warn('[farm auto]', e.message);
      }
    }, 1000); // 1s para um countdown suave
  }

  // ===== botão na topbar =====
  function attachButton(){
    const btn = document.getElementById('btnFarm');
    if (btn) btn.addEventListener('click', openFarm);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachButton);
  } else {
    attachButton();
  }
})();
