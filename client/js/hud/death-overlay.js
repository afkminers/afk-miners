// client/js/hud/death-overlay.js
import { onMessage } from '../ws/singleton.js';
import { apiPost, getCsrf } from '../api.js';

(function () {
  // Estado global simples
  const state = {
    dead: false,
    heroId: null,
    respawnAt: null,
    timerHandle: null,
  };

  // CSS injetado (sem depender de outro arquivo)
  const CSS = `
  .death-overlay {
    position: fixed; inset: 0; z-index: 9999;
    display: none; align-items: center; justify-content: center;
    background: rgba(5,5,10,0.88); color: #fff; font-family: Inter, system-ui, Arial, sans-serif;
    backdrop-filter: blur(2px);
  }
  .death-card {
    width: min(520px, 92vw); padding: 24px 22px; border-radius: 16px;
    background: linear-gradient(180deg, rgba(20,20,30,0.85), rgba(10,10,15,0.85));
    border: 1px solid rgba(255,255,255,0.08);
    box-shadow: 0 20px 70px rgba(0,0,0,0.45);
    text-align: center;
  }
  .death-title {
    font-size: 28px; letter-spacing: 1px; font-weight: 800; margin: 2px 0 10px;
    color: #ff5a5a; text-shadow: 0 1px 0 #000;
  }
  .death-sub { font-size: 14px; opacity: .85; margin-bottom: 16px; }
  .death-count {
    font-size: 40px; font-weight: 800; letter-spacing: 2px; margin: 12px 0 18px;
    color: #ffd37a; text-shadow: 0 2px 0 #000;
  }
  .death-actions { display: flex; gap: 10px; justify-content: center; }
  .death-btn {
    appearance: none; border: none; border-radius: 12px; padding: 12px 18px; cursor: pointer;
    font-weight: 700; transition: transform .06s ease, opacity .2s ease, box-shadow .2s ease;
  }
  .death-btn:active { transform: translateY(1px); }
  .death-btn-primary {
    background: #3ee07d; color: #0b2415;
    box-shadow: 0 8px 24px rgba(62,224,125,0.28);
  }
  .death-btn-secondary {
    background: #303344; color: #e6e9f2;
  }
  .death-note {
    font-size: 12px; opacity: .65; margin-top: 14px;
  }
  `;

  // Monta DOM uma vez
  function ensureDom() {
    if (document.getElementById('death-overlay')) return;

    // CSS
    const tag = document.createElement('style');
    tag.id = 'death-overlay-style';
    tag.textContent = CSS;
    document.head.appendChild(tag);

    // Overlay
    const root = document.createElement('div');
    root.id = 'death-overlay';
    root.className = 'death-overlay';
    root.innerHTML = `
      <div class="death-card">
        <div class="death-title">YOU ARE DEAD</div>
        <div class="death-sub">Seu herói foi derrotado. Você pode aguardar o respawn automático ou reviver agora.</div>
        <div class="death-count" id="death-count">—</div>
        <div class="death-actions">
          <button class="death-btn death-btn-primary" id="death-revive">Revive</button>
          <button class="death-btn death-btn-secondary" id="death-stay">Aguardar</button>
        </div>
        <div class="death-note">Durante a morte, movimento/ataque e interações ficam bloqueados.</div>
      </div>
    `;
    document.body.appendChild(root);

    // Botões
    root.querySelector('#death-revive').addEventListener('click', onClickRevive);
    root.querySelector('#death-stay').addEventListener('click', () => {
      // Apenas mantém a tela, sem fechar. (Auto-respawn chegará pelo WS)
    });

    // Bloqueio de input enquanto ativo (sem atrapalhar F5/DevTools)
    const allowKeys = new Set(['F5', 'F12', 'Escape']);
    const blockInput = (e) => {
      if (!state.dead) return;
      // Deixa clicar nos botões da própria overlay
      const root = document.getElementById('death-overlay');
      if (root && root.contains(e.target)) return;
      // Bloqueia
      e.stopPropagation();
      e.preventDefault();
    };
    // Mouse/Touch
    root.addEventListener('click', blockInput, true);
    document.addEventListener('mousedown', blockInput, true);
    document.addEventListener('touchstart', blockInput, { capture: true, passive: false });
    // Teclado
    document.addEventListener('keydown', (e) => {
      if (!state.dead) return;
      if (allowKeys.has(e.key)) return;
      e.stopPropagation();
      e.preventDefault();
    }, true);
  }

  function showOverlay() {
    ensureDom();
    const el = document.getElementById('death-overlay');
    el.style.display = 'flex';
    document.body.style.pointerEvents = 'auto';
    state.dead = true;
    window.__HERO_DEAD = true;
    window.dispatchEvent(new CustomEvent('hero:dead', { detail: { heroId: state.heroId } }));
    // Para ataques automáticos, se estiverem rodando
    try { window.CombatActions?.stopAttack?.(); } catch {}
  }

  function hideOverlay() {
    const el = document.getElementById('death-overlay');
    if (el) el.style.display = 'none';
    state.dead = false;
    window.__HERO_DEAD = false;
    window.dispatchEvent(new CustomEvent('hero:revived', { detail: { heroId: state.heroId } }));
  }

  function updateCountdown() {
    const box = document.getElementById('death-count');
    if (!box) return;

    if (!state.respawnAt) { box.textContent = '—'; return; }
    const leftMs = Math.max(0, state.respawnAt - Date.now());
    const s = Math.ceil(leftMs / 1000);
    if (s <= 0) {
      box.textContent = 'Respawning...';
      return;
    }
    box.textContent = `Respawn em ${s}s`;
  }

  function startTimer() {
    stopTimer();
    updateCountdown();
    state.timerHandle = setInterval(updateCountdown, 250);
  }
  function stopTimer() {
    if (state.timerHandle) clearInterval(state.timerHandle);
    state.timerHandle = null;
  }

  async function onClickRevive() {
    if (!state.heroId) return;
    try {
      await getCsrf().catch(()=>{});
      const r = await apiPost('/api/combat/revive', { heroId: state.heroId });
      if (r?.ok) {
        // O servidor já vai emitir pos_snap_hero + hero_respawn,
        // mas escondemos na hora pra sensação de responsividade.
        hideOverlay();
      } else {
        alert(r?.error || 'Revive falhou');
      }
    } catch (e) {
      console.warn('[revive] erro:', e?.message || e);
      alert('Revive falhou');
    }
  }

  // ==== WS bindings ====
  onMessage('hero_dead', (msg) => {
    state.heroId = String(msg.heroId);
    state.respawnAt = Number(msg.respawnAt || (Date.now() + (msg.respawnMs || 5000)));
    showOverlay();
    startTimer();
  });

  onMessage('hero_respawn', (msg) => {
    // Segurança: só fecha se for o mesmo herói
    if (!state.heroId || String(msg.heroId) === String(state.heroId)) {
      stopTimer();
      hideOverlay();
    }
  });

  // Garantia: se o servidor mandar um snap de posição após revive automático, também fechamos
  onMessage('pos_snap_hero', (msg) => {
    if (!state.heroId || String(msg.heroId) === String(state.heroId)) {
      stopTimer();
      hideOverlay();
    }
  });

  // Expor helper
  window.DeathHUD = {
    isDead: () => !!state.dead,
    showOverlay, hideOverlay
  };
})();
