// client/js/dock.js
// Dock UI mínimo: criar painéis flutuantes/dockados, arrastar, redimensionar e lembrar estado
const Dock = (() => {
  const shell = document.getElementById('clientShell');
  const dockBar = document.getElementById('dockArea');
  if (!shell || !dockBar) {
    console.warn('[dock] clientShell/dockArea não encontrados.');
  }

  const PANELS = new Map(); // id -> state

  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
  function rect(el){ return el.getBoundingClientRect(); }

  function loadState(id){
    try { return JSON.parse(localStorage.getItem('dock:'+id)) || null; } catch { return null; }
  }
  function saveState(id, st){
    try { localStorage.setItem('dock:'+id, JSON.stringify(st)); } catch {}
  }

  function bringToFront(panel){
    let maxZ = 41;
    for (const p of document.querySelectorAll('.dock-panel')) {
      const z = parseInt(getComputedStyle(p).zIndex || '41', 10);
      maxZ = Math.max(maxZ, z);
    }
    panel.style.zIndex = String(maxZ + 1);
  }

  function snapInside(panel){
    const sh = rect(shell);
    const pb = rect(panel);
    const dx = clamp(pb.left, sh.left, sh.right - pb.width) - pb.left;
    const dy = clamp(pb.top,  sh.top,  sh.bottom - pb.height) - pb.top;
    panel.style.left = (panel.offsetLeft + dx) + 'px';
    panel.style.top  = (panel.offsetTop  + dy) + 'px';
  }

  function makeDraggable(panel, head, id){
    let sx=0, sy=0, px=0, py=0, dragging=false;

    head.addEventListener('pointerdown', (e)=>{
      if (panel.classList.contains('docked')) return;
      dragging = true;
      bringToFront(panel);
      sx = e.clientX; sy = e.clientY;
      px = panel.offsetLeft; py = panel.offsetTop;
      head.setPointerCapture(e.pointerId);
    });

    head.addEventListener('pointermove', (e)=>{
      if (!dragging) return;
      const nx = px + (e.clientX - sx);
      const ny = py + (e.clientY - sy);
      panel.style.left = nx + 'px';
      panel.style.top  = ny + 'px';
      snapInside(panel);
    });

    head.addEventListener('pointerup', (e)=>{
      if (!dragging) return;
      dragging = false;
      head.releasePointerCapture(e.pointerId);
      const st = PANELS.get(id); if (!st) return;
      st.left = panel.style.left; st.top = panel.style.top;
      saveState(id, st);
    });
  }

  function makeResizable(panel, id){
    // canto
    const rez = panel.querySelector('.dock-resize');
    let rw=false, rh=false, cx=0, cy=0, sw=0, sh=0;
    function start(e, what){
      e.preventDefault();
      bringToFront(panel);
      cx = e.clientX; cy = e.clientY;
      sw = panel.offsetWidth; sh = panel.offsetHeight;
      rw = what.includes('w'); rh = what.includes('h');
      window.addEventListener('pointermove', mm);
      window.addEventListener('pointerup', mu, { once:true });
    }
    function mm(e){
      let nw = sw, nh = sh;
      if (rw) nw = Math.max(260, sw + (e.clientX - cx));
      if (rh) nh = Math.max(160, sh + (e.clientY - cy));
      panel.style.width  = nw + 'px';
      panel.style.height = nh + 'px';
      snapInside(panel);
    }
    function mu(){
      window.removeEventListener('pointermove', mm);
      const st = PANELS.get(id); if (!st) return;
      st.width = panel.style.width; st.height = panel.style.height;
      saveState(id, st);
    }
    rez?.addEventListener('pointerdown', (e)=> start(e,'wh'));

    // bordas
    const eEdge = panel.querySelector('.dock-edge.e');
    const sEdge = panel.querySelector('.dock-edge.s');
    eEdge?.addEventListener('pointerdown', (e)=> start(e,'w'));
    sEdge?.addEventListener('pointerdown', (e)=> start(e,'h'));
  }

  function dockUndock(panel, id){
    const st = PANELS.get(id); if (!st) return;

    if (panel.classList.contains('docked')) {
      // virar flutuante
      panel.classList.remove('docked');
      shell.appendChild(panel);
      panel.style.position = 'absolute';
      panel.style.left = st.left ?? '24px';
      panel.style.top  = st.top  ?? '24px';
      panel.style.width  = st.width  ?? '420px';
      panel.style.height = st.height ?? '280px';
    } else {
      // acoplar na barra
      panel.classList.add('docked');
      dockBar.appendChild(panel);
      panel.style.removeProperty('left');
      panel.style.removeProperty('top');
      panel.style.removeProperty('width');
      panel.style.removeProperty('height');
    }
    saveState(id, { ...st, docked: panel.classList.contains('docked') });
  }

  function ensureShellBounds(panel){
    const sh = rect(shell);
    const pb = rect(panel);
    if (pb.width > sh.width - 20) panel.style.width = Math.max(260, sh.width - 20) + 'px';
    if (pb.height > sh.height - 20) panel.style.height = Math.max(160, sh.height - 20) + 'px';
    snapInside(panel);
  }

  function createPanel({ id, title, content, preferDock=false }) {
    if (!shell || !dockBar) return null;
    if (PANELS.has(id)) { bringToFront(PANELS.get(id).el); return PANELS.get(id).el; }

    const el = document.createElement('div');
    el.className = 'dock-panel';
    el.innerHTML = `
      <div class="dock-head">
        <div class="dock-title">${title}</div>
        <div class="dock-actions">
          <button class="dock-btn" data-act="dock">Dock</button>
          <button class="dock-btn" data-act="close">Close</button>
        </div>
      </div>
      <div class="dock-body"></div>
      <div class="dock-edge e"></div>
      <div class="dock-edge s"></div>
      <div class="dock-resize"></div>
    `;
    const head  = el.querySelector('.dock-head');
    const body  = el.querySelector('.dock-body');

    // conteúdo
    if (typeof content === 'function') content(body);
    else if (content instanceof HTMLElement) body.appendChild(content);
    else if (content) body.innerHTML = content;

    // estado inicial
    const saved = loadState(id) || {};
    const state = { el, ...saved };
    PANELS.set(id, state);

    document.getElementById('clientShell').appendChild(el);
    el.style.left   = saved.left   ?? '24px';
    el.style.top    = saved.top    ?? '24px';
    el.style.width  = saved.width  ?? '420px';
    el.style.height = saved.height ?? '280px';

    makeDraggable(el, head, id);
    makeResizable(el, id);
    ensureShellBounds(el);
    bringToFront(el);

    // ações
    el.querySelector('[data-act="dock"]')?.addEventListener('click', ()=> dockUndock(el, id));
    el.querySelector('[data-act="close"]')?.addEventListener('click', ()=>{
      el.remove(); PANELS.delete(id); localStorage.removeItem('dock:'+id);
    });

    // aplicar estado dock salvo / preferDock
    const wantDock = saved.docked ?? preferDock ?? false;
    if (wantDock) {
      el.classList.add('docked');
      dockBar.appendChild(el);
    }

    // re-snap ao redimensionar janela
    window.addEventListener('resize', ()=> ensureShellBounds(el));

    return el;
  }

  return { createPanel };
})();
export default Dock;
