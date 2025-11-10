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
      console.log('[landing-bgm] autoplay OK');
      bgmStarted = true;
      removeInteractionListeners();
    }).catch((err) => {
      console.warn('[landing-bgm] autoplay bloqueado:', err?.message || err);
      // navegador bloqueou, vamos depender da interação do usuário
    });
  }

  function handleFirstInteraction() {
    if (!bgmAudio || bgmStarted) return;
    bgmStarted = true;
    bgmAudio.play().catch((err) => {
      console.warn('[landing-bgm] play após interação falhou:', err?.message || err);
    });
    removeInteractionListeners();
  }

  function initBgm() {
    try {
      bgmAudio = new Audio(BGM_PATH);
      bgmAudio.loop = true;
      bgmAudio.volume = 0.35;

      console.log('[landing-bgm] inicializado');

      // tenta autoplay na carga
      tryAutoplay();

      // fallback se autoplay for bloqueado
      window.addEventListener('pointerdown', handleFirstInteraction);
      window.addEventListener('keydown', handleFirstInteraction);
    } catch (e) {
      console.warn('[landing-bgm] erro ao iniciar:', e);
    }
  }

  // expõe um stop global caso você queira parar de fora
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
