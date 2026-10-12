import { describe, expect, it } from 'vitest';
import type { BuildingEntity } from './entity.js';
import { Terrain, type GameMap } from './map.js';
import { Sim } from './sim.js';
import { findBlockingWall } from './systems/gates.js';

const MAP_SIZE = 32;

/** Two players-plus map with no starting bases so nothing contaminates topology. */
function makeEmptyMap(): GameMap {
  return {
    version: 1,
    id: 'test_breach_topology_map',
    name: 'Test Breach Topology Map',
    size: MAP_SIZE,
    players: 3,
    tiles: new Uint8Array(MAP_SIZE * MAP_SIZE).fill(Terrain.GRASS),
    goldMines: [],
    starts: [],
    doodads: [],
  };
}

function makeSim(map: GameMap = makeEmptyMap()): Sim {
  const sim = new Sim(map, 1);
  expect(sim.world.entities.filter((e) => e !== undefined)).toHaveLength(0);
  return sim;
}

/** Hollow square ring of 1x1 stone walls spanning x/z in [lo, hi]. */
function buildRing(
  sim: Sim,
  owner: number,
  lo: number,
  hi: number,
): BuildingEntity[] {
  const walls: BuildingEntity[] = [];
  for (let x = lo; x <= hi; x++) {
    for (let z = lo; z <= hi; z++) {
      if (x === lo || x === hi || z === lo || z === hi) {
        walls.push(sim.world.spawnBuilding(owner, 'stone_wall', x, z, true));
      }
    }
  }
  return walls;
}

function onRing(w: BuildingEntity, lo: number, hi: number): boolean {
  return w.x === lo || w.x === hi || w.z === lo || w.z === hi;
}

describe('M7 breach topology', () => {
  it('chooses a wall whose removal actually breaches the ring, never an unrelated spur', () => {
    const sim = makeSim();
    const { world } = sim;
    buildRing(sim, 1, 10, 14);
    // Spur toward the attacker that separates nothing.
    for (let x = 6; x <= 9; x++) {
      world.spawnBuilding(1, 'stone_wall', x, 12, true);
    }
    const target = world.spawnUnit(1, 'peasant', 12.5, 12.9);
    const attacker = world.spawnUnit(0, 'man_at_arms', 3.5, 12.5);

    const wall = findBlockingWall(world, attacker, target);
    expect(wall).toBeDefined();
    // Only (10,11) and (10,13) reach the interior: (10,12) is shielded by the
    // spur tile (9,12) and diagonal moves cannot cut the corners.
    expect(wall!.x).toBe(10);
    expect([11, 13]).toContain(wall!.z);
    expect(findBlockingWall(world, attacker, target)).toBe(wall);

    world.removeEntity(wall!.id);
    expect(findBlockingWall(world, attacker, target)).toBeUndefined();
  });

  it('breaches multiple wall layers in sequence along the real route', () => {
    const sim = makeSim();
    const { world } = sim;
    buildRing(sim, 1, 8, 16);
    buildRing(sim, 1, 10, 14);
    const target = world.spawnUnit(1, 'peasant', 12.5, 12.5);
    const attacker = world.spawnUnit(0, 'man_at_arms', 3.5, 12.5);

    const outer = findBlockingWall(world, attacker, target);
    expect(outer).toBeDefined();
    expect(onRing(outer!, 8, 16)).toBe(true);
    world.removeEntity(outer!.id);

    const inner = findBlockingWall(world, attacker, target);
    expect(inner).toBeDefined();
    expect(inner).not.toBe(outer);
    expect(onRing(inner!, 10, 14)).toBe(true);
    expect(
      inner!.x >= 10 && inner!.x <= 14 && inner!.z >= 10 && inner!.z <= 14,
    ).toBe(true);
    world.removeEntity(inner!.id);

    expect(findBlockingWall(world, attacker, target)).toBeUndefined();
  });

  it('breaches toward a building footprint through its enclosing ring', () => {
    const sim = makeSim();
    const { world } = sim;
    buildRing(sim, 1, 8, 16);
    const keep = world.spawnBuilding(1, 'barracks', 11, 11, true);
    const attacker = world.spawnUnit(0, 'man_at_arms', 3.5, 12.5);

    const wall = findBlockingWall(world, attacker, keep);
    expect(wall).toBeDefined();
    expect(onRing(wall!, 8, 16)).toBe(true);
    world.removeEntity(wall!.id);
    expect(findBlockingWall(world, attacker, keep)).toBeUndefined();
  });

  it('terrain-isolated enemy does not trigger an arbitrary wall attack', () => {
    const map = makeEmptyMap();
    for (let x = 8; x <= 16; x++) {
      for (let z = 8; z <= 16; z++) {
        if (x === 8 || x === 16 || z === 8 || z === 16) {
          map.tiles[z * MAP_SIZE + x] = Terrain.WATER;
        }
      }
    }
    const sim = makeSim(map);
    const { world } = sim;
    const islandTarget = world.spawnUnit(1, 'peasant', 12.5, 12.5);
    // Enemy walls on the shore and elsewhere cannot bridge the water.
    world.spawnBuilding(1, 'stone_wall', 6, 12, true);
    world.spawnBuilding(1, 'stone_wall', 7, 12, true);
    world.spawnBuilding(1, 'stone_wall', 28, 28, true);
    const attacker = world.spawnUnit(0, 'man_at_arms', 3.5, 12.5);

    expect(findBlockingWall(world, attacker, islandTarget)).toBeUndefined();
  });

  it('ranged attacker with a reachable firing tile is not redirected to a wall', () => {
    const sim = makeSim();
    const { world } = sim;
    buildRing(sim, 1, 10, 14);
    const target = world.spawnUnit(1, 'peasant', 12.5, 12.5);

    // Already in range (5 tiles, range 6) behind the ring.
    const inRange = world.spawnUnit(0, 'longbowman', 7.5, 12.5);
    expect(findBlockingWall(world, inRange, target)).toBeUndefined();

    // Out of range (9 tiles) but its component contains firing tiles outside the ring.
    const farAway = world.spawnUnit(0, 'longbowman', 3.5, 12.5);
    expect(findBlockingWall(world, farAway, target)).toBeUndefined();
  });

  it('ranged attacker with no reachable firing tile breaches the wall nearest a firing position', () => {
    const sim = makeSim();
    const { world } = sim;
    // Solid 13x13 wall block with a single hollow tile at (12,12).
    for (let x = 6; x <= 18; x++) {
      for (let z = 6; z <= 18; z++) {
        if (x !== 12 || z !== 12) {
          world.spawnBuilding(1, 'stone_wall', x, z, true);
        }
      }
    }
    const target = world.spawnUnit(1, 'peasant', 12.5, 12.5);
    const archer = world.spawnUnit(0, 'longbowman', 3.5, 12.5);

    // Every free tile is >6 tiles from the target; (6,12) is the first wall
    // tile on the cheapest route whose own centre is within range 6.
    const wall = findBlockingWall(world, archer, target);
    expect(wall).toBeDefined();
    expect(wall!.x).toBe(6);
    expect(wall!.z).toBe(12);
  });
});
