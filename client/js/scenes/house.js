// Wrapper da cena "house" — garante que play.js INICIE, independente do formato.

export async function mount({ canvas, hud, params } = {}) {
  // 1) Canvas
  const el = canvas || document.getElementById('view') || document.querySelector('canvas');
  if (!el) throw new Error('Canvas não encontrado');
  const originalId = el.id;
  if (el.id !== 'view') el.id = 'view';

  // 2) HUD mínimo (compat com play.js lendo #pos)
  if (hud && !hud.dataset.wired) {
    if (!hud.children.length) {
      hud.innerHTML = `
        <div>map: <code>${params?.map || 'house'}</code></div>
        <div>Move: WASD / Setas</div>
        <div id="pos"></div>`;
    }
    hud.dataset.wired = '1';
  }

  // 3) Import da cena real
  let mod;
  try {
    mod = await import('/js/play.js');
  } catch (e) {
    console.error('Não consegui importar /js/play.js', e);
    if (originalId) el.id = originalId; else el.removeAttribute('id');
    throw e;
  }

  // 4) Tenta iniciar de forma robusta (suporta vários formatos)
  try {
    if (typeof mod.mount === 'function') {
      await mod.mount({ canvas: el, hud, params });
    } else if (typeof mod.start === 'function') {
      await mod.start({ canvas: el, hud, params });
    } else if (typeof mod.default === 'function') {
      await mod.default({ canvas: el, hud, params });
    } else if (typeof window.SceneHouse?.start === 'function') {
      // fallback caso play.js exponha global via side-effect
      await window.SceneHouse.start({ canvas: el, hud, params });
    } else {
      // se play.js inicializa via side-effect, não há nada a chamar aqui
      // apenas seguimos e deixamos os métodos de resize/destroy abaixo.
    }
  } catch (e) {
    console.error('[house] falha ao iniciar play.js:', e);
    throw e;
  }

  // 5) API para o shell
  return {
    resize(w, h, dpr) {
      try { (mod.resize || window.GameScene?.resize)?.(w, h, dpr); } catch {}
    },
    unmount() {
      try { (mod.destroy || window.GameScene?.destroy)?.(); } catch {}
      if (originalId) el.id = originalId; else el.removeAttribute('id');
    }
  };
}
