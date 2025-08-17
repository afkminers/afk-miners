// js/landing_fx.js
// Camada frontal: glows/partículas nas mãos/cajados dos heróis (igual você já tinha)
// Camada traseira: vento (poeira/rajadas) + trovões ocasionais no céu

// --------------------------- FX FRONTAL (MAGIA) ---------------------------
const FX = (() => {
  let cvs, ctx, DPR = 1, W = 0, H = 0, on = false, raf = 0, t = 0;
  const sparks = [];

  // Âncoras normalizadas (0..1) por imagem
  const anchors = {
    // Zephyr (esquerda) — mão azul e chamas laranja
    L1: { x: 0.26, y: 0.43, hue: 195, r: 96 },
    L2: { x: 0.72, y: 0.62, hue: 30,  r: 102 },

    // Elara (centro) — gema do cajado (esq) e orbe (dir)
    C1: { x: 0.18, y: 0.18, hue: 185, r: 92 },
    C2: { x: 0.72, y: 0.47, hue: 170, r: 98 },

    // Wizard (direita) — orbe do cajado
    R1: { x: 0.21, y: 0.18, hue: 300, r: 98 }
  };

  function sel(){
    cvs = document.getElementById('landingFx');
    if (!cvs) return false;
    ctx = cvs.getContext('2d', { alpha:true });
    return true;
  }
  function resize(){
    if (!cvs) return;
    const r = cvs.getBoundingClientRect();
    DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    W = Math.max(1, Math.floor(r.width * DPR));
    H = Math.max(1, Math.floor(r.height * DPR));
    cvs.width = W; cvs.height = H;
  }
  function imgRect(id){
    const el = document.getElementById(id);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { l: r.left * DPR, t: r.top * DPR, w: r.width * DPR, h: r.height * DPR };
  }
  const fromFrac = (rect,f)=> rect ? { x:rect.l+f.x*rect.w, y:rect.t+f.y*rect.h } : {x:-9999,y:-9999};

  function addSpark(x,y,hue){
    const speed = 0.6 + Math.random()*1.6;
    const spread = 1.2;
    sparks.push({
      x,y,
      vx:(Math.random()-0.5)*1.6*spread,
      vy:-speed,
      life:28+Math.random()*38,
      s:(Math.random()<0.18?3:2),
      hue
    });
  }
  function glow(x,y,r,hue){
    const c1 = `hsla(${hue},95%,65%,0.95)`;
    const c2 = `hsla(${hue},90%,55%,0.45)`;
    const g = ctx.createRadialGradient(x,y,r*0.08,x,y,r);
    g.addColorStop(0,c1); g.addColorStop(0.45,c2); g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.globalCompositeOperation='lighter';
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
    ctx.globalCompositeOperation='source-over';
  }

  function loop(){
    raf = requestAnimationFrame(loop); t++;
    ctx.clearRect(0,0,W,H);

    const rL = imgRect('heroL-img');
    const rC = imgRect('heroC-img');
    const rR = imgRect('heroR-img');

    const pL1 = fromFrac(rL, anchors.L1);
    const pL2 = fromFrac(rL, anchors.L2);
    const pC1 = fromFrac(rC, anchors.C1);
    const pC2 = fromFrac(rC, anchors.C2);
    const pR1 = fromFrac(rR, anchors.R1);

    const jig = (n,amp=3)=> Math.sin((t+n)*0.06)*amp;

    if (rL){ glow(pL1.x+jig(0,2), pL1.y+jig(3,2), anchors.L1.r, anchors.L1.hue);
             glow(pL2.x+jig(7,2), pL2.y+jig(5,2), anchors.L2.r, anchors.L2.hue); }
    if (rC){ glow(pC1.x+jig(4,2), pC1.y+jig(6,2), anchors.C1.r, anchors.C1.hue);
             glow(pC2.x+jig(5,2), pC2.y+jig(8,2), anchors.C2.r, anchors.C2.hue); }
    if (rR){ glow(pR1.x+jig(2,2), pR1.y+jig(9,2), anchors.R1.r, anchors.R1.hue); }

    if (rL){ for(let i=0;i<2;i++) addSpark(pL1.x,pL1.y,anchors.L1.hue);
             for(let i=0;i<2;i++) addSpark(pL2.x,pL2.y,anchors.L2.hue); }
    if (rC){ for(let i=0;i<2;i++) addSpark(pC1.x,pC1.y,anchors.C1.hue);
             for(let i=0;i<2;i++) addSpark(pC2.x,pC2.y,anchors.C2.hue); }
    if (rR){ for(let i=0;i<2;i++) addSpark(pR1.x,pR1.y,anchors.R1.hue); }

    for (let i=sparks.length-1;i>=0;i--){
      const s = sparks[i];
      s.x+=s.vx; s.y+=s.vy; s.life--;
      if (s.life<=0 || s.x<-16 || s.x>W+16 || s.y<-16){ sparks.splice(i,1); continue; }
      const a = Math.max(0, Math.min(1, s.life/34));
      ctx.fillStyle = `hsla(${s.hue},95%,70%,${a})`;
      const r=s.s; ctx.fillRect(Math.round(s.x),Math.round(s.y),r,r);
      ctx.globalAlpha=a*0.28;
      ctx.beginPath(); ctx.arc(s.x,s.y,r*3.1,0,Math.PI*2);
      ctx.fillStyle=`hsla(${s.hue},90%,60%,0.25)`; ctx.fill();
      ctx.globalAlpha=1;
    }
  }

  function start(){ if(on) return; if(!sel()) return; on=true; resize(); window.addEventListener('resize',resize); loop(); }
  function stop(){ if(!on) return; on=false; cancelAnimationFrame(raf); window.removeEventListener('resize',resize); ctx&&ctx.clearRect(0,0,W,H); sparks.length=0; }

  return { start, stop };
})();

// ------------------------ FX TRASEIRO (VENTO + TROVÃO) ------------------------
const FX_BACK = (() => {
  let cvs, ctx, DPR=1, W=0, H=0, on=false, raf=0, t=0;
  const dust = [];    // poeira leve
  const streaks = []; // rajadas
  let lightningTimer = 0;
  let flash = 0;      // brilho global no céu ao dar o raio

  function sel(){
    cvs = document.getElementById('landingFxBack');
    if(!cvs) return false;
    ctx = cvs.getContext('2d', { alpha:true });
    return true;
  }
  function resize(){
    if(!cvs) return;
    const r = cvs.getBoundingClientRect();
    DPR = Math.max(1, Math.min(2, window.devicePixelRatio||1));
    W = Math.max(1, Math.floor(r.width * DPR));
    H = Math.max(1, Math.floor(r.height * DPR));
    cvs.width=W; cvs.height=H;
  }

  // cria partículas iniciais
  function seed(){
    dust.length = 0; streaks.length = 0;
    for(let i=0;i<120;i++){
      dust.push({
        x: Math.random()*W,
        y: H*0.35 + Math.random()*H*0.6,
        vx: -0.25 - Math.random()*0.6,
        vy: -0.05 + Math.random()*0.1,
        a: 0.15 + Math.random()*0.25,
        s: Math.random()<0.15 ? 2 : 1
      });
    }
    for(let i=0;i<12;i++){
      streaks.push({
        x: Math.random()*W,
        y: H*0.45 + Math.random()*H*0.4,
        vx: -1.6 - Math.random()*1.8,
        len: 24 + Math.random()*36,
        a: 0.08 + Math.random()*0.12
      });
    }
    lightningTimer = 240 + Math.random()*300; // ~ a cada 4–9s
  }

  // desenha um raio (zig-zag) no céu
  function drawLightning(){
    // origem aleatória no topo
    const startX = Math.random()*W;
    let x = startX, y = 0;
    const segments = 8 + Math.floor(Math.random()*6);
    const targetY = H*0.35 + Math.random()*H*0.1;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // glow de fundo
    const grad = ctx.createRadialGradient(startX, targetY*0.6, 10, startX, targetY*0.6, W*0.35);
    grad.addColorStop(0, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad; ctx.fillRect(0,0,W,H*0.6);

    // traçado do raio
    ctx.lineWidth = 2.0 * DPR;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath(); ctx.moveTo(x,y);
    for(let i=0;i<segments;i++){
      x += (Math.random()*120 - 60) * DPR;
      y += (targetY - y)/ (segments - i);
      ctx.lineTo(x,y);
    }
    ctx.stroke();

    // corona lilás/azulada
    ctx.lineWidth = 6.0 * DPR;
    ctx.strokeStyle = 'rgba(180,210,255,0.18)';
    ctx.stroke();

    ctx.restore();

    // flash global curto
    flash = 0.45;
  }

  function loop(){
    raf = requestAnimationFrame(loop); t++;
    ctx.clearRect(0,0,W,H);

    // Céu leve piscando quando flash>0
    if (flash>0){
      ctx.fillStyle = `rgba(255,255,255,${flash*0.25})`;
      ctx.fillRect(0,0,W,H*0.55);
      flash *= 0.90;
    }

    // poeira
    ctx.globalCompositeOperation = 'screen';
    for(const p of dust){
      p.x += p.vx; p.y += p.vy;
      if (p.x < -10) { p.x = W + Math.random()*40; p.y = H*0.35 + Math.random()*H*0.6; }
      const a = p.a * (0.6 + 0.4*Math.sin((t+p.x)*0.01));
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(255,215,160,1)'; // amarelado/laranja
      ctx.fillRect(p.x, p.y, p.s, p.s);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // rajadas (streaks)
    ctx.strokeStyle = 'rgba(255,230,180,0.25)';
    ctx.lineWidth = 1 * DPR;
    for(const s of streaks){
      s.x += s.vx;
      if (s.x < -s.len) { s.x = W + Math.random()*120; s.y = H*0.45 + Math.random()*H*0.4; }
      ctx.globalAlpha = s.a;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + s.len, s.y + Math.sin((t+s.y)*0.02)*3);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // temporizador do raio
    lightningTimer--;
    if (lightningTimer <= 0){
      drawLightning();
      lightningTimer = 240 + Math.random()*300;
    }
  }

  function start(){ if(on) return; if(!sel()) return; on=true; resize(); seed(); window.addEventListener('resize',()=>{ resize(); seed(); }); loop(); }
  function stop(){ if(!on) return; on=false; cancelAnimationFrame(raf); ctx&&ctx.clearRect(0,0,W,H); }

  return { start, stop };
})();

// Liga/Desliga conforme a landing está visível (igual ao seu fluxo)
(function wire(){
  const appMain = document.getElementById('appMain');
  const visible = () => appMain && appMain.classList.contains('hidden');

  function sync(){
    if (visible()){ FX_BACK.start(); FX.start(); }
    else { FX_BACK.stop(); FX.stop(); }
  }
  sync();

  document.addEventListener('landing-visibility', (e)=>{
    if (e.detail?.visible){ FX_BACK.start(); FX.start(); }
    else { FX_BACK.stop(); FX.stop(); }
  });

  const obs = new MutationObserver(sync);
  if (appMain) obs.observe(appMain, { attributes:true, attributeFilter:['class'] });
})();
