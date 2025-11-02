// client/js/engine/player_controller.js
import { TILE, toTile, tileCenter, normalizeStep, footColliderPx } from './movement_contract.js';

const legacyToTile = (px) => Math.floor(px / TILE);
const featureEnabled = () => typeof window !== 'undefined' && !!window.FEATURE_MOVEMENT_GRID_V1;
const tileCoord = (px) => (featureEnabled() ? toTile(px) : legacyToTile(px));
const centerOfTile = (t) => (featureEnabled() ? tileCenter(t) : t * TILE + TILE / 2);
const snapThreshold = () => (featureEnabled() ? 2 : 1);
export class PlayerController {
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

      this._debug = { timer: 0, diag: false, snap: false };
    }

    setCollision(grid, cols, rows) { this.coll = grid; this.cols = cols; this.rows = rows; }
    setDynamicBlockChecker(fn) { this._dynamicBlocker = (typeof fn === 'function') ? fn : null; }
    setPosition(x, y) { this.x = x; this.y = y; }
    getPosition() { return { x: this.x, y: this.y }; }

    _snap(v) { return Math.round(v); }
    // Centro exato do tile (simétrico em X e Y)
    _centerOf(cx, cy) {
      return { x: centerOfTile(cx), y: centerOfTile(cy) };
    }

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
      if (!featureEnabled()) {
        const cx = legacyToTile(nx);
        const cy = legacyToTile(ny);
        if (this.isBlockedCell(cx, cy)) return { x: this.x, y: this.y, blocked: true };
        return { x: nx, y: ny, blocked: false };
      }

      const collider = footColliderPx(nx, ny);
      const minCx = toTile(collider.x);
      const maxCx = toTile(collider.x + collider.w - 0.0001);
      const minCy = toTile(collider.y);
      const maxCy = toTile(collider.y + collider.h - 0.0001);

      for (let ty = minCy; ty <= maxCy; ty++) {
        for (let tx = minCx; tx <= maxCx; tx++) {
          if (this.isBlockedCell(tx, ty)) {
            return { x: this.x, y: this.y, blocked: true };
          }
        }
      }
      return { x: nx, y: ny, blocked: false };
    }

    // Solicita um passo cardinal (dir: {x:-1|0|1, y:-1|0|1} com |x|+|y| = 1)
    requestStep(dir) {
      if (!dir || (dir.x && dir.y)) return; // ignora diagonal
      if (this.path) return;                // se está seguindo path, ignora input manual
      if (this._moving) return;             // já executando um passo

      // célula atual e alvo
      const ccx = tileCoord(this.x), ccy = tileCoord(this.y);
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
      const feature = featureEnabled();

      if (this.path && this.pathIdx < this.path.length) {
        const node = this.path[this.pathIdx];
        const { x: tx, y: ty } = this._centerOf(node.x, node.y);

        const vx = tx - this.x, vy = ty - this.y;
        const dist = Math.hypot(vx, vy);
        if (dist <= snapThreshold()) {
          // chegou ao centro deste tile: snap + publica + próximo nó
          this.x = this._snap(tx);
          this.y = this._snap(ty);
          if (this.onMoved) this.onMoved(this.x, this.y);
          this.pathIdx++;
          if (this.pathIdx >= this.path.length) this.path = null;
          if (feature) this._debug.snap = true;
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
        if (dist <= snapThreshold()) {
          // chegou ao centro do tile alvo: snap + publica
          this.x = this._snap(this._stepTarget.x);
          this.y = this._snap(this._stepTarget.y);
          this._moving = false; this._stepTarget = null;
          if (this.onMoved) this.onMoved(this.x, this.y);
          if (feature) this._debug.snap = true;
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
      let vxMove = 0;
      let vyMove = 0;
      let diagNormalized = false;

      if (feature) {
        const delta = normalizeStep(dx, dy, spd, dt);
        vxMove = delta.vx;
        vyMove = delta.vy;
        diagNormalized = !!delta.diagonal;
        const deltaMag = Math.hypot(vxMove, vyMove);
        if (Number.isFinite(maxDist) && deltaMag > maxDist) {
          const scale = maxDist / (deltaMag || 1);
          vxMove *= scale;
          vyMove *= scale;
        }
      } else {
        const step = spd * dt;
        const moveDist = Number.isFinite(maxDist) ? Math.min(step, maxDist) : step;
        vxMove = dx * moveDist;
        vyMove = dy * moveDist;
      }

      const nx = this.x + vxMove;
      const ny = this.y + vyMove;

      const res = this.tryMove(nx, ny);
      const moved = (res.x !== this.x || res.y !== this.y);
      this.x = res.x; this.y = res.y;

      if (moved) {
        // Em STEP ou PATH, quem dispara onMoved é o “chegar ao centro”.
        // No contínuo, mantém autosave por ~64px:
        if (!this._moving && !this.path) {
          this._accumMoved += Math.hypot(vxMove, vyMove);
          if (this.onMoved && this._accumMoved >= 64) {
            this._accumMoved = 0;
            this.onMoved(this.x, this.y);
          }
        }
      }

      if (feature) {
        if (diagNormalized) this._debug.diag = true;
        this._debug.timer += dt;
        if (window.DEBUG_MOVEMENT && this._debug.timer >= 1) {
          const tileX = tileCoord(this.x);
          const tileY = tileCoord(this.y);
          console.debug('[movement]', {
            pos: { x: Math.round(this.x), y: Math.round(this.y) },
            tile: { x: tileX, y: tileY },
            diag: this._debug.diag,
            snap: this._debug.snap,
          });
          this._debug.timer = 0;
          this._debug.diag = false;
          this._debug.snap = false;
        }
      }
      return moved;
    }
  }

if (typeof window !== 'undefined') {
  window.PlayerController = PlayerController;
}
