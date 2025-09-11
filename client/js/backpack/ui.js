// client/js/backpack/ui.js
import { apiGet } from '../api.js';

(function () {
  // Container onde a Backpack é renderizada (no seu app.html)
  const ROOT_SEL = '#app-inventory';

  // Estado e cache
  let OPEN = false;
  let LAST_SNAPSHOT = null; // snapshot mais recente do backend (ex.: após pickup)
  let LAST_HERO_ID = null;

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

  function findPanel() {
    return document.querySelector(ROOT_SEL);
  }

  // Esconde o rótulo estático “Backpack” que fica imediatamente acima de #app-inventory
  function hideOuterLabelIfPresent() {
    try {
      const panel = findPanel();
      const label = panel?.previousElementSibling;
      if (!label) return;
      const txt = String(label.textContent || '').trim().toLowerCase();
      if (txt === 'backpack') label.style.display = 'none';
    } catch {}
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function iconFor(itemKey, itemsIndex) {
    const d = itemsIndex?.[itemKey] || {};
    return d.icon || null;
  }

  function displayNameForBackpack(payload, itemsIndex) {
    const key = payload?.backpackKey || null;
    const meta = key ? (itemsIndex?.[key] || null) : null;
    return meta?.name || meta?.title || (key ? key.replace(/_/g, ' ') : 'Backpack');
  }

  function renderGrid(container, payload, itemsIndex) {
    const capacity = Number(payload?.capacity || 0) || 0;
    const items = Array.isArray(payload?.items) ? payload.items : [];
    if (!container) return;

    const cols = 5;

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
        width: '40px',
        height: '40px',
        border: '1px solid #444',
        background: '#1f2937',
        borderRadius: '6px',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden'
      });

      if (it?.itemKey && it?.qty > 0) {
        const ic = iconFor(it.itemKey, itemsIndex || {});
        if (ic) {
          const img = document.createElement('img');
          img.src = ic;
          img.alt = it.itemKey;
          Object.assign(img.style, {
            maxWidth: '100%',
            maxHeight: '100%',
            imageRendering: 'pixelated'
          });
          slot.appendChild(img);
        } else {
          const tag = document.createElement('div');
          tag.textContent = it.itemKey;
          Object.assign(tag.style, {
            fontSize: '9px',
            color: '#e5e7eb',
            textAlign: 'center',
            padding: '2px'
          });
          slot.appendChild(tag);
        }

        const qty = document.createElement('div');
        qty.textContent = '×' + it.qty;
        Object.assign(qty.style, {
          position: 'absolute',
          right: '2px',
          bottom: '2px',
          fontSize: '10px',
          color: '#e5e7eb',
          textShadow: '0 1px 2px #000'
        });
        slot.title = `${it.itemKey} x${it.qty}`;
        slot.appendChild(qty);
      }

      grid.appendChild(slot);
    }

    const used = (typeof payload?.used === 'number')
      ? payload.used
      : items.filter(x => x && x.itemKey && x.qty > 0).length;

    const title = displayNameForBackpack(payload, itemsIndex || {});
    const head = document.createElement('div');
    head.style.display = 'flex';
    head.style.alignItems = 'center';
    head.style.justifyContent = 'space-between';
    head.style.padding = '6px 8px';
    head.innerHTML = `<strong>${escapeHtml(title)}</strong><small>${used}/${capacity}</small>`;

    container.innerHTML = '';
    container.appendChild(head);
    container.appendChild(grid);
  }

  // Render só quando estiver ABERTO (evita reabrir sem querer)
  async function render(heroId) {
    try {
      if (!heroId) return;
      LAST_HERO_ID = heroId;

      if (!OPEN) return; // fechado: não desenha

      const panel = findPanel();
      if (!panel) {
        console.warn('[BackpackUI] painel não encontrado (#app-inventory).');
        return;
      }

      hideOuterLabelIfPresent();
      panel.innerHTML = '<div style="padding:8px">Loading…</div>';

      const [data, itemsIndex] = await Promise.all([
        apiGet(`/api/backpack/${heroId}/slots`),
        getItemsIndex()
      ]);

      if (Number(data.capacity || 0) <= 0) {
        panel.innerHTML = `<div style="padding:8px">Sem backpack equipada.</div>`;
        LAST_SNAPSHOT = data;
        return;
      }

      LAST_SNAPSHOT = data;
      renderGrid(panel, data, itemsIndex);
    } catch (e) {
      console.warn('[BackpackUI] render error:', e?.message || e);
    }
  }

  // Evento de atualização instantânea (ex.: após loot pickup)
  window.addEventListener('backpack:update', async (ev) => {
    try {
      const snapshot = ev?.detail?.snapshot || null;
      const heroId = ev?.detail?.heroId || null;
      if (heroId) LAST_HERO_ID = heroId;
      if (snapshot) LAST_SNAPSHOT = snapshot;

      if (!OPEN) return;

      const panel = findPanel();
      if (!panel || !snapshot) return;

      hideOuterLabelIfPresent();
      const itemsIndex = ITEMS_CACHE || await getItemsIndex();
      renderGrid(panel, snapshot, itemsIndex);
    } catch (e) {
      console.warn('[BackpackUI] instant update error:', e?.message || e);
    }
  });

  // Compat: após loot, se estiver aberta, recarrega do servidor (se necessário)
  window.addEventListener('loot:picked', () => {
    if (!OPEN) return;
    const hid =
      window.ActiveHeroId ||
      (window.Team && typeof window.Team.getActiveHeroId === 'function' && window.Team.getActiveHeroId()) ||
      (window.GameScene && window.GameScene.activeHeroId) ||
      (window.Player && window.Player.activeHeroId) ||
      LAST_HERO_ID ||
      null;
    if (hid) render(hid);
  });

  // IMPORTANTE: open() age como TOGGLE.
  // O script existente em app.html (que chama BackpackUI.open(heroId) no clique direito)
  // passa a alternar abrir/fechar.
  function open(heroId) {
    const panel = findPanel();
    if (!panel) {
      console.warn('[BackpackUI] painel não encontrado (#app-inventory).');
      return;
    }

    // Se já está aberta, este "open" fecha (toggle-on-open)
    if (OPEN) {
      close();
      return;
    }

    OPEN = true;

    const hid = heroId ||
      window.ActiveHeroId ||
      (window.Team && typeof window.Team.getActiveHeroId === 'function' && window.Team.getActiveHeroId()) ||
      (window.GameScene && window.GameScene.activeHeroId) ||
      (window.Player && window.Player.activeHeroId) ||
      LAST_HERO_ID ||
      null;

    if (!hid) {
      // Se não tem herói, apenas limpa e marca como fechada
      OPEN = false;
      panel.innerHTML = '';
      return;
    }
    LAST_HERO_ID = hid;

    hideOuterLabelIfPresent();

    if (LAST_SNAPSHOT && Number(LAST_SNAPSHOT.capacity || 0) > 0) {
      // Render imediato com snapshot; ícones paralelos
      renderGrid(panel, LAST_SNAPSHOT, ITEMS_CACHE || {});
      if (!ITEMS_CACHE) {
        getItemsIndex().then((idx) => {
          if (OPEN && findPanel() && LAST_SNAPSHOT) renderGrid(findPanel(), LAST_SNAPSHOT, idx || {});
        }).catch(() => {});
      }
    } else {
      render(hid);
    }
  }

  function close() {
    if (!OPEN) return;
    OPEN = false;
    const panel = findPanel();
    if (panel) panel.innerHTML = '';
  }

  function toggle(heroId) {
    if (OPEN) close();
    else open(heroId);
  }

  // Compat: função usada por outras telas — aqui é NO-OP seguro
  function bindContextOpen() {
    // Intencionalmente vazio: evitamos múltiplos binders e deixamos
    // o script existente do app.html cuidar do clique direito.
  }

  // Expor API pública
  window.BackpackUI = { render, open, close, toggle, bindContextOpen };
})();