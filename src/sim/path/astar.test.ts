import { describe, expect, it } from 'vitest';
import { Grid } from '../grid';
import type { GameMap } from '../map';
import { Terrain } from '../map';
import { AStarSearch, hasLineOfSight, stringPull } from './astar';

function makeEmptyMap(size = 12): GameMap {
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

describe('AStarSearch and LOS', () => {
  it('routes around an obstacle wall', () => {
    const grid = new Grid(makeEmptyMap(10));
    // Wall from (5, 2) to (5, 7)
    grid.setBuilding(5, 2, 1, 6, true);

    const search = new AStarSearch(grid, 2, 5, 8, 5, 0);
    const result = search.step(1000);

    expect(result.status).toBe('found');
    expect(search.rawPath).not.toBeNull();
    const path = search.rawPath!;
    expect(path.length).toBeGreaterThan(0);

    // Verify start and end
    expect(path[0]).toEqual({ x: 2.5, z: 5.5 });
    expect(path[path.length - 1]).toEqual({ x: 8.5, z: 5.5 });

    // Verify all points on path are passable
    for (const pt of path) {
      expect(grid.isPassable(pt.x, pt.z, 0)).toBe(true);
    }

    // Verify it routed around the wall (z <= 1 or z >= 8)
    const crossedX = path.some((p) => p.x >= 4.5 && p.x <= 5.5 && (p.z <= 1.5 || p.z >= 8.5));
    expect(crossedX).toBe(true);
  });

  it('strictly prevents diagonal corner cuts', () => {
    // 4x4 grid:
    // (1, 0) is wall, (0, 1) is wall
    // Route from (0, 0) to (2, 2)
    // Direct diagonal step to (1, 1) is forbidden because (1, 0) and (0, 1) are walls.
    const grid = new Grid(makeEmptyMap(4));
    grid.setBuilding(1, 0, 1, 1, true);
    grid.setBuilding(0, 1, 1, 1, true);

    const search = new AStarSearch(grid, 0, 0, 2, 2, 0);
    const result = search.step(100);

    // Since (0, 0) is cut off by the two walls and boundary, it should be not found
    expect(result.status).toBe('not_found');
  });

  it('breaks ties deterministically across runs', () => {
    // Symmetric map and diagonal path
    const map = makeEmptyMap(10);
    const grid1 = new Grid(map);
    const grid2 = new Grid(map);

    const search1 = new AStarSearch(grid1, 1, 1, 8, 8, 0);
    search1.step(500);

    const search2 = new AStarSearch(grid2, 1, 1, 8, 8, 0);
    search2.step(500);

    expect(search1.rawPath).toEqual(search2.rawPath);
  });

  it('pauses and resumes search across budget slices', () => {
    const grid = new Grid(makeEmptyMap(20));
    // Long wall
    grid.setBuilding(10, 0, 1, 15, true);

    const search = new AStarSearch(grid, 2, 5, 18, 5, 0);

    // Step with budget of only 5 expansions
    const step1 = search.step(5);
    expect(step1.status).toBe('in_progress');
    expect(step1.expansions).toBe(5);

    // Step with budget of 10 more expansions
    const step2 = search.step(10);
    expect(step2.status).toBe('in_progress');
    expect(step2.expansions).toBe(10);

    // Step with remaining needed expansions
    const step3 = search.step(2000);
    expect(step3.status).toBe('found');
    expect(search.rawPath).not.toBeNull();
  });

  it('checks line of sight and prevents cutting blocked corners', () => {
    const grid = new Grid(makeEmptyMap(6));

    // Clear straight line
    expect(hasLineOfSight(grid, 1.5, 1.5, 4.5, 1.5, 0)).toBe(true);

    // Wall in between
    grid.setBuilding(3, 1, 1, 1, true);
    expect(hasLineOfSight(grid, 1.5, 1.5, 4.5, 1.5, 0)).toBe(false);

    // Diagonal corner test:
    // (1, 0) is wall, (0, 1) is open, (0, 0) is open, (1, 1) is open.
    const grid2 = new Grid(makeEmptyMap(4));
    grid2.setBuilding(1, 0, 1, 1, true);

    // Diagonal line from (0.5, 0.5) to (1.5, 1.5) touches the corner of (1, 0)
    // Must NOT have line of sight!
    expect(hasLineOfSight(grid2, 0.5, 0.5, 1.5, 1.5, 0)).toBe(false);

    // Parallel cardinal line alongside wall at distance 0.5 (e.g. z = 1.5)
    // Must HAVE line of sight
    expect(hasLineOfSight(grid2, 0.5, 1.5, 2.5, 1.5, 0)).toBe(true);
  });

  it('string pulls waypoints into straight segments without cutting corners', () => {
    const grid = new Grid(makeEmptyMap(10));
    // Obstacle at (5, 5)
    grid.setBuilding(5, 5, 2, 2, true);

    const rawPath = [
      { x: 1.5, z: 1.5 },
      { x: 2.5, z: 1.5 },
      { x: 3.5, z: 1.5 },
      { x: 4.5, z: 1.5 },
      { x: 5.5, z: 1.5 },
    ];

    // Open line should be pulled to 2 points: start and end
    const pulled = stringPull(grid, rawPath, 0);
    expect(pulled.length).toBe(2);
    expect(pulled[0]).toEqual({ x: 1.5, z: 1.5 });
    expect(pulled[1]).toEqual({ x: 5.5, z: 1.5 });
  });
});
