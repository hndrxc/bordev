export class SpatialHash {
  readonly cellSize: number;
  private readonly invCellSize: number;
  private readonly cols: number;
  private readonly rows: number;
  private head: Int32Array;
  private next: Int32Array;
  private readonly queryResult: number[] = [];

  constructor(mapSize: number = 128, cellSize: number = 2, maxEntities: number = 2048) {
    this.cellSize = cellSize;
    this.invCellSize = 1 / cellSize;
    this.cols = Math.ceil(mapSize / cellSize);
    this.rows = Math.ceil(mapSize / cellSize);
    this.head = new Int32Array(this.cols * this.rows).fill(-1);
    this.next = new Int32Array(maxEntities).fill(-1);
  }

  clear(): void {
    this.head.fill(-1);
  }

  insert(id: number, x: number, z: number): void {
    if (id >= this.next.length) {
      const newCapacity = Math.max(id + 1, this.next.length * 2);
      const expanded = new Int32Array(newCapacity).fill(-1);
      expanded.set(this.next);
      this.next = expanded;
    }
    const cx = Math.floor(x * this.invCellSize);
    const cz = Math.floor(z * this.invCellSize);
    if (cx < 0 || cx >= this.cols || cz < 0 || cz >= this.rows) {
      return;
    }
    const cellIdx = cz * this.cols + cx;
    this.next[id] = this.head[cellIdx];
    this.head[cellIdx] = id;
  }

  queryNearby(x: number, z: number, radius: number): readonly number[] {
    this.queryResult.length = 0;
    const minCx = Math.max(0, Math.floor((x - radius) * this.invCellSize));
    const maxCx = Math.min(this.cols - 1, Math.floor((x + radius) * this.invCellSize));
    const minCz = Math.max(0, Math.floor((z - radius) * this.invCellSize));
    const maxCz = Math.min(this.rows - 1, Math.floor((z + radius) * this.invCellSize));

    for (let cz = minCz; cz <= maxCz; cz++) {
      const rowOffset = cz * this.cols;
      for (let cx = minCx; cx <= maxCx; cx++) {
        let curr = this.head[rowOffset + cx];
        while (curr !== -1) {
          this.queryResult.push(curr);
          curr = this.next[curr];
        }
      }
    }
    return this.queryResult;
  }
}
