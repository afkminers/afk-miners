// client/js/engine/player_controller.js
(function () {
  const TILE = 32;

  class PlayerController {
    constructor({ speed = 120, collisionGrid = null, cols = 0, rows = 0, onMoved = null }) {
      this.x = 0; this.y = 0;
      this.speed = speed;
      this.vx = 0; this.vy = 0;
      this.cols = cols; this.rows = rows;
      this.coll = collisionGrid;          // Uint8Array (1=sólido, 0=livre)
      this.path = null;                   // caminho de tiles [{x,y}, ...]
      this.pathIdx = 0;
      this.onMoved = onMoved;             // callback (ex.: publishPos)
      this._accumMoved = 0;               // pixels desde o último autosave (modo contínuo)

      this._dynamicBlocker = null;        // função (cx, cy) => true se houver bloqueio dinâmico

      // ====== STEP MODE (WASD — um tile por vez) ======
      this._moving = false;               // está executando um passo de tile?
      this._stepTarget = null;            // { x, y } centro do próximo tile
      this._pendingStep = null;           // reservado p/ fila futura
    }

    setCollision(grid, cols, rows) { this.coll = grid; this.cols = cols; this.rows = rows; }
    setDynamicBlockChecker(fn) { this._dynamicBlocker = (typeof fn === 'function') ? fn : null; }
    setPosition(x, y) { this.x = x; this.y = y; }
    getPosition() { return { x: this.x, y: this.y }; }

    _snap(v) { return Math.round(v); }
    // Centro exato do tile (simétrico em X e Y)
    _centerOf(cx, cy) { return { x: cx * TILE + TILE / 2, y: cy * TILE + TILE / 2 }; }

    // Define um caminho de tiles (A*)
    followPath(path) {
      this.path = Array.isArray(path) ? path.slice() : null;
      this.pathIdx = 0;
      // cancela qualquer step manual em andamento para priorizar o path
      this._moving = false; this._stepTarget = null; this._pendingStep = null;
    }

    // retorna true se a célula (cx, cy) é sólida
    isBlockedCell(cx, cy) {
      if (!Number.isFinite(this.cols) || !Number.isFinite(this.rows) || this.cols <= 0 || this.rows <= 0) {
        return !!(this._dynamicBlocker && this._dynamicBlocker(cx, cy));
      }
      if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return true;
      if (this.coll && this.coll[cy * this.cols + cx] === 1) return true;
      if (this._dynamicBlocker && this._dynamicBlocker(cx, cy)) return true;
      return false;
    }

    // AABB simples: ocupa 1 tile “central”; pode refinar com bbox se quiser
    tryMove(nx, ny) {
      const cx = Math.floor(nx / TILE);
      const cy = Math.floor(ny / TILE);
      if (this.isBlockedCell(cx, cy)) return { x: this.x, y: this.y, blocked: true };
      return { x: nx, y: ny, blocked: false };
    }

    // Solicita um passo cardinal (dir: {x:-1|0|1, y:-1|0|1} com |x|+|y| = 1)
    requestStep(dir) {
      if (!dir || (dir.x && dir.y)) return; // ignora diagonal
      if (this.path) return;                // se está seguindo path, ignora input manual
      if (this._moving) return;             // já executando um passo

      // célula atual e alvo
      const ccx = Math.floor(this.x / TILE), ccy = Math.floor(this.y / TILE);
      const nx = ccx + (dir.x || 0);
      const ny = ccy + (dir.y || 0);
      if (this.isBlockedCell(nx, ny)) return; // passo inválido

      const c = this._centerOf(nx, ny);
      this._stepTarget = { x: c.x, y: c.y };
      this._moving = true;
    }

    // dt em segundos; dir = {x:-1..1, y:-1..1} (contínuo legado)
    update(dt, dir) {
      let dx = 0, dy = 0;
      let maxDist = Infinity;

      // ------ Caminho (A*): chegar ao centro de CADA tile e publicar ------
      if (this.path && this.pathIdx < this.path.length) {
        const node = this.path[this.pathIdx];
        const { x: tx, y: ty } = this._centerOf(node.x, node.y);

        const vx = tx - this.x, vy = ty - this.y;
        const dist = Math.hypot(vx, vy);
        if (dist <= 1.0) {
          // chegou ao centro deste tile: snap + publica + próximo nó
          this.x = this._snap(tx);
          this.y = this._snap(ty);
          if (this.onMoved) this.onMoved(this.x, this.y);
          this.pathIdx++;
          if (this.pathIdx >= this.path.length) this.path = null;
          return true; // já processou este frame
        }

        dx = vx / (dist || 1);
        dy = vy / (dist || 1);
        maxDist = dist;

      // ------ Step único (WASD) ------
      } else if (this._moving && this._stepTarget) {
        const vx = this._stepTarget.x - this.x;
        const vy = this._stepTarget.y - this.y;
        const dist = Math.hypot(vx, vy);
        if (dist <= 1.0) {
          // chegou ao centro do tile alvo: snap + publica
          this.x = this._snap(this._stepTarget.x);
          this.y = this._snap(this._stepTarget.y);
          this._moving = false; this._stepTarget = null;
          if (this.onMoved) this.onMoved(this.x, this.y);
          return true;
        }
        dx = vx / (dist || 1);
        dy = vy / (dist || 1);
        maxDist = dist;

      // ------ Contínuo legado (apenas se ninguém chamou requestStep e não há path) ------
      } else if (dir && (dir.x || dir.y)) {
        dx = dir.x; dy = dir.y;
        // normaliza diagonal
        const n = (dx && dy) ? Math.SQRT1_2 : 1;
        dx *= n; dy *= n;

      } else {
        this.vx = this.vy = 0;
        return false;
      }

      // Integra movimento com colisão
      const spd = this.speed;
      const step = spd * dt;
      const moveDist = Number.isFinite(maxDist) ? Math.min(step, maxDist) : step;
      const nx = this.x + dx * moveDist;
      const ny = this.y + dy * moveDist;

      const res = this.tryMove(nx, ny);
      const moved = (res.x !== this.x || res.y !== this.y);
      this.x = res.x; this.y = res.y;

      if (moved) {
        // Em STEP ou PATH, quem dispara onMoved é o “chegar ao centro”.
        // No contínuo, mantém autosave por ~64px:
        if (!this._moving && !this.path) {
          this._accumMoved += Math.hypot(dx * spd * dt, dy * spd * dt);
          if (this.onMoved && this._accumMoved >= 64) {
            this._accumMoved = 0;
            this.onMoved(this.x, this.y);
          }
        }
      }
      return moved;
    }
  }

  window.PlayerController = PlayerController;
})();
