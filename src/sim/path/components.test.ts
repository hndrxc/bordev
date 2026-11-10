import { describe, expect, it } from 'vitest';
import { Grid } from '../grid';
import type { GameMap } from '../map';
import { Terrain } from '../map';
import {
  ComponentManager,
  computeComponentLabels,
  findNearestTileInComponent,
  findStartComponent,
} from './components';

function makeEmptyMap(size = 10): GameMap {
  return {
    version: 1,
    id: 'test_map',
    name: 'Test Map',
    size,
    players: 2,
    tiles: new Uint8Array(size * size).fill(Terrain.GRASS),
    goldMines: [],
    starts: [],
    doodads: [],
  };
}

describe('Components', () => {
  it('assigns positive component labels to passable tiles and 0 to impassable', () => {
    const grid = new Grid(makeEmptyMap(6));
    grid.setBuilding(2, 2, 2, 2, true);

    const labels = computeComponentLabels(grid, 0);

    // Impassable building tiles have label 0
    expect(labels[2 * 6 + 2]).toBe(0);
    expect(labels[2 * 6 + 3]).toBe(0);
    expect(labels[3 * 6 + 2]).toBe(0);
    expect(labels[3 * 6 + 3]).toBe(0);

    // Surrounding open tiles are connected
    const comp0 = labels[0];
    expect(comp0).toBeGreaterThan(0);
    expect(labels[5 * 6 + 5]).toBe(comp0);
  });

  it('enforces no diagonal corner cutting between diagonal touching obstacles', () => {
    // 4x4 grid:
    // (1, 0) is wall, (0, 1) is wall
    // Open tiles at (0, 0) and (1, 1) touch at a diagonal corner.
    // They must NOT be connected through that corner!
    const grid = new Grid(makeEmptyMap(4));
    // Build a complete wall dividing (0, 0) from the rest of the map except diagonal corner
    // Walls at (1, 0), (1, 1) ... wait:
    // If (1, 0) is wall, (0, 1) is wall:
    grid.setBuilding(1, 0, 1, 1, true);
    grid.setBuilding(0, 1, 1, 1, true);

    const labels = computeComponentLabels(grid, 0);

    // (0, 0) can only step to (1, 0) [blocked], (0, 1) [blocked], or diagonal (1, 1).
    // Diagonal to (1, 1) requires both (1, 0) and (0, 1) to be passable.
    // Both are blocked, so (0, 0) cannot step to (1, 1)!
    expect(labels[0 * 4 + 0]).toBeGreaterThan(0);
    expect(labels[1 * 4 + 1]).toBeGreaterThan(0);
    expect(labels[0 * 4 + 0]).not.toBe(labels[1 * 4 + 1]);
  });

  it('distinguishes connected components based on gate permissions', () => {
    // 10x10 map: wall across z = 5 from x = 0 to 9, with gate at x = 5
    const grid = new Grid(makeEmptyMap(10));
    // Wall across x=0..9 at z=5
    grid.setBuilding(0, 5, 10, 1, true);
    // Gate at x=5, z=5 owned by player 0
    grid.setGate(5, 5, 1, 1, 0);

    // For player 0 (owner): north (z=2) and south (z=8) are connected through gate
    const labelsOwner = computeComponentLabels(grid, 0);
    const northTile = 2 * 10 + 5;
    const southTile = 8 * 10 + 5;
    expect(labelsOwner[northTile]).toBe(labelsOwner[southTile]);

    // For player 1 (enemy): gate is impassable, north and south are in different components
    const labelsEnemy = computeComponentLabels(grid, 1);
    expect(labelsEnemy[northTile]).not.toBe(labelsEnemy[southTile]);
  });

  it('manages component cache and invalidates on grid revision', () => {
    const grid = new Grid(makeEmptyMap(8));
    const manager = new ComponentManager();

    const labels1 = manager.getLabels(grid, 0);
    const labels2 = manager.getLabels(grid, 0);
    expect(labels1).toBe(labels2); // Cached same instance

    // Change grid: revision increments
    grid.setBuilding(3, 3, 2, 2, true);
    const labels3 = manager.getLabels(grid, 0);
    expect(labels3).not.toBe(labels1); // Recomputed
    expect(labels3[3 * 8 + 3]).toBe(0);
  });

  it('finds nearest reachable tile via target BFS when target is in an enclosed pocket', () => {
    // 10x10 map with a closed 3x3 pocket at [4..6] x [4..6]
    // Walls at perimeter of pocket:
    // x in 4..6, z in 4..6 with wall at:
    // (4,4), (5,4), (6,4)
    // (4,5),        (6,5)
    // (4,6), (5,6), (6,6)
    // (5,5) is open but completely enclosed!
    const grid = new Grid(makeEmptyMap(10));
    for (let x = 4; x <= 6; x++) {
      for (let z = 4; z <= 6; z++) {
        if (x === 5 && z === 5) continue; // open center
        grid.setBuilding(x, z, 1, 1, true);
      }
    }

    const labels = computeComponentLabels(grid, 0);
    const centerIdx = 5 * 10 + 5;
    const outerIdx = 1 * 10 + 1;
    const centerComp = labels[centerIdx];
    const outerComp = labels[outerIdx];

    expect(centerComp).toBeGreaterThan(0);
    expect(outerComp).toBeGreaterThan(0);
    expect(centerComp).not.toBe(outerComp);

    // Unit at outer (1, 1) ordered to click inside pocket at (5.5, 5.5)
    const nearest = findNearestTileInComponent(grid, labels, outerComp, 5, 5, 5.5, 5.5);

    // Nearest tile must belong to outer component!
    const nearestIdx = nearest.tz * 10 + nearest.tx;
    expect(labels[nearestIdx]).toBe(outerComp);

    // Nearest tile must be right adjacent to the outer wall of the pocket
    // (e.g. distance to (5.5, 5.5) should be minimal among outer tiles)
    expect(Math.abs(nearest.tx - 5)).toBeLessThanOrEqual(2);
    expect(Math.abs(nearest.tz - 5)).toBeLessThanOrEqual(2);
  });

  it('recovers start component when starting inside an impassable tile', () => {
    const grid = new Grid(makeEmptyMap(8));
    grid.setBuilding(2, 2, 2, 2, true);
    const labels = computeComponentLabels(grid, 0);

    // Unit starts at (2.5, 2.5), inside the building
    const startInfo = findStartComponent(grid, labels, 2.5, 2.5, 0);
    expect(startInfo.compId).toBeGreaterThan(0);
    // Nearest passable tile found
    expect(grid.isPassable(startInfo.tx, startInfo.tz, 0)).toBe(true);
  });
});
