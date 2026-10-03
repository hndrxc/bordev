import type { Grid } from '../grid';

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

export function computeComponentLabels(grid: Grid, player: number): Int32Array {
  const size = grid.size;
  const total = size * size;
  const labels = new Int32Array(total);
  const queue = new Int32Array(total);
  let nextCompId = 1;

  for (let i = 0; i < total; i++) {
    if (labels[i] !== 0) continue;
    const tx = i % size;
    const tz = (i / size) | 0;
    if (!grid.isPassable(tx, tz, player)) continue;

    const compId = nextCompId++;
    labels[i] = compId;
    let head = 0;
    let tail = 0;
    queue[tail++] = i;

    while (head < tail) {
      const curr = queue[head++];
      const cx = curr % size;
      const cz = (curr / size) | 0;

      for (let d = 0; d < 8; d++) {
        const [dx, dz] = DIRS_8[d];
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nx >= size || nz < 0 || nz >= size) continue;

        const nIdx = nz * size + nx;
        if (labels[nIdx] !== 0) continue;
        if (!grid.isPassable(nx, nz, player)) continue;

        // Diagonal move: enforce no corner cutting
        if (dx !== 0 && dz !== 0) {
          if (!grid.isPassable(cx + dx, cz, player) || !grid.isPassable(cx, cz + dz, player)) {
            continue;
          }
        }

        labels[nIdx] = compId;
        queue[tail++] = nIdx;
      }
    }
  }

  return labels;
}

export class ComponentManager {
  private readonly cache = new Map<number, { revision: number; labels: Int32Array }>();

  getLabels(grid: Grid, player: number): Int32Array {
    const cached = this.cache.get(player);
    if (cached && cached.revision === grid.revision) {
      return cached.labels;
    }
    const labels = computeComponentLabels(grid, player);
    this.cache.set(player, { revision: grid.revision, labels });
    return labels;
  }

  invalidate(): void {
    this.cache.clear();
  }
}

export function findStartComponent(
  grid: Grid,
  labels: Int32Array,
  startX: number,
  startZ: number,
  player: number
): { compId: number; tx: number; tz: number } {
  const size = grid.size;
  const startTx = Math.max(0, Math.min(size - 1, Math.floor(startX)));
  const startTz = Math.max(0, Math.min(size - 1, Math.floor(startZ)));
  const startIdx = startTz * size + startTx;
  const directComp = labels[startIdx];
  if (directComp !== 0) {
    return { compId: directComp, tx: startTx, tz: startTz };
  }

  // Start tile is impassable; search outward for nearest passable tile
  const queue = new Int32Array(size * size);
  const visited = new Uint8Array(size * size);
  let head = 0;
  let tail = 0;
  queue[tail++] = startIdx;
  visited[startIdx] = 1;

  while (head < tail) {
    const curr = queue[head++];
    const cx = curr % size;
    const cz = (curr / size) | 0;

    for (let d = 0; d < 8; d++) {
      const [dx, dz] = DIRS_8[d];
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nx >= size || nz < 0 || nz >= size) continue;
      const nIdx = nz * size + nx;
      if (visited[nIdx] !== 0) continue;
      visited[nIdx] = 1;

      const comp = labels[nIdx];
      if (comp !== 0 && grid.isPassable(nx, nz, player)) {
        return { compId: comp, tx: nx, tz: nz };
      }
      queue[tail++] = nIdx;
    }
  }

  return { compId: 0, tx: startTx, tz: startTz };
}

export function findNearestTileInComponent(
  grid: Grid,
  labels: Int32Array,
  startComp: number,
  targetTx: number,
  targetTz: number,
  targetX: number,
  targetZ: number
): { tx: number; tz: number; x: number; z: number } {
  const size = grid.size;
  const total = size * size;
  const clampedTx = Math.max(0, Math.min(size - 1, targetTx));
  const clampedTz = Math.max(0, Math.min(size - 1, targetTz));
  const targetIdx = clampedTz * size + clampedTx;

  const safeTargetX =
    targetX < 0 || targetX >= size
      ? clampedTx + 0.5
      : Math.max(clampedTx, Math.min(clampedTx + 1, targetX));
  const safeTargetZ =
    targetZ < 0 || targetZ >= size
      ? clampedTz + 0.5
      : Math.max(clampedTz, Math.min(clampedTz + 1, targetZ));

  if (labels[targetIdx] === startComp) {
    return { tx: clampedTx, tz: clampedTz, x: safeTargetX, z: safeTargetZ };
  }
  if (startComp === 0) {
    return { tx: clampedTx, tz: clampedTz, x: safeTargetX, z: safeTargetZ };
  }

  const queue = new Int32Array(total);
  const visited = new Uint8Array(total);
  let head = 0;
  let tail = 0;

  queue[tail++] = targetIdx;
  visited[targetIdx] = 1;

  let bestTx = clampedTx;
  let bestTz = clampedTz;
  let bestDistSq = Infinity;
  let found = false;

  while (head < tail && !found) {
    const levelCount = tail - head;

    for (let l = 0; l < levelCount; l++) {
      const curr = queue[head++];
      const cx = curr % size;
      const cz = (curr / size) | 0;

      if (labels[curr] === startComp) {
        found = true;
        const centerX = cx + 0.5;
        const centerZ = cz + 0.5;
        const distSq = (centerX - targetX) ** 2 + (centerZ - targetZ) ** 2;
        if (distSq < bestDistSq || (distSq === bestDistSq && curr < bestTz * size + bestTx)) {
          bestDistSq = distSq;
          bestTx = cx;
          bestTz = cz;
        }
      }

      if (!found) {
        for (let d = 0; d < 8; d++) {
          const [dx, dz] = DIRS_8[d];
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nx >= size || nz < 0 || nz >= size) continue;
          const nIdx = nz * size + nx;
          if (visited[nIdx] !== 0) continue;
          visited[nIdx] = 1;
          queue[tail++] = nIdx;
        }
      }
    }
  }

  return {
    tx: bestTx,
    tz: bestTz,
    x: bestTx + 0.5,
    z: bestTz + 0.5,
  };
}
