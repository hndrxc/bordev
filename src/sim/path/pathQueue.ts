import type { Grid } from '../grid';
import { AStarScratch, AStarSearch, hasLineOfSight, stringPull } from './astar';
import { ComponentManager, findNearestTileInComponent, findStartComponent } from './components';

export interface PathResult {
  id: number;
  path: { x: number; z: number }[];
  target: { x: number; z: number };
}

interface QueuedRequest {
  id: number;
  startX: number;
  startZ: number;
  targetX: number;
  targetZ: number;
  player: number;
  gridRevision: number;
  search?: AStarSearch;
  finalTarget?: { x: number; z: number; tx: number; tz: number };
}

export class PathQueue {
  readonly grid: Grid;
  lastExpansions = 0;
  totalExpansions = 0;

  private queue: QueuedRequest[] = [];
  private lastGridRevision = 0;
  private readonly components = new ComponentManager();
  private readonly scratch: AStarScratch;

  constructor(grid: Grid) {
    this.grid = grid;
    this.lastGridRevision = grid.revision;
    this.scratch = new AStarScratch(grid.size);
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  request(
    id: number,
    startX: number,
    startZ: number,
    targetX: number,
    targetZ: number,
    player: number
  ): void {
    const existingIdx = this.queue.findIndex((r) => r.id === id);
    if (existingIdx !== -1) {
      this.queue.splice(existingIdx, 1);
    }

    this.queue.push({
      id,
      startX,
      startZ,
      targetX,
      targetZ,
      player,
      gridRevision: this.grid.revision,
    });
  }

  cancel(id: number): void {
    const idx = this.queue.findIndex((r) => r.id === id);
    if (idx !== -1) {
      this.queue.splice(idx, 1);
    }
  }

  process(budget = 25000): PathResult[] {
    if (this.grid.revision !== this.lastGridRevision) {
      for (let i = 0; i < this.queue.length; i++) {
        const r = this.queue[i];
        r.gridRevision = this.grid.revision;
        r.search = undefined;
        r.finalTarget = undefined;
      }
      this.lastGridRevision = this.grid.revision;
      this.components.invalidate();
    }

    let expansionsUsed = 0;
    const results: PathResult[] = [];

    while (this.queue.length > 0 && expansionsUsed < budget) {
      const req = this.queue[0];
      if (req.gridRevision !== this.grid.revision) {
        req.gridRevision = this.grid.revision;
        req.search = undefined;
        req.finalTarget = undefined;
      }
      if (!req.search || !req.finalTarget) {
        const labels = this.components.getLabels(this.grid, req.player);
        const startInfo = findStartComponent(this.grid, labels, req.startX, req.startZ, req.player);
        const targetTx = Math.max(0, Math.min(this.grid.size - 1, Math.floor(req.targetX)));
        const targetTz = Math.max(0, Math.min(this.grid.size - 1, Math.floor(req.targetZ)));
        const reachable = findNearestTileInComponent(
          this.grid,
          labels,
          startInfo.compId,
          targetTx,
          targetTz,
          req.targetX,
          req.targetZ
        );
        req.finalTarget = reachable;

        if (hasLineOfSight(this.grid, req.startX, req.startZ, reachable.x, reachable.z, req.player)) {
          results.push({
            id: req.id,
            path: [{ x: reachable.x, z: reachable.z }],
            target: { x: reachable.x, z: reachable.z },
          });
          this.queue.shift();
          continue;
        }

        req.search = new AStarSearch(
          this.grid,
          startInfo.tx,
          startInfo.tz,
          reachable.tx,
          reachable.tz,
          req.player,
          this.scratch
        );
      }

      const finalTarget = req.finalTarget;
      const targetPos = { x: finalTarget.x, z: finalTarget.z };
      const search = req.search;

      const remaining = budget - expansionsUsed;
      const stepRes = search.step(remaining);
      expansionsUsed += stepRes.expansions;
      this.totalExpansions += stepRes.expansions;

      if (stepRes.status === 'found') {
        this.queue.shift();
        const raw = search.rawPath ?? [];
        const full: { x: number; z: number }[] = [{ x: req.startX, z: req.startZ }];
        for (let i = 0; i < raw.length; i++) {
          full.push(raw[i]);
        }
        if (
          full.length === 1 ||
          full[full.length - 1].x !== targetPos.x ||
          full[full.length - 1].z !== targetPos.z
        ) {
          full.push(targetPos);
        }

        const pulled = stringPull(this.grid, full, req.player);
        if (
          pulled.length > 0 &&
          Math.hypot(pulled[0].x - req.startX, pulled[0].z - req.startZ) < 1e-4
        ) {
          pulled.shift();
        }
        if (pulled.length === 0) {
          pulled.push(targetPos);
        }

        results.push({
          id: req.id,
          path: pulled,
          target: targetPos,
        });
      } else if (stepRes.status === 'not_found') {
        this.queue.shift();
        results.push({
          id: req.id,
          path: [],
          target: { x: req.startX, z: req.startZ },
        });
      } else {
        // 'in_progress': budget exhausted, keep req at head of queue
        break;
      }
    }

    this.lastExpansions = expansionsUsed;
    return results;
  }
}
