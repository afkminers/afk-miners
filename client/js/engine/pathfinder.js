// client/js/engine/pathfinder.js
(function () {
  const SQRT2 = Math.SQRT2;

  class AStarGrid {
    // grid: Uint8Array/boolean[][] em que 1 = bloqueado, 0 = livre
    constructor(grid, cols, rows) {
      this.grid = grid; this.cols = cols; this.rows = rows;
    }
    isBlocked(cx, cy) {
      if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return true;
      return this.grid[cy * this.cols + cx] === 1;
    }
    neighbors(cx, cy) {
      const res = [];
      for (let dy=-1; dy<=1; dy++) for (let dx=-1; dx<=1; dx++) {
        if (dx===0 && dy===0) continue;
        const nx = cx+dx, ny = cy+dy;
        if (this.isBlocked(nx, ny)) continue;
        // opcional: “corner cutting” — bloqueia diagonal se vizinhos cardinais forem sólidos
        if (dx!==0 && dy!==0) {
          if (this.isBlocked(cx+dx, cy) || this.isBlocked(cx, cy+dy)) continue;
        }
        const cost = (dx!==0 && dy!==0) ? SQRT2 : 1;
        res.push({ x:nx, y:ny, cost });
      }
      return res;
    }
    heuristic(ax, ay, bx, by) {
      const dx = Math.abs(ax-bx), dy = Math.abs(ay-by);
      // octile distance (melhor pra 8 direções)
      const F = SQRT2 - 1;
      return (dx < dy) ? F*dx + dy : F*dy + dx;
    }
    findPath(start, goal, maxIter=2000) {
      const sx=start.x, sy=start.y, gx=goal.x, gy=goal.y;
      if (this.isBlocked(gx, gy)) return null;

      const open = new MinHeap();
      const came = new Map();
      const gScore = new Map();

      const key = (x,y)=> `${x},${y}`;
      const startKey = key(sx,sy);
      gScore.set(startKey, 0);
      open.push({ x:sx, y:sy, f:this.heuristic(sx,sy,gx,gy) });

      let iter=0;
      while (!open.empty() && iter++ < maxIter) {
        const cur = open.pop(); // menor f
        if (cur.x===gx && cur.y===gy) {
          // reconstrói
          const path = [];
          let ck = key(gx,gy);
          while (ck !== startKey) {
            const [cx, cy] = ck.split(',').map(Number);
            path.push({x:cx, y:cy});
            ck = came.get(ck);
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
            open.push({ x:nb.x, y:nb.y, f });
          }
        }
      }
      return null; // falhou
    }
  }

  class MinHeap {
    constructor(){ this.a=[]; }
    empty(){ return this.a.length===0; }
    push(n){ this.a.push(n); this.bubble(this.a.length-1); }
    pop(){
      if(this.a.length===1) return this.a.pop();
      const top=this.a[0]; this.a[0]=this.a.pop(); this.sink(0); return top;
    }
    bubble(i){ while(i>0){ const p=((i-1)>>1); if(this.a[p].f<=this.a[i].f) break; [this.a[p],this.a[i]]=[this.a[i],this.a[p]]; i=p; } }
    sink(i){ for(;;){ let l=i*2+1, r=l+1, s=i;
      if(l<this.a.length && this.a[l].f<this.a[s].f) s=l;
      if(r<this.a.length && this.a[r].f<this.a[s].f) s=r;
      if(s===i) break; [this.a[i],this.a[s]]=[this.a[s],this.a[i]]; i=s; } }
  }

  window.AStarGrid = AStarGrid;
})();
