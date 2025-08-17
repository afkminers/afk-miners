// client/js/login_fx.js
// Efeitos de login para a sua DOM atual (#authDecor + .char.left/.right + #authParticles).
// Usa um único canvas full-screen e calcula a ponta do cajado pela posição da <img> na tela.

// API pública usada no boot.js
export function initLoginFx(){ LoginFX.start(); }
export function stopLoginFx(){ LoginFX.stop(); }
export function celebrate(){ LoginFX.celebrate(); }

/* =================== CONFIG =================== */
/** Coordenadas da ponta do cajado em FRAÇÕES (0..1) do retângulo da imagem .char */
const STAFF_TIP = {
  // Ajuste estes dois números até alinhar com a ponta do cajado do mago (arkan2.png)
  // x é a fração da largura; y é a fração da altura
  left : { x: 0.74, y: 0.19 },   // <<<<< ajuste fino aqui
  // se quiser efeito do lado direito (se houver mascote), ajuste também:
  right: { x: 0.45, y: 0.20 },
};

// Ative temporariamente para ver um alvo (retículo) em cima da ponta:
const DEBUG = false;
/* ============================================== */

const LoginFX = (() => {
  let on = false, raf = 0, W = 0, H = 0, DPR = 1;
  let parts = [];
  let tick = 0;

  let canvas, ctx, charL, charR;

  function sel(){
    canvas = document.getElementById('authParticles');
    if(!canvas) return false;
    ctx = canvas.getContext('2d', { alpha:true });
    charL = document.querySelector('#authDecor .char.left');
    charR = document.querySelector('#authDecor .char.right');
    return true;
  }

  function resize(){
    if(!canvas) return;
    const r = canvas.getBoundingClientRect();
    DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    W = Math.max(1, Math.floor(r.width  * DPR));
    H = Math.max(1, Math.floor(r.height * DPR));
    canvas.width = W; canvas.height = H;
  }

  function toCanvasXYFromChar(el, frac){
    // pega o retângulo da imagem na viewport e converte a fração (0..1) para coordenada do canvas
    const r = el.getBoundingClientRect();
    const xCss = r.left + (frac.x * r.width);
    const yCss = r.top  + (frac.y * r.height);
    return { x: xCss * DPR, y: yCss * DPR };
  }

  function px(x, y, s=2, col='#fff'){
    ctx.fillStyle = col;
    ctx.fillRect(Math.round(x), Math.round(y), s, s);
  }

  function spawnBurst(n, x, y){
    for(let i=0;i<n;i++){
      parts.push({
        x, y,
        vx: (Math.random()-.5)*1.6,
        vy: -(0.9 + Math.random()*1.4),
        life: 26 + Math.random()*26,
        s: (Math.random()<.22)?3:2,
        col: (Math.random()<.6)?'#ffd36c':'#fff',
      });
    }
  }

  function spawnTick(x, y){
    // faíscas “fixas” e fumacinha (pixel) saindo
    if(Math.random()<.65){
      parts.push({
        x: x + (Math.random()-.5)*6,
        y: y + (Math.random()-.5)*4,
        vx:(Math.random()-.5)*0.7,
        vy:- (0.5 + Math.random()*1.0),
        life: 14 + Math.random()*18,
        s: 2,
        col: (Math.random()<.7)?'#ffd36c':'#fff',
      });
    }
    if(Math.random()<.16){
      parts.push({
        x, y,
        vx:(Math.random()-.5)*0.35,
        vy:- (0.18 + Math.random()*0.5),
        life: 26 + Math.random()*18,
        s: 3,
        col: 'rgba(255,255,255,0.15)',
      });
    }
  }

  function drawDebugCross(p){
    ctx.strokeStyle = 'rgba(255,60,60,.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(p.x)-6, Math.round(p.y));
    ctx.lineTo(Math.round(p.x)+6, Math.round(p.y));
    ctx.moveTo(Math.round(p.x), Math.round(p.y)-6);
    ctx.lineTo(Math.round(p.x), Math.round(p.y)+6);
    ctx.stroke();
  }

  function loop(){
    raf = requestAnimationFrame(loop);
    ctx.clearRect(0,0,W,H);
    tick++;

    // ponta do cajado (esquerda)
    if(charL){
      const tipL = toCanvasXYFromChar(charL, STAFF_TIP.left);
      spawnTick(tipL.x, tipL.y);
      if((tick % 28) === 0) spawnBurst(10, tipL.x, tipL.y);
      if(DEBUG) drawDebugCross(tipL);
    }

    // direita (opcional)
    if(charR){
      const tipR = toCanvasXYFromChar(charR, STAFF_TIP.right);
      spawnTick(tipR.x, tipR.y);
      if((tick % 36) === 0) spawnBurst(8, tipR.x, tipR.y);
      if(DEBUG) drawDebugCross(tipR);
    }

    // atualiza e desenha partículas
    for(let i=parts.length-1;i>=0;i--){
      const p = parts[i];
      p.x += p.vx; p.y += p.vy; p.life--;
      if(p.life <= 0 || p.y < -8 || p.x < -8 || p.x > (W+8)){ parts.splice(i,1); continue; }
      px(p.x, p.y, p.s, p.col);
    }
  }

  function start(){
    if(on) return;
    if(!sel()) return;
    on = true;
    resize();
    window.addEventListener('resize', resize);
    loop();
  }
  function stop(){
    if(!on) return;
    on = false;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    parts.length = 0;
    if(ctx) ctx.clearRect(0,0,W,H);
  }

  function celebrate(){
    if(!canvas) return;
    const x = (W/2), y = (H*0.35);
    spawnBurst(24, x, y);
  }

  return { start, stop, celebrate };
})();
