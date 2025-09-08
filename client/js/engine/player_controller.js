// client/js/engine/player_controller.js
(function () {
  const TILE = 32;

  class PlayerController {
    constructor({ speed=120, collisionGrid=null, cols=0, rows=0, onMoved=null }) {
      this.x = 0; this.y = 0;
      this.speed = speed;
      this.vx = 0; this.vy = 0;
      this.cols = cols; this.rows = rows;
      this.coll = collisionGrid; // Uint8Array (1=sólido, 0=livre)
      this.path = null; // caminho de tiles [{x,y},...]
      this.pathIdx = 0;
      this.onMoved = onMoved; // callback para autosave
      this._accumMoved = 0; // pixels desde último save (usado só para modo contínuo)

      // ====== STEP MODE (NOVO) ======
      this._moving = false;            // está executando um passo de tile?
      this._stepTarget = null;         // {x,y} centro do próximo tile
      this._pendingStep = null;        // reservado (se quiser enfileirar no futuro)
    }

    setCollision(grid, cols, rows) { this.coll = grid; this.cols=cols; this.rows=rows; }
    setPosition(x, y) { this.x = x; this.y = y; }
    getPosition() { return { x: this.x, y: this.y }; }

    _snap(v) { return Math.round(v); }
    _centerOf(cx, cy) { return { x: cx * TILE + TILE/2, y: cy * TILE/2 + TILE/2 }; } // + TILE/2 para y também
    // (ajuste: manter simetria com x; se preferir, pode voltar ao formato original:
    // { x: cx * TILE + TILE/2, y: cy * TILE + TILE/2 })

    // seta um caminho de tiles (A*)
    followPath(path) {
      this.path = path; this.pathIdx = 0;
      // cancelar qualquer step manual em andamento para priorizar path
      this._moving = false; this._stepTarget = null; this._pendingStep = null;
    }

    // retorna true se célula (cx,cy) é sólida
    isBlockedCell(cx, cy) {
      if (!this.coll) return false;
      if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return true;
      return this.coll[cy * this.cols + cx] === 1;
    }

    // AABB simples: ocupa 1 tile “central”; pode refinar com bbox
    tryMove(nx, ny) {
      const cx = Math.floor(nx / TILE);
      const cy = Math.floor(ny / TILE);
      if (this.isBlockedCell(cx, cy)) return { x:this.x, y:this.y, blocked:true };
      return { x:nx, y:ny, blocked:false };
    }

    // ===== NOVO: solicitar um passo cardinal (dx,dy) onde |dx|+|dy|=1 =====
    requestStep(dir) {
      if (!dir || (dir.x && dir.y)) return; // ignora diagonal
      if (this.path) return;                // se está seguindo path, ignora input manual
      if (this._moving) return;             // já andando um passo

      // calcula célula atual e alvo
      const ccx = Math.floor(this.x / TILE), ccy = Math.floor(this.y / TILE);
      const nx = ccx + (dir.x || 0);
      const ny = ccy + (dir.y || 0);
      if (this.isBlockedCell(nx, ny)) return; // passo inválido

      this._stepTarget = { x: nx * TILE + TILE/2, y: ny * TILE + TILE/2 };
      this._moving = true;
    }

    // dt em segundos; dir = {x:-1..1, y:-1..1}
    update(dt, dir) {
      let dx = 0, dy = 0;

      if (this.path && this.pathIdx < this.path.length) {
        // segue o próximo “tile alvo”
        const t = this.path[this.pathIdx];
        const tx = t.x * TILE + TILE/2;
        const ty = t.y * TILE + TILE/2;
        const vx = tx - this.x, vy = ty - this.y;
        const len = Math.hypot(vx, vy) || 1;
        dx = (vx/len); dy = (vy/len);
        if (Math.hypot(this.x - tx, this.y - ty) < 2) this.pathIdx++;
        if (this.pathIdx >= this.path.length) this.path = null;

      } else if (this._moving && this._stepTarget) {
        // modo STEP: mover até o centro do tile alvo
        const vx = this._stepTarget.x - this.x;
        const vy = this._stepTarget.y - this.y;
        const dist = Math.hypot(vx, vy);
        if (dist <= 1.0) {
          // chegou: snap e libera
          this.x = this._snap(this._stepTarget.x);
          this.y = this._snap(this._stepTarget.y);
          this._moving = false; this._stepTarget = null;
          if (this.onMoved) this.onMoved(this.x, this.y);
          return true;
        }
        dx = vx / (dist || 1);
        dy = vy / (dist || 1);

      } else if (dir && (dir.x || dir.y)) {
        // MODO CONTÍNUO LEGADO (só se ninguém chamou requestStep e não há path)
        dx = dir.x; dy = dir.y;
        // normaliza diagonal
        const n = (dx && dy) ? Math.SQRT1_2 : 1;
        dx *= n; dy *= n;

      } else {
        this.vx = this.vy = 0;
        return false;
      }

      const spd = this.speed;
      const nx = this.x + dx * spd * dt;
      const ny = this.y + dy * spd * dt;

      const res = this.tryMove(nx, ny);
      const moved = (res.x !== this.x || res.y !== this.y);
      this.x = res.x; this.y = res.y;

      if (moved) {
        // Em modo STEP, quem dispara onMoved é a chegada no centro (acima).
        // No contínuo, mantém o autosave por ~64px:
        if (!this._moving) {
          this._accumMoved += Math.hypot(dx * spd * dt, dy * spd * dt);
          if (this.onMoved && this._accumMoved >= 64) { // autosave após ~64px
            this._accumMoved = 0; this.onMoved(this.x, this.y);
          }
        }
      }
      return moved;
    }
  }

  window.PlayerController = PlayerController;
})();
