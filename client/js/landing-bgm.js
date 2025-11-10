// client/js/landing-bgm.js
// BGM retrô suave na página inicial (index.html) usando a mesma música do starter.

(function () {
  if (window.__AFK_LANDING_BGM_INIT__) return;
  window.__AFK_LANDING_BGM_INIT__ = true;

  const BGM_PATH = '/sfx/starter-bgm-loop.mp3';

  let bgmAudio = null;
  let bgmStarted = false;

  function isMuted() {
    // 1 = mutado, 0 ou null = tocando
    return localStorage.getItem('bgm-muted') === '1';
  }

  function setMutedFlag(muted) {
    localStorage.setItem('bgm-muted', muted ? '1' : '0');
  }

  function removeInteractionListeners() {
    window.removeEventListener('pointerdown', handleFirstInteraction);
    window.removeEventListener('keydown', handleFirstInteraction);
  }

  function tryPlay() {
    if (!bgmAudio || bgmStarted) return;
    bgmAudio.play().then(() => {
      console.log('[landing-bgm] play OK');
      bgmStarted = true;
      removeInteractionListeners();
    }).catch((err) => {
      console.warn('[landing-bgm] play bloqueado/autoplay:', err?.message || err);
      // navegador bloqueou, vamos depender da interação do usuário
    });
  }

  function tryAutoplay() {
    if (isMuted()) {
      console.log('[landing-bgm] não toca: bgm-muted=1');
      return;
    }
    tryPlay();
  }

  function handleFirstInteraction() {
    if (!bgmAudio || bgmStarted || isMuted()) return;
    bgmStarted = true;
    bgmAudio.play().catch((err) => {
      console.warn('[landing-bgm] play após interação falhou:', err?.message || err);
    });
    removeInteractionListeners();
  }

  function handleMuteChange(muted) {
    if (!bgmAudio) {
      // garante que o flag persista mesmo antes do áudio existir
      setMutedFlag(muted);
      return;
    }

    setMutedFlag(muted);

    if (muted) {
      try {
        bgmAudio.pause();
        console.log('[landing-bgm] música pausada (mute ON)');
      } catch (e) {
        console.warn('[landing-bgm] erro ao pausar:', e?.message || e);
      }
      bgmStarted = false;
    } else {
      console.log('[landing-bgm] música liberada (mute OFF)');
      // só tenta tocar se ainda não começou
      if (!bgmStarted) {
        tryPlay();
      }
    }
  }

  function initBgm() {
    try {
      bgmAudio = new Audio(BGM_PATH);
      bgmAudio.loop = true;
      bgmAudio.volume = 0.35;

      console.log('[landing-bgm] inicializado');

      // tenta autoplay na carga (se não estiver mutado)
      tryAutoplay();

      // fallback se autoplay for bloqueado
      window.addEventListener('pointerdown', handleFirstInteraction);
      window.addEventListener('keydown', handleFirstInteraction);

      // reage ao evento global vindo do painel de settings (ou de qualquer outro script)
      document.addEventListener('bgm-mute', (ev) => {
        const muted = !!(ev && ev.detail && ev.detail.muted);
        handleMuteChange(muted);
      });

      // se alguém tiver mexido no localStorage antes de carregar esse script,
      // garante que o estado atual seja respeitado
      if (isMuted()) {
        try {
          bgmAudio.pause();
        } catch {}
        bgmStarted = false;
      }
    } catch (e) {
      console.warn('[landing-bgm] erro ao iniciar:', e);
    }
  }

  // expõe um stop global caso você queira parar de fora
  window.AFK_LANDING_BGM = {
    stop() {
      if (!bgmAudio) return;
      try { bgmAudio.pause(); } catch {}
      bgmStarted = false;
    },
    getAudio() { return bgmAudio; },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBgm);
  } else {
    initBgm();
  }
})();
