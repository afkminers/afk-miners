// client/js/engine/input.js
// ES Module com export nomeado { Input } e default.
// Mantém compat: também expõe window.Input quando no browser.

const KEYS = new Set();
const MOUSE = { x: 0, y: 0, clicked: false, lastClickAt: 0 };

// Direções por tecla
const MAP = {
  ArrowUp:   { x: 0,  y: -1 }, ArrowDown: { x: 0,  y: 1  },
  ArrowLeft: { x: -1, y: 0  }, ArrowRight:{ x: 1,  y: 0  },
  KeyW:      { x: 0,  y: -1 }, KeyS:      { x: 0,  y: 1  },
  KeyA:      { x: -1, y: 0  }, KeyD:      { x: 1,  y: 0  },

  // numpad
  Numpad8:   { x: 0,  y: -1 }, Numpad2:   { x: 0,  y: 1  },
  Numpad4:   { x: -1, y: 0  }, Numpad6:   { x: 1,  y: 0  },
  // diagonais (suportadas em getDir, ignoradas em getStepIntent)
  Numpad7:   { x: -1, y: -1 }, Numpad9:   { x: 1,  y: -1 },
  Numpad1:   { x: -1, y: 1  }, Numpad3:   { x: 1,  y: 1  },

  // algumas plataformas
  Home:      { x: -1, y: -1 }, PageUp:    { x: 1,  y: -1 },
  End:       { x: -1, y: 1  }, PageDown:  { x: 1,  y: 1  },
};

function clamp1(n) { return Math.max(-1, Math.min(1, n)); }

function dirFromKeys() {
  let dx = 0, dy = 0;
  KEYS.forEach(code => { const m = MAP[code]; if (m) { dx += m.x; dy += m.y; } });
  return { x: clamp1(dx), y: clamp1(dy) };
}

// ===== Step cardinal (um passo por tecla) =====
const CARD_KEYS = [
  'KeyW','ArrowUp','Numpad8',
  'KeyS','ArrowDown','Numpad2',
  'KeyA','ArrowLeft','Numpad4',
  'KeyD','ArrowRight','Numpad6',
];

// segura quando não há window (ex.: testes)
const STEP_REPEAT_MS = Number(((typeof window !== 'undefined' && window.ENV?.STEP_REPEAT_MS) || 160));
const _stepState = new Map(); // code -> { down, first, lastAt }

function _ensureStepState(code) {
  let st = _stepState.get(code);
  if (!st) { st = { down: false, first: false, lastAt: 0 }; _stepState.set(code, st); }
  return st;
}

function _onKeyDown(code) {
  const st = _ensureStepState(code);
  if (!st.down) { st.down = true; st.first = true; st.lastAt = 0; }
}

function _onKeyUp(code) {
  const st = _ensureStepState(code);
  st.down = false; st.first = false; st.lastAt = 0;
}

let _attached = false;

const Input = {
  attach(el = (typeof window !== 'undefined' ? window : undefined), canvasEl = null) {
    if (!el || _attached) return;
    _attached = true;

    el.addEventListener('keydown', e => { KEYS.add(e.code); _onKeyDown(e.code); });
    el.addEventListener('keyup',   e => { KEYS.delete(e.code); _onKeyUp(e.code); });

    const target = (canvasEl || el);
    target.addEventListener('mousemove', e => { MOUSE.x = e.clientX; MOUSE.y = e.clientY; });
    target.addEventListener('mousedown', e => {
      if (e.button === 0) { MOUSE.clicked = true; MOUSE.lastClickAt = (typeof performance !== 'undefined' ? performance.now() : Date.now()); }
    });
    target.addEventListener('mouseup', e => { if (e.button === 0) MOUSE.clicked = false; });
  },

  // Movimento contínuo legado (mantido)
  getDir() { return dirFromKeys(); },

  // Retorna UMA direção cardinal quando tecla entra em "down" ou no repeat.
  // Diagonais são ignoradas aqui (andar 1 SQM por vez).
  getStepIntent() {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    for (const code of CARD_KEYS) {
      const m = MAP[code];
      if (!m || (m.x && m.y)) continue; // ignora diagonais
      const st = _stepState.get(code);
      if (!st || !st.down) continue;

      if (st.first) {
        st.first = false; st.lastAt = now;
        return { x: m.x, y: m.y };
      }
      if ((now - st.lastAt) >= STEP_REPEAT_MS) {
        st.lastAt = now;
        return { x: m.x, y: m.y };
      }
    }
    return null;
  },

  getMouse() { return { ...MOUSE }; },
  consumeClick() { const c = MOUSE.clicked; MOUSE.clicked = false; return c; },
};

// Compat global (debug/fallback)
if (typeof window !== 'undefined') {
  try { window.Input = Input; } catch {}
}

export { Input };
export default Input;
