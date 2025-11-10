// client/js/landing-bgm.js
// BGM retrô suave na página inicial (index.html) usando a mesma música do starter.

(function () {
  if (window.__AFK_LANDING_BGM_INIT__) return;
  window.__AFK_LANDING_BGM_INIT__ = true;

  const BGM_PATH = '/sfx/starter-bgm-loop.mp3';

  let bgmAudio = null;
  let bgmStarted = false;

  function removeInteractionListeners() {
    window.removeEventListener('pointerdown', handleFirstInteraction);
    window.removeEventListener('keydown', handleFirstInteraction);
  }

  function tryAutoplay() {
    if (!bgmAudio || bgmStarted) return;
    bgmAudio.play().then(() => {
      bgmStarted = true;
      removeInteractionListeners();
    }).catch((err) => {
      console.warn('[landing-bgm] autoplay bloqueado pelo navegador:', err?.message || err);
      // se bloquear, a gente deixa o fallback de clique/tecla ativo
    });
  }

  function handleFirstInteraction() {
    if (!bgmAudio || bgmStarted) return;
    bgmStarted = true;
    bgmAudio.play().catch(() => {});
    removeInteractionListeners();
  }

  function initBgm() {
    try {
      bgmAudio = new Audio(BGM_PATH);
      bgmAudio.loop = true;
      bgmAudio.volume = 0.35;

      // tenta tocar assim que carregar
      tryAutoplay();

      // fallback se o navegador bloquear o autoplay
      window.addEventListener('pointerdown', handleFirstInteraction);
      window.addEventListener('keydown', handleFirstInteraction);
    } catch (e) {
      console.warn('[landing-bgm] não foi possível iniciar áudio:', e);
    }
  }

  // expõe stop caso você queira parar de fora
  window.AFK_LANDING_BGM = {
    stop() {
      if (!bgmAudio) return;
      try { bgmAudio.pause(); } catch {}
    },
    getAudio() { return bgmAudio; },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBgm);
  } else {
    initBgm();
  }
})();
