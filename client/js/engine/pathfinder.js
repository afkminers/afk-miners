// client/js/engine/pathfinder.js
(function () {
  // A* em grid ortogonal (N/S/L/O). 1 = bloqueado, 0 = livre.
  class AStarGrid {
    constructor(grid, cols, rows) {
      this.grid = grid;
      this.cols = cols;
      this.rows = rows;
    }

    isBlocked(cx, cy) {
      if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return true;
      return this.grid[cy * this.cols + cx] === 1;
    }

    // Apenas 4 vizinhos cardinais (sem diagonal).
    neighbors(cx, cy) {
      const res = [];
      const cand = [
        { x: cx + 1, y: cy,     cost: 1 },
        { x: cx - 1, y: cy,     cost: 1 },
        { x: cx,     y: cy + 1, cost: 1 },
        { x: cx,     y: cy - 1, cost: 1 },
      ];
      for (const n of cand) {
        if (!this.isBlocked(n.x, n.y)) res.push(n);
      }
      return res;
    }

    // Heurística Manhattan (coerente com movimento cardinal)
    heuristic(ax, ay, bx, by) {
      return Math.abs(ax - bx) + Math.abs(ay - by);
    }

    findPath(start, goal, maxIter = 4000) {
      const sx = start.x | 0, sy = start.y | 0;
      const gx = goal.x  | 0, gy = goal.y  | 0;

      // destino inválido
      if (this.isBlocked(gx, gy)) return null;

      const open = new MinHeap();
      const came = new Map();    // key -> key do anterior
      const gScore = new Map();  // key -> custo g

      const key = (x, y) => `${x},${y}`;
      const startKey = key(sx, sy);

      gScore.set(startKey, 0);
      open.push({ x: sx, y: sy, f: this.heuristic(sx, sy, gx, gy) });

      let iter = 0;
      while (!open.empty() && iter++ < maxIter) {
        const cur = open.pop(); // menor f

        if (cur.x === gx && cur.y === gy) {
          // reconstrói caminho
          const path = [];
          let ck = key(gx, gy);
          while (ck !== startKey) {
            const [cx, cy] = ck.split(',').map(Number);
            path.push({ x: cx, y: cy });
            ck = came.get(ck);
            if (!ck) break; // segurança
          }
          path.reverse();
          return path;
        }

        const curKey = key(cur.x, cur.y);
        const gCur = gScore.get(curKey) ?? Infinity;

        for (const nb of this.neighbors(cur.x, cur.y)) {
          const nk = key(nb.x, nb.y);
          const tentative = gCur + nb.cost;
          if (tentative < (gScore.get(nk) ?? Infinity)) {
            came.set(nk, curKey);
            gScore.set(nk, tentative);
            const f = tentative + this.heuristic(nb.x, nb.y, gx, gy);
            open.push({ x: nb.x, y: nb.y, f });
          }
        }
      }
      return null; // não encontrou (ou estourou iterações)
    }
  }

  class MinHeap {
    constructor() { this.a = []; }
    empty() { return this.a.length === 0; }
    push(n) { this.a.push(n); this._bubble(this.a.length - 1); }
    pop() {
      if (this.a.length === 1) return this.a.pop();
      const top = this.a[0];
      this.a[0] = this.a.pop();
      this._sink(0);
      return top;
    }
    _bubble(i) {
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (this.a[p].f <= this.a[i].f) break;
        [this.a[p], this.a[i]] = [this.a[i], this.a[p]];
        i = p;
      }
    }
    _sink(i) {
      for (;;) {
        let l = i * 2 + 1, r = l + 1, s = i;
        if (l < this.a.length && this.a[l].f < this.a[s].f) s = l;
        if (r < this.a.length && this.a[r].f < this.a[s].f) s = r;
        if (s === i) break;
        [this.a[i], this.a[s]] = [this.a[s], this.a[i]];
        i = s;
      }
    }
  }

  window.AStarGrid = AStarGrid;
})();
