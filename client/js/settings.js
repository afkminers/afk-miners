// client/js/settings.js
// Global game settings (vanilla script). Persist via localStorage and emit events.

(function () {
  const LS_KEY = 'afkminers.settings.v1';

  function clampNum(v, min, max) {
    v = Number(v);
    if (!Number.isFinite(v)) v = min;
    return Math.min(max, Math.max(min, v));
  }

  // Defaults: força pixelão nativo p/ todos
  const defaults = {
    pixelArt: true,
    // dprCap 1 = sem super nitidez de hiDPI (mantém o "dente de serra" da pixel art)
    dprCap: 1,

    // Zoom "numérico" (usado se zoomByTiles = false)
    zoom: 2,
    zoomStep: 0.25,
    zoomMin: 0.75,
    zoomMax: 4,

    // Modo recomendado (Tibia-like): calcula o zoom para caber N tiles na altura
    zoomByTiles: true,
    tilesY: 13, // ~Tibia clássico
  };

  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return { ...defaults };
      const j = JSON.parse(raw) || {};

      // Merge + clamps
      return {
        pixelArt: !!(j.pixelArt ?? defaults.pixelArt),
        dprCap: 1, // força 1 sempre (independente do que veio salvo)

        zoom: clampNum(j.zoom ?? defaults.zoom, defaults.zoomMin, defaults.zoomMax),
        zoomStep: clampNum(j.zoomStep ?? defaults.zoomStep, 0.05, 1),
        zoomMin: clampNum(j.zoomMin ?? defaults.zoomMin, 0.25, 4),
        zoomMax: clampNum(j.zoomMax ?? defaults.zoomMax, 0.5, 8),

        zoomByTiles: !!(j.zoomByTiles ?? defaults.zoomByTiles),
        tilesY: clampNum(j.tilesY ?? defaults.tilesY, 6, 30),
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

    if ('pixelArt'  in patch) next.pixelArt  = !!patch.pixelArt;
    // dprCap é forçado = 1 (pixel art nativo pra todos)
    next.dprCap = 1;

    if ('zoom'      in patch) next.zoom      = clampNum(patch.zoom, state.zoomMin, state.zoomMax);
    if ('zoomStep'  in patch) next.zoomStep  = clampNum(patch.zoomStep, 0.05, 1);
    if ('zoomMin'   in patch) next.zoomMin   = clampNum(patch.zoomMin, 0.25, 4);
    if ('zoomMax'   in patch) next.zoomMax   = clampNum(patch.zoomMax, 0.5, 8);

    if ('zoomByTiles' in patch) next.zoomByTiles = !!patch.zoomByTiles;
    if ('tilesY'      in patch) next.tilesY      = clampNum(patch.tilesY, 6, 30);

    state = next;
    save(); emit();
    return getState();
  }

  function getState() { return { ...state }; }
  function get(k) { return state[k]; }

  // Mantemos a API, mas garantimos dprCap=1 sempre
  function autodetect() {
    state = { ...state, dprCap: 1 };
    save(); emit();
    return getState();
  }

  // expose
  window.GameSettings = { getState, get, set, autodetect };

  // fire initial event so listeners apply on first load
  emit();
})();
