import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateMap, serializeMap, runCli } from './mapgen.js';
import { parseMap, Terrain, type GameMap } from '../src/sim/map.js';
import { isTerrainPassable } from '../src/data/terrain.js';
import { Sim } from '../src/sim/sim.js';

describe('Map Generator (tools/mapgen.ts)', () => {
  describe('Validation', () => {
    it('rejects unsupported player counts', () => {
      expect(() => generateMap({ players: 3 })).toThrow();
      expect(() => generateMap({ players: 4 })).toThrow();
      expect(() => generateMap({ players: 1 })).toThrow();
    });

    it('rejects unsupported map sizes', () => {
      expect(() => generateMap({ size: 64 })).toThrow();
      expect(() => generateMap({ size: 256 })).toThrow();
    });

    it('rejects invalid non-integer seeds', () => {
      expect(() => generateMap({ seed: NaN })).toThrow();
      expect(() => generateMap({ seed: 1.5 })).toThrow();
    });
  });

  describe('Determinism & Reproducibility', () => {
    it('produces identical maps when invoked with the same seed', () => {
      const mapA = generateMap({ seed: 42 });
      const mapB = generateMap({ seed: 42 });

      expect(mapA.tiles).toEqual(mapB.tiles);
      expect(mapA.goldMines).toEqual(mapB.goldMines);
      expect(mapA.starts).toEqual(mapB.starts);
      expect(mapA.doodads).toEqual(mapB.doodads);
    });

    it('produces variation across different seeds', () => {
      const map1 = generateMap({ seed: 1 });
      const map2 = generateMap({ seed: 2 });

      const differentDoodads = map1.doodads.filter(
        ([x, z, variant], idx) =>
          map2.doodads[idx] &&
          (map2.doodads[idx][0] !== x || map2.doodads[idx][1] !== z || map2.doodads[idx][2] !== variant),
      );
      expect(differentDoodads.length).toBeGreaterThan(0);
    });
  });

  describe('Rotational Symmetry (180 degrees)', () => {
    const testSeeds = [1, 2, 7, 42, 999];

    it.each(testSeeds)('preserves 180-degree rotational symmetry for all tiles (seed %i)', (seed) => {
      const map = generateMap({ seed });
      const N = map.size;

      for (let z = 0; z < N; z++) {
        for (let x = 0; x < N; x++) {
          const t1 = map.tiles[z * N + x];
          const t2 = map.tiles[(N - 1 - z) * N + (N - 1 - x)];
          expect(t1).toBe(t2);
        }
      }
    });

    it.each(testSeeds)('preserves 180-degree rotational symmetry for starting bases (seed %i)', (seed) => {
      const map = generateMap({ seed });
      const [s0, s1] = map.starts;
      expect(s0).toEqual([20, 20]);
      expect(s1).toEqual([104, 104]);
    });

    it.each(testSeeds)('preserves 180-degree rotational symmetry for all 2x2 gold mines (seed %i)', (seed) => {
      const map = generateMap({ seed });
      const mineSet = new Set(map.goldMines.map(([mx, mz]) => `${mx},${mz}`));

      for (const [mx, mz] of map.goldMines) {
        // A 2x2 mine occupies [mx..mx+1, mz..mz+1].
        // Rotated 180 degrees, its top-left is (126 - mx, 126 - mz).
        const symKey = `${126 - mx},${126 - mz}`;
        expect(mineSet.has(symKey)).toBe(true);
      }
    });

    it.each(testSeeds)('preserves 180-degree rotational symmetry for doodads and variants (seed %i)', (seed) => {
      const map = generateMap({ seed });
      const N = map.size;
      const doodadMap = new Map<string, string>();
      for (const [dx, dz, variant] of map.doodads) {
        doodadMap.set(`${dx},${dz}`, variant);
      }

      for (const [dx, dz, variant] of map.doodads) {
        const symKey = `${N - 1 - dx},${N - 1 - dz}`;
        expect(doodadMap.has(symKey)).toBe(true);
        expect(doodadMap.get(symKey)).toBe(variant);
      }
    });
  });

  describe('Biome & Terrain Guarantees', () => {
    it('contains all 7 canonical terrain codes', () => {
      const map = generateMap({ seed: 1 });
      const presentCodes = new Set(map.tiles);
      expect(presentCodes.size).toBe(7);
      for (let code = 0; code <= 6; code++) {
        expect(presentCodes.has(code)).toBe(true);
      }
    });
  });

  describe('Mine Distribution & Resource Guarantees', () => {
    it('guarantees exactly 10 mines (3 per start + 4 contested)', () => {
      const map = generateMap({ seed: 1 });
      expect(map.goldMines.length).toBe(10);
    });

    it('enforces exact required footprint-center distance intervals for near and far mines', () => {
      for (const seed of [1, 2, 7, 42]) {
        const map = generateMap({ seed });
        const p0KeepCenter = [22, 22]; // Center of 4x4 keep at [20, 20]
        const p1KeepCenter = [106, 106]; // Center of 4x4 keep at [104, 104]

        // Measure footprint-center distances from p0KeepCenter to mine centers
        const p0Distances = map.goldMines
          .map(([mx, mz]) => {
            const mineCenter = [mx + 1, mz + 1];
            return Math.hypot(mineCenter[0] - p0KeepCenter[0], mineCenter[1] - p0KeepCenter[1]);
          })
          .sort((a, b) => a - b);

        // Near mine: exact required interval [6, 8]
        expect(p0Distances[0]).toBeGreaterThanOrEqual(6);
        expect(p0Distances[0]).toBeLessThanOrEqual(8);

        // Far mines: exact required interval [14, 18]
        expect(p0Distances[1]).toBeGreaterThanOrEqual(14);
        expect(p0Distances[1]).toBeLessThanOrEqual(18);
        expect(p0Distances[2]).toBeGreaterThanOrEqual(14);
        expect(p0Distances[2]).toBeLessThanOrEqual(18);

        // Player 1 symmetric footprint-center distances
        const p1Distances = map.goldMines
          .map(([mx, mz]) => {
            const mineCenter = [mx + 1, mz + 1];
            return Math.hypot(mineCenter[0] - p1KeepCenter[0], mineCenter[1] - p1KeepCenter[1]);
          })
          .sort((a, b) => a - b);

        expect(p1Distances[0]).toBeGreaterThanOrEqual(6);
        expect(p1Distances[0]).toBeLessThanOrEqual(8);
        expect(p1Distances[1]).toBeGreaterThanOrEqual(14);
        expect(p1Distances[1]).toBeLessThanOrEqual(18);
        expect(p1Distances[2]).toBeGreaterThanOrEqual(14);
        expect(p1Distances[2]).toBeLessThanOrEqual(18);

        // 4 contested mines in central pocket
        const contestedMines = map.goldMines.filter(([mx, mz]) => {
          const mineCenter = [mx + 1, mz + 1];
          const dist0 = Math.hypot(mineCenter[0] - p0KeepCenter[0], mineCenter[1] - p0KeepCenter[1]);
          const dist1 = Math.hypot(mineCenter[0] - p1KeepCenter[0], mineCenter[1] - p1KeepCenter[1]);
          return dist0 >= 30 && dist1 >= 30;
        });
        expect(contestedMines.length).toBe(4);

        for (const [mx, mz] of contestedMines) {
          expect(mx).toBeGreaterThanOrEqual(54);
          expect(mx + 1).toBeLessThanOrEqual(73);
          expect(mz).toBeGreaterThanOrEqual(38);
          expect(mz + 1).toBeLessThanOrEqual(89);
        }
      }
    });

    it('ensures clearance margin of passable terrain around every gold mine', () => {
      const map = generateMap({ seed: 7 });
      const N = map.size;

      for (const [mx, mz] of map.goldMines) {
        for (let dz = -1; dz <= 2; dz++) {
          for (let dx = -1; dx <= 2; dx++) {
            const x = mx + dx;
            const z = mz + dz;
            if (x >= 0 && x < N && z >= 0 && z < N) {
              const code = map.tiles[z * N + x];
              expect(isTerrainPassable(code)).toBe(true);
            }
          }
        }
      }
    });

    it('ensures no doodad is placed within any mine footprint or 1-tile clearance', () => {
      const map = generateMap({ seed: 1 });
      const doodadCoords = new Set(map.doodads.map(([dx, dz]) => `${dx},${dz}`));

      for (const [mx, mz] of map.goldMines) {
        for (let dz = -1; dz <= 2; dz++) {
          for (let dx = -1; dx <= 2; dx++) {
            const x = mx + dx;
            const z = mz + dz;
            expect(doodadCoords.has(`${x},${z}`)).toBe(false);
          }
        }
      }
    });
  });

  describe('Start Base Clearances', () => {
    it('provides clear 4x4 Keep footprints and surrounding passable area', () => {
      const map = generateMap({ seed: 1 });
      const N = map.size;

      // Check Player 0 base at [20, 20]
      for (let z = 16; z <= 27; z++) {
        for (let x = 16; x <= 27; x++) {
          const code = map.tiles[z * N + x];
          expect(isTerrainPassable(code)).toBe(true);
        }
      }

      // Check Player 1 base at [104, 104]
      for (let z = 100; z <= 111; z++) {
        for (let x = 100; x <= 111; x++) {
          const code = map.tiles[z * N + x];
          expect(isTerrainPassable(code)).toBe(true);
        }
      }
    });

    it('contains no doodads in base clearings', () => {
      const map = generateMap({ seed: 1 });
      for (const [dx, dz] of map.doodads) {
        const inP0Base = dx >= 14 && dx <= 30 && dz >= 14 && dz <= 30;
        const inP1Base = dx >= 97 && dx <= 113 && dz >= 97 && dz <= 113;
        expect(inP0Base).toBe(false);
        expect(inP1Base).toBe(false);
      }
    });
  });

  describe('Seeded Blocked Tile Doodads', () => {
    it('places doodads exclusively on blocked tiles (FOREST or ROCK)', () => {
      const map = generateMap({ seed: 42 });
      const N = map.size;

      for (const [dx, dz, variant] of map.doodads) {
        const code = map.tiles[dz * N + dx];
        expect(code === Terrain.FOREST || code === Terrain.ROCK).toBe(true);

        if (code === Terrain.FOREST) {
          expect(['tree_1', 'tree_2', 'tree_3', 'tree_4']).toContain(variant);
        } else {
          expect(['rock_1', 'rock_2']).toContain(variant);
        }
      }
    });

    it('adheres to checkerboard parity (x + z) % 2 === 0', () => {
      const map = generateMap({ seed: 1 });
      for (const [dx, dz] of map.doodads) {
        expect((dx + dz) % 2).toBe(0);
      }
    });

    it('sorts doodads canonically in row-major order (by z ascending, then x)', () => {
      const map = generateMap({ seed: 7 });
      for (let i = 1; i < map.doodads.length; i++) {
        const prev = map.doodads[i - 1];
        const curr = map.doodads[i];
        if (prev[1] === curr[1]) {
          expect(curr[0]).toBeGreaterThan(prev[0]);
        } else {
          expect(curr[1]).toBeGreaterThan(prev[1]);
        }
      }
    });

    it('ensures every checkerboard forest and rock tile has a doodad across the entire map', () => {
      for (const seed of [1, 2, 7, 42]) {
        const map = generateMap({ seed });
        const N = map.size;
        const doodadMap = new Map<string, string>();
        for (const [dx, dz, variant] of map.doodads) {
          doodadMap.set(`${dx},${dz}`, variant);
        }

        for (let z = 0; z < N; z++) {
          for (let x = 0; x < N; x++) {
            const code = map.tiles[z * N + x];
            const isBlocked = code === Terrain.FOREST || code === Terrain.ROCK;
            const isCheckerboard = (x + z) % 2 === 0;

            if (isBlocked && isCheckerboard) {
              expect(doodadMap.has(`${x},${z}`)).toBe(true);
            } else {
              expect(doodadMap.has(`${x},${z}`)).toBe(false);
            }
          }
        }
      }
    });
  });

  describe('Critical Forest Barrier & M3 Acceptance Simulation', () => {
    it('preserves the exact forest barrier coordinates from M3 contract', () => {
      for (const seed of [1, 2, 7, 42]) {
        const map = generateMap({ seed });
        const N = map.size;

        // Left barrier: x=49..53, z=38..89
        for (let z = 38; z <= 89; z++) {
          for (let x = 49; x <= 53; x++) {
            expect(map.tiles[z * N + x]).toBe(Terrain.FOREST);
          }
        }

        // Symmetric right barrier: x=74..78, z=38..89
        for (let z = 38; z <= 89; z++) {
          for (let x = 74; x <= 78; x++) {
            expect(map.tiles[z * N + x]).toBe(Terrain.FOREST);
          }
        }
      }
    });

    it('maintains open detour corridors north and south of the barrier', () => {
      const map = generateMap({ seed: 1 });
      const N = map.size;

      // North detour corridor (z in 34..37 across barrier columns 49..78)
      for (let z = 34; z <= 37; z++) {
        for (let x = 44; x <= 83; x++) {
          expect(isTerrainPassable(map.tiles[z * N + x])).toBe(true);
        }
      }

      // South detour corridor (z in 90..93 across barrier columns 49..78)
      for (let z = 90; z <= 93; z++) {
        for (let x = 44; x <= 83; x++) {
          expect(isTerrainPassable(map.tiles[z * N + x])).toBe(true);
        }
      }
    });

    it('satisfies the M3 forest detour movement test on generated map', () => {
      const map = generateMap({ seed: 1 });
      const sim = new Sim(map, 1);

      const startX = 45.5;
      const startZ = 60.5;
      const targetX = 58.5;
      const targetZ = 60.5;

      const unit = sim.world.spawnUnit(0, 'peasant', startX, startZ);
      expect(unit.x).toBe(startX);
      expect(unit.z).toBe(startZ);

      sim.issue({
        kind: 'move',
        player: 0,
        ids: [unit.id],
        x: targetX,
        z: targetZ,
        queued: false,
      });

      let detoured = false;
      let penetratedForest = false;
      const maxTicks = 1600;

      for (let tick = 0; tick < maxTicks; tick++) {
        sim.step();

        const tx = Math.floor(unit.x);
        const tz = Math.floor(unit.z);
        const tileCode = map.tiles[tz * map.size + tx];
        if (tileCode === Terrain.FOREST) {
          penetratedForest = true;
        }

        if (unit.x >= 49.0 && unit.x <= 54.0) {
          if (unit.z <= 38.0 || unit.z >= 89.0) {
            detoured = true;
          }
        }

        const distToTarget = Math.hypot(unit.x - targetX, unit.z - targetZ);
        if (distToTarget <= 0.5) {
          break;
        }
      }

      const finalDist = Math.hypot(unit.x - targetX, unit.z - targetZ);
      expect(penetratedForest).toBe(false);
      expect(detoured).toBe(true);
      expect(finalDist).toBeLessThanOrEqual(0.5);
    });
  });

  describe('Full Map Reachability', () => {
    it('connects both starts and all 10 mines in a single reachable component', () => {
      for (const seed of [1, 2, 7, 42]) {
        const map = generateMap({ seed });
        const N = map.size;

        const walkable = new Uint8Array(N * N);
        for (let z = 0; z < N; z++) {
          for (let x = 0; x < N; x++) {
            walkable[z * N + x] = isTerrainPassable(map.tiles[z * N + x]) ? 1 : 0;
          }
        }
        for (const [mx, mz] of map.goldMines) {
          for (let dz = 0; dz < 2; dz++) {
            for (let dx = 0; dx < 2; dx++) {
              walkable[(mz + dz) * N + (mx + dx)] = 0;
            }
          }
        }

        // BFS from outside Keep 0
        const visited = new Uint8Array(N * N);
        const queue: number[] = [];
        const startIdx = 24 * N + 24;
        visited[startIdx] = 1;
        queue.push(startIdx);

        while (queue.length > 0) {
          const curr = queue.shift()!;
          const cx = curr % N;
          const cz = Math.floor(curr / N);

          const neighbors = [
            cz > 0 ? (cz - 1) * N + cx : -1,
            cz < N - 1 ? (cz + 1) * N + cx : -1,
            cx > 0 ? cz * N + (cx - 1) : -1,
            cx < N - 1 ? cz * N + (cx + 1) : -1,
          ];

          for (const n of neighbors) {
            if (n >= 0 && !visited[n] && walkable[n]) {
              visited[n] = 1;
              queue.push(n);
            }
          }
        }

        // Reach Start 1
        expect(visited[103 * N + 103]).toBe(1);

        // Reach all 10 mines
        for (const [mx, mz] of map.goldMines) {
          let mineAdjacentReachable = false;
          for (let dz = -1; dz <= 2; dz++) {
            for (let dx = -1; dx <= 2; dx++) {
              if (dx >= 0 && dx <= 1 && dz >= 0 && dz <= 1) continue;
              const x = mx + dx;
              const z = mz + dz;
              if (x >= 0 && x < N && z >= 0 && z < N && visited[z * N + x]) {
                mineAdjacentReachable = true;
                break;
              }
            }
            if (mineAdjacentReachable) break;
          }
          expect(mineAdjacentReachable).toBe(true);
        }
      }
    });
  });

  describe('Serialization & parseMap Round-Trip', () => {
    it('round-trips through serializeMap and parseMap perfectly', () => {
      const original = generateMap({ seed: 1 });
      const serialized = serializeMap(original);
      const parsed: GameMap = parseMap(serialized);

      expect(parsed.version).toBe(1);
      expect(parsed.id).toBe(original.id);
      expect(parsed.name).toBe(original.name);
      expect(parsed.size).toBe(original.size);
      expect(parsed.players).toBe(original.players);
      expect(parsed.tiles.length).toBe(original.tiles.length);
      expect(Buffer.compare(Buffer.from(parsed.tiles), Buffer.from(original.tiles))).toBe(0);
      expect(parsed.goldMines).toEqual(original.goldMines);
      expect(parsed.starts).toEqual(original.starts);
      expect(parsed.doodads).toEqual(original.doodads);
    });
  });

  describe('CLI Execution', () => {
    it('rejects unsupported player counts in CLI with non-zero exit code', async () => {
      const code3 = await runCli(['--players', '3', '--out', 'test_fail']);
      expect(code3).not.toBe(0);

      const code4 = await runCli(['--players4', '--out', 'test_fail']);
      expect(code4).not.toBe(0);

      const code1 = await runCli(['--players', '1', '--out', 'test_fail']);
      expect(code1).not.toBe(0);
    });

    it('rejects missing --out flag in CLI with non-zero exit code', async () => {
      const code = await runCli(['--seed', '1', '--players', '2']);
      expect(code).not.toBe(0);
    });

    it('rejects invalid seed in CLI with non-zero exit code', async () => {
      const code = await runCli(['--seed', 'abc', '--players', '2', '--out', 'test_out']);
      expect(code).not.toBe(0);
    });

    it('executes CLI and writes a valid map file to disk', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mapgen-cli-test-'));
      const tmpFile = path.join(tmpDir, 'cli_test_map.json');

      try {
        const exitCode = await runCli(['--seed', '7', '--players', '2', '--out', tmpFile]);
        expect(exitCode).toBe(0);
        expect(fs.existsSync(tmpFile)).toBe(true);

        const content = fs.readFileSync(tmpFile, 'utf8');
        const parsed = parseMap(content);
        expect(parsed.size).toBe(128);
        expect(parsed.players).toBe(2);
        expect(parsed.goldMines.length).toBe(10);
        expect(parsed.starts.length).toBe(2);
        expect(parsed.doodads.length).toBeGreaterThan(0);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
