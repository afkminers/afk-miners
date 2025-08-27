// client/js/engine/click_to_move.js
(function () {
  const TILE = 32;
  class ClickToMove {
    constructor({ canvas, camera, controller, grid }) {
      this.canvas = canvas; this.camera = camera; this.ctrl = controller; this.grid = grid;
      this.astar = null;
    }
    setGrid(grid) { this.grid = grid; }
    setAStar(astar) { this.astar = astar; }

    handleClick(screenX, screenY) {
      if (!this.astar || !this.grid) return;
      const world = this.camera.screenToWorld(screenX, screenY);
      const gx = Math.floor(world.x / TILE);
      const gy = Math.floor(world.y / TILE);
      const pos = this.ctrl.getPosition();
      const sx = Math.floor(pos.x / TILE), sy = Math.floor(pos.y / TILE);
      const path = this.astar.findPath({x:sx,y:sy}, {x:gx,y:gy});
      if (path && path.length) this.ctrl.followPath(path);
    }
  }
  window.ClickToMove = ClickToMove;
})();
