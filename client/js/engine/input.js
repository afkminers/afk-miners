// client/js/engine/input.js
(function () {
  const KEYS = new Set();
  const MOUSE = { x: 0, y: 0, clicked: false, lastClickAt: 0 };

  // Direções por tecla
  const MAP = {
    ArrowUp:{x:0,y:-1}, ArrowDown:{x:0,y:1}, ArrowLeft:{x:-1,y:0}, ArrowRight:{x:1,y:0},
    KeyW:{x:0,y:-1}, KeyS:{x:0,y:1}, KeyA:{x:-1,y:0}, KeyD:{x:1,y:0},
    // numpad sem NumLock (ou com): diagonais/cardinais
    Numpad8:{x:0,y:-1}, Numpad2:{x:0,y:1}, Numpad4:{x:-1,y:0}, Numpad6:{x:1,y:0},
    // diagonais continuam mapeadas aqui para getDir(), mas serão ignoradas no getStepIntent()
    Numpad7:{x:-1,y:-1}, Numpad9:{x:1,y:-1}, Numpad1:{x:-1,y:1}, Numpad3:{x:1,y:1},
    // algumas plataformas reportam Home/PageUp/End/PageDown
    Home:{x:-1,y:-1}, PageUp:{x:1,y:-1}, End:{x:-1,y:1}, PageDown:{x:1,y:1},
  };

  function clamp1(n) { return Math.max(-1, Math.min(1, n)); }

  function dirFromKeys() {
    let dx = 0, dy = 0;
    KEYS.forEach(code => { const m = MAP[code]; if (m) { dx += m.x; dy += m.y; } });
    return { x: clamp1(dx), y: clamp1(dy) };
  }

  // ======= NOVO: step cardinal por "tecla pressionada" (um passo por tecla) =======
  // ordem de prioridade de teclas (experiência clássica WASD/setas)
  const CARD_KEYS = [
    'KeyW','ArrowUp','Numpad8',
    'KeyS','ArrowDown','Numpad2',
    'KeyA','ArrowLeft','Numpad4',
    'KeyD','ArrowRight','Numpad6',
  ];
  const _pressedEdge = new Set();

  function _edgeDown(code) {
    if (!KEYS.has(code)) return false;     // tecla não está pressionada
    if (_pressedEdge.has(code)) return false; // já consumimos o "down" desta tecla
    _pressedEdge.add(code);
    return true;
  }

  function _onKeyUp(code) {
    _pressedEdge.delete(code); // libera para detectar um novo "down" no futuro
  }

  const Input = {
    attach(el = window, canvasEl = null) {
      el.addEventListener('keydown', e => { KEYS.add(e.code); });
      el.addEventListener('keyup',   e => { KEYS.delete(e.code); _onKeyUp(e.code); });
      (canvasEl || el).addEventListener('mousemove', e => {
        MOUSE.x = e.clientX; MOUSE.y = e.clientY;
      });
      (canvasEl || el).addEventListener('mousedown', e => {
        if (e.button === 0) { MOUSE.clicked = true; MOUSE.lastClickAt = performance.now(); }
      });
      (canvasEl || el).addEventListener('mouseup', e => { if (e.button === 0) MOUSE.clicked = false; });
    },

    // Movimento contínuo legado (continua disponível)
    getDir() { return dirFromKeys(); },

    // >>> NOVO: retorna UMA direção cardinal (x,y) quando alguma tecla entra em "down"
    // Ignora diagonais (Numpad7/9/1/3, Home/PageUp/End/PageDown) para andar 1 SQM por vez.
    getStepIntent() {
      for (const code of CARD_KEYS) {
        if (_edgeDown(code)) {
          const m = MAP[code];
          if (m && (m.x === 0 || m.y === 0)) return { x: m.x, y: m.y };
        }
      }
      return null;
    },

    getMouse() { return { ...MOUSE }; },
    consumeClick() { const c = MOUSE.clicked; MOUSE.clicked = false; return c; },
  };

  window.Input = Input;
})();
