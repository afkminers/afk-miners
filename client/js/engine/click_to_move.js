// client/js/engine/click_to_move.js
import { TILE, toTile } from './movement_contract.js';

const legacyToTile = (px) => Math.floor(px / TILE);
const featureEnabled = () => typeof window !== 'undefined' && !!window.FEATURE_MOVEMENT_GRID_V1;

export class ClickToMove {
    constructor({ canvas, camera, controller, grid }) {
      this.canvas = canvas; this.camera = camera; this.ctrl = controller; this.grid = grid;
      this.astar = null;
    }
    setGrid(grid) { this.grid = grid; }
    setAStar(astar) { this.astar = astar; }

    handleClick(screenX, screenY) {
      if (!this.astar || !this.grid) return;
      const world = this.camera.screenToWorld(screenX, screenY);
      const gx = featureEnabled() ? toTile(world.x) : legacyToTile(world.x);
      const gy = featureEnabled() ? toTile(world.y) : legacyToTile(world.y);
      const pos = this.ctrl.getPosition();
      const sx = featureEnabled() ? toTile(pos.x) : legacyToTile(pos.x);
      const sy = featureEnabled() ? toTile(pos.y) : legacyToTile(pos.y);
      const path = this.astar.findPath({x:sx,y:sy}, {x:gx,y:gy});
      if (path && path.length) this.ctrl.followPath(path);
    }
}

if (typeof window !== 'undefined') {
  window.ClickToMove = ClickToMove;
}
