import { describe, expect, it } from 'vitest';
import alphaTestMapJson from '../../public/maps/alpha_test.json' with { type: 'json' };
import { Sim } from './sim.js';
import { Terrain, parseMap, type GameMap } from './map.js';
import type { Command } from './commands.js';
import type { UnitEntity } from './entity.js';

function makeCleanMap(size = 32): GameMap {
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

describe('Simulation Movement Acceptance Tests', () => {
  it('alpha_test forest detour: routes around barrier and reaches within 0.5 of target', () => {
    const map = parseMap(alphaTestMapJson);
    const sim = new Sim(map, 1);

    // Barrier lies between x=49..53 and z=38..89
    // Start at (45.5, 60.5) and target at (58.5, 60.5)
    const startX = 45.5;
    const startZ = 60.5;
    const targetX = 58.5;
    const targetZ = 60.5;

    // Use peasant (speed 1.15)
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

      // Check if unit is in forest zone
      const tx = Math.floor(unit.x);
      const tz = Math.floor(unit.z);
      const tileCode = map.tiles[tz * map.size + tx];
      if (tileCode === Terrain.FOREST) {
        penetratedForest = true;
      }

      // Check detour: routing above z=38 or below z=90 while between barrier X coords
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

  it('nearest reachable enclosed pocket: stops at nearest reachable tile without infinite loop', () => {
    const map = makeCleanMap(32);
    const sim = new Sim(map, 1);

    // Construct a walled enclosed pocket from x=16..22, z=16..22
    for (let x = 16; x <= 22; x++) {
      sim.world.grid.setBuilding(x, 16, 1, 1, true);
      sim.world.grid.setBuilding(x, 22, 1, 1, true);
    }
    for (let z = 16; z <= 22; z++) {
      sim.world.grid.setBuilding(16, z, 1, 1, true);
      sim.world.grid.setBuilding(22, z, 1, 1, true);
    }
    sim.world.grid.revision++;

    // Unit starts outside the pocket at (10.5, 19.5)
    const unit = sim.world.spawnUnit(0, 'peasant', 10.5, 19.5);

    // Target inside the enclosed pocket (19.5, 19.5)
    sim.issue({
      kind: 'move',
      player: 0,
      ids: [unit.id],
      x: 19.5,
      z: 19.5,
      queued: false,
    });

    // Run simulation
    for (let t = 0; t < 250; t++) {
      sim.step();
    }

    // The unit must stop on a passable tile outside the pocket
    expect(sim.world.grid.isPassable(unit.x, unit.z, 0)).toBe(true);
    const insidePocket = unit.x >= 16 && unit.x <= 22 && unit.z >= 16 && unit.z <= 22;
    expect(insidePocket).toBe(false);

    // Distance to the unreachable target must match the minimum distance among all reachable tiles (4.0)
    const distToTarget = Math.hypot(unit.x - 19.5, unit.z - 19.5);
    expect(distToTarget).toBeCloseTo(4.0, 1);
    // Order must settle to idle, avoiding an endless stuck repath loop
    expect(unit.order?.kind).toBe('idle');
    expect(unit.stuckTicks).toBe(0);
  });

  it('20 unit separation: group ordered to one point ends with no pair overlapping by >0.1', () => {
    const map = makeCleanMap(40);
    const sim = new Sim(map, 42);

    const units: UnitEntity[] = [];
    const unitIds: number[] = [];

    // Spawn 20 peasants in a compact cluster at (10, 10)
    for (let i = 0; i < 20; i++) {
      const sx = 10.0 + (i % 5) * 0.5;
      const sz = 10.0 + Math.floor(i / 5) * 0.5;
      const u = sim.world.spawnUnit(0, 'peasant', sx, sz);
      units.push(u);
      unitIds.push(u.id);
    }

    // Order all 20 units to destination (25.0, 25.0)
    sim.issue({
      kind: 'move',
      player: 0,
      ids: unitIds,
      x: 25.0,
      z: 25.0,
      queued: false,
    });

    // Run for 350 ticks to give units ample time to travel, form up, and settle
    for (let t = 0; t < 350; t++) {
      sim.step();
    }

    // Assert all units arrived near target
    for (const u of units) {
      const dist = Math.hypot(u.x - 25.0, u.z - 25.0);
      expect(dist).toBeLessThan(5.0);
    }

    // Check overlap for every unique pair of units:
    // overlap = (r1 + r2) - dist <= 0.1
    let maxOverlapFound = -Infinity;
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        const u1 = units[i];
        const u2 = units[j];
        const dist = Math.hypot(u1.x - u2.x, u1.z - u2.z);
        const minDist = u1.radius + u2.radius;
        const overlap = minDist - dist;
        if (overlap > maxOverlapFound) {
          maxOverlapFound = overlap;
        }
        expect(overlap).toBeLessThanOrEqual(0.1);
      }
    }

    expect(maxOverlapFound).toBeLessThanOrEqual(0.1);
  });

  it('determinism: two sims with seed 7 and same command log produce identical entity positions after 2000 ticks', () => {
    const sim1 = new Sim(parseMap(alphaTestMapJson), 7);
    const sim2 = new Sim(parseMap(alphaTestMapJson), 7);

    // Extract actual unit entities for both players (spawned by initStartingBases after mines and doodads)
    const p0Units = sim1.world.entities.filter(
      (e): e is UnitEntity => e?.kind === 'unit' && e.player === 0,
    );
    const p1Units = sim1.world.entities.filter(
      (e): e is UnitEntity => e?.kind === 'unit' && e.player === 1,
    );
    const p0Ids = p0Units.map((u) => u.id);
    const p1Ids = p1Units.map((u) => u.id);

    expect(p0Ids.length).toBeGreaterThan(0);
    expect(p1Ids.length).toBeGreaterThan(0);

    const initP0X = p0Units[0].x;
    const initP0Z = p0Units[0].z;
    const initP1X = p1Units[0].x;
    const initP1Z = p1Units[0].z;

    // Scheduled command log across 2000 ticks targeting actual unit IDs
    const commandsAtTick = new Map<number, Command[]>();
    commandsAtTick.set(0, [
      { kind: 'move', player: 0, ids: [p0Ids[0]], x: 30.5, z: 25.5, queued: false },
      { kind: 'move', player: 0, ids: [p0Ids[1]], x: 22.5, z: 32.5, queued: false },
      { kind: 'move', player: 1, ids: [p1Ids[0]], x: 95.5, z: 98.5, queued: false },
      { kind: 'move', player: 1, ids: [p1Ids[1]], x: 98.5, z: 95.5, queued: false },
    ]);

    commandsAtTick.set(80, [
      { kind: 'move', player: 0, ids: [p0Ids[0], p0Ids[1], p0Ids[2], p0Ids[3]], x: 42.0, z: 38.0, queued: false },
    ]);

    commandsAtTick.set(200, [
      { kind: 'stop', player: 0, ids: [p0Ids[1]], queued: false },
      { kind: 'hold', player: 0, ids: [p0Ids[2]], queued: false },
    ]);

    commandsAtTick.set(350, [
      { kind: 'move', player: 0, ids: [p0Ids[0]], x: 44.0, z: 40.0, queued: false },
      { kind: 'move', player: 0, ids: [p0Ids[0]], x: 46.0, z: 42.0, queued: true },
    ]);

    commandsAtTick.set(600, [
      { kind: 'attackMove', player: 1, ids: [p1Ids[0], p1Ids[1], p1Ids[2]], x: 80.0, z: 80.0, queued: false },
    ]);

    commandsAtTick.set(1000, [
      { kind: 'move', player: 0, ids: p0Ids, x: 35.0, z: 35.0, queued: false },
    ]);

    commandsAtTick.set(1400, [
      { kind: 'move', player: 1, ids: p1Ids, x: 90.0, z: 90.0, queued: false },
    ]);

    commandsAtTick.set(1750, [
      { kind: 'stop', player: 1, ids: [p1Ids[1]], queued: false },
    ]);

    let checkedVisibleMovement = false;

    // Run both sims in lockstep for 2000 ticks
    for (let tick = 0; tick < 2000; tick++) {
      const scheduled = commandsAtTick.get(tick);
      if (scheduled) {
        for (const cmd of scheduled) {
          sim1.issue(cmd);
          sim2.issue(cmd);
        }
      }
      sim1.step();
      sim2.step();

      // Assert units have visibly and substantially moved during the command sequence
      if (tick === 500) {
        const u0 = sim1.world.entities[p0Ids[0]] as UnitEntity;
        const u1 = sim1.world.entities[p1Ids[0]] as UnitEntity;
        expect(Math.hypot(u0.x - initP0X, u0.z - initP0Z)).toBeGreaterThan(5.0);
        expect(Math.hypot(u1.x - initP1X, u1.z - initP1Z)).toBeGreaterThan(5.0);
        checkedVisibleMovement = true;
      }
    }

    expect(checkedVisibleMovement).toBe(true);
    // After 2000 ticks, verify exact identical entity count and positions
    expect(sim1.world.tick).toBe(2000);
    expect(sim2.world.tick).toBe(2000);
    expect(sim1.world.entities.length).toBe(sim2.world.entities.length);

    for (let i = 0; i < sim1.world.entities.length; i++) {
      const e1 = sim1.world.entities[i];
      const e2 = sim2.world.entities[i];

      if (!e1) {
        expect(e2).toBeUndefined();
        continue;
      }
      expect(e2).toBeDefined();

      expect(e1.kind).toBe(e2!.kind);
      expect(e1.x).toBe(e2!.x);
      expect(e1.z).toBe(e2!.z);
      expect(e1.previousX).toBe(e2!.previousX);
      expect(e1.previousZ).toBe(e2!.previousZ);

      if (e1.kind === 'unit') {
        const u1 = e1 as UnitEntity;
        const u2 = e2 as UnitEntity;
        expect(u1.facing).toBe(u2.facing);
        expect(u1.order?.kind).toBe(u2.order?.kind);
      }
    }
  });

  it('queue budget: respects 25000 node expansion cap per tick and resumes deferred searches', () => {
    const map = parseMap(alphaTestMapJson);
    const sim = new Sim(map, 99);

    // Queue 20 complex searches across the 128x128 map
    for (let i = 0; i < 20; i++) {
      sim.world.pathQueue.request(
        100 + i,
        20.5 + (i % 3) * 0.5,
        20.5 + Math.floor(i / 3) * 0.5,
        104.5 - (i % 3) * 0.5,
        104.5 - Math.floor(i / 3) * 0.5,
        0,
      );
    }

    expect(sim.world.pathQueue.pendingCount).toBe(20);

    // Process with the standard 25,000 budget
    const resultsTick1 = sim.world.pathQueue.process(25000);
    expect(sim.world.pathQueue.lastExpansions).toBeLessThanOrEqual(25000);

    // Subsequent tick continues processing remaining searches
    const resultsTick2 = sim.world.pathQueue.process(25000);
    expect(sim.world.pathQueue.lastExpansions).toBeLessThanOrEqual(25000);

    const totalProcessed = resultsTick1.length + resultsTick2.length;
    expect(totalProcessed).toBeGreaterThan(0);
  });

  it('command ordering: orders apply at start of next tick and queued orders chain', () => {
    const map = makeCleanMap(30);
    const sim = new Sim(map, 1);

    const unit = sim.world.spawnUnit(0, 'peasant', 10.0, 10.0);

    // Issue move to (12.0, 10.0)
    sim.issue({
      kind: 'move',
      player: 0,
      ids: [unit.id],
      x: 12.0,
      z: 10.0,
      queued: false,
    });

    // Before step(), order is not yet applied
    expect(unit.order?.kind).toBe('idle');

    // First step applies the command
    sim.step();
    expect(unit.order?.kind).toBe('move');

    // Queue a second move to (14.0, 10.0)
    sim.issue({
      kind: 'move',
      player: 0,
      ids: [unit.id],
      x: 14.0,
      z: 10.0,
      queued: true,
    });

    sim.step();
    expect(unit.orders.length).toBe(1);
    expect(unit.orders[0].x).toBe(14.0);
  });

  it('gate permissions: allies pass through gate while enemies are blocked', () => {
    const map = makeCleanMap(30);
    const sim = new Sim(map, 1);

    // Player 0 and Player 1 are enemies by default (teams 0 and 1)
    // Wall line at x=15 with a gate at (15, 14, w=1, h=2)
    for (let z = 0; z < 30; z++) {
      if (z === 14 || z === 15) {
        sim.world.grid.setGate(15, z, 1, 1, 0); // owned by player 0
      } else {
        sim.world.grid.setBuilding(15, z, 1, 1, true);
      }
    }
    sim.world.grid.revision++;

    // Player 0 unit (owner) can pass
    expect(sim.world.grid.isPassable(15, 14, 0)).toBe(true);
    // Player 1 unit (enemy) cannot pass
    expect(sim.world.grid.isPassable(15, 14, 1)).toBe(false);

    // If we make player 1 an ally of player 0
    sim.world.grid.setAllies(0, [1]);
    expect(sim.world.grid.isPassable(15, 14, 1)).toBe(true);
  });

  it('shallow water slowdown: unit speed is reduced by 30% in shallow water', () => {
    const map = makeCleanMap(30);
    // Place a strip of shallow water from x=12..16, z=0..30
    for (let z = 0; z < 30; z++) {
      for (let x = 12; x <= 16; x++) {
        map.tiles[z * map.size + x] = Terrain.SHALLOW;
      }
    }

    const sim = new Sim(map, 1);
    // Clear parallel routes away from starting Keep ([2,2] footprint x=2..6, z=2..6)
    const normalUnit = sim.world.spawnUnit(0, 'peasant', 8.5, 10.0);
    const shallowUnit = sim.world.spawnUnit(0, 'peasant', 14.5, 10.0);

    sim.issue({
      kind: 'move',
      player: 0,
      ids: [normalUnit.id],
      x: 8.5,
      z: 24.0,
      queued: false,
    });

    sim.issue({
      kind: 'move',
      player: 0,
      ids: [shallowUnit.id],
      x: 14.5,
      z: 24.0,
      queued: false,
    });

    // Run for 30 ticks
    for (let t = 0; t < 30; t++) {
      sim.step();
    }

    const normalDistance = normalUnit.z - 10.0;
    const shallowDistance = shallowUnit.z - 10.0;

    expect(shallowUnit.speed).toBeCloseTo(shallowUnit.baseSpeed * 0.7, 4);
    expect(shallowDistance).toBeLessThan(normalDistance);
    expect(shallowDistance / normalDistance).toBeCloseTo(0.7, 2);
  });
});
