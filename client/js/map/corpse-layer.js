// client/js/map/corpse-layer.js
(function () {
  if (window.CorpseLayer && window.CorpseLayer.__ready) return;

  const state = {
    nodes: new Map(), // corpseId -> HTMLElement
    corpses: new Map(),
    __ready: false,
  };

  function getMapKey() {
    return (
      window.GameScene?.mapKey ||
      window.Player?.mapKey ||
      window.CurrentMapKey ||
      null
    );
  }

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

  function getOverlayRoot() {
    const host = document.getElementById('clientShell') || document.body;
    let el = document.getElementById('corpseLayer');
    if (!el) {
      el = document.createElement('div');
      el.id = 'corpseLayer';
      el.style.position = 'absolute';
      el.style.left = '0';
      el.style.top = '0';
      el.style.width = '0';
      el.style.height = '0';
      el.style.overflow = 'visible';
      el.style.pointerEvents = 'auto';
      el.style.zIndex = '7';
      host.appendChild(el);
    }
    return el;
  }

  function getCanvasRects() {
    const canvas = document.getElementById('scene');
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

  // world(px) -> coords dentro do canvas (antes do scaling CSS)
  function worldToCanvasPx(wx, wy) {
    const cam = getCamera();
    if (cam && typeof cam.worldToScreen === 'function') {
      const p = cam.worldToScreen(wx, wy) || {};
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) return p;
      const z = cam.getZoom ? Number(cam.getZoom()) || 1 : 1;
      const cx = Number(cam.x || 0);
      const cy = Number(cam.y || 0);
      return { x: (wx - cx) * z, y: (wy - cy) * z };
    }
    return { x: wx, y: wy };
  }

  // TILE -> world center -> canvas coords
  function tileToCanvasPx(tileX, tileY) {
    const gs = window.GameScene || null;
    const tileSize = Number(
      gs?.tileSize || gs?.TILE_SIZE || window.TILE_SIZE || 32,
    );
    const wx = tileX * tileSize + tileSize / 2;
    const wy = tileY * tileSize + tileSize / 2;
    return worldToCanvasPx(wx, wy);
  }

  function canvasPxToCss(px, py) {
    const { rect, cw, ch } = getCanvasRects();
    const scaleX = Math.max(0.0001, rect.width / cw);
    const scaleY = Math.max(0.0001, rect.height / ch);
    // SOMA O OFFSET DO CANVAS NA PÁGINA
    return { x: rect.left + px * scaleX, y: rect.top + py * scaleY };
  }


  function tileToCss(tileX, tileY) {
    const p = tileToCanvasPx(tileX, tileY);
    return canvasPxToCss(p.x, p.y);
  }

  function upsertCorpse(corpse) {
    if (!corpse) return;
    const mapKey = corpse.mapKey || corpse.map_key || null;
    const currentMap = getMapKey();
    if (mapKey && currentMap && mapKey !== currentMap) return;

    const id = String(corpse.id);
    state.corpses.set(id, corpse);

    let node = state.nodes.get(id);
    if (!node) {
      node = document.createElement('div');
      node.className = 'corpse-hitbox';
      node.style.position = 'absolute';
      node.style.width = '32px';
      node.style.height = '32px';
      node.style.pointerEvents = 'auto';
      node.style.zIndex = '7';
      node.style.transform = 'translate(-50%, -50%)';
      node.style.cursor = 'pointer';
      node.style.background = 'rgba(0,0,0,0)';
      node.dataset.corpseId = id;

      // RMB / context menu abre loot
      node.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        try {
          window.CorpseWindow?.open(id);
        } catch {}
      });
      node.addEventListener('pointerdown', (ev) => {
        if (ev.button === 2) {
          ev.preventDefault();
          ev.stopPropagation();
          try {
            window.CorpseWindow?.open(id);
          } catch {}
        }
      });

      getOverlayRoot().appendChild(node);
      state.nodes.set(id, node);
    }

    node.dataset.empty = corpse.isEmpty ? '1' : '0';
    node.style.opacity = corpse.isEmpty ? '0.35' : '1';

    const tileX = Number(corpse.tileX ?? corpse.tile_x);
    const tileY = Number(corpse.tileY ?? corpse.tile_y);
    if (Number.isInteger(tileX) && Number.isInteger(tileY)) {
      const pos = tileToCss(tileX, tileY);
      node.style.left = (pos.x | 0) + 'px';
      node.style.top = (pos.y | 0) + 'px';
    }
  }

  // remove só localmente, sem disparar evento (quem dispara é o servidor / refresh)
  function removeCorpse(id) {
    const key = String(id);
    const node = state.nodes.get(key);
    if (node && node.parentNode) {
      try {
        node.parentNode.removeChild(node);
      } catch {}
    }
    state.nodes.delete(key);
    state.corpses.delete(key);
  }

  async function refresh() {
    const mapKey = getMapKey();
    if (!mapKey) return;
    try {
      const res = await fetch(
        `/api/map/${encodeURIComponent(mapKey)}/corpses`,
        { credentials: 'include' },
      );
      if (!res.ok) return;
      const list = await res.json();
      const seen = new Set();
      for (const raw of list || []) {
        const corpse = {
          id: String(raw.id),
          mapKey: raw.mapKey || raw.map_key || mapKey,
          tileX: Number(raw.tileX ?? raw.tile_x),
          tileY: Number(raw.tileY ?? raw.tile_y),
          posX: raw.posX ?? raw.pos_x ?? null,
          posY: raw.posY ?? raw.pos_y ?? null,
          ownerPlayerId: raw.ownerPlayerId || raw.owner_player_id || null,
          ownerHeroId: raw.ownerHeroId || raw.owner_hero_id || null,
          isEmpty: raw.isEmpty === true || raw.is_fully_looted === true,
        };
        seen.add(corpse.id);
        upsertCorpse(corpse);
      }

      // Qualquer corpse que existia localmente e não veio mais do servidor => despawn
      for (const key of Array.from(state.corpses.keys())) {
        if (!seen.has(key)) {
          try {
            window.dispatchEvent(
              new CustomEvent('corpse:removed', {
                detail: { id: key, cause: 'despawn' },
              }),
            );
          } catch {}
        }
      }
    } catch {
      // ignora erro
    }
  }

  /**
   * Tenta abrir o corpse exatamente debaixo do cursor (clientX/clientY).
   * Retorna true se abriu algum loot, false caso contrário.
   */
  function openCorpseAtEvent(ev) {
    if (!ev) return false;

    const clientX = ev.clientX ?? (ev.touches && ev.touches[0]?.clientX);
    const clientY = ev.clientY ?? (ev.touches && ev.touches[0]?.clientY);
    if (
      !Number.isFinite(clientX) ||
      !Number.isFinite(clientY) ||
      typeof document.elementFromPoint !== 'function'
    ) {
      return false;
    }

    const top = document.elementFromPoint(clientX, clientY);
    if (!top || typeof top.closest !== 'function') return false;

    const hit = top.closest('.corpse-hitbox');
    if (!hit) return false;

    const id = hit.dataset && hit.dataset.corpseId;
    if (!id) return false;

    try {
      window.CorpseWindow?.open(id);
    } catch (err) {
      console.warn('[corpse-layer] openCorpseAtEvent failed:', err);
      return false;
    }
    return true;
  }

  // eventos globais vindos do servidor/UI
  window.addEventListener('corpse:spawn', (ev) => {
    upsertCorpse(ev?.detail || ev?.corpse || ev);
  });
  window.addEventListener('corpse:refresh', (ev) => {
    upsertCorpse(ev?.detail || ev);
  });
  window.addEventListener('corpse:updated', (ev) => {
    const detail = ev?.detail || null;
    if (!detail?.id) return;
    const existing = state.corpses.get(String(detail.id));
    if (!existing) return;
    existing.isEmpty = detail.isEmpty === true;
    upsertCorpse(existing);
  });
  window.addEventListener('corpse:removed', (ev) => {
    const id = ev?.detail?.id || ev?.detail || ev?.corpseId || null;
    if (id) removeCorpse(id);
  });

  window.addEventListener('gamescene:ready', () => {
    refresh();
  });

  setInterval(refresh, 2500);
  refresh();

  // expõe helper pro attack-controls usar RMB em cima do corpse
  state.openAtEvent = openCorpseAtEvent;

  state.__ready = true;
  window.CorpseLayer = state;
})();
