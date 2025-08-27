// client/js/engine/camera2d.js
// Camera 2D simples com suporte a zoom (escala) e clamp de limites do mundo.
// API: constructor({width,height,worldWidth,worldHeight}), follow(target),
//      setZoom(z), getZoom(), resize(w,h), update(dt), apply(ctx, drawcb)

(function(){
  class Camera2D {
    constructor(opts){
      this.w = Number(opts?.width)  || 800;
      this.h = Number(opts?.height) || 600;
      this.worldW = Number(opts?.worldWidth)  || 5000;
      this.worldH = Number(opts?.worldHeight) || 5000;

      this.x = 0;
      this.y = 0;
      this.zoom = 1;          // escala: 1 = 100%
      this._target = null;    // algo com getPosition(): {x,y}

      this._clamp();
    }

    getZoom(){ return this.zoom; }
    setZoom(z){
      const v = Number(z);
      this.zoom = (Number.isFinite(v) ? Math.min(3, Math.max(0.5, v)) : 1);
      this._clamp();
    }

    resize(w, h){
      if (Number.isFinite(w)) this.w = Math.max(1, Math.floor(w));
      if (Number.isFinite(h)) this.h = Math.max(1, Math.floor(h));
      this._clamp();
    }

    follow(target){ this._target = target || null; }

    // centraliza na posição do alvo
    update(/*dt*/){
      if (!this._target || typeof this._target.getPosition !== 'function') return;
      const p = this._target.getPosition();
      const vw = this.w / this.zoom;
      const vh = this.h / this.zoom;
      this.x = p.x - vw * 0.5;
      this.y = p.y - vh * 0.5;
      this._clamp();
    }

    // aplica transformação e chama drawcb()
    apply(ctx, drawcb){
      ctx.save();
      // aplica escala (zoom) antes da translação do mundo
      ctx.scale(this.zoom, this.zoom);
      ctx.translate(-this.x, -this.y);
      try { drawcb && drawcb(); } finally { ctx.restore(); }
    }

    _clamp(){
      const vw = this.w / this.zoom;
      const vh = this.h / this.zoom;
      // limita para não sair do mundo
      if (this.worldW > vw) {
        this.x = Math.min(Math.max(0, this.x), this.worldW - vw);
      } else {
        // se a viewport for maior que o mundo, deixa no zero
        this.x = 0;
      }
      if (this.worldH > vh) {
        this.y = Math.min(Math.max(0, this.y), this.worldH - vh);
      } else {
        this.y = 0;
      }
    }
  }

  // expõe globalmente (sem modules)
  window.Camera2D = Camera2D;
})();
