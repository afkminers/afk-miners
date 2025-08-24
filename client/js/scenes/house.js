// client/js/scenes/house.js
// Wrapper da cena "house" que garante compat com play.js (espera #view).

export async function mount({ canvas, hud, params } = {}){
  // garante um canvas
  canvas = canvas || document.getElementById('view') || document.querySelector('canvas');
  if (!canvas) throw new Error('Canvas não encontrado');

  // play.js procura especificamente por id="view"
  const originalId = canvas.id;
  if (canvas.id !== 'view') canvas.id = 'view';

  // HUD mínimo compatível (#pos é lido pelo play.js)
  if (hud && !hud.dataset.wired) {
    if (!hud.children.length) {
      hud.innerHTML = `
        <div>map: <code>${params?.map || 'house'}</code></div>
        <div>Move: WASD / Setas</div>
        <div id="pos"></div>`;
    }
    hud.dataset.wired = '1';
  }

  // carrega a engine/cena real
  let mod;
  try {
    mod = await import('/js/play.js'); // este arquivo já inicializa ao importar
  } catch (e) {
    console.error('Não consegui importar /js/play.js', e);
    // volta id para não “sujar” o shell
    if (originalId) canvas.id = originalId; else canvas.removeAttribute('id');
    throw e;
  }

  // expõe API mínima para o shell
  return {
    resize(w,h,dpr){ try{ mod.resize?.(w,h,dpr); }catch{} },
    unmount(){
      try{ mod.destroy?.(); }catch{}
      if (originalId) canvas.id = originalId; else canvas.removeAttribute('id');
    },
    // expose a snapshot helper for the mini-map (best-effort, tolerant)
    getSnapshot() {
      try {
        // prefer explicit API from play.js
        if (typeof mod.getSnapshot === 'function') return mod.getSnapshot();

        // try common property names used by simple engines
        const mapW = mod.mapWidth || mod.map?.width || (mod.state && mod.state.mapWidth) || 1024;
        const mapH = mod.mapHeight || mod.map?.height || (mod.state && mod.state.mapHeight) || 768;

        const player = {
          x: (mod.player && (mod.player.x ?? mod.player.posX)) ?? (mod.hero && (mod.hero.x ?? mod.hero.posX)) ?? (mod.state && mod.state.player && (mod.state.player.x ?? mod.state.player.posX)) ?? 0,
          y: (mod.player && (mod.player.y ?? mod.player.posY)) ?? (mod.hero && (mod.hero.y ?? mod.hero.posY)) ?? (mod.state && mod.state.player && (mod.state.player.y ?? mod.state.player.posY)) ?? 0
        };

        const rawEntities = mod.entities || mod.actors || mod.state?.entities || [];
        const entities = Array.isArray(rawEntities) ? rawEntities.map(e => ({ x: e.x||0, y: e.y||0, color: e.color || '#ff4d4d' })) : [];

        return { mapW, mapH, player, entities };
      } catch (e) {
        return null;
      }
    }
  };
}
