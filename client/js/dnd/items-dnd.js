// client/js/dnd/items-dnd.js
// Drag-and-drop a partir da Backpack: chão (/api/loot/drop) e slots equipáveis (/api/equipment/equip)
// Melhorias:
// - Fallback para dropar no tile do jogador se o tile do mouse não puder ser resolvido.
// - Logs "esperados" de equip inválido viram info (menos ruído).
// - Mantém CSRF e cookies.

(function () {
  if (window.ItemDnD && window.ItemDnD.__ready) return;

  const FEAT = Object.assign(
    { dragdrop: true, dragEquip: true, debugDnD: false, dropAtPlayerOnInvalid: true },
    window.Features || {}
  );
  window.Features = FEAT;
  if (!FEAT.dragdrop) return;

  // ==== CSRF helpers ====
  function getCookie(name) {
    try {
      const parts = document.cookie.split(';').map(s => s.trim());
      for (const p of parts) if (p.startsWith(name + '=')) return decodeURIComponent(p.substring(name.length + 1));
    } catch {}
    return '';
  }
  async function ensureCsrfLocal() {
    try { await fetch('/api/auth/csrf', { credentials: 'include' }); } catch {}
    try { await fetch('/api/csrf', { credentials: 'include' }); } catch {}
  }
  async function ensureCsrf() {
    if (typeof window.ensureCsrf === 'function') {
      try { await window.ensureCsrf(); return; } catch {}
    }
    await ensureCsrfLocal();
  }
  async function postJSON(url, body) {
    const send = async () => {
      const token = getCookie('csrf') || '';
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
        body: JSON.stringify(body || {})
      });
      return res;
    };
    let res = await send();
    if (res.status === 403) { try { await ensureCsrf(); } catch {} res = await send(); }
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      const err = new Error(data?.error || ('request-failed ' + res.status));
      err.status = res.status; err.payload = data;
      throw err;
    }
    return data;
  }

  // ==== debug HUD opcional ====
  function makeDebugHud() {
    if (!FEAT.debugDnD) return null;
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:8px;bottom:8px;padding:6px 8px;background:#111827cc;color:#e5e7eb;border:1px solid #374151;border-radius:6px;font:12px monospace;z-index:999999;pointer-events:none';
    el.textContent = 'tile: --';
    document.body.appendChild(el);
    return el;
  }

  const DnD = {
    __ready: false,
    drag: null,              // { source:'backpack', itemKey, qty, bpIndex }
    __hoverTile: null,       // { mapKey, x, y }
    __lastMapKey: null,
    __hud: null,

    resolveHeroId() {
      return (
        window.ActiveHeroId ||
        (window.Team && typeof window.Team.getActiveHeroId === 'function' && window.Team.getActiveHeroId()) ||
        (window.GameScene && window.GameScene.activeHeroId) ||
        (window.Player && window.Player.activeHeroId) ||
        null
      );
    },

    getMapKey() {
      return (
        window.GameScene?.mapKey ||
        window.Player?.mapKey ||
        window.CurrentMapKey ||
        this.__lastMapKey ||
        null
      );
    },

    getCanvas() {
      return document.getElementById('scene') || document.querySelector('[data-drop-map]') || document.body;
    },

    toCanvasSpace(clientX, clientY, target) {
      const el = target || this.getCanvas();
      const rect = el.getBoundingClientRect?.() || { left: 0, top: 0, width: 1, height: 1 };
      const cssX = clientX - rect.left;
      const cssY = clientY - rect.top;
      const cw = Number(el.width || rect.width || 1);
      const ch = Number(el.height || rect.height || 1);
      const scaleX = cw / Math.max(1, rect.width || cw);
      const scaleY = ch / Math.max(1, rect.height || ch);
      return { x: cssX * scaleX, y: cssY * scaleY };
    },

    // Estratégias para obter tile
    screenToTileFromEvent(ev, target) {
      try {
        const gs = window.GameScene || window.scene || window.gameScene || null;
        const el = target || this.getCanvas();

        // 0) Props diretas
        const px = gs?.pointerTileX ?? gs?.mouseTileX ?? null;
        const py = gs?.pointerTileY ?? gs?.mouseTileY ?? null;
        if (Number.isInteger(px) && Number.isInteger(py)) {
          const mk0 = gs?.mapKey || this.getMapKey();
          if (mk0) return { mapKey: mk0, x: px, y: py };
        }
        if (typeof gs?.getPointerTile === 'function') {
          const t = gs.getPointerTile(); if (t && Number.isInteger(t.x) && Number.isInteger(t.y)) {
            const mk0 = gs?.mapKey || this.getMapKey();
            if (mk0) return { mapKey: mk0, x: t.x, y: t.y };
          }
        }
        if (typeof gs?.getMouseTile === 'function') {
          const t = gs.getMouseTile(); if (t && Number.isInteger(t.x) && Number.isInteger(t.y)) {
            const mk0 = gs?.mapKey || this.getMapKey();
            if (mk0) return { mapKey: mk0, x: t.x, y: t.y };
          }
        }

        // 1) Funções que recebem pixel em canvas
        const p = this.toCanvasSpace(ev.clientX, ev.clientY, el);
        if (gs && typeof gs.screenToTile === 'function') {
          const out = gs.screenToTile(p.x, p.y) || {};
          if (Number.isInteger(out.x) && Number.isInteger(out.y)) {
            const mk = out.mapKey || gs?.mapKey || this.getMapKey();
            if (mk) return { mapKey: mk, x: out.x, y: out.y };
          }
        }
        if (gs && typeof gs.pixelToTile === 'function') {
          const out = gs.pixelToTile(p.x, p.y) || {};
          if (Number.isInteger(out.x) && Number.isInteger(out.y)) {
            const mk = out.mapKey || gs?.mapKey || this.getMapKey();
            if (mk) return { mapKey: mk, x: out.x, y: out.y };
          }
        }

        // 2) Fallback manual
        const tileSize =
          Number(gs?.tileSize) ||
          Number(gs?.TILE_SIZE) ||
          Number(window.TILE_SIZE) ||
          32;
        const camX = Number(gs?.cameraX ?? gs?.camera?.x ?? gs?.viewX ?? 0) || 0;
        const camY = Number(gs?.cameraY ?? gs?.camera?.y ?? gs?.viewY ?? 0) || 0;

        const worldX = camX + p.x;
        const worldY = camY + p.y;
        if (tileSize > 0 && Number.isFinite(worldX) && Number.isFinite(worldY)) {
          const tx = Math.floor(worldX / tileSize);
          const ty = Math.floor(worldY / tileSize);
          if (Number.isInteger(tx) && Number.isInteger(ty)) {
            const mk = gs?.mapKey || this.getMapKey();
            if (mk) return { mapKey: mk, x: tx, y: ty };
          }
        }
      } catch (e) {
        // silencioso
      }
      return null;
    },

    resolveDropTile(ev, target) {
      // 1) último hover válido
      if (this.__hoverTile && this.__hoverTile.mapKey != null && Number.isInteger(this.__hoverTile.x) && Number.isInteger(this.__hoverTile.y)) {
        return this.__hoverTile;
      }
      // 2) cálculo ao vivo
      const live = this.screenToTileFromEvent(ev, target);
      if (live) return live;
      // 3) fallback: tile do jogador se permitido
      if (FEAT.dropAtPlayerOnInvalid) {
        const mk = this.getMapKey();
        const x = window.GameScene?.playerTileX ?? window.Player?.tileX;
        const y = window.GameScene?.playerTileY ?? window.Player?.tileY;
        if (mk && Number.isInteger(x) && Number.isInteger(y)) return { mapKey: mk, x, y };
      }
      // 4) inválido
      return { mapKey: this.getMapKey(), x: NaN, y: NaN };
    },

    qtyFromModifiers(originalQty, ev) {
      if (ev?.ctrlKey) return 1;
      if (ev?.shiftKey) return Math.max(1, Math.floor(Number(originalQty || 1) / 2));
      return Number(originalQty || 1);
    },

    async dropToGround({ heroId, itemKey, qty, tile }) {
      return postJSON('/api/loot/drop', { heroId, itemKey, qty, mapKey: tile.mapKey, x: tile.x, y: tile.y });
    },

    async equipFromBackpackTry({ heroId, slot, itemKey }) {
      return postJSON('/api/equipment/equip', { heroId, slot, itemKey });
    },

    makeDragImage(iconUrl, label) {
      const c = document.createElement('div');
      c.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 6px;background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:6px;font-size:12px;box-shadow:0 2px 8px rgba(0,0,0,.35);pointer-events:none';
      if (iconUrl) { const img = document.createElement('img'); img.src = iconUrl; img.width = 20; img.height = 20; img.style.imageRendering = 'pixelated'; c.appendChild(img); }
      const t = document.createElement('span'); t.textContent = label || 'item'; c.appendChild(t);
      document.body.appendChild(c); return c;
    },

    // Origem: Backpack
    wireBackpack(panel) {
      if (!panel) return;
      if (panel.dataset.dndBackpackWired === '1') return;
      panel.dataset.dndBackpackWired = '1';

      panel.addEventListener('dragstart', (ev) => {
        const slot = ev.target?.closest?.('.bp-slot');
        if (!slot) return;
        const itemKey = slot?.dataset?.itemKey || null;
        const qty = Number(slot?.dataset?.qty || 0) || 0;
        const bpIndex = Number(slot?.dataset?.bpIndex || -1);
        if (!itemKey || qty <= 0) { ev.preventDefault?.(); return; }
        const dragLabel = `${itemKey} ×${qty}`;
        const iconUrl = slot.querySelector('img')?.src || null;
        const img = this.makeDragImage(iconUrl, dragLabel);
        try { ev.dataTransfer?.setDragImage(img, 10, 10); } catch {}
        setTimeout(() => img.remove(), 0);
        if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
        this.drag = { source: 'backpack', itemKey, qty, bpIndex };
        if (!this.__hud) this.__hud = makeDebugHud();
      });

      panel.addEventListener('dragend', () => {
        this.drag = null;
        this.__hoverTile = null;
        if (this.__hud) { try { this.__hud.remove(); } catch {} this.__hud = null; }
      });
    },

    // Alvo: mapa
    wireMapDropTarget(scope) {
      const target = scope || this.getCanvas();
      if (!target || target.dataset.dndMapWired === '1') return;
      target.dataset.dndMapWired = '1';

      const updateHover = (ev) => {
        if (!this.drag) return;
        const gs = window.GameScene || null;
        const px = gs?.pointerTileX ?? gs?.mouseTileX ?? null;
        const py = gs?.pointerTileY ?? gs?.mouseTileY ?? null;
        if (Number.isInteger(px) && Number.isInteger(py)) {
          const mk = gs?.mapKey || this.getMapKey();
          if (mk) this.__hoverTile = { mapKey: mk, x: px, y: py };
        } else {
          const out = this.screenToTileFromEvent(ev, target);
          if (out && Number.isInteger(out.x) && Number.isInteger(out.y)) this.__hoverTile = out;
        }
        if (this.__hoverTile) this.__lastMapKey = this.__hoverTile.mapKey;
        if (this.__hud && this.__hoverTile) this.__hud.textContent = `tile: ${this.__hoverTile.mapKey} (${this.__hoverTile.x}, ${this.__hoverTile.y})`;
      };

      target.addEventListener('dragenter', updateHover);
      target.addEventListener('dragover', (ev) => {
        if (!this.drag) return;
        ev.preventDefault();
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
        updateHover(ev);
      });

      target.addEventListener('drop', async (ev) => {
        if (!this.drag || this.drag.source !== 'backpack') return;
        try {
          const heroId = this.resolveHeroId();
          if (!heroId) return;

          let tile = this.resolveDropTile(ev, target);
          // último fallback: player tile se permitido
          if ((!tile?.mapKey || !Number.isInteger(tile.x) || !Number.isInteger(tile.y)) && FEAT.dropAtPlayerOnInvalid) {
            const mk = this.getMapKey();
            const px = window.GameScene?.playerTileX ?? window.Player?.tileX;
            const py = window.GameScene?.playerTileY ?? window.Player?.tileY;
            if (mk && Number.isInteger(px) && Number.isInteger(py)) tile = { mapKey: mk, x: px, y: py };
          }
          if (!tile?.mapKey || !Number.isInteger(tile.x) || !Number.isInteger(tile.y)) {
            console.info('[DnD] drop cancelado: tile inválido', tile);
            return;
          }

          const qty = this.qtyFromModifiers(this.drag.qty, ev);
          if (qty <= 0) return;

          const { ok, snapshot } = await this.dropToGround({ heroId, itemKey: this.drag.itemKey, qty, tile });
          if (ok && snapshot) {
            window.dispatchEvent(new CustomEvent('backpack:update', { detail: { heroId, snapshot } }));
          } else {
            try { window.BackpackUI?.render(heroId); } catch {}
          }
          try { document.dispatchEvent(new CustomEvent('map:loot-refresh', { detail: { mapKey: tile.mapKey } })); } catch {}
        } catch (e) {
          console.warn('[DnD] drop error:', e?.message || e);
        } finally {
          this.drag = null;
          this.__hoverTile = null;
          if (this.__hud) { try { this.__hud.remove(); } catch {} this.__hud = null; }
        }
      });
    },

    // Alvo: slots equipáveis
    wireEquipDropTargets(scope) {
      if (!FEAT.dragEquip) return;
      const root = scope || document;
      if (root.__dndEquipWired) return;
      root.__dndEquipWired = true;

      root.addEventListener('dragover', (ev) => {
        if (!this.drag) return;
        const slotEl = ev.target?.closest?.('.slot[data-eq-slot]');
        if (!slotEl) return;
        ev.preventDefault();
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
      }, true);

      root.addEventListener('drop', async (ev) => {
        if (!this.drag) return;
        const slotEl = ev.target?.closest?.('.slot[data-eq-slot]');
        if (!slotEl) return;
        if (this.drag.source !== 'backpack') return;

        const SLOT = String(slotEl.getAttribute('data-eq-slot') || '').toUpperCase();
        if (!SLOT) return;

        try {
          const heroId = this.resolveHeroId();
          if (!heroId) return;

          await this.equipFromBackpackTry({ heroId, slot: SLOT, itemKey: this.drag.itemKey });
          try { document.dispatchEvent(new CustomEvent('equip-updated')); } catch {}
          try { window.BackpackUI?.render(heroId); } catch {}
        } catch (e) {
          const msg = String(e?.message || '');
          if (msg.includes('no-such-item') || msg.includes('bad-slot') || msg.includes('not-equipable')) {
            console.info('[DnD] equip inválido:', msg);
          } else {
            console.warn('[DnD] equip error:', msg);
          }
          try {
            slotEl.style.transition = 'transform .08s ease';
            slotEl.style.transform = 'translateX(3px)';
            setTimeout(() => { slotEl.style.transform = 'translateX(-3px)'; }, 80);
            setTimeout(() => { slotEl.style.transform = ''; }, 160);
          } catch {}
        } finally {
          this.drag = null;
        }
      }, true);
    },

    init() {
      this.wireMapDropTarget();
      this.wireEquipDropTargets();
      this.__ready = true;
    }
  };

  window.ItemDnD = DnD;
  DnD.init();
})();