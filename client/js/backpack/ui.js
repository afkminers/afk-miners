// client/js/backpack/ui.js
import { apiGet } from '../api.js';

(function () {
  // Onde desenhar a mochila (coloque um desses IDs no seu HTML)
  const ROOT_SEL = '#app-inventory, #inventory-panel, #invPanel';
  // Slot de mochila no grid de equips (seletor do SEU HTML): usamos 'back' (minúsculo)
  const BP_SLOT_SEL = '[data-slot="back"], #equip-slot-back, .equip-slot[data-slot="back"], .slot[data-eq-slot="BACK"]';

  // cache de itens para resolver ícones/nomes
  let ITEMS_CACHE = null;
  async function getItemsIndex() {
    if (ITEMS_CACHE) return ITEMS_CACHE;
    try {
      const rows = await apiGet('/api/assets/items'); // [{key,data}]
      const idx = {};
      for (const r of rows || []) idx[r.key] = r.data || {};
      ITEMS_CACHE = idx;
      return idx;
    } catch {
      ITEMS_CACHE = {};
      return ITEMS_CACHE;
    }
  }

  function findPanel() { return document.querySelector(ROOT_SEL); }

  function iconFor(itemKey, itemsIndex) {
    const d = itemsIndex?.[itemKey] || {};
    // Se no YAML você definir "icon: /sprites/items/backpack_brown.png", usamos aqui:
    return d.icon || null;
  }

  function renderGrid(container, payload, itemsIndex) {
    const { capacity, items } = payload;
    if (!container) return;

    const cols = 5;
    const rows = Math.max(1, Math.ceil(Math.max(1, capacity) / cols));

    const grid = document.createElement('div');
    grid.className = 'bp-grid';
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = `repeat(${cols}, 40px)`;
    grid.style.gap = '6px';
    grid.style.padding = '8px';

    for (let i = 0; i < capacity; i++) {
      const it = items[i];
      const slot = document.createElement('div');
      slot.className = 'bp-slot';
      Object.assign(slot.style, {
        width:'40px', height:'40px', border:'1px solid #444',
        background:'#1f2937', borderRadius:'6px', position:'relative',
        display:'flex', alignItems:'center', justifyContent:'center',
        overflow:'hidden'
      });

      if (it?.itemKey && it?.qty > 0) {
        const ic = iconFor(it.itemKey, itemsIndex);

        if (ic) {
          const img = document.createElement('img');
          img.src = ic;
          img.alt = it.itemKey;
          Object.assign(img.style, {
            maxWidth:'100%', maxHeight:'100%', imageRendering:'pixelated'
          });
          slot.appendChild(img);
        } else {
          // fallback texto
          const tag = document.createElement('div');
          tag.textContent = it.itemKey;
          Object.assign(tag.style, { fontSize:'9px', color:'#e5e7eb', textAlign:'center', padding:'2px' });
          slot.appendChild(tag);
        }

        // quantidade
        const qty = document.createElement('div');
        qty.textContent = '×' + it.qty;
        Object.assign(qty.style, {
          position:'absolute', right:'2px', bottom:'2px',
          fontSize:'10px', color:'#e5e7eb', textShadow:'0 1px 2px #000'
        });
        slot.title = `${it.itemKey} x${it.qty}`;
        slot.appendChild(qty);
      }

      grid.appendChild(slot);
    }

    container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;">
        <strong>Backpack</strong>
        <small>${payload.used}/${payload.capacity}</small>
      </div>`;
    container.appendChild(grid);
  }

  async function render(heroId) {
    try {
      if (!heroId) return;
      const [data, itemsIndex] = await Promise.all([
        apiGet(`/api/backpack/${heroId}/slots`),
        getItemsIndex()
      ]);

      const panel = findPanel();
      if (panel) panel.innerHTML = '<div style="padding:8px">Loading…</div>';
      else {
        console.warn('[BackpackUI] painel não encontrado (ROOT_SEL).');
        return;
      }
      if (Number(data.capacity || 0) <= 0) {
        panel.innerHTML = `<div style="padding:8px">Sem backpack equipada.</div>`;
        return;
      }
      renderGrid(panel, data, itemsIndex);
    } catch (e) {
      console.warn('[BackpackUI] render error:', e?.message);
    }
  }

  // Clique direito no slot "back" abre a mochila
  function bindContextOpen(getHeroId) {
    const el = document.querySelector(BP_SLOT_SEL);
    if (!el) return;
    el.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      const hid = typeof getHeroId === 'function' ? getHeroId() : (window.ActiveHeroId || null);
      if (!hid) return;
      render(hid);
    });
  }
  function open(heroId, opts){ return render(heroId); }
  window.BackpackUI = { render, bindContextOpen, open };
})();
