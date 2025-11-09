// client/js/ui/corpse-window.js
import { apiPost, apiGet } from '../api.js';

(function () {
  const state = {
    open: false,
    corpse: null,
    itemsIndex: null,
    loadingDnD: false,
  };

  const ROOT_ID = 'corpseWindow';

  function heroIdFromState() {
    return (
      window.ActiveHeroId ||
      (window.Team && typeof window.Team.getActiveHeroId === 'function' && window.Team.getActiveHeroId()) ||
      (window.GameScene && window.GameScene.activeHeroId) ||
      (window.Player && window.Player.activeHeroId) ||
      null
    );
  }

  function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = ROOT_ID;
      root.style.position = 'absolute';
      root.style.top = '120px';
      root.style.right = '24px';
      root.style.width = '240px';
      root.style.maxHeight = '320px';
      root.style.padding = '8px';
      root.style.background = 'rgba(17, 24, 39, 0.95)';
      root.style.border = '1px solid #4b5563';
      root.style.borderRadius = '8px';
      root.style.boxShadow = '0 4px 12px rgba(0,0,0,0.45)';
      root.style.color = '#e5e7eb';
      root.style.font = '12px/16px "Press Start 2P", monospace';
      root.style.zIndex = '50';
      root.style.display = 'none';
      root.style.pointerEvents = 'auto';
      const host = document.getElementById('clientShell') || document.body;
      host.appendChild(root);
    }
    return root;
  }

  async function ensureItemsIndex() {
    if (state.itemsIndex) return state.itemsIndex;
    try {
      const rows = await apiGet('/api/assets/items');
      const idx = {};
      for (const r of rows || []) idx[r.key] = r.data || {};
      state.itemsIndex = idx;
    } catch {
      state.itemsIndex = {};
    }
    return state.itemsIndex;
  }

  function iconFor(itemKey) {
    const meta = (state.itemsIndex || {})[itemKey] || {};
    return meta.icon || meta.sprite || null;
  }

  function nameFor(itemKey) {
    const meta = (state.itemsIndex || {})[itemKey] || {};
    return meta.name || meta.title || itemKey;
  }

  function ensureDnDLoaded(cb) {
    if (window.ItemDnD && window.ItemDnD.__ready) {
      try { cb && cb(); } catch {}
      return;
    }
    if (state.loadingDnD) {
      const once = () => { try { cb && cb(); } catch {}; };
      document.addEventListener('itemdnd:ready', once, { once: true });
      return;
    }
    state.loadingDnD = true;
    const s = document.createElement('script');
    s.src = '/js/dnd/items-dnd.js';
    s.async = true;
    s.onload = () => {
      state.loadingDnD = false;
      try { document.dispatchEvent(new Event('itemdnd:ready')); } catch {}
      try { cb && cb(); } catch {}
    };
    s.onerror = () => { state.loadingDnD = false; };
    document.head.appendChild(s);
  }

  function renderCorpse() {
    const root = ensureRoot();
    root.innerHTML = '';
    if (!state.corpse) {
      root.style.display = 'none';
      return;
    }

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';
    header.style.marginBottom = '8px';

    const title = document.createElement('div');
    title.textContent = (state.corpse.monsterName || 'Corpse').toUpperCase();
    title.style.fontSize = '11px';
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.background = '#111827';
    closeBtn.style.color = '#e5e7eb';
    closeBtn.style.border = '1px solid #4b5563';
    closeBtn.style.width = '22px';
    closeBtn.style.height = '22px';
    closeBtn.style.borderRadius = '4px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.addEventListener('click', close);
    header.appendChild(closeBtn);
    root.appendChild(header);

    const content = document.createElement('div');
    content.style.maxHeight = '240px';
    content.style.overflowY = 'auto';
    content.style.padding = '4px 0';

    const items = Array.isArray(state.corpse.items) ? state.corpse.items : [];
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.style.padding = '16px 8px';
      empty.style.textAlign = 'center';
      empty.style.fontSize = '11px';
      empty.style.color = '#9ca3af';
      empty.textContent = state.corpse.isEmpty ? 'This corpse is empty.' : 'No visible items.';
      content.appendChild(empty);
    } else {
      const grid = document.createElement('div');
      grid.style.display = 'grid';
      grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(48px, 1fr))';
      grid.style.gap = '6px';
      grid.style.padding = '4px';

      for (const item of items) {
        const slot = document.createElement('div');
        slot.className = 'corpse-slot';
        slot.style.width = '48px';
        slot.style.height = '48px';
        slot.style.border = '1px solid #4b5563';
        slot.style.background = '#1f2937';
        slot.style.borderRadius = '6px';
        slot.style.position = 'relative';
        slot.style.display = 'flex';
        slot.style.alignItems = 'center';
        slot.style.justifyContent = 'center';
        slot.style.cursor = 'grab';
        slot.draggable = true;
        slot.dataset.corpseId = state.corpse.id;
        slot.dataset.corpseItemId = item.id;
        slot.dataset.itemKey = item.itemKey || item.key;
        slot.dataset.qty = String(item.amount || item.qty || 0);

        const icon = iconFor(item.itemKey || item.key);
        if (icon) {
          const img = document.createElement('img');
          img.src = icon;
          img.alt = item.itemKey || item.key;
          img.style.maxWidth = '100%';
          img.style.maxHeight = '100%';
          img.style.imageRendering = 'pixelated';
          slot.appendChild(img);
        } else {
          const label = document.createElement('div');
          label.textContent = (item.itemKey || item.key || '').slice(0, 6);
          label.style.fontSize = '9px';
          label.style.textAlign = 'center';
          slot.appendChild(label);
        }

        const qty = document.createElement('div');
        qty.textContent = '×' + (item.amount || item.qty || 1);
        qty.style.position = 'absolute';
        qty.style.right = '3px';
        qty.style.bottom = '3px';
        qty.style.fontSize = '10px';
        qty.style.color = '#e5e7eb';
        qty.style.textShadow = '0 1px 2px #000';
        slot.appendChild(qty);

        slot.title = `${nameFor(item.itemKey || item.key)} ×${item.amount || item.qty || 1}`;

        grid.appendChild(slot);
      }

      content.appendChild(grid);
      ensureDnDLoaded(() => {
        try { window.ItemDnD?.wireCorpse(content); } catch {}
      });
    }

    root.appendChild(content);
    root.style.display = 'block';
    state.open = true;
  }

  async function fetchCorpse(corpseId, { heroId, silent = false } = {}) {
    const hid = heroId || heroIdFromState();
    if (!hid) {
      if (!silent) alert('No active hero available.');
      return null;
    }
    const res = await apiPost('/api/loot/corpse/open', { corpseId, heroId: hid });
    if (res?.corpse) {
      state.corpse = Object.assign({}, res.corpse, { heroId: hid });
      await ensureItemsIndex();
      renderCorpse();
    }
    return res?.corpse || null;
  }

  async function open(corpseId) {
    try {
      const corpse = await fetchCorpse(corpseId);
      if (!corpse) return;
    } catch (e) {
      const msg = String(e?.message || '');
      // fecha e informa o motivo mais comum
      if (msg.includes('request-failed 409')) {
        try { close(); } catch {}
        try { window.toast?.warn?.('Muito longe do corpo. Aproxime-se mais.'); } catch {}
        return;
      }
      if (msg.includes('request-failed 410') || msg.includes('corpse-expired')) {
        try { close(); } catch {}
        try { window.toast?.info?.('O corpo apodreceu e desapareceu.'); } catch {}
        return;
      }
      console.warn('[corpse-window] open failed:', msg);
    }
  }


  function close() {
    state.open = false;
    state.corpse = null;
    const root = ensureRoot();
    root.style.display = 'none';
    root.innerHTML = '';
  }

  function handleCorpseRefresh(ev) {
    const corpse = ev?.detail || null;
    if (!corpse || !state.corpse || String(corpse.id) !== String(state.corpse.id)) return;
    state.corpse = Object.assign({}, state.corpse, corpse);
    renderCorpse();
  }

  async function handleCorpseUpdated(ev) {
    const corpse = ev?.detail || null;
    if (!corpse || !state.corpse || String(corpse.id) !== String(state.corpse.id)) return;
    if (corpse.isEmpty === true) {
      state.corpse.isEmpty = true;
      state.corpse.items = [];
      renderCorpse();
    } else {
      try { await fetchCorpse(corpse.id, { heroId: state.corpse.heroId, silent: true }); } catch {}
    }
  }

  function handleCorpseRemoved(ev) {
    const id = ev?.detail?.id || ev?.detail || null;
    if (!id || !state.corpse || String(id) !== String(state.corpse.id)) return;
    close();
  }

  window.addEventListener('corpse:refresh', handleCorpseRefresh);
  window.addEventListener('corpse:updated', handleCorpseUpdated);
  window.addEventListener('corpse:removed', handleCorpseRemoved);

  window.CorpseWindow = { open, close };
})();
