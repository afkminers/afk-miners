// client/js/ui/settings_panel.js
// Simple dockable settings panel. Vanilla script; expects window.GameSettings.

(function () {
  function fmt(n) {
    const v = Number(n);
    return Number.isFinite(v) ? (Math.round(v * 100) / 100).toString() : String(n);
  }

  function mountPanel(container) {
    const st = (window.GameSettings && window.GameSettings.getState()) || { pixelArt: true, dprCap: 1, zoom: 1 };

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.dataset.panel = 'settings';

    panel.innerHTML = `
      <header><h3>Settings</h3></header>
      <div class="body" style="display:flex;flex-direction:column;gap:14px">
        <label style="display:flex;align-items:center;justify-content:space-between;gap:12px">
          <span>Pixel Art</span>
          <input id="gs_pixel" type="checkbox">
        </label>

        <div>
          <div style="display:flex;align-items:center;justify-content:space-between">
            <label for="gs_dpr">DPR Cap</label>
            <span id="gs_dpr_val">${fmt(st.dprCap)}</span>
          </div>
          <input id="gs_dpr" type="range" min="1" max="3" step="0.05">
        </div>

        <div>
          <div style="display:flex;align-items:center;justify-content:space-between">
            <label for="gs_zoom">Zoom</label>
            <span id="gs_zoom_val">${fmt(st.zoom)}</span>
          </div>
          <input id="gs_zoom" type="range" min="0.5" max="3" step="0.05">
        </div>

        <div style="display:flex;gap:8px">
          <button id="gs_auto" type="button">Auto-detect</button>
          <button id="gs_close" type="button">Fechar</button>
        </div>
      </div>
    `;

    const chkPixel = panel.querySelector('#gs_pixel');
    const rngDpr   = panel.querySelector('#gs_dpr');
    const lblDpr   = panel.querySelector('#gs_dpr_val');
    const rngZoom  = panel.querySelector('#gs_zoom');
    const lblZoom  = panel.querySelector('#gs_zoom_val');
    const btnAuto  = panel.querySelector('#gs_auto');
    const btnClose = panel.querySelector('#gs_close');

    // apply initial values
    chkPixel.checked = !!st.pixelArt;
    rngDpr.value = String(st.dprCap);
    rngZoom.value = String(st.zoom);

    // wire events -> GameSettings
    chkPixel.addEventListener('change', () => {
      window.GameSettings && window.GameSettings.set({ pixelArt: chkPixel.checked });
    });

    rngDpr.addEventListener('input', () => {
      const v = parseFloat(rngDpr.value);
      lblDpr.textContent = fmt(v);
      window.GameSettings && window.GameSettings.set({ dprCap: v });
    });

    rngZoom.addEventListener('input', () => {
      const v = parseFloat(rngZoom.value);
      lblZoom.textContent = fmt(v);
      window.GameSettings && window.GameSettings.set({ zoom: v });
    });

    btnAuto.addEventListener('click', () => {
      const ns = (window.GameSettings && window.GameSettings.autodetect()) || st;
      // refresh UI
      chkPixel.checked = !!ns.pixelArt;
      rngDpr.value = String(ns.dprCap); lblDpr.textContent = fmt(ns.dprCap);
      rngZoom.value = String(ns.zoom);  lblZoom.textContent = fmt(ns.zoom);
    });

    btnClose.addEventListener('click', () => panel.remove());

    // keep labels in sync if settings change elsewhere
    document.addEventListener('settings:changed', (ev) => {
      const ns = ev && ev.detail ? ev.detail : (window.GameSettings && window.GameSettings.getState());
      if (!ns) return;
      chkPixel.checked = !!ns.pixelArt;
      if (String(rngDpr.value) !== String(ns.dprCap)) {
        rngDpr.value = String(ns.dprCap);
        lblDpr.textContent = fmt(ns.dprCap);
      }
      if (String(rngZoom.value) !== String(ns.zoom)) {
        rngZoom.value = String(ns.zoom);
        lblZoom.textContent = fmt(ns.zoom);
      }
    });

    // insert
    (container || document.body).appendChild(panel);
    return panel;
  }

  // global helper used by app.js button
  window.openSettingsPanel = function (stackEl) {
    const target = stackEl || document.getElementById('rightStack') || document.body;
    // remove existing settings panel if any
    const prev = target.querySelector('[data-panel="settings"]');
    if (prev) prev.remove();
    return mountPanel(target);
  };
})();
