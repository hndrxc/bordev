import type { Grid } from '../grid';

const SQRT2 = Math.SQRT2;
const SQRT2_MINUS_ONE = Math.SQRT2 - 1;
const CLEARANCE = 0.15;
const CLEARANCE_SQ = CLEARANCE * CLEARANCE;

const DIRS_8: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

function octileDistance(dx: number, dz: number): number {
  const adx = Math.abs(dx);
  const adz = Math.abs(dz);
  return adx < adz
    ? SQRT2_MINUS_ONE * adx + adz
    : SQRT2_MINUS_ONE * adz + adx;
}

function distToSegmentSquared(
  px: number,
  pz: number,
  x0: number,
  z0: number,
  x1: number,
  z1: number
): number {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const lenSq = dx * dx + dz * dz;
  if (lenSq === 0) {
    const rx = px - x0;
    const rz = pz - z0;
    return rx * rx + rz * rz;
  }
  let t = ((px - x0) * dx + (pz - z0) * dz) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const projX = x0 + t * dx;
  const projZ = z0 + t * dz;
  const rx = px - projX;
  const rz = pz - projZ;
  return rx * rx + rz * rz;
}

function checkTileCorners(
  nx: number,
  nz: number,
  x0: number,
  z0: number,
  x1: number,
  z1: number
): boolean {
  if (distToSegmentSquared(nx, nz, x0, z0, x1, z1) < CLEARANCE_SQ) return false;
  if (distToSegmentSquared(nx + 1, nz, x0, z0, x1, z1) < CLEARANCE_SQ) return false;
  if (distToSegmentSquared(nx, nz + 1, x0, z0, x1, z1) < CLEARANCE_SQ) return false;
  if (distToSegmentSquared(nx + 1, nz + 1, x0, z0, x1, z1) < CLEARANCE_SQ) return false;
  return true;
}

function checkNearObstacles(
  grid: Grid,
  cx: number,
  cz: number,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  player: number
): boolean {
  for (let d = 0; d < 8; d++) {
    const nx = cx + DIRS_8[d][0];
    const nz = cz + DIRS_8[d][1];
    if (nx >= 0 && nx < grid.size && nz >= 0 && nz < grid.size) {
      const nIdx = nz * grid.size + nx;
      if (!grid.isTilePassable(nIdx, player)) {
        if (!checkTileCorners(nx, nz, x0, z0, x1, z1)) {
          return false;
        }
      }
    }
  }
  return true;
}

export function hasLineOfSight(
  grid: Grid,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  player: number
): boolean {
  if (x0 === x1 && z0 === z1) {
    return grid.isPassable(x0, z0, player);
  }

  let currX = Math.floor(x0);
  let currZ = Math.floor(z0);
  const endX = Math.floor(x1);
  const endZ = Math.floor(z1);

  if (
    currX < 0 ||
    currX >= grid.size ||
    currZ < 0 ||
    currZ >= grid.size ||
    endX < 0 ||
    endX >= grid.size ||
    endZ < 0 ||
    endZ >= grid.size
  ) {
    return false;
  }

  let currIdx = currZ * grid.size + currX;
  const endIdx = endZ * grid.size + endX;

  if (!grid.isTilePassable(currIdx, player) || !grid.isTilePassable(endIdx, player)) {
    return false;
  }
  if (currIdx === endIdx) {
    return true;
  }

  const dx = x1 - x0;
  const dz = z1 - z0;
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;

  let tMaxX =
    stepX > 0
      ? (currX + 1 - x0) / dx
      : stepX < 0
        ? (currX - x0) / dx
        : Infinity;
  let tMaxZ =
    stepZ > 0
      ? (currZ + 1 - z0) / dz
      : stepZ < 0
        ? (currZ - z0) / dz
        : Infinity;

  if (grid.nearObstacle[currIdx] !== 0) {
    if (!checkNearObstacles(grid, currX, currZ, x0, z0, x1, z1, player)) {
      return false;
    }
  }

  while (currIdx !== endIdx) {
    if (Math.abs(tMaxX - tMaxZ) < 1e-8) {
      const c1Idx = currZ * grid.size + (currX + stepX);
      const c2Idx = (currZ + stepZ) * grid.size + currX;
      if (!grid.isTilePassable(c1Idx, player) || !grid.isTilePassable(c2Idx, player)) {
        return false;
      }
      currX += stepX;
      currZ += stepZ;
      tMaxX += tDeltaX;
      tMaxZ += tDeltaZ;
    } else if (tMaxX < tMaxZ) {
      currX += stepX;
      tMaxX += tDeltaX;
    } else {
      currZ += stepZ;
      tMaxZ += tDeltaZ;
    }

    currIdx = currZ * grid.size + currX;
    if (!grid.isTilePassable(currIdx, player)) {
      return false;
    }
    if (grid.nearObstacle[currIdx] !== 0) {
      if (!checkNearObstacles(grid, currX, currZ, x0, z0, x1, z1, player)) {
        return false;
      }
    }
  }

  return true;
}

export function stringPull(
  grid: Grid,
  rawPath: readonly { x: number; z: number }[],
  player: number
): { x: number; z: number }[] {
  const len = rawPath.length;
  if (len <= 2) {
    return rawPath.map((p) => ({ x: p.x, z: p.z }));
  }

  const result: { x: number; z: number }[] = [{ x: rawPath[0].x, z: rawPath[0].z }];
  let curr = 0;

  while (curr < len - 1) {
    // Fast path: direct line to end
    if (
      curr < len - 2 &&
      hasLineOfSight(
        grid,
        rawPath[curr].x,
        rawPath[curr].z,
        rawPath[len - 1].x,
        rawPath[len - 1].z,
        player
      )
    ) {
      result.push({ x: rawPath[len - 1].x, z: rawPath[len - 1].z });
      break;
    }

    let furthest = curr + 1;
    for (let next = curr + 2; next < len; next++) {
      if (
        hasLineOfSight(
          grid,
          rawPath[curr].x,
          rawPath[curr].z,
          rawPath[next].x,
          rawPath[next].z,
          player
        )
      ) {
        furthest = next;
      } else {
        break;
      }
    }
    result.push({ x: rawPath[furthest].x, z: rawPath[furthest].z });
    curr = furthest;
  }

  return result;
}

export class AStarScratch {
  readonly size: number;
  readonly total: number;
  readonly gScore: Float64Array;
  readonly fScore: Float64Array;
  readonly hScore: Float64Array;
  readonly parent: Int32Array;
  readonly tag: Int32Array;
  readonly closed: Int32Array;
  readonly heap: Int32Array;
  readonly heapPos: Int32Array;
  searchId = 0;

  constructor(size: number) {
    this.size = size;
    this.total = size * size;
    this.gScore = new Float64Array(this.total);
    this.fScore = new Float64Array(this.total);
    this.hScore = new Float64Array(this.total);
    this.parent = new Int32Array(this.total);
    this.tag = new Int32Array(this.total);
    this.closed = new Int32Array(this.total);
    this.heap = new Int32Array(this.total);
    this.heapPos = new Int32Array(this.total).fill(-1);
  }

  nextSearch(): number {
    this.searchId++;
    if (this.searchId >= 0x7fffffff) {
      this.searchId = 1;
      this.tag.fill(0);
      this.closed.fill(0);
      this.heapPos.fill(-1);
    }
    return this.searchId;
  }
}

export class AStarSearch {
  readonly grid: Grid;
  readonly player: number;
  readonly startTx: number;
  readonly startTz: number;
  readonly targetTx: number;
  readonly targetTz: number;
  readonly startIdx: number;
  readonly goalIdx: number;
  readonly gridRevision: number;

  status: 'in_progress' | 'found' | 'not_found' = 'in_progress';
  rawPath: { x: number; z: number }[] | null = null;

  private readonly size: number;
  private readonly scratch: AStarScratch;
  private readonly searchId: number;
  private heapSize = 0;

  constructor(
    grid: Grid,
    startTx: number,
    startTz: number,
    targetTx: number,
    targetTz: number,
    player: number,
    scratch?: AStarScratch
  ) {
    this.grid = grid;
    this.player = player;
    this.startTx = startTx;
    this.startTz = startTz;
    this.targetTx = targetTx;
    this.targetTz = targetTz;
    this.size = grid.size;
    this.gridRevision = grid.revision;

    this.scratch = scratch ?? new AStarScratch(this.size);
    this.searchId = this.scratch.nextSearch();

    this.startIdx = startTz * this.size + startTx;
    this.goalIdx = targetTz * this.size + targetTx;

    if (this.startIdx === this.goalIdx) {
      this.status = 'found';
      this.rawPath = [{ x: startTx + 0.5, z: startTz + 0.5 }];
      return;
    }

    this.scratch.tag[this.startIdx] = this.searchId;
    this.scratch.gScore[this.startIdx] = 0;
    const h = octileDistance(this.targetTx - startTx, this.targetTz - startTz);
    this.scratch.hScore[this.startIdx] = h;
    this.scratch.fScore[this.startIdx] = h;
    this.scratch.parent[this.startIdx] = -1;
    this.pushHeap(this.startIdx);
  }

  step(budget: number): { expansions: number; status: 'in_progress' | 'found' | 'not_found' } {
    if (this.status !== 'in_progress') {
      return { expansions: 0, status: this.status };
    }

    let expansions = 0;
    const scratch = this.scratch;
    const searchId = this.searchId;

    while (this.heapSize > 0 && expansions < budget) {
      const currIdx = this.popHeap();
      expansions++;
      scratch.closed[currIdx] = searchId;

      if (currIdx === this.goalIdx) {
        this.status = 'found';
        this.reconstructPath();
        return { expansions, status: 'found' };
      }

      const cx = currIdx % this.size;
      const cz = (currIdx / this.size) | 0;
      const currentG = scratch.gScore[currIdx];

      for (let d = 0; d < 8; d++) {
        const dx = DIRS_8[d][0];
        const dz = DIRS_8[d][1];
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nx >= this.size || nz < 0 || nz >= this.size) continue;

        const nIdx = nz * this.size + nx;
        if (scratch.closed[nIdx] === searchId) continue;
        if (!this.grid.isTilePassable(nIdx, this.player)) continue;

        const isDiagonal = dx !== 0 && dz !== 0;
        if (isDiagonal) {
          const c1Idx = cz * this.size + (cx + dx);
          const c2Idx = (cz + dz) * this.size + cx;
          if (
            !this.grid.isTilePassable(c1Idx, this.player) ||
            !this.grid.isTilePassable(c2Idx, this.player)
          ) {
            continue;
          }
        }

        const stepCost = isDiagonal ? SQRT2 : 1.0;
        const tentativeG = currentG + stepCost;

        if (scratch.tag[nIdx] !== searchId) {
          scratch.tag[nIdx] = searchId;
          scratch.parent[nIdx] = currIdx;
          scratch.gScore[nIdx] = tentativeG;
          const h = octileDistance(this.targetTx - nx, this.targetTz - nz);
          scratch.hScore[nIdx] = h;
          scratch.fScore[nIdx] = tentativeG + h;
          scratch.heapPos[nIdx] = -1;
          this.pushHeap(nIdx);
        } else if (tentativeG < scratch.gScore[nIdx]) {
          scratch.parent[nIdx] = currIdx;
          scratch.gScore[nIdx] = tentativeG;
          const h = octileDistance(this.targetTx - nx, this.targetTz - nz);
          scratch.hScore[nIdx] = h;
          scratch.fScore[nIdx] = tentativeG + h;

          if (scratch.heapPos[nIdx] >= 0) {
            this.bubbleUp(scratch.heapPos[nIdx]);
          } else {
            this.pushHeap(nIdx);
          }
        }
      }
    }

    if (this.heapSize === 0) {
      this.status = 'not_found';
      return { expansions, status: 'not_found' };
    }

    return { expansions, status: 'in_progress' };
  }

  private reconstructPath(): void {
    const waypoints: { x: number; z: number }[] = [];
    let curr = this.goalIdx;
    while (curr !== -1) {
      const tx = curr % this.size;
      const tz = (curr / this.size) | 0;
      waypoints.push({ x: tx + 0.5, z: tz + 0.5 });
      curr = this.scratch.parent[curr];
    }
    waypoints.reverse();
    this.rawPath = waypoints;
  }

  private compare(a: number, b: number): number {
    const fa = this.scratch.fScore[a];
    const fb = this.scratch.fScore[b];
    if (fa < fb) return -1;
    if (fa > fb) return 1;
    const ha = this.scratch.hScore[a];
    const hb = this.scratch.hScore[b];
    if (ha < hb) return -1;
    if (ha > hb) return 1;
    return a - b;
  }

  private pushHeap(idx: number): void {
    const pos = this.heapSize++;
    this.scratch.heap[pos] = idx;
    this.scratch.heapPos[idx] = pos;
    this.bubbleUp(pos);
  }

  private popHeap(): number {
    const root = this.scratch.heap[0];
    this.scratch.heapPos[root] = -1;
    const last = this.scratch.heap[--this.heapSize];
    if (this.heapSize > 0) {
      this.scratch.heap[0] = last;
      this.scratch.heapPos[last] = 0;
      this.sinkDown(0);
    }
    return root;
  }

  private bubbleUp(pos: number): void {
    const heap = this.scratch.heap;
    const heapPos = this.scratch.heapPos;
    while (pos > 0) {
      const parentPos = (pos - 1) >> 1;
      const parentIdx = heap[parentPos];
      const currIdx = heap[pos];
      if (this.compare(currIdx, parentIdx) < 0) {
        heap[pos] = parentIdx;
        heap[parentPos] = currIdx;
        heapPos[parentIdx] = pos;
        heapPos[currIdx] = parentPos;
        pos = parentPos;
      } else {
        break;
      }
    }
  }

  private sinkDown(pos: number): void {
    const heap = this.scratch.heap;
    const heapPos = this.scratch.heapPos;
    const size = this.heapSize;

    while (true) {
      let smallest = pos;
      const left = (pos << 1) + 1;
      const right = left + 1;

      if (left < size && this.compare(heap[left], heap[smallest]) < 0) {
        smallest = left;
      }
      if (right < size && this.compare(heap[right], heap[smallest]) < 0) {
        smallest = right;
      }
      if (smallest !== pos) {
        const swapIdx = heap[smallest];
        const currIdx = heap[pos];
        heap[pos] = swapIdx;
        heap[smallest] = currIdx;
        heapPos[swapIdx] = pos;
        heapPos[currIdx] = smallest;
        pos = smallest;
      } else {
        break;
      }
    }
  }
}
