// client/js/settings.js
// Global game settings (vanilla script). Persist via localStorage and emit events.

(function () {
  const LS_KEY = 'afkminers.settings.v1';
  const defaults = {
    pixelArt: true,
    dprCap: clampNum((window.devicePixelRatio || 1), 1, 3),
    zoom: 1
  };

  function clampNum(v, min, max) {
    v = Number(v);
    if (!Number.isFinite(v)) v = min;
    return Math.min(max, Math.max(min, v));
  }

  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return { ...defaults };
      const j = JSON.parse(raw);
      return {
        pixelArt: !!j.pixelArt,
        dprCap: clampNum(j.dprCap ?? defaults.dprCap, 1, 3),
        zoom: clampNum(j.zoom ?? 1, 0.5, 3)
      };
    } catch {
      return { ...defaults };
    }
  }

  let state = load();

  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch {}
  }

  function emit() {
    try {
      document.dispatchEvent(new CustomEvent('settings:changed', { detail: { ...state } }));
    } catch {}
  }

  function set(patch) {
    if (!patch || typeof patch !== 'object') return getState();
    const next = { ...state };
    if ('pixelArt' in patch) next.pixelArt = !!patch.pixelArt;
    if ('dprCap'   in patch) next.dprCap   = clampNum(patch.dprCap, 1, 3);
    if ('zoom'     in patch) next.zoom     = clampNum(patch.zoom, 0.5, 3);
    state = next;
    save(); emit();
    return getState();
  }

  function getState() { return { ...state }; }

  function autodetect() {
    const dpr = window.devicePixelRatio || 1;
    // heuristic: cap alto demais desperdiça GPU; tenta <= 2.0 por padrão em desktops,
    // mas nunca menor que o DPR atual de telas comuns.
    const heuristicCap = clampNum(Math.min(2.0, dpr), 1, 3);
    state = { ...state, dprCap: heuristicCap, zoom: 1 };
    save(); emit();
    return getState();
  }

  // expose
  window.GameSettings = { getState, set, autodetect };

  // fire initial event so listeners apply on first load
  emit();
})();
