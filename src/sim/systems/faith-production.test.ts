import { describe, expect, it } from 'vitest';
import { type GameMap, Terrain } from '../map.js';
import { World } from '../world.js';
import { Rng } from '../rng.js';
import type { UnitEntity } from '../entity.js';
import { updateFaith } from './faith.js';
import {
  applyTrainCommand,
  applyCancelTrainCommand,
  updateProduction,
  findSpawnPosition,
} from './production.js';

function makeTestMap(size = 32): GameMap {
  return {
    version: 1,
    id: 'faith_prod_test_map',
    name: 'Faith Production Test Map',
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
}

function makeTestWorld(size = 32): World {
  const map = makeTestMap(size);
  const rng = new Rng(42);
  const world = new World(map, rng, { 0: 'crown', 1: 'crown' });

  // Clean starting entities to give test cases a pristine fixture
  for (let i = 0; i < world.entities.length; i++) {
    const ent = world.entities[i];
    if (ent) {
      world.removeEntity(ent.id);
    }
  }
  world.events.length = 0;

  // Reset player 0 state
  const p0 = world.players[0];
  p0.food = 300;
  p0.gold = 200;
  p0.faithProduced = 0;
  p0.faithUsed = 0;
  p0.lowFaith = false;
  p0.pop = 0;
  p0.popCap = 0;
  p0.age = 1;
  p0.eliminated = false;

  return world;
}

/**
 * Steps faith and production sequentially for one tick, matching SimIntegration tick order.
 */
function stepFaithAndProduction(world: World): void {
  updateFaith(world);
  updateProduction(world);
  world.tick++;
}

describe('M5 Faith System', () => {
  it('recalculates faith and pop only from completed buildings', () => {
    const world = makeTestWorld();
    const p0 = world.players[0];

    // Spawn an incomplete cottage (built = false)
    const unfinishedCottage = world.spawnBuilding(0, 'cottage', 10, 10, false);
    expect(unfinishedCottage.built).toBe(false);

    updateFaith(world);
    expect(p0.popCap).toBe(0);
    expect(p0.faithProduced).toBe(0);
    expect(p0.faithUsed).toBe(0);
    expect(p0.lowFaith).toBe(false);

    // Complete the cottage
    world.completeBuilding(unfinishedCottage);
    expect(unfinishedCottage.built).toBe(true);

    updateFaith(world);
    expect(p0.popCap).toBe(10); // Cottage gives 10 pop
    expect(p0.lowFaith).toBe(false);

    // Destroy the cottage
    world.removeEntity(unfinishedCottage.id);
    updateFaith(world);
    expect(p0.popCap).toBe(0);
  });

  it('enforces hard pop cap of 150 and prevents cap-loss subtraction bugs', () => {
    const world = makeTestWorld();
    const p0 = world.players[0];

    // Spawn 16 cottages (each +10 pop = 160 pop total)
    const cottages = [];
    for (let i = 0; i < 16; i++) {
      const c = world.spawnBuilding(
        0,
        'cottage',
        (i % 8) * 3,
        Math.floor(i / 8) * 3,
        true,
      );
      cottages.push(c);
    }

    updateFaith(world);
    // Hard cap must clamp at 150
    expect(p0.popCap).toBe(150);

    // Remove 1 cottage (15 cottages remain, providing 150 pop)
    world.removeEntity(cottages[0].id);
    updateFaith(world);

    // Deterministic recompute ensures popCap remains 150, avoiding cap-loss bug
    expect(p0.popCap).toBe(150);

    // Remove another cottage (14 cottages remain = 140 pop)
    world.removeEntity(cottages[1].id);
    updateFaith(world);
    expect(p0.popCap).toBe(140);
  });

  it('determines lowFaith when faithUsed > faithProduced', () => {
    const world = makeTestWorld();
    const p0 = world.players[0];

    // Keep provides +5 faith
    world.spawnBuilding(0, 'keep', 10, 10, true);
    updateFaith(world);
    expect(p0.faithProduced).toBe(5);
    expect(p0.faithUsed).toBe(0);
    expect(p0.lowFaith).toBe(false);

    // Barracks uses 2 faith (-2 faith)
    world.spawnBuilding(0, 'barracks', 15, 10, true);
    updateFaith(world);
    expect(p0.faithProduced).toBe(5);
    expect(p0.faithUsed).toBe(2);
    expect(p0.lowFaith).toBe(false); // 2 <= 5 -> false

    // Stable uses 3 faith (-3 faith)
    world.spawnBuilding(0, 'stable', 20, 10, true);
    expect(p0.faithProduced).toBe(5);
    expect(p0.faithUsed).toBe(5);
    expect(p0.lowFaith).toBe(false); // 5 <= 5 -> false

    // Stone tower uses 2 faith (-2 faith)
    const tower = world.spawnBuilding(0, 'stone_tower', 25, 10, true);
    updateFaith(world);
    expect(p0.faithProduced).toBe(5);
    expect(p0.faithUsed).toBe(7);
    expect(p0.lowFaith).toBe(true); // 7 > 5 -> true

    // Remove stone tower -> faithUsed drops to 5, lowFaith clears
    world.removeEntity(tower.id);
    updateFaith(world);
    expect(p0.faithProduced).toBe(5);
    expect(p0.faithUsed).toBe(5);
    expect(p0.lowFaith).toBe(false);
  });
});

describe('M5 Production & LowFaith Timing Regression', () => {
  it('actual timing regression: 5 produced / 7 used triggers LowFaith and doubles peasant train time (20s -> 40s)', () => {
    const world = makeTestWorld();
    const p0 = world.players[0];
    p0.age = 2; // Age II fixture allowing stable and tower
    p0.food = 1000;
    p0.gold = 1000;

    // Completed legitimate Keep (+5 faith produced, +10 popCap)
    const keep = world.spawnBuilding(0, 'keep', 10, 10, true);
    // Completed legitimate Stable (-3 faith used)
    world.spawnBuilding(0, 'stable', 16, 10, true);
    // Completed legitimate Stone Tower (-2 faith used)
    world.spawnBuilding(0, 'stone_tower', 20, 10, true);

    // Before barracks: 5 produced, 5 used -> LowFaith is false
    updateFaith(world);
    expect(p0.faithProduced).toBe(5);
    expect(p0.faithUsed).toBe(5);
    expect(p0.lowFaith).toBe(false);

    // Start building barracks (unfinished, built = false)
    const barracks = world.spawnBuilding(0, 'barracks', 22, 10, false);
    updateFaith(world);
    expect(p0.faithUsed).toBe(5);
    expect(p0.lowFaith).toBe(false);

    // Actual barracks completion MUST trigger flag
    world.completeBuilding(barracks);
    updateFaith(world);
    expect(p0.faithProduced).toBe(5);
    expect(p0.faithUsed).toBe(7);
    expect(p0.lowFaith).toBe(true);

    // Queue a peasant in the Keep
    const queued = applyTrainCommand(world, {
      kind: 'train',
      player: 0,
      buildingId: keep.id,
      unitType: 'peasant',
    });
    expect(queued).toBe(true);
    expect(keep.trainingQueue.length).toBe(1);

    // Peasant base trainTime is 20s.
    // In LowFaith, progress increments at 0.025s per tick (halved from 0.05s).
    // Total ticks required: 20s / 0.025s = 800 ticks (40 seconds).

    // Advance 799 ticks (39.95s)
    for (let t = 0; t < 799; t++) {
      stepFaithAndProduction(world);
    }

    // At tick 799, peasant must NOT be completed yet
    expect(keep.trainingQueue.length).toBe(1);
    expect(keep.trainingQueue[0].progress).toBeCloseTo(799 * 0.025, 4);
    expect(
      world.entities.some(
        (e) => e && e.kind === 'unit' && e.type === 'peasant',
      ),
    ).toBe(false);

    // Advance 1 more tick -> tick 800 (40.0s elapsed)
    stepFaithAndProduction(world);

    // Peasant must be completed and spawned
    expect(keep.trainingQueue.length).toBe(0);
    const spawnedPeasant = world.entities.find(
      (e) => e && e.kind === 'unit' && e.type === 'peasant',
    );
    expect(spawnedPeasant).toBeDefined();
    expect(p0.pop).toBe(1);
  });

  it('normal faith timing: peasant trains in exactly 20s (400 ticks)', () => {
    const world = makeTestWorld();
    const p0 = world.players[0];
    p0.food = 1000;
    p0.gold = 1000;

    const keep = world.spawnBuilding(0, 'keep', 10, 10, true);
    updateFaith(world);
    expect(p0.lowFaith).toBe(false);

    applyTrainCommand(world, {
      kind: 'train',
      player: 0,
      buildingId: keep.id,
      unitType: 'peasant',
    });

    // Peasant base trainTime is 20s (400 ticks at dt = 0.05s)
    for (let t = 0; t < 399; t++) {
      stepFaithAndProduction(world);
    }

    // Tick 399: not spawned
    expect(keep.trainingQueue.length).toBe(1);
    expect(
      world.entities.some(
        (e) => e && e.kind === 'unit' && e.type === 'peasant',
      ),
    ).toBe(false);

    // Tick 400: spawned
    stepFaithAndProduction(world);
    expect(keep.trainingQueue.length).toBe(0);
    expect(
      world.entities.some(
        (e) => e && e.kind === 'unit' && e.type === 'peasant',
      ),
    ).toBe(true);
  });

  it('LowFaith halves progress in the same tick as barracks completion', () => {
    const world = makeTestWorld();
    const p0 = world.players[0];
    p0.age = 2;
    p0.food = 1000;
    p0.gold = 1000;

    const keep = world.spawnBuilding(0, 'keep', 10, 10, true);
    world.spawnBuilding(0, 'stable', 16, 10, true);
    world.spawnBuilding(0, 'stone_tower', 20, 10, true);
    const unfinishedBarracks = world.spawnBuilding(
      0,
      'barracks',
      22,
      10,
      false,
    );

    applyTrainCommand(world, {
      kind: 'train',
      player: 0,
      buildingId: keep.id,
      unitType: 'peasant',
    });

    // Train under normal faith for 100 ticks -> progress should be exactly 5.0 seconds
    for (let t = 0; t < 100; t++) {
      stepFaithAndProduction(world);
    }
    expect(keep.trainingQueue[0].progress).toBeCloseTo(5.0, 4);

    // Complete barracks on tick 100
    world.completeBuilding(unfinishedBarracks);

    // Next tick: updateFaith sets lowFaith = true, and production progress advances by 0.025s (not 0.05s)
    stepFaithAndProduction(world);
    expect(p0.lowFaith).toBe(true);
    expect(keep.trainingQueue[0].progress).toBeCloseTo(5.0 + 0.025, 4);
  });
});

describe('M5 Training Table Validation & Commands', () => {
  it('validates faction, age, building type, and resource affordability', () => {
    const world = makeTestWorld();
    const p0 = world.players[0]; // Crown faction, Age 1

    const keep = world.spawnBuilding(0, 'keep', 10, 10, true);

    // 1. Unknown unit type
    expect(
      applyTrainCommand(world, {
        kind: 'train',
        player: 0,
        buildingId: keep.id,
        unitType: 'super_dragon',
      }),
    ).toBe(false);

    // 2. Wrong faction: Crown player cannot train Clans thrall
    expect(
      applyTrainCommand(world, {
        kind: 'train',
        player: 0,
        buildingId: keep.id,
        unitType: 'thrall',
      }),
    ).toBe(false);

    // 3. Wrong building: Keep cannot train spearman (trained at barracks)
    expect(
      applyTrainCommand(world, {
        kind: 'train',
        player: 0,
        buildingId: keep.id,
        unitType: 'spearman',
      }),
    ).toBe(false);

    // 4. Age requirement: cannot train Age 2 sergeant in Age 1
    const stable = world.spawnBuilding(0, 'stable', 15, 10, true);
    expect(
      applyTrainCommand(world, {
        kind: 'train',
        player: 0,
        buildingId: stable.id,
        unitType: 'sergeant',
      }),
    ).toBe(false);

    // Set age to 2, sergeant now passes age check
    p0.age = 2;
    p0.food = 200;
    p0.gold = 200;
    expect(
      applyTrainCommand(world, {
        kind: 'train',
        player: 0,
        buildingId: stable.id,
        unitType: 'sergeant',
      }),
    ).toBe(true);
    // 5. Incomplete building cannot train units
    const unfinishedKeep = world.spawnBuilding(0, 'keep', 20, 20, false);
    expect(
      applyTrainCommand(world, {
        kind: 'train',
        player: 0,
        buildingId: unfinishedKeep.id,
        unitType: 'peasant',
      }),
    ).toBe(false);

    // 6. Insufficient resources
    p0.food = 10;
    p0.gold = 0;
    expect(
      applyTrainCommand(world, {
        kind: 'train',
        player: 0,
        buildingId: keep.id,
        unitType: 'peasant', // Peasant costs 50 food
      }),
    ).toBe(false);
  });

  it('enforces maximum queue size of 5', () => {
    const world = makeTestWorld();
    const p0 = world.players[0];
    p0.food = 1000;
    p0.gold = 1000;

    const keep = world.spawnBuilding(0, 'keep', 10, 10, true);

    for (let i = 0; i < 5; i++) {
      const ok = applyTrainCommand(world, {
        kind: 'train',
        player: 0,
        buildingId: keep.id,
        unitType: 'peasant',
      });
      expect(ok).toBe(true);
    }
    expect(keep.trainingQueue.length).toBe(5);

    // 6th command must be rejected
    const foodBefore = p0.food;
    const ok6 = applyTrainCommand(world, {
      kind: 'train',
      player: 0,
      buildingId: keep.id,
      unitType: 'peasant',
    });
    expect(ok6).toBe(false);
    expect(keep.trainingQueue.length).toBe(5);
    expect(p0.food).toBe(foodBefore); // No food deducted
  });

  it('cancelTrain refunds 100% of food and gold and shifts queue', () => {
    const world = makeTestWorld();
    const p0 = world.players[0];
    p0.food = 300;
    p0.gold = 200;

    const keep = world.spawnBuilding(0, 'keep', 10, 10, true);

    // Queue ox_cart (60 food, 40 gold)
    applyTrainCommand(world, {
      kind: 'train',
      player: 0,
      buildingId: keep.id,
      unitType: 'ox_cart',
    });
    expect(p0.food).toBe(240);
    expect(p0.gold).toBe(160);

    // Queue peasant (50 food, 0 gold)
    applyTrainCommand(world, {
      kind: 'train',
      player: 0,
      buildingId: keep.id,
      unitType: 'peasant',
    });
    expect(p0.food).toBe(190);
    expect(p0.gold).toBe(160);
    expect(keep.trainingQueue.length).toBe(2);

    // Cancel last item (slotIndex omitted -> cancels peasant)
    const cancelledLast = applyCancelTrainCommand(world, {
      kind: 'cancelTrain',
      player: 0,
      buildingId: keep.id,
    });
    expect(cancelledLast).toBe(true);
    expect(p0.food).toBe(240); // 100% refund of 50 food
    expect(p0.gold).toBe(160);
    expect(keep.trainingQueue.length).toBe(1);
    expect(keep.trainingQueue[0].unitType).toBe('ox_cart');

    // Run ox_cart training for 100 ticks (partial progress)
    updateFaith(world);
    for (let t = 0; t < 100; t++) {
      updateProduction(world);
    }
    expect(keep.trainingQueue[0].progress).toBeGreaterThan(0);

    // Cancel actively training item at slotIndex 0 -> must still refund 100%
    const cancelledActive = applyCancelTrainCommand(world, {
      kind: 'cancelTrain',
      player: 0,
      buildingId: keep.id,
      slotIndex: 0,
    });
    expect(cancelledActive).toBe(true);
    expect(p0.food).toBe(300); // 100% refund of 60 food
    expect(p0.gold).toBe(200); // 100% refund of 40 gold
    expect(keep.trainingQueue.length).toBe(0);
  });
});

describe('M5 Population Cap Boundaries & Collision-Safe Spawning', () => {
  it('cap pause: training freezes at pop cap and resumes when cap increases', () => {
    const world = makeTestWorld();
    const p0 = world.players[0];
    p0.food = 1000;
    p0.gold = 1000;

    // Keep provides 10 popCap
    const keep = world.spawnBuilding(0, 'keep', 10, 10, true);

    // Spawn 10 peasants directly to reach 10/10 pop
    for (let i = 0; i < 10; i++) {
      world.spawnUnit(0, 'peasant', 18 + i, 10);
    }

    updateFaith(world);
    expect(p0.pop).toBe(10);
    expect(p0.popCap).toBe(10);

    // Queue an 11th peasant
    applyTrainCommand(world, {
      kind: 'train',
      player: 0,
      buildingId: keep.id,
      unitType: 'peasant',
    });
    expect(keep.trainingQueue.length).toBe(1);

    // Step 400 ticks (20s) while pop capped
    for (let t = 0; t < 400; t++) {
      stepFaithAndProduction(world);
    }

    // Training must be paused at cap (progress remains 0, unit does not spawn)
    expect(keep.trainingQueue[0].progress).toBe(0);
    expect(p0.pop).toBe(10);

    // Build a cottage to increase popCap to 20
    world.spawnBuilding(0, 'cottage', 4, 10, true);
    updateFaith(world);
    expect(p0.popCap).toBe(20);
    // Now step 400 ticks -> training completes and unit spawns
    for (let t = 0; t < 400; t++) {
      stepFaithAndProduction(world);
    }

    expect(keep.trainingQueue.length).toBe(0);
    expect(p0.pop).toBe(11);
  });

  it('cap unpause: training resumes when a living unit dies/is removed', () => {
    const world = makeTestWorld();
    const p0 = world.players[0];
    p0.food = 1000;
    p0.gold = 1000;

    const keep = world.spawnBuilding(0, 'keep', 10, 10, true);
    const existingPeasant = world.spawnUnit(0, 'peasant', 18, 10);

    // Set pop equal to popCap (e.g. 10/10)
    for (let i = 0; i < 9; i++) {
      world.spawnUnit(0, 'peasant', 19 + i, 10);
    }

    updateFaith(world);
    expect(p0.pop).toBe(10);
    expect(p0.popCap).toBe(10);

    applyTrainCommand(world, {
      kind: 'train',
      player: 0,
      buildingId: keep.id,
      unitType: 'peasant',
    });

    // Paused for 50 ticks
    for (let t = 0; t < 50; t++) {
      stepFaithAndProduction(world);
    }
    expect(keep.trainingQueue[0].progress).toBe(0);

    // Kill one existing peasant
    world.removeEntity(existingPeasant.id);
    updateFaith(world);
    expect(p0.pop).toBe(9);

    // Training immediately unpauses and completes after 400 ticks
    for (let t = 0; t < 400; t++) {
      stepFaithAndProduction(world);
    }
    expect(keep.trainingQueue.length).toBe(0);
    expect(p0.pop).toBe(10);
  });

  it('spawns unit collision-safe on building perimeter and applies ground rally', () => {
    const world = makeTestWorld();
    const p0 = world.players[0];
    p0.food = 1000;
    p0.gold = 1000;

    const keep = world.spawnBuilding(0, 'keep', 10, 10, true);
    keep.rallyPoint = { x: 25, z: 30 };

    updateFaith(world);

    // Verify findSpawnPosition finds a valid perimeter location
    const spawnPos = findSpawnPosition(world, keep, 0.2);
    expect(spawnPos).toBeDefined();

    // Spawn position must be outside Keep footprint [10..13] x [10..13]
    const inKeepFootprint =
      spawnPos!.x >= 10 &&
      spawnPos!.x <= 14 &&
      spawnPos!.z >= 10 &&
      spawnPos!.z <= 14;
    expect(inKeepFootprint).toBe(false);

    // Block candidate tile on south side with a unit
    world.spawnUnit(0, 'peasant', spawnPos!.x, spawnPos!.z);

    // Candidate search must avoid the occupied tile
    const nextSpawnPos = findSpawnPosition(world, keep, 0.2);
    expect(nextSpawnPos).toBeDefined();
    expect(
      nextSpawnPos!.x === spawnPos!.x && nextSpawnPos!.z === spawnPos!.z,
    ).toBe(false);

    // Queue peasant and train to completion
    applyTrainCommand(world, {
      kind: 'train',
      player: 0,
      buildingId: keep.id,
      unitType: 'peasant',
    });

    for (let t = 0; t < 400; t++) {
      stepFaithAndProduction(world);
    }

    const spawned = world.entities.find(
      (e): e is UnitEntity =>
        !!e && e.kind === 'unit' && e.id !== 1 && e.type === 'peasant',
    );
    expect(spawned).toBeDefined();
    // Rally order must be issued to the spawned unit
    expect(spawned!.order).toEqual({ kind: 'move', x: 25, z: 30 });
  });
});
