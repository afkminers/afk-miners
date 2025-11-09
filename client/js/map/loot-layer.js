// client/js/map/loot-layer.js
// Renderiza loots no mapa por cima do canvas (#scene), com placeholder se não houver sprite.
// Também permite clicar no loot para coletar (POST /api/loot/pickup).

(function () {
  if (window.LootLayer && window.LootLayer.__ready) return;

  // ===== helpers CSRF / fetch =====
  function getCookie(name) {
    try {
      const parts = document.cookie.split(';').map(s => s.trim());
      for (const p of parts) if (p.startsWith(name + '=')) return decodeURIComponent(p.substring(name.length + 1));
    } catch {}
    return '';
  }
  async function ensureCsrf() {
    try { await fetch('/api/auth/csrf', { credentials: 'include' }); } catch {}
    try { await fetch('/api/csrf', { credentials: 'include' }); } catch {}
  }
  async function postJSON(url, body) {
    const send = async () => {
      const token = getCookie('csrf') || '';
      const res = await fetch(url, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
        body: JSON.stringify(body || {})
      });
      return res;
    };
    let r = await send();
    if (r.status === 403) { await ensureCsrf(); r = await send(); }
    let data = {};
    try { data = await r.json(); } catch {}
    if (!r.ok) throw new Error(data?.error || ('request-failed ' + r.status));
    return data;
  }
  async function getJSON(url) {
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error('GET ' + url + ' -> ' + r.status);
    return r.json();
  }

  // ===== estado =====
  const state = {
    itemsIndex: null, // { key: { icon, name, ... } }
    loots: new Map(), // id -> { id, mapKey, tileX, tileY, itemKey, amount }
    nodes: new Map(), // id -> HTMLElement
    __ready: false
  };

  function getHeroId() {
    return (
      window.ActiveHeroId ||
      (window.Team && typeof window.Team.getActiveHeroId === 'function' && window.Team.getActiveHeroId()) ||
      (window.GameScene && window.GameScene.activeHeroId) ||
      (window.Player && window.Player.activeHeroId) ||
      null
    );
  }
  function getMapKey() {
    return (
      window.GameScene?.mapKey ||
      window.Player?.mapKey ||
      window.CurrentMapKey ||
      null
    );
  }

  // ===== items index (para achar sprite) =====
  async function ensureItemsIndex() {
    if (state.itemsIndex) return state.itemsIndex;
    try {
      const rows = await getJSON('/api/assets/items'); // [{key,data}]
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

  // ===== overlay root =====
  function getOverlayRoot() {
    const host = document.getElementById('clientShell') || document.body;
    let el = document.getElementById('lootLayer');
    if (!el) {
      el = document.createElement('div');
      el.id = 'lootLayer';
      el.style.position = 'absolute';
      el.style.inset = '0';
      el.style.pointerEvents = 'none'; // só os ícones têm pointer-events
      el.style.zIndex = '6'; // acima do canvas (hud é 9999)
      host.appendChild(el);
    }
    return el;
  }

  // ===== world->screen helpers =====
  function getCanvas() {
    return document.getElementById('scene');
  }
  function getCanvasRects() {
    const canvas = getCanvas();
    if (!canvas) return { rect: { left:0, top:0, width:1, height:1 }, cw:1, ch:1 };
    const rect = canvas.getBoundingClientRect?.() || { left:0, top:0, width:1, height:1 };
    const cw = Number(canvas.width || rect.width || 1);
    const ch = Number(canvas.height || rect.height || 1);
    return { rect, cw, ch };
  }
  function tileToCanvasPx(x, y) {
    const gs = window.GameScene || null;

    // 1) Preferir API do engine
    if (gs && typeof gs.tileToScreen === 'function') {
      const p = gs.tileToScreen(x, y) || {};
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) return { x: p.x, y: p.y };
    }

    // 2) Fallback com câmera/tileSize
    const tileSize =
      Number(gs?.tileSize) ||
      Number(gs?.TILE_SIZE) ||
      Number(window.TILE_SIZE) ||
      32;
    const camX = Number(gs?.cameraX ?? gs?.camera?.x ?? gs?.viewX ?? 0) || 0;
    const camY = Number(gs?.cameraY ?? gs?.camera?.y ?? gs?.viewY ?? 0) || 0;

    const px = x * tileSize - camX;
    const py = y * tileSize - camY;
    return { x: px, y: py };
  }
  function canvasPxToCss(px, py) {
    const { rect, cw, ch } = getCanvasRects();
    const scaleX = Math.max(0.0001, rect.width / cw);
    const scaleY = Math.max(0.0001, rect.height / ch);
    return { x: px * scaleX, y: py * scaleY };
  }
  function tileToCss(x, y) {
    const p = tileToCanvasPx(x, y);
    return canvasPxToCss(p.x, p.y);
  }

  // ===== DOM nodes =====
  function makeNode(loot) {
    const node = document.createElement('div');
    node.className = 'loot-marker';
    node.style.position = 'absolute';
    node.style.transform = 'translate(-50%, -80%)'; // âncora levemente acima do centro
    node.style.pointerEvents = 'auto';

    // decide ícone
    const icon = iconFor(loot.itemKey);
    if (icon) {
      const img = document.createElement('img');
      img.src = icon;
      img.alt = loot.itemKey || 'loot';
      img.width = 22; img.height = 22;
      img.style.imageRendering = 'pixelated';
      img.style.filter = 'drop-shadow(0 1px 1px rgba(0,0,0,.6))';
      node.appendChild(img);
    } else {
      // placeholder: moeda/bolsa
      const dot = document.createElement('div');
      dot.style.width = '18px';
      dot.style.height = '18px';
      dot.style.borderRadius = '50%';
      dot.style.background = 'linear-gradient(180deg,#fbbf24,#d97706)';
      dot.style.boxShadow = '0 1px 2px rgba(0,0,0,.45), inset 0 1px 1px rgba(255,255,255,.35)';
      node.appendChild(dot);
    }

    // badge quantidade (se for 1 item com quantidade > 1)
    const amount = Number(loot.amount || 0);
    if (amount > 1) {
      const badge = document.createElement('div');
      badge.textContent = '×' + amount;
      badge.style.position = 'absolute';
      badge.style.bottom = '-8px';
      badge.style.left = '50%';
      badge.style.transform = 'translateX(-50%)';
      badge.style.font = '10px/12px monospace';
      badge.style.color = '#fff';
      badge.style.textShadow = '0 1px 2px #000';
      node.appendChild(badge);
    }

    // tooltip simples
    node.title = `${nameFor(loot.itemKey)} ×${amount || 1}`;

    // click-to-pickup
    node.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const heroId = getHeroId();
      if (!heroId) return;
      try {
        const out = await postJSON('/api/loot/pickup', { heroId, lootId: loot.id });
        // atualiza backpack instantaneamente
        if (out?.ok && out?.snapshot) {
          window.dispatchEvent(new CustomEvent('backpack:update', { detail: { heroId, snapshot: out.snapshot } }));
        }
        // remove do layer
        removeLoot(loot.id);
      } catch (e) {
        // erros esperados: sem espaço, etc.
        console.info('[loot] pickup falhou:', e?.message || e);
      }
    });

    return node;
  }

  function removeLoot(id) {
    const node = state.nodes.get(id);
    if (node && node.parentNode) try { node.parentNode.removeChild(node); } catch {}
    state.nodes.delete(id);
    state.loots.delete(id);
  }

  // ===== posicionamento =====
  function layout() {
    const root = getOverlayRoot();
    for (const [id, loot] of state.loots) {
      let node = state.nodes.get(id);
      if (!node) {
        node = makeNode(loot);
        state.nodes.set(id, node);
        root.appendChild(node);
      }
      const pos = tileToCss(loot.tileX, loot.tileY);
      node.style.left = (pos.x | 0) + 'px';
      node.style.top = (pos.y | 0) + 'px';
    }
    requestAnimationFrame(layout);
  }

  // ===== carregar loots do mapa =====
  async function refresh() {
    const mapKey = getMapKey();
    if (!mapKey) return;
    try {
      await ensureItemsIndex();
      const list = await getJSON(`/api/map/${encodeURIComponent(mapKey)}/loot`);
      // normaliza
      const next = new Map();
      const tileSize = Number(window.GameScene?.tileSize || window.GameScene?.TILE_SIZE || window.TILE_SIZE || 32);
      for (const r of list || []) {
        const id = String(r.id);
        const tileX = Number.isFinite(Number(r.tileX ?? r.tile_x)) ? Number(r.tileX ?? r.tile_x) : null;
        const tileY = Number.isFinite(Number(r.tileY ?? r.tile_y)) ? Number(r.tileY ?? r.tile_y) : null;
        const px = Number.isFinite(r.x) ? Number(r.x) : (tileX != null ? tileX * tileSize + tileSize / 2 : null);
        const py = Number.isFinite(r.y) ? Number(r.y) : (tileY != null ? tileY * tileSize + tileSize / 2 : null);
        next.set(id, {
          id,
          mapKey: r.mapKey || r.map_key || mapKey,
          tileX: tileX != null ? tileX : Math.floor((px ?? 0) / tileSize),
          tileY: tileY != null ? tileY : Math.floor((py ?? 0) / tileSize),
          itemKey: r.itemKey || r.item_key || (Array.isArray(r.items) && r.items[0]?.key) || null,
          amount: Number(r.amount ?? r.qty ?? (Array.isArray(r.items) ? r.items[0]?.amount ?? r.items[0]?.qty : 1)) || 1,
        });
      }
      // remove os que sumiram
      for (const id of state.loots.keys()) {
        if (!next.has(id)) removeLoot(id);
      }
      // adiciona/atualiza
      for (const [id, row] of next) state.loots.set(id, row);
    } catch (e) {
      // se a rota não existir, evita spam
      // console.info('[loot] refresh skipped:', e?.message || e);
    }
  }

  // ===== eventos =====
  window.addEventListener('map:loot-refresh', () => { refresh(); });
  window.addEventListener('loot:picked', (ev) => {
    const id = ev?.detail?.lootId || ev?.detail?.id || null;
    if (id) removeLoot(String(id));
  });
  window.addEventListener('ground-item:update', (ev) => {
    const data = ev?.detail || null;
    if (!data) return;
    const mapKey = data.mapKey || data.map_key || getMapKey();
    if (mapKey && mapKey !== getMapKey()) return;
    state.loots.set(String(data.id), {
      id: String(data.id),
      mapKey,
      tileX: Number.isFinite(Number(data.tileX ?? data.tile_x)) ? Number(data.tileX ?? data.tile_x) : Math.floor(Number(data.x || 0) / (Number(window.GameScene?.tileSize || 32))),
      tileY: Number.isFinite(Number(data.tileY ?? data.tile_y)) ? Number(data.tileY ?? data.tile_y) : Math.floor(Number(data.y || 0) / (Number(window.GameScene?.tileSize || 32))),
      itemKey: data.itemKey || data.item_key || null,
      amount: Number(data.amount ?? data.qty ?? 1) || 1,
    });
  });
  window.addEventListener('ground-item:removed', (ev) => {
    const id = ev?.detail?.id || ev?.detail || null;
    if (id) removeLoot(String(id));
  });

  // troca de mapa (se você tiver um evento). Como fallback, timer periódico:
  setInterval(refresh, 1500);

  // kickstart
  requestAnimationFrame(layout);
  refresh();

  window.LootLayer = state;
  state.__ready = true;
})();