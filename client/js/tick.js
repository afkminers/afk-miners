// client/js/tick.js
// Poll consolidado do /api/game/tick com suporte a sinceChatId incremental
// Emite eventos customizados para integração sem acoplamento forte.
// Evita múltiplas instâncias usando flag global.

(function () {
  if (window.__GAME_TICK_ACTIVE__) return;
  window.__GAME_TICK_ACTIVE__ = true;

  const POLL_INTERVAL_MS =
    Number(window.GAME_TICK_INTERVAL_MS || 1800); // pode sobrescrever antes de carregar este script

  let lastChatCursor = 0;
  let running = true;
  let inFlight = false;

  // Expor API leve
  window.GameTick = {
    pause() { running = false; },
    resume() { if (!running) { running = true; tickOnce(); } },
    getChatCursor() { return lastChatCursor; }
  };

  async function tickOnce() {
    if (!running || inFlight) return;
    inFlight = true;
    try {
      const qs = lastChatCursor > 0 ? `?sinceChatId=${lastChatCursor}` : '';
      const r = await fetch(`/api/game/tick${qs}`, {
        credentials: 'include',
        headers: { 'Accept': 'application/json' },
        cache: 'no-store'
      });
      if (r.status === 401) {
        console.warn('[tick] 401 (sessão perdida) — parando polling.');
        running = false;
        return;
      }
      if (!r.ok) {
        console.warn('[tick] resposta não OK:', r.status);
        return;
      }
      const data = await r.json();

      // Atualiza cursor
      if (Number.isFinite(data.chatCursor) && data.chatCursor > lastChatCursor) {
        lastChatCursor = data.chatCursor;
      }

      // Eventos granulares
      try { window.dispatchEvent(new CustomEvent('tick:full', { detail: data })); } catch {}
      if (data.hero) {
        try { window.dispatchEvent(new CustomEvent('tick:hero', { detail: data.hero })); } catch {}
      }
      if (Array.isArray(data.chat) && data.chat.length > 0) {
        try {
          window.dispatchEvent(new CustomEvent('tick:chat:append', { detail: data.chat }));
        } catch {}
      }
      if (data.pos) {
        try { window.dispatchEvent(new CustomEvent('tick:pos', { detail: data.pos })); } catch {}
      }
      if (Array.isArray(data.loot)) {
        try { window.dispatchEvent(new CustomEvent('tick:loot', { detail: data.loot })); } catch {}
      }
      if (Array.isArray(data.combat)) {
        try { window.dispatchEvent(new CustomEvent('tick:combat', { detail: data.combat })); } catch {}
      }
      if (Array.isArray(data.backpack)) {
        try { window.dispatchEvent(new CustomEvent('tick:backpack', { detail: data.backpack })); } catch {}
      }

    } catch (e) {
      console.warn('[tick] erro:', e && e.message);
    } finally {
      inFlight = false;
      if (running) {
        setTimeout(tickOnce, POLL_INTERVAL_MS);
      }
    }
  }

  // Primeiro disparo com pequeno delay (evita competir com outras inicializações)
  setTimeout(tickOnce, 400);
})();