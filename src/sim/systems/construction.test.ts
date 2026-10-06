import { describe, expect, it } from 'vitest';
import { getBuildingData } from '../../data/buildings.js';
import { Terrain, type GameMap } from '../map.js';
import { Rng } from '../rng.js';
import { World } from '../world.js';
import {
  applyBuildCommand,
  applyRepairCommand,
  cancelConstruction,
  updateConstruction,
  validatePlacement,
} from './construction.js';
import { Sim, SIM_DT } from '../sim.js';
import type { BuildingEntity, UnitEntity } from '../entity.js';
function makeTestMap(size = 32): GameMap {
  return {
    version: 1,
    id: 'test_clean',
    name: 'Clean Map',
    size,
    players: 2,
    tiles: new Uint8Array(size * size).fill(Terrain.GRASS),
    goldMines: [],
    starts: [
      [2, 2],
      [size - 6, size - 6],
    ],
    doodads: [],
  };
}

describe('Construction System — Placement Validation & Explored Invalidation', () => {
  it('rejects floating-point or out-of-bounds coordinates', () => {
    const world = new World(makeTestMap(), new Rng(1));
    const floatRes = validatePlacement(world, 0, 'cottage', 10.5, 10);
    expect(floatRes.valid).toBe(false);

    const oobRes = validatePlacement(world, 0, 'cottage', 31, 31);
    expect(oobRes.valid).toBe(false);
  });

  it('rejects buildings belonging to other factions', () => {
    const world = new World(makeTestMap(), new Rng(1));
    const player = world.players[0];
    const food = player.food;
    const gold = player.gold;
    const entities = world.entities.slice();
    expect(getBuildingData('war_shrine', 'clans')?.faction).toBe('clans');
    expect(validatePlacement(world, 0, 'war_shrine', 10, 10).valid).toBe(false);
    applyBuildCommand(world, {
      kind: 'build',
      player: 0,
      ids: [],
      buildingType: 'war_shrine',
      x: 10,
      z: 10,
    });
    expect(player.food).toBe(food);
    expect(player.gold).toBe(gold);
    expect(world.entities).toEqual(entities);
    expect(world.grid.isPassable(10.5, 10.5, 0)).toBe(true);
  });

  it('enforces age requirements and extra Town Center Age II rule', () => {
    const world = new World(makeTestMap(), new Rng(1));
    const pState = world.players[0];
    pState.age = 1;

    expect(getBuildingData('stable', 'crown')?.age).toBe(2);
    const food = pState.food;
    const gold = pState.gold;
    const entities = world.entities.slice();
    const stableRes = validatePlacement(world, 0, 'stable', 10, 10);
    expect(stableRes.valid).toBe(false);
    applyBuildCommand(world, {
      kind: 'build',
      player: 0,
      ids: [],
      buildingType: 'stable',
      x: 10,
      z: 10,
    });
    expect(pState.food).toBe(food);
    expect(pState.gold).toBe(gold);
    expect(world.entities).toEqual(entities);
    expect(world.grid.isPassable(10.5, 10.5, 0)).toBe(true);

    // Player 0 already has starting Keep at (2, 2). Another Keep requires Age II.
    pState.food = 1000;
    pState.gold = 1000;
    const extraTcAge1 = validatePlacement(world, 0, 'keep', 10, 10);
    expect(extraTcAge1.valid).toBe(false);

    // Advancing player to Age 2 allows extra Keep and stable
    pState.age = 2;
    const extraTcAge2 = validatePlacement(world, 0, 'keep', 10, 10);
    expect(extraTcAge2.valid).toBe(true);

    const stableRes2 = validatePlacement(world, 0, 'stable', 10, 10);
    expect(stableRes2.valid).toBe(true);
  });

  it('rejects placement when player has insufficient resources', () => {
    const world = new World(makeTestMap(), new Rng(1));
    const pState = world.players[0];
    pState.food = 10;
    pState.gold = 0;

    const res = validatePlacement(world, 0, 'cottage', 10, 10);
    expect(res.valid).toBe(false);
  });

  it('rejects placement when any tile in the footprint is unexplored', () => {
    const world = new World(makeTestMap(), new Rng(1));
    const pState = world.players[0];

    // Cottage is 2x2. Tile (11, 10) inside (10..12, 10..12) set to unexplored (0)
    const unexploredIdx = 10 * world.grid.size + 11;
    pState.explored[unexploredIdx] = 0;

    const res = validatePlacement(world, 0, 'cottage', 10, 10);
    expect(res.valid).toBe(false);

    // Once marked explored, it passes
    pState.explored[unexploredIdx] = 1;
    const res2 = validatePlacement(world, 0, 'cottage', 10, 10);
    expect(res2.valid).toBe(true);
  });

  it('rejects placement when footprint overlaps obstacle or existing building', () => {
    const world = new World(makeTestMap(), new Rng(1));
    // Starting Keep is at (2, 2) with 4x4 footprint
    const res = validatePlacement(world, 0, 'cottage', 3, 3);
    expect(res.valid).toBe(false);
  });

  it('handles gate dimensions and orientations accurately', () => {
    const world = new World(makeTestMap(), new Rng(1));
    world.players[0].age = 2; // Stone gate requires Age 2

    const horiz = validatePlacement(
      world,
      0,
      'stone_gate',
      10,
      10,
      'horizontal',
    );
    expect(horiz.valid).toBe(true);
    expect(horiz.width).toBe(3);
    expect(horiz.height).toBe(1);

    const vert = validatePlacement(world, 0, 'stone_gate', 10, 10, 'vertical');
    expect(vert.valid).toBe(true);
    expect(vert.width).toBe(1);
    expect(vert.height).toBe(3);
  });

  it('allows placement when units are inside footprint (units do not block placement)', () => {
    const world = new World(makeTestMap(), new Rng(1));
    world.spawnUnit(0, 'peasant', 10.5, 10.5);

    const res = validatePlacement(world, 0, 'cottage', 10, 10);
    expect(res.valid).toBe(true);
  });
});

describe('Construction System — Deterministic Unit Displacement', () => {
  it('deterministically displaces multiple units to free radius-legal positions despite obstacles and sparse entities', () => {
    const place = () => {
      const map = makeTestMap();
      for (const [x, z] of [
        [10, 9],
        [11, 9],
        [9, 10],
      ]) {
        map.tiles[z * map.size + x] = Terrain.WATER;
      }
      const world = new World(map, new Rng(1));
      const doodad = world.spawnDoodad(10.5, 10.5, 'flowers');
      const units = [
        world.spawnUnit(0, 'peasant', 10.5, 10.5),
        world.spawnUnit(0, 'peasant', 10.5, 10.5),
        world.spawnUnit(0, 'ox_cart', 11.9, 11.9),
        world.spawnUnit(0, 'peasant', 9.9, 11.5),
      ];
      const removed = world.spawnUnit(0, 'peasant', 20.5, 20.5);
      const secondHole = world.spawnUnit(0, 'peasant', 21.5, 20.5);
      const trailing = world.spawnDoodad(22.5, 20.5, 'flowers');
      world.removeEntity(removed.id);
      world.removeEntity(secondHole.id);
      applyBuildCommand(world, {
        kind: 'build',
        player: 0,
        ids: [],
        buildingType: 'cottage',
        x: 10,
        z: 10,
      });
      const site = world.entities.find(
        (e): e is BuildingEntity =>
          !!e && e.kind === 'building' && e.type === 'cottage',
      );
      expect(site).toBeDefined();
      expect(world.entities[secondHole.id]).toBeUndefined();
      expect([doodad.x, doodad.z]).toEqual([10.5, 10.5]);
      expect([trailing.x, trailing.z]).toEqual([22.5, 20.5]);
      for (const unit of units) {
        const dx = Math.max(10 - unit.x, 0, unit.x - 12);
        const dz = Math.max(10 - unit.z, 0, unit.z - 12);
        expect(dx * dx + dz * dz).toBeGreaterThanOrEqual(
          unit.radius * unit.radius,
        );
        expect(
          world.grid.canOccupy(unit.x, unit.z, unit.radius, unit.player),
        ).toBe(true);
        for (const other of world.entities) {
          if (!other || other.kind !== 'unit' || other.id === unit.id) continue;
          expect(
            Math.hypot(unit.x - other.x, unit.z - other.z),
          ).toBeGreaterThanOrEqual(unit.radius + other.radius);
        }
      }
      return units.map((unit) => [unit.x, unit.z]);
    };
    expect(place()).toEqual(place());
  });
});

describe('Construction System — Sim Work Approach', () => {
  it('resumes a distant site through a reachable perimeter and keeps building until completion', () => {
    const map = makeTestMap();
    // The left perimeter is an isolated pocket, nearer than any reachable approach.
    // The worker must go around its enclosing wall to the open top or bottom.
    for (let z = 13; z <= 16; z++) {
      map.tiles[z * map.size + 12] = Terrain.WATER;
    }
    map.tiles[13 * map.size + 13] = Terrain.WATER;
    map.tiles[16 * map.size + 13] = Terrain.WATER;
    const sim = new Sim(map, 1);
    const world = sim.world;
    const site = world.spawnBuilding(0, 'cottage', 14, 14, false);
    const worker = world.spawnUnit(0, 'peasant', 8.5, 14.5);
    const food = world.players[0].food;
    const gold = world.players[0].gold;
    expect(world.grid.isPassable(13.5, 14.5, 0)).toBe(true);
    expect(world.grid.isPassable(14.5, 13.5, 0)).toBe(true);
    sim.issue({
      kind: 'build',
      player: 0,
      ids: [worker.id],
      buildingType: 'cottage',
      x: 14,
      z: 14,
      targetId: site.id,
    });
    sim.step();
    expect(site.buildProgress).toBe(0);
    expect(worker.order?.kind).toBe('build');
    expect(worker.workAnimation).toBeUndefined();
    let arrival: { x: number; z: number } | undefined;
    let previousProgress = 0;
    for (let tick = 0; tick < 1600 && !site.built; tick++) {
      expect(worker.order?.kind).toBe('build');
      expect(worker.order?.targetId).toBe(site.id);
      sim.step();
      expect(site.buildProgress).toBeGreaterThanOrEqual(previousProgress);
      if (site.buildProgress > 0) {
        if (!arrival) {
          arrival = { x: worker.x, z: worker.z };
          expect(Math.hypot(worker.x - 8.5, worker.z - 14.5)).toBeGreaterThan(
            1,
          );
        } else {
          expect(worker.x).toBeCloseTo(arrival.x, 10);
          expect(worker.z).toBeCloseTo(arrival.z, 10);
          expect(site.buildProgress).toBeGreaterThan(previousProgress);
        }
        if (!site.built) expect(worker.workAnimation).toBe('work');
      }
      previousProgress = site.buildProgress;
    }
    expect(arrival).toBeDefined();
    expect(site.built).toBe(true);
    expect(site.buildProgress).toBe(1);
    expect(site.hp).toBe(site.maxHp);
    expect(worker.order?.kind).toBe('idle');
    expect(worker.workAnimation).toBeUndefined();
    expect(
      world.grid.canOccupy(worker.x, worker.z, worker.radius, worker.player),
    ).toBe(true);
    const dx = Math.max(site.x - worker.x, 0, worker.x - (site.x + site.width));
    const dz = Math.max(
      site.z - worker.z,
      0,
      worker.z - (site.z + site.height),
    );
    expect(dx * dx + dz * dz).toBeGreaterThanOrEqual(
      worker.radius * worker.radius,
    );
    expect(world.players[0].food).toBe(food);
    expect(world.players[0].gold).toBe(gold);
    expect(
      world.events.filter(
        (event) =>
          event.kind === 'buildingCompleted' && event.entityId === site.id,
      ),
    ).toHaveLength(1);
  });
});

describe.each([
  {
    faction: 'crown',
    building: 'cottage',
    worker: 'peasant',
    military: 'spearman',
    cart: 'ox_cart',
  },
  {
    faction: 'clans',
    building: 'field',
    worker: 'thrall',
    military: 'axeman',
    cart: 'haul_wagon',
  },
] as const)('Construction System — $faction Worker Eligibility', (types) => {
  it('ignores military and cart builders while counting the production worker type', () => {
    const world = new World(makeTestMap(), new Rng(1), { 0: types.faction });
    const site = world.spawnBuilding(0, types.building, 10, 10, false);
    const military = world.spawnUnit(0, types.military, 9.5, 10.5);
    const cart = world.spawnUnit(0, types.cart, 10.5, 9.5);
    const command = {
      kind: 'build' as const,
      player: 0,
      ids: [military.id, cart.id],
      buildingType: types.building,
      x: 10,
      z: 10,
      targetId: site.id,
    };
    applyBuildCommand(world, command);
    updateConstruction(world);
    expect(site.buildProgress).toBe(0);
    expect(military.order?.kind).toBe('idle');
    expect(cart.order?.kind).toBe('idle');
    expect(military.workAnimation).toBeUndefined();
    expect(cart.workAnimation).toBeUndefined();
    const worker = world.spawnUnit(0, types.worker, 9.5, 11.5);
    applyBuildCommand(world, {
      ...command,
      ids: [worker.id, military.id, cart.id],
    });
    updateConstruction(world);
    const data = getBuildingData(types.building, types.faction)!;
    expect(site.buildProgress).toBeCloseTo(0.05 / data.buildTime, 8);
    expect(worker.workAnimation).toBe('work');
    expect(military.workAnimation).toBeUndefined();
    expect(cart.workAnimation).toBeUndefined();
  });

  it('ignores military and cart repairers while counting only an arrived production worker', () => {
    const world = new World(makeTestMap(), new Rng(1), { 0: types.faction });
    const building = world.spawnBuilding(0, types.building, 10, 10, true);
    building.hp = building.maxHp * 0.5;
    const hp = building.hp;
    const food = world.players[0].food;
    const gold = world.players[0].gold;
    const military = world.spawnUnit(0, types.military, 9.5, 10.5);
    const cart = world.spawnUnit(0, types.cart, 10.5, 9.5);
    const command = {
      kind: 'repair' as const,
      player: 0,
      ids: [military.id, cart.id],
      targetId: building.id,
    };
    applyRepairCommand(world, command);
    updateConstruction(world);
    expect(building.hp).toBe(hp);
    expect(military.order?.kind).toBe('idle');
    expect(cart.order?.kind).toBe('idle');
    const worker = world.spawnUnit(0, types.worker, 9.5, 11.5);
    const farWorker = world.spawnUnit(0, types.worker, 20.5, 20.5);
    applyRepairCommand(world, {
      ...command,
      ids: [worker.id, farWorker.id, military.id, cart.id],
    });
    updateConstruction(world);
    const data = getBuildingData(types.building, types.faction)!;
    expect(building.hp).toBeCloseTo(
      hp + (0.5 * building.maxHp * 0.05) / data.buildTime,
      8,
    );
    expect(worker.workAnimation).toBe('work');
    expect(farWorker.workAnimation).toBeUndefined();
    expect(military.workAnimation).toBeUndefined();
    expect(cart.workAnimation).toBeUndefined();
    expect(world.players[0].food).toBe(food);
    expect(world.players[0].gold).toBe(gold);
  });
});

describe('Construction System — Progress, 3T/(n+2) Rule, and Completion', () => {
  it('deducts cost once on initial site placement and does not deduct cost on resume', () => {
    const world = new World(makeTestMap(), new Rng(1));
    const pState = world.players[0];
    const initialFood = pState.food;
    const initialGold = pState.gold;

    const bData = getBuildingData('cottage', 'crown')!;
    applyBuildCommand(world, {
      kind: 'build',
      player: 0,
      ids: [],
      buildingType: 'cottage',
      x: 10,
      z: 10,
    });

    expect(pState.food).toBe(initialFood - bData.food);
    expect(pState.gold).toBe(initialGold - bData.gold);

    const site = world.entities.find(
      (e): e is BuildingEntity =>
        !!e && e.kind === 'building' && e.type === 'cottage' && !e.built,
    );
    expect(site).toBeDefined();

    // Resume the site with a worker: cost should NOT be deducted again
    const worker = world.spawnUnit(0, 'peasant', 9.5, 10.5);
    const foodBeforeResume = pState.food;
    const goldBeforeResume = pState.gold;

    applyBuildCommand(world, {
      kind: 'build',
      player: 0,
      ids: [worker.id],
      buildingType: 'cottage',
      x: 10,
      z: 10,
      targetId: site!.id,
    });

    expect(pState.food).toBe(foodBeforeResume);
    expect(pState.gold).toBe(goldBeforeResume);
  });

  it('only arrived builders contribute to construction progress', () => {
    const world = new World(makeTestMap(), new Rng(1));
    const site = world.spawnBuilding(0, 'cottage', 10, 10, false);

    // Worker placed far away (e.g. at 25, 25)
    const farWorker = world.spawnUnit(0, 'peasant', 25.5, 25.5);
    applyBuildCommand(world, {
      kind: 'build',
      player: 0,
      ids: [farWorker.id],
      buildingType: 'cottage',
      x: 10,
      z: 10,
      targetId: site.id,
    });

    updateConstruction(world);
    // Far worker has not arrived yet -> 0 progress
    expect(site.buildProgress).toBe(0);
    expect(farWorker.workAnimation).toBeUndefined();

    // Worker placed right at perimeter (9.5, 10.5)
    const nearWorker = world.spawnUnit(0, 'peasant', 9.5, 10.5);
    applyBuildCommand(world, {
      kind: 'build',
      player: 0,
      ids: [nearWorker.id],
      buildingType: 'cottage',
      x: 10,
      z: 10,
      targetId: site.id,
    });

    updateConstruction(world);
    // Near worker has arrived -> progress increases and work animation set
    expect(site.buildProgress).toBeGreaterThan(0);
    expect(nearWorker.workAnimation).toBe('work');
    expect(site.buildProgress).toBeCloseTo(
      0.05 / getBuildingData('cottage', 'crown')!.buildTime,
      8,
    );
  });

  it('follows 3T / (n + 2) construction speed scaling for 1 vs 3 builders', () => {
    const world1 = new World(makeTestMap(), new Rng(1));
    const site1 = world1.spawnBuilding(0, 'cottage', 10, 10, false);
    const bData = getBuildingData('cottage', 'crown')!;
    const T = bData.buildTime; // 25s

    // 1 builder
    const w1 = world1.spawnUnit(0, 'peasant', 9.5, 10.5);
    applyBuildCommand(world1, {
      kind: 'build',
      player: 0,
      ids: [w1.id],
      buildingType: 'cottage',
      x: 10,
      z: 10,
      targetId: site1.id,
    });
    updateConstruction(world1);
    const progress1 = site1.buildProgress;
    const expectedRate1 = (1 + 2) / (3 * T); // 1 / T
    expect(progress1).toBeCloseTo(expectedRate1 * 0.05, 5);

    // 3 builders
    const world3 = new World(makeTestMap(), new Rng(1));
    const site3 = world3.spawnBuilding(0, 'cottage', 10, 10, false);
    const u1 = world3.spawnUnit(0, 'peasant', 9.5, 10.5);
    const u2 = world3.spawnUnit(0, 'peasant', 9.5, 11.5);
    const u3 = world3.spawnUnit(0, 'peasant', 10.5, 9.5);
    applyBuildCommand(world3, {
      kind: 'build',
      player: 0,
      ids: [u1.id, u2.id, u3.id],
      buildingType: 'cottage',
      x: 10,
      z: 10,
      targetId: site3.id,
    });
    updateConstruction(world3);
    const progress3 = site3.buildProgress;
    const expectedRate3 = (3 + 2) / (3 * T); // 5 / (3 * T)
    expect(progress3).toBeCloseTo(expectedRate3 * 0.05, 5);

    // 3 builders progress faster than 1 builder by exactly 5/3 ratio
    expect(progress3 / progress1).toBeCloseTo(5 / 3, 4);
  });

  it('completes building exactly once, updating supply and emitting completed event', () => {
    const world = new World(makeTestMap(), new Rng(1));
    const site = world.spawnBuilding(0, 'cottage', 10, 10, false);
    site.buildProgress = 0.999;
    const worker = world.spawnUnit(0, 'peasant', 9.5, 10.5);

    applyBuildCommand(world, {
      kind: 'build',
      player: 0,
      ids: [worker.id],
      buildingType: 'cottage',
      x: 10,
      z: 10,
      targetId: site.id,
    });

    const initialPopCap = world.players[0].popCap;
    updateConstruction(world);

    expect(site.built).toBe(true);
    expect(site.buildProgress).toBe(1);
    expect(site.hp).toBe(site.maxHp);
    expect(world.players[0].popCap).toBe(initialPopCap + site.pop);

    const events = world.events.filter(
      (e) => e.kind === 'buildingCompleted' && e.entityId === site.id,
    );
    expect(events.length).toBe(1);

    // Subsequent tick should not complete or increase cap again
    updateConstruction(world);
    const eventsAfter = world.events.filter(
      (e) => e.kind === 'buildingCompleted' && e.entityId === site.id,
    );
    expect(eventsAfter.length).toBe(1);
    expect(world.players[0].popCap).toBe(initialPopCap + site.pop);
  });
});

describe('Construction System — Cancellation and Refunds', () => {
  it('refunds 100% of cost when cancelled at exact 0% progress', () => {
    const world = new World(makeTestMap(), new Rng(1));
    const pState = world.players[0];
    const bData = getBuildingData('cottage', 'crown')!;

    applyBuildCommand(world, {
      kind: 'build',
      player: 0,
      ids: [],
      buildingType: 'cottage',
      x: 10,
      z: 10,
    });

    const foodAfterPlace = pState.food;
    const goldAfterPlace = pState.gold;

    const site = world.entities.find(
      (e): e is BuildingEntity =>
        !!e && e.kind === 'building' && e.type === 'cottage' && !e.built,
    )!;
    expect(site.buildProgress).toBe(0);

    cancelConstruction(world, site);
    expect(pState.food).toBe(foodAfterPlace + bData.food);
    expect(pState.gold).toBe(goldAfterPlace + bData.gold);
    expect(world.entities[site.id]).toBeUndefined();
  });

  it('refunds positive 50% of cost when cancelled with positive progress', () => {
    const world = new World(makeTestMap(), new Rng(1));
    const pState = world.players[0];
    const bData = getBuildingData('cottage', 'crown')!;

    applyBuildCommand(world, {
      kind: 'build',
      player: 0,
      ids: [],
      buildingType: 'cottage',
      x: 10,
      z: 10,
    });

    const foodAfterPlace = pState.food;
    const goldAfterPlace = pState.gold;

    const site = world.entities.find(
      (e): e is BuildingEntity =>
        !!e && e.kind === 'building' && e.type === 'cottage' && !e.built,
    )!;
    site.buildProgress = 0.25;

    cancelConstruction(world, site);
    expect(pState.food).toBe(foodAfterPlace + Math.floor(bData.food * 0.5));
    expect(pState.gold).toBe(goldAfterPlace + Math.floor(bData.gold * 0.5));
    expect(world.entities[site.id]).toBeUndefined();
  });

  it('does not cancel or refund completed buildings', () => {
    const world = new World(makeTestMap(), new Rng(1));
    const pState = world.players[0];
    const foodBefore = pState.food;
    const keep = world.entities.find(
      (e): e is BuildingEntity => !!e && e.kind === 'building' && e.built,
    )!;

    cancelConstruction(world, keep);
    expect(pState.food).toBe(foodBefore);
    expect(world.entities[keep.id]).toBeDefined();
  });
});

describe('Construction System — Repair Mechanics', () => {
  it('repairs damaged buildings free of cost at half build rate', () => {
    const world = new World(makeTestMap(), new Rng(1));
    const pState = world.players[0];
    const cottage = world.spawnBuilding(0, 'cottage', 10, 10, true);
    cottage.hp = cottage.maxHp * 0.5;

    const worker = world.spawnUnit(0, 'peasant', 9.5, 10.5);
    const foodBefore = pState.food;
    const goldBefore = pState.gold;

    applyRepairCommand(world, {
      kind: 'repair',
      player: 0,
      ids: [worker.id],
      targetId: cottage.id,
    });

    updateConstruction(world);

    // Free repair: no resources deducted
    expect(pState.food).toBe(foodBefore);
    expect(pState.gold).toBe(goldBefore);

    // Half build rate progress
    const bData = getBuildingData('cottage', 'crown')!;
    const expectedHpDelta =
      0.5 * ((1 + 2) / (3 * bData.buildTime)) * cottage.maxHp * 0.05;
    expect(cottage.hp).toBeCloseTo(cottage.maxHp * 0.5 + expectedHpDelta, 4);

    // Full HP completes repair and finishes work order
    cottage.hp = cottage.maxHp - 0.001;
    updateConstruction(world);
    expect(cottage.hp).toBe(cottage.maxHp);
    expect(worker.order?.kind).toBe('idle');
  });
});

describe('Construction System — Farm Auto-Assignment & Queued Jobs', () => {
  it('auto-assigns exactly one eligible farm builder without clobbering queued jobs', () => {
    const world = new World(makeTestMap(), new Rng(1));
    const farmSite = world.spawnBuilding(0, 'farm', 10, 10, false);
    farmSite.buildProgress = 0.999;

    const worker1 = world.spawnUnit(0, 'peasant', 9.5, 10.5);
    const worker2 = world.spawnUnit(0, 'peasant', 10.5, 9.5);

    // Worker 1 has build order only (no queued task)
    applyBuildCommand(world, {
      kind: 'build',
      player: 0,
      ids: [worker1.id],
      buildingType: 'farm',
      x: 10,
      z: 10,
      targetId: farmSite.id,
    });

    // Worker 2 has build order and queued move order
    applyBuildCommand(world, {
      kind: 'build',
      player: 0,
      ids: [worker2.id],
      buildingType: 'farm',
      x: 10,
      z: 10,
      targetId: farmSite.id,
    });
    worker2.orders.push({
      kind: 'move',
      x: 20,
      z: 20,
    });

    updateConstruction(world);

    expect(farmSite.built).toBe(true);

    // Worker 1 had no queue -> auto-assigned to farm
    expect(worker1.order?.kind).toBe('farm');
    expect(worker1.order?.targetId).toBe(farmSite.id);

    // Worker 2 had queued move -> queued job preserved and advanced
    expect(worker2.order?.kind).toBe('move');
    expect(worker2.order?.x).toBe(20);
    expect(worker2.order?.z).toBe(20);
  });
});

describe('Work System — Recycled & Deleted Target Safety', () => {
  it('safely finishes work order when target entity is removed or recycled', () => {
    const world = new World(makeTestMap(), new Rng(1));
    const cottage = world.spawnBuilding(0, 'cottage', 10, 10, false);
    const worker = world.spawnUnit(0, 'peasant', 9.5, 10.5);

    applyBuildCommand(world, {
      kind: 'build',
      player: 0,
      ids: [worker.id],
      buildingType: 'cottage',
      x: 10,
      z: 10,
      targetId: cottage.id,
    });

    expect(worker.order?.kind).toBe('build');

    // Remove cottage
    world.removeEntity(cottage.id);

    // Next construction update should gracefully finish work order
    updateConstruction(world);
    expect(worker.order?.kind).toBe('idle');
  });

  it('finishes a real build job without working on an entity that recycles its target ID', () => {
    const world = new World(makeTestMap(), new Rng(1));
    const cottage = world.spawnBuilding(0, 'cottage', 10, 10, false);
    const worker = world.spawnUnit(0, 'peasant', 9.5, 10.5);
    applyBuildCommand(world, {
      kind: 'build',
      player: 0,
      ids: [worker.id],
      buildingType: 'cottage',
      x: 10,
      z: 10,
      targetId: cottage.id,
    });
    updateConstruction(world);
    expect(cottage.buildProgress).toBeGreaterThan(0);
    expect(worker.order?.kind).toBe('build');
    world.removeEntity(cottage.id);
    const replacement = world.spawnBuilding(0, 'cottage', 10, 10, false);
    expect(replacement.id).toBe(cottage.id);
    const hp = replacement.hp;
    updateConstruction(world);
    updateConstruction(world);
    expect(replacement.buildProgress).toBe(0);
    expect(replacement.hp).toBe(hp);
    expect(replacement.built).toBe(false);
    expect(worker.order?.kind).toBe('idle');
    expect(worker.workAnimation).toBeUndefined();
    expect(worker.orders).toEqual([]);
  });
});

describe('Construction System — Connected Transactional Displacement', () => {
  it('keeps a displaced unit on its home bank instead of teleporting to a tied far bank', () => {
    const place = () => {
      const map = makeTestMap();
      // A water row splits the map. Ring 2 above the site (z=8) is a tied-nearest
      // candidate with ring 2 below it (z=12), and wins on tile index unless the
      // search is limited to the unit's original connected component.
      for (let x = 0; x < map.size; x++)
        map.tiles[9 * map.size + x] = Terrain.WATER;
      const world = new World(map, new Rng(1), { 0: 'clans' });
      const player = world.players[0];
      player.gold = 100;
      world.spawnBuilding(0, 'palisade', 9, 10, true);
      world.spawnBuilding(0, 'palisade', 11, 10, true);
      const crowd = [9.5, 10.5, 11.5].map((x) =>
        world.spawnUnit(0, 'thrall', x, 11.5),
      );
      const crowdBefore = crowd.map((unit) => [unit.x, unit.z]);
      const unit = world.spawnUnit(0, 'thrall', 10.5, 10.5);
      const goldBefore = player.gold;

      applyBuildCommand(world, {
        kind: 'build',
        player: 0,
        ids: [],
        buildingType: 'palisade',
        x: 10,
        z: 10,
      });

      const site = world.entities.find(
        (e): e is BuildingEntity =>
          !!e &&
          e.kind === 'building' &&
          e.type === 'palisade' &&
          e.x === 10 &&
          e.z === 10,
      );
      expect(site).toBeDefined();
      expect(player.gold).toBe(
        goldBefore - getBuildingData('palisade', 'clans')!.gold,
      );
      expect(unit.z).toBeGreaterThanOrEqual(10);
      expect(unit.z).not.toBeCloseTo(8.5, 5);
      expect(
        world.grid.canOccupy(unit.x, unit.z, unit.radius, unit.player),
      ).toBe(true);
      const dx = Math.max(10 - unit.x, 0, unit.x - 11);
      const dz = Math.max(10 - unit.z, 0, unit.z - 11);
      expect(dx * dx + dz * dz).toBeGreaterThanOrEqual(
        unit.radius * unit.radius,
      );
      for (const other of world.entities) {
        if (!other || other.kind !== 'unit' || other.id === unit.id) continue;
        expect(
          Math.hypot(unit.x - other.x, unit.z - other.z),
        ).toBeGreaterThanOrEqual(unit.radius + other.radius);
      }
      expect(crowd.map((member) => [member.x, member.z])).toEqual(crowdBefore);
      return [unit.x, unit.z];
    };
    expect(place()).toEqual(place());
  });

  it.each([
    {
      name: 'a sealed one-tile pocket',
      pocket: [] as [number, number][],
      types: ['thrall'],
    },
    {
      name: 'one free tile for two wagons',
      pocket: [[10, 11]] as [number, number][],
      types: ['haul_wagon', 'haul_wagon'],
    },
  ])(
    'rejects the whole placement atomically when $name has no connected safe exit',
    ({ pocket, types }) => {
      const map = makeTestMap();
      // Everything outside this 3x4 box is a different connected component.
      for (let z = 9; z <= 12; z++) {
        for (let x = 9; x <= 11; x++) {
          const open =
            x === 10 &&
            (z === 10 || pocket.some(([px, pz]) => px === x && pz === z));
          if (!open) map.tiles[z * map.size + x] = Terrain.WATER;
        }
      }
      const world = new World(map, new Rng(1), { 0: 'clans' });
      const player = world.players[0];
      player.food = 100;
      player.gold = 100;
      const units = types.map((type) => world.spawnUnit(0, type, 10.5, 10.5));
      units.forEach((unit, i) => {
        unit.order = { kind: 'move', x: 20.5, z: 20.5 };
        unit.orders = [{ kind: 'move', x: 25.5, z: 25.5 }];
        unit.orderGeneration += 3;
        unit.pathTarget = { x: 20.5, z: 20.5 };
        unit.formationSlotX = 20.5;
        unit.formationSlotZ = 20.5;
        if (i % 2 === 0) {
          unit.path = [
            { x: 10.5, z: 10.7 },
            { x: 20.5, z: 20.5 },
          ];
          unit.pathPending = false;
        } else {
          world.pathQueue.request(unit.id, unit.x, unit.z, 20.5, 20.5, 0);
          unit.pathPending = true;
        }
      });
      const snapshot = (unit: UnitEntity) =>
        JSON.stringify({
          x: unit.x,
          z: unit.z,
          previousX: unit.previousX,
          previousZ: unit.previousZ,
          order: unit.order,
          orders: unit.orders,
          orderGeneration: unit.orderGeneration,
          path: unit.path,
          pathTarget: unit.pathTarget,
          pathPending: unit.pathPending,
          formationSlotX: unit.formationSlotX,
          formationSlotZ: unit.formationSlotZ,
          stuckTicks: unit.stuckTicks,
        });
      const before = units.map(snapshot);
      const food = player.food;
      const gold = player.gold;
      const entityCount = world.entities.length;
      const flags = world.grid.flags.slice();
      const revision = world.grid.revision;
      const pending = world.pathQueue.pendingCount;
      const events = world.events.length;
      expect(pending).toBe(types.length > 1 ? 1 : 0);

      applyBuildCommand(world, {
        kind: 'build',
        player: 0,
        ids: units.map((unit) => unit.id),
        buildingType: 'palisade',
        x: 10,
        z: 10,
      });

      expect(player.food).toBe(food);
      expect(player.gold).toBe(gold);
      expect(world.entities.length).toBe(entityCount);
      expect(
        world.entities.filter(
          (e) => e?.kind === 'building' && e.type === 'palisade',
        ),
      ).toHaveLength(0);
      expect(world.grid.flags).toEqual(flags);
      expect(world.grid.revision).toBe(revision);
      expect(world.grid.isPassable(10.5, 10.5, 0)).toBe(true);
      expect(world.pathQueue.pendingCount).toBe(pending);
      expect(world.events.length).toBe(events);
      expect(units.map(snapshot)).toEqual(before);
    },
  );
});

describe.each(['move', 'attackMove'] as const)(
  'Construction System — Displaced %s Consumer',
  (kind) => {
    it.each([{ group: false }, { group: true }])(
      'repaths from the displaced position to the existing destination (group=$group)',
      ({ group }) => {
        const map = makeTestMap();
        // The site plugs a one-tile gap in a short wall: straight-line travel from
        // the north side to the south destination is blocked, but a detour exists.
        for (const x of [8, 9, 11, 12])
          map.tiles[10 * map.size + x] = Terrain.WATER;
        const sim = new Sim(map, 1, { 0: 'clans' });
        const world = sim.world;
        world.players[0].gold = 100;
        // South perimeter crowd forces the unit to the north side of the site.
        for (const x of [9.5, 10.5, 11.5])
          world.spawnUnit(0, 'thrall', x, 11.5);
        const unit = world.spawnUnit(0, 'thrall', 10.5, 10.5);
        const ids = [unit.id];
        if (group) ids.push(world.spawnUnit(0, 'thrall', 14.5, 7.5).id);

        sim.issue({ kind, player: 0, ids, x: 10.5, z: 14.5 });
        sim.step();
        expect(unit.order?.kind).toBe(kind);
        expect(unit.path?.length ?? 0).toBeGreaterThan(0);
        expect(unit.pathPending).toBe(false);
        if (group) {
          expect(unit.formationSlotX).toBeDefined();
          expect(unit.formationSlotZ).toBeDefined();
        }
        const destination = { x: unit.pathTarget!.x, z: unit.pathTarget!.z };
        expect(destination.z).toBeGreaterThan(13);
        expect(unit.x).toBeGreaterThan(10);
        expect(unit.x).toBeLessThan(11);
        expect(unit.z).toBeGreaterThan(10);
        expect(unit.z).toBeLessThan(11);

        const revision = world.grid.revision;
        sim.issue({
          kind: 'build',
          player: 0,
          ids: [],
          buildingType: 'palisade',
          x: 10,
          z: 10,
        });
        sim.step();
        expect(world.grid.revision).toBeGreaterThan(revision);
        expect(
          world.entities.some(
            (e) =>
              e?.kind === 'building' &&
              e.type === 'palisade' &&
              e.x === 10 &&
              e.z === 10,
          ),
        ).toBe(true);
        expect(unit.z).toBeLessThan(10);
        expect(
          world.grid.canOccupy(unit.x, unit.z, unit.radius, unit.player),
        ).toBe(true);

        // The active order survives and a fresh path (computed against the new grid
        // from the displaced position) is available without waiting for stuck repath.
        expect(unit.order?.kind).toBe(kind);
        expect(unit.order?.x).toBeCloseTo(destination.x, 10);
        expect(unit.order?.z).toBeCloseTo(destination.z, 10);
        expect(unit.pathPending).toBe(false);
        expect(unit.path?.length ?? 0).toBeGreaterThan(0);
        expect(unit.pathTarget?.x).toBeCloseTo(destination.x, 10);
        expect(unit.pathTarget?.z).toBeCloseTo(destination.z, 10);
        const path = unit.path!;
        const last = path[path.length - 1];
        expect(last.x).toBeCloseTo(destination.x, 5);
        expect(last.z).toBeCloseTo(destination.z, 5);

        let pathLength = 0;
        let prev = { x: unit.x, z: unit.z };
        for (const waypoint of path) {
          const length = Math.hypot(waypoint.x - prev.x, waypoint.z - prev.z);
          const samples = Math.max(1, Math.ceil(length / 0.02));
          for (let s = 0; s <= samples; s++) {
            const px = prev.x + ((waypoint.x - prev.x) * s) / samples;
            const pz = prev.z + ((waypoint.z - prev.z) * s) / samples;
            expect(px > 10.01 && px < 10.99 && pz > 10.01 && pz < 10.99).toBe(
              false,
            );
          }
          pathLength += length;
          prev = waypoint;
        }
        // A real detour is required: the straight line is blocked by the new site.
        expect(pathLength).toBeGreaterThan(
          Math.hypot(destination.x - unit.x, destination.z - unit.z) + 1,
        );

        const displaced = { x: unit.x, z: unit.z };
        const tickLimit =
          Math.ceil((pathLength / (unit.baseSpeed * SIM_DT)) * 1.3) + 40;
        let arrivedAt = -1;
        for (let tick = 1; tick <= tickLimit; tick++) {
          sim.step();
          expect(unit.stuckTicks).toBe(0);
          if (tick === 40) {
            // No 2 s straight-line stall before the first repath.
            expect(
              Math.hypot(unit.x - displaced.x, unit.z - displaced.z),
            ).toBeGreaterThan(1);
          }
          if (unit.order?.kind === 'idle') {
            arrivedAt = tick;
            break;
          }
        }
        expect(arrivedAt).toBeGreaterThan(0);
        expect(
          Math.hypot(unit.x - destination.x, unit.z - destination.z),
        ).toBeLessThanOrEqual(0.3);
        expect(
          world.grid.canOccupy(unit.x, unit.z, unit.radius, unit.player),
        ).toBe(true);
      },
    );
  },
);
