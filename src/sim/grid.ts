import { isTerrainPassable } from '../data/terrain.js';
import type { GameMap } from './map.js';
export const FLAG_TERRAIN = 1;  // bit 0: terrain-blocked (water, forest, rock)
export const FLAG_BUILDING = 2; // bit 1: building-blocked
export const FLAG_GATE = 4;     // bit 2: gate (passable for owner and allies)

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

export class Grid {
  readonly size: number;
  readonly flags: Uint8Array;
  readonly gateOwners: Int32Array;
  readonly nearObstacle: Uint8Array;
  private readonly alliesMap = new Map<number, Set<number>>();
  revision = 0;

  constructor(map: GameMap) {
    this.size = map.size;
    const totalTiles = this.size * this.size;
    this.flags = new Uint8Array(totalTiles);
    this.gateOwners = new Int32Array(totalTiles).fill(-1);
    this.nearObstacle = new Uint8Array(totalTiles);

    for (let i = 0; i < totalTiles; i++) {
      if (!isTerrainPassable(map.tiles[i])) {
        this.flags[i] = FLAG_TERRAIN;
      }
    }
    this.updateNearObstacles();
  }

  private updateNearObstacles(): void {
    const size = this.size;
    const total = size * size;
    this.nearObstacle.fill(0);

    for (let i = 0; i < total; i++) {
      if (this.flags[i] !== 0) {
        this.nearObstacle[i] = 1;
        const cx = i % size;
        const cz = (i / size) | 0;
        for (let d = 0; d < 8; d++) {
          const nx = cx + DIRS_8[d][0];
          const nz = cz + DIRS_8[d][1];
          if (nx >= 0 && nx < size && nz >= 0 && nz < size) {
            this.nearObstacle[nz * size + nx] = 1;
          }
        }
      }
    }
  }

  isTilePassable(idx: number, player: number): boolean {
    const f = this.flags[idx];
    if (f === 0) return true;
    if ((f & (FLAG_TERRAIN | FLAG_BUILDING)) !== 0) return false;
    if ((f & FLAG_GATE) !== 0) {
      const owner = this.gateOwners[idx];
      return owner === player || this.isAlly(owner, player);
    }
    return true;
  }

  isPassable(x: number, z: number, player: number): boolean {
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    if (tx < 0 || tx >= this.size || tz < 0 || tz >= this.size) {
      return false;
    }
    return this.isTilePassable(tz * this.size + tx, player);
  }


  canOccupy(x: number, z: number, radius: number, player: number): boolean {
    if (radius <= 0) {
      return this.isPassable(x, z, player);
    }
    // Check whole circle bounding box against map boundaries
    if (x - radius < 0 || x + radius > this.size || z - radius < 0 || z + radius > this.size) {
      return false;
    }

    const minTx = Math.max(0, Math.floor(x - radius));
    const maxTx = Math.min(this.size - 1, Math.floor(x + radius));
    const minTz = Math.max(0, Math.floor(z - radius));
    const maxTz = Math.min(this.size - 1, Math.floor(z + radius));

    const radiusThresholdSq = (radius - 1e-6) * (radius - 1e-6);

    for (let tz = minTz; tz <= maxTz; tz++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        if (!this.isPassable(tx, tz, player)) {
          // Nearest point on impassable unit square [tx, tx+1] x [tz, tz+1]
          const closestX = Math.max(tx, Math.min(x, tx + 1));
          const closestZ = Math.max(tz, Math.min(z, tz + 1));
          const dx = x - closestX;
          const dz = z - closestZ;
          if (dx * dx + dz * dz < radiusThresholdSq) {
            return false;
          }
        }
      }
    }
    return true;
  }

  setBuilding(x: number, z: number, width: number, height: number, blocked: boolean): void {
    for (let dz = 0; dz < height; dz++) {
      for (let dx = 0; dx < width; dx++) {
        const tx = x + dx;
        const tz = z + dz;
        if (tx >= 0 && tx < this.size && tz >= 0 && tz < this.size) {
          const idx = tz * this.size + tx;
          if (blocked) {
            this.flags[idx] |= FLAG_BUILDING;
            this.flags[idx] &= ~FLAG_GATE;
            this.gateOwners[idx] = -1;
          } else {
            this.flags[idx] &= ~FLAG_BUILDING;
            this.flags[idx] &= ~FLAG_GATE;
            this.gateOwners[idx] = -1;
          }
        }
      }
    }
    this.updateNearObstacles();
    this.revision++;
  }

  setGate(x: number, z: number, width: number, height: number, owner: number): void {
    for (let dz = 0; dz < height; dz++) {
      for (let dx = 0; dx < width; dx++) {
        const tx = x + dx;
        const tz = z + dz;
        if (tx >= 0 && tx < this.size && tz >= 0 && tz < this.size) {
          const idx = tz * this.size + tx;
          if (owner >= 0) {
            this.flags[idx] |= FLAG_GATE;
            this.flags[idx] &= ~FLAG_BUILDING;
            this.gateOwners[idx] = owner;
          } else {
            this.flags[idx] &= ~FLAG_GATE;
            this.gateOwners[idx] = -1;
          }
        }
      }
    }
    this.updateNearObstacles();
    this.revision++;
  }

  setAllies(player: number, allies: readonly number[]): void {
    this.alliesMap.set(player, new Set(allies));
    this.revision++;
  }

  isAlly(playerA: number, playerB: number): boolean {
    if (playerA === playerB) return true;
    const alliesA = this.alliesMap.get(playerA);
    if (alliesA && alliesA.has(playerB)) return true;
    const alliesB = this.alliesMap.get(playerB);
    if (alliesB && alliesB.has(playerA)) return true;
    return false;
  }
}
