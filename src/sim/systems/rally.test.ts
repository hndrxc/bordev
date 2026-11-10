import { describe, expect, it } from 'vitest';
import { type GameMap, Terrain } from '../map.js';
import { World } from '../world.js';
import { Rng } from '../rng.js';
import type { BuildingEntity, UnitEntity } from '../entity.js';
import { updateFaith } from './faith.js';
import {
  applyTrainCommand,
  getTrainAvailability,
  setRally,
  updateProduction,
} from './production.js';
import { resolveRallyPoint, resolveRallyTarget } from './rally.js';
import { Sim } from '../sim.js';

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

  for (const p of world.players) {
    if (!p) continue;
    p.food = 1000;
    p.gold = 1000;
    p.age = 1;
    p.eliminated = false;
  }
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

  it('enemy target picks store ground only and do not track enemy through fog', () => {
    const world = makeTestWorld();
    const keep = world.spawnBuilding(0, 'keep', 10, 10, true);
    const enemyPeasant = world.spawnUnit(1, 'peasant', 20, 20);

    // Rallying to enemy target stores ground coords, but omits targetId and targetRef
    const ok = setRally(world, {
      kind: 'setRally',
      player: 0,
      buildingId: keep.id,
      x: enemyPeasant.x,
      z: enemyPeasant.z,
      targetId: enemyPeasant.id,
    });
    expect(ok).toBe(true);
    expect(keep.rallyPoint).toEqual({ x: 20, z: 20 });
    expect(keep.rallyPoint!.targetId).toBeUndefined();
    expect(keep.rallyPoint!.targetRef).toBeUndefined();

    // Enemy moves far away
    enemyPeasant.x = 2;
    enemyPeasant.z = 2;

    // Rally point does not follow enemy (no fog tracking)
    expect(resolveRallyPoint(world, keep.rallyPoint!, 0)).toEqual({
      x: 20,
      z: 20,
    });

    // Spawned unit moves to stored ground point, not the enemy's new position
    const spawned = trainPeasant(world, keep);
    expect(spawned.order).toEqual({ kind: 'move', x: 20, z: 20 });
  });

  it('stops resolving and falls back to ground if target ownership changes', () => {
    const world = makeTestWorld();
    const keep = world.spawnBuilding(0, 'keep', 10, 10, true);
    const friendlyUnit = world.spawnUnit(0, 'peasant', 20, 20);

    // Rally to own unit
    expect(rallyTo(world, keep, 25, 30, friendlyUnit.id)).toBe(true);
    expect(keep.rallyPoint!.targetId).toBe(friendlyUnit.id);

    // Friendly unit converted / ownership changes to enemy
    friendlyUnit.player = 1;
    expect(resolveRallyTarget(world, keep.rallyPoint!, 0)).toBeUndefined();
    expect(resolveRallyPoint(world, keep.rallyPoint!, 0)).toEqual({
      x: 25,
      z: 30,
    });

    // Spawning unit drops stale target and falls back to ground coordinates
    const spawned = trainPeasant(world, keep);
    expect(spawned.order).toEqual({ kind: 'move', x: 25, z: 30 });
    expect(keep.rallyPoint).toEqual({ x: 25, z: 30 });
  });

  it('falls back to stored ground coordinates when building has no reachable perimeter in unit component', () => {
    const size = 32;
    const tiles = new Uint8Array(size * size).fill(Terrain.GRASS);
    for (let z = 18; z <= 23; z++) {
      for (let x = 18; x <= 23; x++) {
        if (x < 20 || x > 21 || z < 20 || z > 21) {
          tiles[z * size + x] = Terrain.WATER;
        }
      }
    }
    const map: GameMap = {
      version: 1,
      id: 'isolated_map',
      name: 'Isolated Map',
      size,
      players: 2,
      tiles,
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
    for (const p of world.players) {
      if (!p) continue;
      p.food = 1000;
      p.gold = 1000;
      p.age = 1;
      p.eliminated = false;
    }

    const keep = world.spawnBuilding(0, 'keep', 4, 4, true);
    const target = world.spawnBuilding(0, 'cottage', 20, 20, true);

    rallyTo(world, keep, 5, 5, target.id);

    const spawned = trainPeasant(world, keep);
    // Because cottage perimeter is unreachable (surrounded by water), fallback to stored ground coordinates (5, 5)
    expect(spawned.order).toEqual({ kind: 'move', x: 5, z: 5 });
  });

  it('routes around isolated pocket to reachable perimeter of building target', () => {
    const size = 32;
    const tiles = new Uint8Array(size * size).fill(Terrain.GRASS);
    // water row z14 x0..25
    for (let x = 0; x <= 25; x++) {
      tiles[14 * size + x] = Terrain.WATER;
    }
    // water 13,15 & 17,15
    tiles[15 * size + 13] = Terrain.WATER;
    tiles[15 * size + 17] = Terrain.WATER;

    const map: GameMap = {
      version: 1,
      id: 'pocket_map',
      name: 'Pocket Map',
      size,
      players: 2,
      tiles,
      goldMines: [],
      starts: [
        [4, 4],
        [size - 8, size - 8],
      ],
      doodads: [],
    };

    const sim = new Sim(map, 1);
    const p0 = sim.world.players[0];
    p0.food = 1000;
    p0.gold = 1000;
    p0.age = 1;

    for (let i = 0; i < sim.world.entities.length; i++) {
      const e = sim.world.entities[i];
      if (e) sim.world.removeEntity(e.id);
    }

    // keep at (12, 4), barracks at (14, 16)
    const keep = sim.world.spawnBuilding(0, 'keep', 12, 4, true);
    const barracks = sim.world.spawnBuilding(0, 'barracks', 14, 16, true);
    p0.eliminated = false;

    // Rally keep to barracks
    sim.issue({
      kind: 'setRally',
      player: 0,
      buildingId: keep.id,
      x: barracks.x + barracks.width * 0.5,
      z: barracks.z + barracks.height * 0.5,
      targetId: barracks.id,
    });
    sim.step();

    // Train peasant at keep
    const trained = applyTrainCommand(sim.world, {
      kind: 'train',
      player: 0,
      buildingId: keep.id,
      unitType: 'peasant',
    });
    expect(trained).toBe(true);

    keep.trainingQueue[0].progress = 1000;
    sim.step();

    const spawned = sim.world.entities.find(
      (e): e is UnitEntity =>
        !!e && e.kind === 'unit' && e.player === 0 && e.type === 'peasant',
    );
    expect(spawned).toBeDefined();
    const peasant = spawned!;

    // In the isolated pocket bug, peasant order was z = 15.5 (inside the cut-off pocket).
    // With component-filtered selection, chosen destination must NOT be inside the cut-off z = 15 pocket.
    const order = peasant.order as { kind: string; x: number; z: number };
    expect(order.kind).toBe('move');
    expect(order.z).not.toBe(15.5);

    // Deterministic simulation: peasant routes around the barrier (x >= 25) and reaches barracks perimeter.
    let navigatedAroundBarrier = false;
    let reachedPerimeter = false;
    for (let t = 0; t < 600; t++) {
      sim.step();
      if (peasant.x >= 25) {
        navigatedAroundBarrier = true;
      }
      const dx = Math.max(0, barracks.x - peasant.x, peasant.x - (barracks.x + barracks.width));
      const dz = Math.max(0, barracks.z - peasant.z, peasant.z - (barracks.z + barracks.height));
      if (dx * dx + dz * dz <= 1.0) {
        reachedPerimeter = true;
        break;
      }
    }
    expect(navigatedAroundBarrier).toBe(true);
    expect(reachedPerimeter).toBe(true);
  });
});

describe('getTrainAvailability and training rejection invariants', () => {
  it('allows valid training and rejects invalid commands without cost or queue mutation across players', () => {
    const world = makeTestWorld();
    const keep0 = world.spawnBuilding(0, 'keep', 10, 10, true);
    const keep1 = world.spawnBuilding(1, 'keep', 20, 20, true);

    for (const [playerId, keep] of [
      [0, keep0],
      [1, keep1],
    ] as const) {
      const player = world.players[playerId]!;

      // Allowed when requirements are met
      const valid = getTrainAvailability(world, playerId, keep.id, 'peasant');
      expect(valid.allowed).toBe(true);
      expect(valid.reason).toBeUndefined();

      const assertRejectedInvariant = (
        pId: number,
        buildingId: number,
        unitType: string,
      ) => {
        const p = world.players[pId] ?? player;
        const foodBefore = p.food;
        const goldBefore = p.gold;
        const bld = world.getEntity(buildingId);
        const queueLenBefore =
          bld && bld.kind === 'building' ? (bld.trainingQueue?.length ?? 0) : 0;

        const availability = getTrainAvailability(world, pId, buildingId, unitType);
        expect(availability.allowed).toBe(false);
        expect(typeof availability.reason).toBe('string');

        const success = applyTrainCommand(world, {
          kind: 'train',
          player: pId,
          buildingId,
          unitType,
        });
        expect(success).toBe(false);
        expect(p.food).toBe(foodBefore);
        expect(p.gold).toBe(goldBefore);
        if (bld && bld.kind === 'building') {
          expect(bld.trainingQueue?.length ?? 0).toBe(queueLenBefore);
        }
      };

      // 1. Foreign / other player's building
      const otherKeepId = playerId === 0 ? keep1.id : keep0.id;
      assertRejectedInvariant(playerId, otherKeepId, 'peasant');

      // 2. Unknown building ID
      assertRejectedInvariant(playerId, 9999, 'peasant');

      // 3. Destroyed building
      keep.hp = 0;
      assertRejectedInvariant(playerId, keep.id, 'peasant');
      keep.hp = 1000;

      // 4. Unfinished building
      keep.built = false;
      assertRejectedInvariant(playerId, keep.id, 'peasant');
      keep.built = true;

      // 5. Research in progress on building
      keep.research = {
        upgradeId: 'heavy_plough',
        progress: 0,
        food: 0,
        gold: 0,
        time: 30,
      };
      assertRejectedInvariant(playerId, keep.id, 'peasant');
      keep.research = undefined;

      // 6. Full queue (>= 5)
      keep.trainingQueue = Array.from({ length: 5 }, () => ({
        unitType: 'peasant',
        progress: 0,
        food: 50,
        gold: 0,
      }));
      assertRejectedInvariant(playerId, keep.id, 'peasant');
      keep.trainingQueue = [];

      // 7. Unknown unit
      assertRejectedInvariant(playerId, keep.id, 'unknown_unit');

      // 8. Unit trained at a different building (spearman requires barracks, not keep)
      assertRejectedInvariant(playerId, keep.id, 'spearman');
      const barracks = world.spawnBuilding(playerId, 'barracks', 14, 14, true);
      expect(getTrainAvailability(world, playerId, barracks.id, 'spearman').allowed).toBe(true);

      // 9. Unit requiring higher age (man_at_arms requires Age 2 at barracks)
      player.age = 1;
      assertRejectedInvariant(playerId, barracks.id, 'man_at_arms');
      player.age = 2;
      expect(getTrainAvailability(world, playerId, barracks.id, 'man_at_arms').allowed).toBe(true);
      player.age = 1;

      // 10. Insufficient food (peasant requires food)
      player.food = 0;
      assertRejectedInvariant(playerId, keep.id, 'peasant');
      player.food = 1000;
      expect(getTrainAvailability(world, playerId, keep.id, 'peasant').allowed).toBe(true);

      // 11. Insufficient gold (knight requires gold at stable)
      const stable = world.spawnBuilding(playerId, 'stable', 16, 16, true);
      player.age = 2;
      player.gold = 0;
      assertRejectedInvariant(playerId, stable.id, 'knight');
      player.gold = 1000;
      expect(getTrainAvailability(world, playerId, stable.id, 'knight').allowed).toBe(true);
      // 12. Eliminated player
      player.eliminated = true;
      assertRejectedInvariant(playerId, keep.id, 'peasant');
      player.eliminated = false;
    }
  });
});
