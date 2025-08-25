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
    }
  };
}
