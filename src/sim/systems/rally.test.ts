import { describe, expect, it } from 'vitest';
import { type GameMap, Terrain } from '../map.js';
import { World } from '../world.js';
import { Rng } from '../rng.js';
import type { BuildingEntity, UnitEntity } from '../entity.js';
import { updateFaith } from './faith.js';
import { applyTrainCommand, setRally, updateProduction } from './production.js';
import { resolveRallyPoint, resolveRallyTarget } from './rally.js';

function makeTestWorld(size = 32): World {
  const map: GameMap = {
    version: 1,
    id: 'rally_test_map',
    name: 'Rally Test Map',
    size,
    players: 2,
    tiles: new Uint8Array(size * size).fill(Terrain.GRASS),
    goldMines: [],
    starts: [
      [4, 4],
      [size - 8, size - 8],
    ],
    doodads: [],
  };
  const world = new World(map, new Rng(42), { 0: 'crown', 1: 'crown' });
  for (let i = 0; i < world.entities.length; i++) {
    const ent = world.entities[i];
    if (ent) world.removeEntity(ent.id);
  }
  world.events.length = 0;

  const p0 = world.players[0];
  p0.food = 1000;
  p0.gold = 1000;
  p0.age = 1;
  p0.eliminated = false;
  return world;
}

/** Trains one peasant at the keep and returns the unit it spawns. */
function trainPeasant(world: World, keep: BuildingEntity): UnitEntity {
  updateFaith(world);
  const before = new Set(world.entities.filter((e) => e).map((e) => e!.id));
  expect(
    applyTrainCommand(world, {
      kind: 'train',
      player: 0,
      buildingId: keep.id,
      unitType: 'peasant',
    }),
  ).toBe(true);
  keep.trainingQueue[0].progress = 1000;
  updateProduction(world);
  const spawned = world.entities.find(
    (e): e is UnitEntity =>
      !!e && e.kind === 'unit' && e.type === 'peasant' && !before.has(e.id),
  );
  expect(spawned).toBeDefined();
  return spawned!;
}

function rallyTo(
  world: World,
  keep: BuildingEntity,
  x: number,
  z: number,
  targetId?: number,
): boolean {
  return setRally(world, {
    kind: 'setRally',
    player: 0,
    buildingId: keep.id,
    x,
    z,
    targetId,
  });
}

describe('M6 rally targets', () => {
  it('ground rally stores coordinates only and clamps to the map', () => {
    const world = makeTestWorld();
    const keep = world.spawnBuilding(0, 'keep', 10, 10, true);

    expect(rallyTo(world, keep, 25, 30)).toBe(true);
    expect(keep.rallyPoint).toEqual({ x: 25, z: 30 });

    expect(rallyTo(world, keep, -5, 999)).toBe(true);
    expect(keep.rallyPoint).toEqual({ x: 0, z: 32 });
  });

  it('rejects non-owner, non-production, non-building and non-finite rallies', () => {
    const world = makeTestWorld();
    const keep = world.spawnBuilding(0, 'keep', 10, 10, true);
    const cottage = world.spawnBuilding(0, 'cottage', 2, 2, true);
    const peasant = world.spawnUnit(0, 'peasant', 20, 20);
    expect(rallyTo(world, keep, 25, 30)).toBe(true);

    expect(
      setRally(world, {
        kind: 'setRally',
        player: 1,
        buildingId: keep.id,
        x: 5,
        z: 5,
      }),
    ).toBe(false);
    expect(rallyTo(world, cottage, 5, 5)).toBe(false);
    expect(
      setRally(world, {
        kind: 'setRally',
        player: 0,
        buildingId: peasant.id,
        x: 5,
        z: 5,
      }),
    ).toBe(false);
    expect(rallyTo(world, keep, Number.NaN, 5)).toBe(false);
    expect(rallyTo(world, keep, 5, Number.POSITIVE_INFINITY)).toBe(false);

    expect(keep.rallyPoint).toEqual({ x: 25, z: 30 });
    expect(cottage.rallyPoint).toBeUndefined();
    expect('rallyPoint' in peasant).toBe(false);
  });

  it('follows a moved unit target to its current position at spawn', () => {
    const world = makeTestWorld();
    const keep = world.spawnBuilding(0, 'keep', 10, 10, true);
    const target = world.spawnUnit(0, 'peasant', 20, 20);

    expect(rallyTo(world, keep, 25, 30, target.id)).toBe(true);
    expect(keep.rallyPoint).toEqual({
      x: 25,
      z: 30,
      targetId: target.id,
      targetRef: target,
    });
    expect(resolveRallyPoint(world, keep.rallyPoint!)).toEqual({
      x: 20,
      z: 20,
    });

    target.x = 22.5;
    target.z = 18.5;
    expect(resolveRallyPoint(world, keep.rallyPoint!)).toEqual({
      x: 22.5,
      z: 18.5,
    });

    const spawned = trainPeasant(world, keep);
    expect(spawned.order).toEqual({ kind: 'move', x: 22.5, z: 18.5 });
    expect(spawned.pathPending).toBe(true);
    // Live target is retained for later spawns.
    expect(keep.rallyPoint!.targetRef).toBe(target);
  });

  it('paths to a safe perimeter tile of a building target, not its footprint', () => {
    const world = makeTestWorld();
    const keep = world.spawnBuilding(0, 'keep', 4, 4, true);
    const target = world.spawnBuilding(0, 'cottage', 20, 20, true);

    expect(rallyTo(world, keep, 5, 5, target.id)).toBe(true);
    expect(resolveRallyPoint(world, keep.rallyPoint!)).toEqual({
      x: target.x + target.width * 0.5,
      z: target.z + target.height * 0.5,
    });

    const spawned = trainPeasant(world, keep);
    const order = spawned.order!;
    expect(order.kind).toBe('move');
    const { x, z } = order as { x: number; z: number };

    const outside =
      x < target.x ||
      x > target.x + target.width ||
      z < target.z ||
      z > target.z + target.height;
    expect(outside).toBe(true);
    // Within the one-tile ring around the footprint.
    expect(x).toBeGreaterThanOrEqual(target.x - 1);
    expect(x).toBeLessThanOrEqual(target.x + target.width + 1);
    expect(z).toBeGreaterThanOrEqual(target.z - 1);
    expect(z).toBeLessThanOrEqual(target.z + target.height + 1);
    expect(world.grid.canOccupy(x, z, spawned.radius, 0)).toBe(true);
    // Keep is up-left of the cottage, so the nearest ring tile is on its near corner.
    expect(x).toBeLessThan(target.x + 1);
    expect(z).toBeLessThan(target.z + 1);
  });

  it('falls back to stored ground coordinates when the target dies', () => {
    const world = makeTestWorld();
    const keep = world.spawnBuilding(0, 'keep', 10, 10, true);
    const target = world.spawnUnit(0, 'peasant', 20, 20);
    rallyTo(world, keep, 25, 30, target.id);

    target.hp = 0;
    expect(resolveRallyTarget(world, keep.rallyPoint!)).toBeUndefined();
    expect(resolveRallyPoint(world, keep.rallyPoint!)).toEqual({
      x: 25,
      z: 30,
    });

    const spawned = trainPeasant(world, keep);
    expect(spawned.order).toEqual({ kind: 'move', x: 25, z: 30 });
    expect(keep.rallyPoint).toEqual({ x: 25, z: 30 });
  });

  it('falls back to ground when the target ID is recycled by a different entity', () => {
    const world = makeTestWorld();
    const keep = world.spawnBuilding(0, 'keep', 10, 10, true);
    const target = world.spawnUnit(0, 'peasant', 20, 20);
    const oldId = target.id;
    rallyTo(world, keep, 25, 30, oldId);

    world.removeEntity(oldId);
    expect(world.getEntity(oldId)).toBeUndefined();
    const impostor = world.spawnUnit(1, 'peasant', 5, 25);
    expect(impostor.id).toBe(oldId);

    expect(resolveRallyTarget(world, keep.rallyPoint!)).toBeUndefined();
    expect(resolveRallyPoint(world, keep.rallyPoint!)).toEqual({
      x: 25,
      z: 30,
    });

    const spawned = trainPeasant(world, keep);
    expect(spawned.order).toEqual({ kind: 'move', x: 25, z: 30 });
    expect(keep.rallyPoint).toEqual({ x: 25, z: 30 });
  });

  it('ground rally replaces a previous target and invalid targets store ground only', () => {
    const world = makeTestWorld();
    const keep = world.spawnBuilding(0, 'keep', 10, 10, true);
    const target = world.spawnUnit(0, 'peasant', 20, 20);

    rallyTo(world, keep, 25, 30, target.id);
    expect(keep.rallyPoint!.targetId).toBe(target.id);

    rallyTo(world, keep, 6, 7);
    expect(keep.rallyPoint).toEqual({ x: 6, z: 7 });
    target.x = 1;
    expect(resolveRallyPoint(world, keep.rallyPoint!)).toEqual({ x: 6, z: 7 });

    // Missing, dead, or non-unit/building targets never become target rallies.
    rallyTo(world, keep, 8, 9, 9999);
    expect(keep.rallyPoint).toEqual({ x: 8, z: 9 });
    target.hp = 0;
    rallyTo(world, keep, 8, 9, target.id);
    expect(keep.rallyPoint).toEqual({ x: 8, z: 9 });
  });
});

describe('M6 training vs research exclusivity', () => {
  it('rejects training while the building has active research', () => {
    const world = makeTestWorld();
    const keep = world.spawnBuilding(0, 'keep', 10, 10, true);
    const p0 = world.players[0];
    keep.research = {
      upgradeId: 'heavy_plough',
      progress: 0,
      food: 0,
      gold: 0,
      time: 30,
    };
    const food = p0.food;
    const gold = p0.gold;

    expect(
      applyTrainCommand(world, {
        kind: 'train',
        player: 0,
        buildingId: keep.id,
        unitType: 'peasant',
      }),
    ).toBe(false);
    expect(keep.trainingQueue).toHaveLength(0);
    expect(p0.food).toBe(food);
    expect(p0.gold).toBe(gold);

    keep.research = undefined;
    expect(
      applyTrainCommand(world, {
        kind: 'train',
        player: 0,
        buildingId: keep.id,
        unitType: 'peasant',
      }),
    ).toBe(true);
  });
});
