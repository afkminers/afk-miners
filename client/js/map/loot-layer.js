// client/js/map/loot-layer.js
// Renderiza loots no mapa por cima do canvas (#scene), com placeholder se não houver sprite.
// Também permite clicar no loot para coletar (POST /api/loot/pickup).

(function () {
  if (window.LootLayer && window.LootLayer.__ready) return;

  // ===== helpers CSRF / fetch =====
  function getCookie(name) {
    try {
      const parts = document.cookie.split(';').map((s) => s.trim());
      for (const p of parts)
        if (p.startsWith(name + '=')) return decodeURIComponent(p.substring(name.length + 1));
    } catch {}
    return '';
  }
  async function ensureCsrf() {
    try {
      await fetch('/api/auth/csrf', { credentials: 'include' });
    } catch {}
    try {
      await fetch('/api/csrf', { credentials: 'include' });
    } catch {}
  }
  async function postJSON(url, body) {
    const send = async () => {
      const token = getCookie('csrf') || '';
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
        body: JSON.stringify(body || {}),
      });
      return res;
    };
    let r = await send();
    if (r.status === 403) {
      await ensureCsrf();
      r = await send();
    }
    let data = {};
    try {
      data = await r.json();
    } catch {}
    if (!r.ok) throw new Error(data?.error || 'request-failed ' + r.status);
    return data;
  }
  async function getJSON(url) {
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error('GET ' + url + ' -> ' + r.status);
    return r.json();
  }

  const state = {
    itemsIndex: null,
    nodes: new Map(), // id -> HTMLElement
    loots: new Map(), // id -> loot
    __ready: false,
  };

  function getHeroId() {
    return (
      window.ActiveHeroId ||
      (window.Team &&
        typeof window.Team.getActiveHeroId === 'function' &&
        window.Team.getActiveHeroId()) ||
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
    if (!canvas)
      return {
        rect: { left: 0, top: 0, width: 1, height: 1 },
        cw: 1,
        ch: 1,
      };
    const rect =
      canvas.getBoundingClientRect?.() || {
        left: 0,
        top: 0,
        width: 1,
        height: 1,
      };
    const cw = Number(canvas.width || rect.width || 1);
    const ch = Number(canvas.height || rect.height || 1);
    return { rect, cw, ch };
  }

  function getCamera() {
    return (window.GameScene && window.GameScene.camera) || null;
  }

  // tile -> world center -> camera.worldToScreen
  function tileToCanvasPx(x, y) {
    const gs = window.GameScene || null;
    const tileSize =
      Number(gs?.tileSize) ||
      Number(gs?.TILE_SIZE) ||
      Number(window.TILE_SIZE) ||
      32;

    const wx = x * tileSize + tileSize / 2;
    const wy = y * tileSize + tileSize / 2;

    const cam = getCamera();
    if (cam && typeof cam.worldToScreen === 'function') {
      const p = cam.worldToScreen(wx, wy) || {};
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) return { x: p.x, y: p.y };

      const z = cam.getZoom ? Number(cam.getZoom()) || 1 : 1;
      const cx = Number(cam.x || 0);
      const cy = Number(cam.y || 0);
      return { x: (wx - cx) * z, y: (wy - cy) * z };
    }

    return { x: wx, y: wy };
  }

  function canvasPxToCss(px, py) {
    const { rect, cw, ch } = getCanvasRects();
    const scaleX = Math.max(0.0001, rect.width / cw);
    const scaleY = Math.max(0.0001, rect.height / ch);
    // SOMA O OFFSET DO CANVAS NA PÁGINA
    return { x: rect.left + px * scaleX, y: rect.top + py * scaleY };
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
    node.style.width = '32px';
    node.style.height = '32px';
    node.style.transform = 'translate(-50%, -50%)';
    node.style.pointerEvents = 'auto';
    node.style.cursor = 'pointer';

    node.dataset.lootId = String(loot.id);

    node.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      try {
        await pickupLoot(String(loot.id));
      } catch (err) {
        console.warn('[loot-layer] pickup failed', err);
      }
    });

    return node;
  }

  function getOrCreateNode(loot) {
    const id = String(loot.id);
    let node = state.nodes.get(id);
    if (!node) {
      node = makeNode(loot);
      getOverlayRoot().appendChild(node);
      state.nodes.set(id, node);
    }

    const tileX = Number(loot.tileX ?? loot.tile_x);
    const tileY = Number(loot.tileY ?? loot.tile_y);
    if (Number.isInteger(tileX) && Number.isInteger(tileY)) {
      const pos = tileToCss(tileX, tileY);
      node.style.left = (pos.x | 0) + 'px';
      node.style.top = (pos.y | 0) + 'px';
    }

    return node;
  }

  function removeLoot(id) {
    const key = String(id);
    const node = state.nodes.get(key);
    if (node && node.parentNode) {
      try {
        node.parentNode.removeChild(node);
      } catch {}
    }
    state.nodes.delete(key);
    state.loots.delete(key);
  }

  async function pickupLoot(id) {
    const heroId = getHeroId();
    if (!heroId) return;

    try {
      await postJSON('/api/loot/ground/pickup', {
        heroId: String(heroId),
        groundItemId: String(id),
      });
    } catch (e) {
      console.warn('[loot-layer] pickup error', e);
    }
  }

  async function refresh() {
    const mapKey = getMapKey();
    if (!mapKey) return;

    try {
      const list = await getJSON(
        `/api/loot/map/${encodeURIComponent(mapKey)}/ground`,
      );
      const seen = new Set();
      for (const raw of list || []) {
        const loot = {
          id: String(raw.id),
          mapKey: raw.mapKey || raw.map_key || mapKey,
          tileX: Number(raw.tileX ?? raw.tile_x),
          tileY: Number(raw.tileY ?? raw.tile_y),
          itemKey: raw.itemKey || raw.item_key,
          amount: raw.amount,
          expiresAt: raw.expiresAt || raw.expires_at || null,
        };
        seen.add(loot.id);
        state.loots.set(loot.id, loot);
        getOrCreateNode(loot);
      }

      for (const key of Array.from(state.loots.keys())) {
        if (!seen.has(key)) removeLoot(key);
      }
    } catch (e) {
      console.warn('[loot-layer] refresh failed', e);
    }
  }

  // eventos WS
  window.addEventListener('loot:ground-spawn', (ev) => {
    const loot = ev?.detail || ev?.item || ev;
    if (!loot || !loot.id) return;
    const mapKey = getMapKey();
    const lootMapKey = loot.mapKey || loot.map_key || null;
    if (mapKey && lootMapKey && mapKey !== lootMapKey) return;
    const norm = {
      id: String(loot.id),
      mapKey: lootMapKey || mapKey,
      tileX: Number(loot.tileX ?? loot.tile_x),
      tileY: Number(loot.tileY ?? loot.tile_y),
      itemKey: loot.itemKey || loot.item_key,
      amount: loot.amount,
      expiresAt: loot.expiresAt || loot.expires_at || null,
    };
    state.loots.set(norm.id, norm);
    getOrCreateNode(norm);
  });

  window.addEventListener('loot:ground-removed', (ev) => {
    const id = ev?.detail?.id || ev?.detail || ev?.itemId || null;
    if (id) removeLoot(id);
  });

  window.addEventListener('gamescene:ready', () => {
    refresh();
  });

  setInterval(refresh, 4000);
  refresh();

  state.__ready = true;
  window.LootLayer = state;
})();
