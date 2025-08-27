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
      this._accumMoved = 0; // pixels desde último save
    }
    setCollision(grid, cols, rows) { this.coll = grid; this.cols=cols; this.rows=rows; }
    setPosition(x, y) { this.x = x; this.y = y; }
    getPosition() { return { x: this.x, y: this.y }; }

    // seta um caminho de tiles (A*)
    followPath(path) {
      this.path = path; this.pathIdx = 0;
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
        if (Math.hypot(this.x-tx, this.y-ty) < 2) this.pathIdx++;
        if (this.pathIdx >= this.path.length) this.path = null;
      } else if (dir && (dir.x || dir.y)) {
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
        this._accumMoved += Math.hypot(dx*spd*dt, dy*spd*dt);
        if (this.onMoved && this._accumMoved >= 64) { // autosave após ~64px
          this._accumMoved = 0; this.onMoved(this.x, this.y);
        }
      }
      return moved;
    }
  }

  window.PlayerController = PlayerController;
})();
