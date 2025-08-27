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

  const Input = {
    attach(el = window, canvasEl = null) {
      el.addEventListener('keydown', e => { KEYS.add(e.code); });
      el.addEventListener('keyup',   e => { KEYS.delete(e.code); });
      (canvasEl || el).addEventListener('mousemove', e => {
        MOUSE.x = e.clientX; MOUSE.y = e.clientY;
      });
      (canvasEl || el).addEventListener('mousedown', e => {
        if (e.button === 0) { MOUSE.clicked = true; MOUSE.lastClickAt = performance.now(); }
      });
      (canvasEl || el).addEventListener('mouseup', e => { if (e.button === 0) MOUSE.clicked = false; });
    },
    getDir() { return dirFromKeys(); },
    getMouse() { return { ...MOUSE }; },
    consumeClick() { const c = MOUSE.clicked; MOUSE.clicked = false; return c; },
  };

  window.Input = Input;
})();
