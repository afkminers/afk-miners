// client/js/engine/click_to_move.js
import { TILE, toTile } from './movement_contract.js';

const legacyToTile = (px) => Math.floor(px / TILE);
const featureEnabled = () =>
  typeof window !== 'undefined' && !!window.FEATURE_MOVEMENT_GRID_V1;

export class ClickToMove {
  constructor({ canvas, camera, controller, grid }) {
    this.canvas = canvas;
    this.camera = camera;
    this.ctrl = controller;
    this.grid = grid;
    this.astar = null;

    // guarda o último tile de destino clicado (para não recalcular à toa)
    this._lastGoal = null; // { x, y }
  }

  setGrid(grid) {
    this.grid = grid;
  }
  setAStar(astar) {
    this.astar = astar;
  }

  handleClick(screenX, screenY) {
    if (!this.astar || !this.grid || !this.ctrl || !this.camera) return;

    // converte clique para mundo -> tile
    const world = this.camera.screenToWorld(screenX, screenY);
    const gx = featureEnabled() ? toTile(world.x) : legacyToTile(world.x);
    const gy = featureEnabled() ? toTile(world.y) : legacyToTile(world.y);

    // só ignorar clique repetido se ainda existir um path ativo indo pra lá
    const hasActivePath =
      Array.isArray(this.ctrl.path) &&
      this.ctrl.pathIdx >= 0 &&
      this.ctrl.pathIdx < this.ctrl.path.length;

    if (
      hasActivePath &&
      this._lastGoal &&
      this._lastGoal.x === gx &&
      this._lastGoal.y === gy
    ) {
      // já estamos indo pra esse tile, não recalcular
      return;
    }


    const pos = this.ctrl.getPosition();
    const sx0 = featureEnabled() ? toTile(pos.x) : legacyToTile(pos.x);
    const sy0 = featureEnabled() ? toTile(pos.y) : legacyToTile(pos.y);

    // ponto de partida padrão = tile atual do herói
    let start = { x: sx0, y: sy0 };
    let prefix = null;

    // se já existe um caminho em andamento, reaproveita o trecho que ainda falta
    const curPath =
      Array.isArray(this.ctrl.path) && this.ctrl.path.length
        ? this.ctrl.path
        : null;
    const curIdx =
      Number.isFinite(this.ctrl.pathIdx) && this.ctrl.pathIdx >= 0
        ? this.ctrl.pathIdx
        : 0;

    if (curPath && curIdx < curPath.length) {
      // pedaço que ainda não foi percorrido
      prefix = curPath.slice(curIdx);
      const last = prefix[prefix.length - 1];
      if (last) {
        // novo A* começa no FINAL do caminho atual
        start = { x: last.x, y: last.y };
      }
    }

    // tenta achar caminho a partir do final do path atual
    let newPath = this.astar.findPath(start, { x: gx, y: gy });

    // se não achou, faz fallback: calcula a partir da posição atual do herói
    if ((!newPath || !newPath.length) && (start.x !== sx0 || start.y !== sy0)) {
      prefix = null;
      newPath = this.astar.findPath({ x: sx0, y: sy0 }, { x: gx, y: gy });
    }

    // se ainda assim não achou, não mexe no caminho atual (evita “parar seco”)
    if (!newPath || !newPath.length) {
      return;
    }

    const fullPath = prefix ? prefix.concat(newPath) : newPath;

    // guarda último destino para evitar recalcular no mesmo lugar
    this._lastGoal = { x: gx, y: gy };

    // manda o caminho final para o controller
    this.ctrl.followPath(fullPath);
  }
}

if (typeof window !== 'undefined') {
  window.ClickToMove = ClickToMove;
}
