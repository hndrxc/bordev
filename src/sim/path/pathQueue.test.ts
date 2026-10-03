import { describe, expect, it } from 'vitest';
import { Grid } from '../grid';
import type { GameMap } from '../map';
import { Terrain } from '../map';
import { PathQueue } from './pathQueue';

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

describe('PathQueue', () => {
  it('enqueues and processes a path request around an obstacle', () => {
    const grid = new Grid(makeEmptyMap(10));
    // Obstacle dividing path
    grid.setBuilding(5, 0, 1, 4, true);
    const queue = new PathQueue(grid);

    queue.request(1, 1.5, 1.5, 8.5, 1.5, 0);
    expect(queue.pendingCount).toBe(1);

    const results = queue.process(25000);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe(1);
    expect(results[0].target).toEqual({ x: 8.5, z: 1.5 });
    expect(results[0].path.length).toBeGreaterThan(0);
    expect(results[0].path[results[0].path.length - 1]).toEqual({ x: 8.5, z: 1.5 });
    expect(queue.pendingCount).toBe(0);
    expect(queue.lastExpansions).toBeGreaterThan(0);
    expect(queue.totalExpansions).toBe(queue.lastExpansions);
  });

  it('uses direct LOS shortcut when path is unblocked without expansions', () => {
    const grid = new Grid(makeEmptyMap(10));
    const queue = new PathQueue(grid);

    queue.request(1, 1.5, 1.5, 8.5, 1.5, 0);
    const results = queue.process(25000);
    expect(results.length).toBe(1);
    expect(results[0].target).toEqual({ x: 8.5, z: 1.5 });
    expect(results[0].path).toEqual([{ x: 8.5, z: 1.5 }]);
    expect(queue.lastExpansions).toBe(0);
  });

  it('cancels pending requests by id', () => {
    const grid = new Grid(makeEmptyMap(10));
    const queue = new PathQueue(grid);

    queue.request(10, 1.5, 1.5, 5.5, 5.5, 0);
    expect(queue.pendingCount).toBe(1);

    queue.cancel(10);
    expect(queue.pendingCount).toBe(0);

    const results = queue.process(25000);
    expect(results.length).toBe(0);
  });

  it('enforces a hard expansion budget and resumes search', () => {
    const grid = new Grid(makeEmptyMap(20));
    // Wall dividing x = 10 from z = 0 to 16
    grid.setBuilding(10, 0, 1, 16, true);

    const queue = new PathQueue(grid);
    // Route from (2.5, 5.5) to (18.5, 5.5) requires routing around z=16
    queue.request(1, 2.5, 5.5, 18.5, 5.5, 0);

    // Process with very small budget
    const results1 = queue.process(5);
    expect(results1.length).toBe(0);
    expect(queue.pendingCount).toBe(1);
    expect(queue.lastExpansions).toBe(5);
    expect(queue.totalExpansions).toBe(5);

    // Process with another small budget slice
    const results2 = queue.process(5);
    expect(results2.length).toBe(0);
    expect(queue.pendingCount).toBe(1);
    expect(queue.lastExpansions).toBe(5);
    expect(queue.totalExpansions).toBe(10);

    // Process with enough budget to finish
    const results3 = queue.process(25000);
    expect(results3.length).toBe(1);
    expect(results3[0].id).toBe(1);
    expect(queue.pendingCount).toBe(0);
    expect(queue.lastExpansions).toBeGreaterThan(0);
    expect(queue.totalExpansions).toBeGreaterThan(10);
  });

  it('resets and recomputes pending requests when grid revision changes', () => {
    const grid = new Grid(makeEmptyMap(10));
    const queue = new PathQueue(grid);

    // Queue request 1 from (1.5, 1.5) to (8.5, 8.5)
    queue.request(1, 1.5, 1.5, 8.5, 8.5, 0);
    expect(queue.pendingCount).toBe(1);

    // A building is placed, incrementing grid.revision
    grid.setBuilding(5, 5, 2, 2, true);

    // Processing should NOT discard the request; it should re-evaluate against new revision
    const results = queue.process(25000);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe(1);
    expect(queue.pendingCount).toBe(0);
    // Path must not pass through the new building
    for (const pt of results[0].path) {
      expect(grid.isPassable(pt.x, pt.z, 0)).toBe(true);
    }
  });

  it('resets mid-search state on grid revision change', () => {
    const grid = new Grid(makeEmptyMap(20));
    // Wall across x = 10
    grid.setBuilding(10, 0, 1, 16, true);
    const queue = new PathQueue(grid);

    queue.request(1, 2.5, 5.5, 18.5, 5.5, 0);
    // Run 5 expansions mid-search
    queue.process(5);
    expect(queue.pendingCount).toBe(1);

    // Grid modified mid-search (e.g. gap opened at z=5)
    grid.setBuilding(10, 4, 1, 3, false);

    // Subsequent process should reset search and take the newly opened shortcut
    const results = queue.process(25000);
    expect(results.length).toBe(1);
    expect(queue.pendingCount).toBe(0);
    // Routed through the new gap (z around 5.5) rather than around z=16
    const maxZ = Math.max(...results[0].path.map((p) => p.z));
    expect(maxZ).toBeLessThan(10);
  });

  it('clamps off-map requested targets to valid edge tile center', () => {
    const grid = new Grid(makeEmptyMap(10));
    const queue = new PathQueue(grid);

    // Off-map target (-3, 5.5)
    queue.request(1, 2.5, 5.5, -3, 5.5, 0);
    const results = queue.process(25000);
    expect(results.length).toBe(1);
    expect(results[0].target.x).toBe(0.5);
    expect(results[0].target.z).toBe(5.5);
    expect(results[0].path[results[0].path.length - 1]).toEqual({ x: 0.5, z: 5.5 });
  });

  it('resolves unreachable destination in a walled pocket to nearest reachable tile', () => {
    const grid = new Grid(makeEmptyMap(10));
    // Enclosed 3x3 pocket at [4..6] x [4..6]
    for (let x = 4; x <= 6; x++) {
      for (let z = 4; z <= 6; z++) {
        if (x === 5 && z === 5) continue;
        grid.setBuilding(x, z, 1, 1, true);
      }
    }

    const queue = new PathQueue(grid);
    // Unit at (1.5, 1.5) ordered into center of pocket at (5.5, 5.5)
    queue.request(1, 1.5, 1.5, 5.5, 5.5, 0);

    const results = queue.process(25000);
    expect(results.length).toBe(1);
    const res = results[0];
    expect(res.id).toBe(1);

    // Target must NOT be (5.5, 5.5); must be outside the pocket
    expect(res.target.x === 5.5 && res.target.z === 5.5).toBe(false);
    expect(grid.isPassable(res.target.x, res.target.z, 0)).toBe(true);

    // Final path waypoint must reach this nearest reachable target
    expect(res.path[res.path.length - 1]).toEqual(res.target);
  });

  it('routes through gates for owner but around for enemies', () => {
    const grid = new Grid(makeEmptyMap(12));
    // Wall across x = 6 from z = 0 to 8
    grid.setBuilding(6, 0, 1, 9, true);
    // Gate at x = 6, z = 4 owned by player 0
    grid.setGate(6, 4, 1, 1, 0);

    const queue = new PathQueue(grid);

    // Player 0 (owner) paths directly through gate
    queue.request(1, 2.5, 4.5, 10.5, 4.5, 0);
    const resultsOwner = queue.process(25000);
    expect(resultsOwner.length).toBe(1);
    // Owner path goes straight through gate (z remains ~4.5)
    const ownerPath = resultsOwner[0].path;
    const ownerMaxZ = Math.max(...ownerPath.map((p) => p.z));
    expect(ownerMaxZ).toBeLessThan(6); // did not detour around the wall

    // Player 1 (enemy) must detour around the wall (z >= 9)
    queue.request(2, 2.5, 4.5, 10.5, 4.5, 1);
    const resultsEnemy = queue.process(25000);
    expect(resultsEnemy.length).toBe(1);
    const enemyPath = resultsEnemy[0].path;
    const enemyMaxZ = Math.max(...enemyPath.map((p) => p.z));
    expect(enemyMaxZ).toBeGreaterThanOrEqual(9); // detoured around wall
  });
});
