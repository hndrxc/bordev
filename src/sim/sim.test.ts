import { describe, expect, it } from 'vitest';
import { CROWN_BUILDINGS } from '../data/buildings.js';
import type { BuildingEntity } from './entity.js';
import { Sim, SIM_DT } from './sim.js';
import { parseMap, type GameMap, Terrain } from './map.js';

function makeTestMap(size = 32): GameMap {
  return {
    version: 1,
    id: 'sim_test_map',
    name: 'Sim Test Map',
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

function buildingAt(
  sim: Sim,
  type: string,
  x: number,
  z: number,
): BuildingEntity | undefined {
  return sim.world.entities.find(
    (entity): entity is BuildingEntity =>
      entity?.kind === 'building' &&
      entity.type === type &&
      entity.x === x &&
      entity.z === z,
  );
}

describe('Sim Core Consumer Regressions', () => {
  it('queued move transitions advance through waypoints without stalling', () => {
    const map = makeTestMap(32);
    const sim = new Sim(map, 1);

    const unit = sim.world.spawnUnit(0, 'peasant', 10, 10);
    expect(unit.x).toBe(10);
    expect(unit.z).toBe(10);

    sim.issue({
      kind: 'move',
      player: 0,
      ids: [unit.id],
      x: 12,
      z: 10,
      queued: false,
    });
    sim.step();

    sim.issue({
      kind: 'move',
      player: 0,
      ids: [unit.id],
      x: 14,
      z: 10,
      queued: true,
    });

    for (let t = 0; t < 120; t++) {
      sim.step();
    }

    expect(Math.abs(unit.x - 14)).toBeLessThan(0.1);
    expect(Math.abs(unit.z - 10)).toBeLessThan(0.1);
    expect(unit.orders.length).toBe(0);
    expect(unit.order?.kind).toBe('idle');
  });

  it('stopped and held units accept later queued moves', () => {
    const map = makeTestMap(32);
    const sim = new Sim(map, 1);

    const unit = sim.world.spawnUnit(0, 'peasant', 10, 10);

    sim.issue({
      kind: 'stop',
      player: 0,
      ids: [unit.id],
      queued: false,
    });
    sim.step();
    expect(unit.order?.kind).toBe('stop');

    sim.issue({
      kind: 'move',
      player: 0,
      ids: [unit.id],
      x: 15,
      z: 10,
      queued: true,
    });
    sim.step();

    expect(unit.order?.kind).toBe('move');

    for (let t = 0; t < 120; t++) {
      sim.step();
    }

    expect(Math.abs(unit.x - 15)).toBeLessThan(0.1);
    expect(unit.order?.kind).toBe('idle');

    // Also verify held unit accepts later queued move
    sim.issue({
      kind: 'hold',
      player: 0,
      ids: [unit.id],
      queued: false,
    });
    sim.step();
    expect(unit.order?.kind).toBe('hold');

    sim.issue({
      kind: 'move',
      player: 0,
      ids: [unit.id],
      x: 18,
      z: 10,
      queued: true,
    });
    sim.step();

    expect(unit.order?.kind).toBe('move');

    for (let t = 0; t < 120; t++) {
      sim.step();
    }

    expect(Math.abs(unit.x - 18)).toBeLessThan(0.1);
    expect(unit.order?.kind).toBe('idle');
  });

  it('queued stop/hold acts as a transition and does not permanently block subsequent orders', () => {
    const map = makeTestMap(32);
    const sim = new Sim(map, 1);

    const unit = sim.world.spawnUnit(0, 'peasant', 10, 10);

    sim.issue({
      kind: 'move',
      player: 0,
      ids: [unit.id],
      x: 12,
      z: 10,
      queued: false,
    });
    sim.step();

    sim.issue({
      kind: 'stop',
      player: 0,
      ids: [unit.id],
      queued: true,
    });
    sim.issue({
      kind: 'move',
      player: 0,
      ids: [unit.id],
      x: 14,
      z: 10,
      queued: true,
    });

    for (let t = 0; t < 120; t++) {
      sim.step();
    }

    expect(Math.abs(unit.x - 14)).toBeLessThan(0.1);
    expect(unit.orders.length).toBe(0);
    expect(unit.order?.kind).toBe('idle');
  });

  it('starting popCap invariant derives strictly from sum of completed buildings', () => {
    const map = makeTestMap(32);
    const sim = new Sim(map, 1);

    const player = sim.world.players[0];
    expect(player.popCap).toBe(10);
    expect(player.pop).toBe(5);

    let keepId = -1;
    for (let i = 0; i < sim.world.entities.length; i++) {
      const ent = sim.world.entities[i];
      if (
        ent &&
        ent.kind === 'building' &&
        ent.isTownCenter &&
        ent.player === 0
      ) {
        keepId = ent.id;
        break;
      }
    }
    expect(keepId).toBeGreaterThanOrEqual(0);

    sim.world.removeEntity(keepId);
    expect(player.popCap).toBe(0);

    sim.world.spawnBuilding(0, 'cottage', 10, 10, true);
    expect(player.popCap).toBe(10);
  });

  it('rejects unknown unit and building types with an explicit error', () => {
    const map = makeTestMap(32);
    const sim = new Sim(map, 1);

    expect(() => {
      sim.world.spawnUnit(0, 'not_a_unit', 10, 10);
    }).toThrow(/Unknown unit type 'not_a_unit'/);

    expect(() => {
      sim.world.spawnBuilding(0, 'fake_building', 10, 10);
    }).toThrow(/Unknown building type 'fake_building'/);
  });

  it('defaults all players to Crown for Alpha, while keeping Clans configurable', () => {
    const map = makeTestMap(32);
    const simDefault = new Sim(map, 1);
    expect(simDefault.world.players[0].faction).toBe('crown');
    expect(simDefault.world.players[1].faction).toBe('crown');

    const simCustom = new Sim(map, 1, { 1: 'clans' });
    expect(simCustom.world.players[0].faction).toBe('crown');
    expect(simCustom.world.players[1].faction).toBe('clans');
  });

  it('parseMap strictly validates required fields, tile length, and terrain codes', () => {
    expect(() => {
      parseMap({
        version: 1,
        id: 'test',
        size: 8,
        players: 2,
      });
    }).toThrow(/Missing required map field: tiles/);

    expect(() => {
      parseMap({
        version: 1,
        id: 'test',
        size: 8,
        players: 2,
        tiles: new Uint8Array(10),
      });
    }).toThrow(/Invalid map tiles length/);

    expect(() => {
      const invalidTiles = new Uint8Array(64).fill(0);
      invalidTiles[5] = 99;
      parseMap({
        version: 1,
        id: 'test',
        size: 8,
        players: 2,
        tiles: invalidTiles,
      });
    }).toThrow(/Invalid terrain code 99/);
  });

  it('setRally command updates building rallyPoint on next tick with owner validation', () => {
    const map = makeTestMap(32);
    const sim = new Sim(map, 1);

    const keep = sim.world.spawnBuilding(0, 'keep', 10, 10, true);
    expect(keep.rallyPoint).toBeUndefined();

    // Issue setRally for owner player 0
    sim.issue({
      kind: 'setRally',
      player: 0,
      buildingId: keep.id,
      x: 25,
      z: 30,
    });

    // Next-tick semantics: rallyPoint must NOT be updated before sim.step()
    expect(keep.rallyPoint).toBeUndefined();

    sim.step();
    expect(keep.rallyPoint).toEqual({ x: 25, z: 30 });

    // Non-owner player 1 cannot change player 0's building rally point
    sim.issue({
      kind: 'setRally',
      player: 1,
      buildingId: keep.id,
      x: 5,
      z: 5,
    });
    sim.step();
    expect(keep.rallyPoint).toEqual({ x: 25, z: 30 });

    // Command targeting an enemy's Keep is ignored
    const enemyKeep = sim.world.spawnBuilding(1, 'keep', 20, 20, true);
    sim.issue({
      kind: 'setRally',
      player: 0,
      buildingId: enemyKeep.id,
      x: 18,
      z: 18,
    });
    sim.step();
    expect(enemyKeep.rallyPoint).toBeUndefined();

    // Command targeting non-production own buildings (e.g. cottage, farm) is ignored
    const cottage = sim.world.spawnBuilding(0, 'cottage', 2, 2, true);
    const farm = sim.world.spawnBuilding(0, 'farm', 6, 6, true);
    sim.issue({
      kind: 'setRally',
      player: 0,
      buildingId: cottage.id,
      x: 15,
      z: 15,
    });
    sim.issue({
      kind: 'setRally',
      player: 0,
      buildingId: farm.id,
      x: 15,
      z: 15,
    });
    sim.step();
    expect(cottage.rallyPoint).toBeUndefined();
    expect(farm.rallyPoint).toBeUndefined();

    // Command targeting non-building entity (e.g. peasant) is safely ignored
    const peasant = sim.world.spawnUnit(0, 'peasant', 12, 12);
    sim.issue({
      kind: 'setRally',
      player: 0,
      buildingId: peasant.id,
      x: 15,
      z: 15,
    });
    sim.step();
    expect('rallyPoint' in peasant).toBe(false);

    // Non-finite coordinates (NaN / Infinity) are ignored
    sim.issue({
      kind: 'setRally',
      player: 0,
      buildingId: keep.id,
      x: Number.NaN,
      z: 20,
    });
    sim.issue({
      kind: 'setRally',
      player: 0,
      buildingId: keep.id,
      x: 20,
      z: Number.POSITIVE_INFINITY,
    });
    sim.issue({
      kind: 'setRally',
      player: 0,
      buildingId: keep.id,
      x: Number.NEGATIVE_INFINITY,
      z: Number.NaN,
    });
    sim.step();
    expect(keep.rallyPoint).toEqual({ x: 25, z: 30 });

    // Off-map coordinates clamp to the map edges [0, map.size]
    sim.issue({
      kind: 'setRally',
      player: 0,
      buildingId: keep.id,
      x: -10,
      z: -20,
    });
    sim.step();
    expect(keep.rallyPoint).toEqual({ x: 0, z: 0 });

    sim.issue({
      kind: 'setRally',
      player: 0,
      buildingId: keep.id,
      x: 100,
      z: 200,
    });
    sim.step();
    expect(keep.rallyPoint).toEqual({ x: 32, z: 32 });

    // A valid Keep rally still applies on the next tick
    sim.issue({
      kind: 'setRally',
      player: 0,
      buildingId: keep.id,
      x: 12,
      z: 14,
    });
    expect(keep.rallyPoint).toEqual({ x: 32, z: 32 });
    sim.step();
    expect(keep.rallyPoint).toEqual({ x: 12, z: 14 });
  });

  it('every M5 command works next-tick through Sim.issue', () => {
    const map = makeTestMap(32);
    const sim = new Sim(map, 1);
    const p0 = sim.world.players[0];
    p0.food = 1000;
    p0.gold = 1000;

    // 1. build command
    const builder = sim.world.spawnUnit(0, 'peasant', 9.5, 10.5);
    sim.issue({
      kind: 'build',
      player: 0,
      ids: [builder.id],
      buildingType: 'cottage',
      x: 10,
      z: 10,
    });
    expect(builder.order?.kind).toBe('idle');
    expect(p0.gold).toBe(1000);
    sim.step();
    expect(builder.order?.kind).toBe('build');
    const cottageSite = sim.world.entities.find(
      (e) =>
        e &&
        e.kind === 'building' &&
        e.type === 'cottage' &&
        e.x === 10 &&
        e.z === 10,
    );
    expect(cottageSite).toBeDefined();
    if (!cottageSite || cottageSite.kind !== 'building') {
      throw new Error('Cottage site not found');
    }
    expect(cottageSite.buildProgress).toBeGreaterThan(0);
    expect(p0.gold).toBe(970);

    // 2. repair command
    const damagedBuilding = sim.world.spawnBuilding(
      0,
      'barracks',
      14,
      14,
      true,
    );
    damagedBuilding.hp = 100;
    const repairer = sim.world.spawnUnit(0, 'peasant', 13, 14);
    sim.issue({
      kind: 'repair',
      player: 0,
      ids: [repairer.id],
      targetId: damagedBuilding.id,
    });
    sim.step();
    expect(repairer.order?.kind).toBe('repair');

    expect(damagedBuilding.hp).toBeGreaterThan(100);
    // 3. farm command
    const farm = sim.world.spawnBuilding(0, 'farm', 20, 20, true);
    const farmer = sim.world.spawnUnit(0, 'peasant', 19, 20);
    sim.issue({
      kind: 'farm',
      player: 0,
      ids: [farmer.id],
      targetId: farm.id,
    });
    sim.step();
    expect(farmer.order?.kind).toBe('farm');

    expect(p0.foodCollected).toBeGreaterThan(0);
    // 4. pinMine command
    const mine = sim.world.spawnMine(25, 14, 6000);
    const cart = sim.world.spawnUnit(0, 'ox_cart', 24, 14);
    sim.issue({
      kind: 'pinMine',
      player: 0,
      ids: [cart.id],
      targetId: mine.id,
    });
    sim.step();
    expect(cart.order?.kind).toBe('pinMine');
    expect(cart.cart?.phase).toBe('loading');
    sim.step();
    expect(cart.cart?.ticks).toBeGreaterThan(0);

    // 5. train command
    let tcId = -1;
    for (let i = 0; i < sim.world.entities.length; i++) {
      const e = sim.world.entities[i];
      if (e && e.kind === 'building' && e.isTownCenter && e.player === 0) {
        tcId = e.id;
        break;
      }
    }
    const tc = sim.world.entities[tcId];
    expect(tc?.kind).toBe('building');
    if (!tc || tc.kind !== 'building') throw new Error('Town center not found');
    expect(tc.trainingQueue.length).toBe(0);
    sim.issue({
      kind: 'train',
      player: 0,
      buildingId: tcId,
      unitType: 'peasant',
    });
    sim.step();
    expect(tc.trainingQueue.length).toBe(1);
    expect(tc.trainingQueue[0].progress).toBeGreaterThan(0);

    // 6. cancelTrain command
    sim.issue({
      kind: 'cancelTrain',
      player: 0,
      buildingId: tcId,
      slotIndex: 0,
    });
    sim.step();
    expect(tc.trainingQueue.length).toBe(0);

    // 7. move and attackMove
    const soldier = sim.world.spawnUnit(0, 'peasant', 10, 6);
    sim.issue({
      kind: 'move',
      player: 0,
      ids: [soldier.id],
      x: 12,
      z: 6,
    });
    sim.step();
    expect(soldier.order?.kind).toBe('move');

    sim.issue({
      kind: 'attackMove',
      player: 0,
      ids: [soldier.id],
      x: 14,
      z: 6,
    });
    sim.step();
    expect(soldier.order?.kind).toBe('attackMove');

    // 8. stop and hold
    sim.issue({
      kind: 'stop',
      player: 0,
      ids: [soldier.id],
    });
    sim.step();
    expect(soldier.order?.kind).toBe('stop');

    sim.issue({
      kind: 'hold',
      player: 0,
      ids: [soldier.id],
    });
    sim.step();
    expect(soldier.order?.kind).toBe('hold');

    // 9. setRally
    sim.issue({
      kind: 'setRally',
      player: 0,
      buildingId: tcId,
      x: 16,
      z: 18,
    });
    sim.step();
    expect(tc.rallyPoint).toEqual({ x: 16, z: 18 });

    // 10. delete command
    const cottageId = cottageSite!.id;
    sim.issue({
      kind: 'delete',
      player: 0,
      ids: [cottageId],
    });
    sim.step();
    expect(sim.world.entities[cottageId]).toBeUndefined();
  });

  it('research and cancelResearch apply next tick through Sim.issue and refund fully', () => {
    const sim = new Sim(makeTestMap(48), 1);
    const world = sim.world;
    const player = world.players[0];
    const keep = world.entities.find(
      (entity): entity is BuildingEntity =>
        entity?.kind === 'building' &&
        entity.player === 0 &&
        entity.type === 'keep',
    )!;
    world.spawnBuilding(0, 'barracks', 16, 16, true);
    world.spawnBuilding(0, 'storehouse', 22, 16, true);
    player.food = 1000;
    player.gold = 1000;

    sim.issue({
      kind: 'research',
      player: 0,
      buildingId: keep.id,
      upgradeId: 'age_2',
    });
    // Commands apply at the start of the next tick, never at issue time.
    expect(keep.research).toBeUndefined();
    expect(player.food).toBe(1000);
    sim.step();
    expect(keep.research?.upgradeId).toBe('age_2');
    expect(player.food).toBe(500);
    expect(player.gold).toBe(800);

    sim.issue({ kind: 'cancelResearch', player: 0, buildingId: keep.id });
    expect(keep.research).toBeDefined();
    sim.step();
    expect(keep.research).toBeUndefined();
    expect(player.food).toBe(1000);
    expect(player.gold).toBe(1000);
    expect(player.age).toBe(1);
  });

  it('work approach locomotion does not advance a construction job on arrival', () => {
    const sim = new Sim(makeTestMap(32), 1);
    const unit = sim.world.spawnUnit(0, 'peasant', 10, 10.5);
    const site = sim.world.spawnBuilding(0, 'cottage', 14, 10, false);
    sim.issue({
      kind: 'build',
      player: 0,
      ids: [unit.id],
      buildingType: 'cottage',
      x: site.x,
      z: site.z,
      targetId: site.id,
    });
    sim.step();
    expect(site.buildProgress).toBe(0);

    for (let t = 0; t < 120 && site.buildProgress === 0; t++) {
      sim.step();
    }
    expect(unit.x).toBeGreaterThan(10);
    expect(site.buildProgress).toBeGreaterThan(0);
    expect(site.built).toBe(false);
    expect(unit.order?.kind).toBe('build');
    const progressOnArrival = site.buildProgress;
    for (let t = 0; t < 20; t++) sim.step();
    expect(site.buildProgress).toBeGreaterThan(progressOnArrival);
    expect(unit.order?.kind).toBe('build');
  });

  it('queued work order activates when preceding order completes', () => {
    const map = makeTestMap(32);
    const sim = new Sim(map, 1);

    const farm = sim.world.spawnBuilding(0, 'farm', 14, 10, true);
    const unit = sim.world.spawnUnit(0, 'peasant', 10, 10);
    sim.issue({
      kind: 'move',
      player: 0,
      ids: [unit.id],
      x: 11,
      z: 10,
    });
    sim.step();
    expect(unit.order?.kind).toBe('move');

    // Queue a farm order on the unit targeting real built farm
    sim.issue({
      kind: 'farm',
      player: 0,
      ids: [unit.id],
      targetId: farm.id,
      queued: true,
    });

    const foodBefore = sim.world.players[0].foodCollected;
    // Step until the unit reaches (11, 10)
    for (let t = 0; t < 60; t++) {
      sim.step();
      if (unit.order?.kind === 'farm') break;
    }

    expect(unit.order?.kind).toBe('farm');
    expect(unit.orders.length).toBe(0);

    // Consumer work outcome: unit approaches farm and begins farming
    for (let t = 0; t < 60; t++) {
      sim.step();
    }
    expect(unit.order?.kind).toBe('farm');
    expect(unit.workAnimation).toBe('work');
    expect(sim.world.players[0].foodCollected).toBeGreaterThan(foodBefore);
  });

  it('work orders repath instead of abandoning when stuck threshold reached', () => {
    const sim = new Sim(makeTestMap(32), 1);
    const unit = sim.world.spawnUnit(0, 'peasant', 10, 10);
    const site = sim.world.spawnBuilding(0, 'cottage', 20, 20, false);
    sim.issue({
      kind: 'build',
      player: 0,
      ids: [unit.id],
      buildingType: 'cottage',
      x: site.x,
      z: site.z,
      targetId: site.id,
    });
    sim.step();
    const normalSpeed = unit.baseSpeed;
    unit.baseSpeed = 0;
    unit.stuckTicks = 120;
    unit.stuckProgressX = unit.x;
    unit.stuckProgressZ = unit.z;
    unit.stuckLastCheckTick = sim.world.tick - 40;
    sim.step();
    expect(unit.order?.kind).toBe('build');
    expect(unit.pathPending).toBe(true);
    expect(unit.stuckTicks).toBe(0);

    unit.baseSpeed = normalSpeed;
    for (let t = 0; t < 1000 && !site.built; t++) sim.step();
    expect(site.built).toBe(true);
    expect(site.buildProgress).toBe(1);
  });

  it('active work is canceled when its target disappears or its ID is recycled', () => {
    for (const recycleTarget of [false, true]) {
      const sim = new Sim(makeTestMap(32), 1);
      const unit = sim.world.spawnUnit(0, 'peasant', 10, 10);
      const site = sim.world.spawnBuilding(0, 'cottage', 14, 10, false);
      sim.issue({
        kind: 'build',
        player: 0,
        ids: [unit.id],
        buildingType: 'cottage',
        x: site.x,
        z: site.z,
        targetId: site.id,
      });
      sim.step();
      expect(unit.order?.kind).toBe('build');
      sim.world.removeEntity(site.id);
      const replacement = recycleTarget
        ? sim.world.spawnBuilding(0, 'cottage', 14, 10, false)
        : undefined;
      if (replacement) expect(replacement.id).toBe(site.id);
      sim.step();
      expect(unit.order?.kind).toBe('idle');
      expect(unit.workAnimation).toBeUndefined();
      expect(unit.pathPending).toBe(false);
      if (replacement) expect(replacement.buildProgress).toBe(0);
    }
  });

  it('queued move yields active farming on a real tick without deleting the farm', () => {
    const sim = new Sim(makeTestMap(32), 1);
    const player = sim.world.players[0];
    const farm = sim.world.spawnBuilding(0, 'farm', 10, 10, true);
    const farmer = sim.world.spawnUnit(0, 'peasant', 9.5, 10.5);
    sim.issue({
      kind: 'farm',
      player: 0,
      ids: [farmer.id],
      targetId: farm.id,
    });
    for (let t = 0; t < 20; t++) sim.step();
    expect(farmer.order?.kind).toBe('farm');
    expect(farmer.workAnimation).toBe('work');
    expect(player.foodCollected).toBeCloseTo(0.5, 8);

    const foodBefore = player.food;
    const collectedBefore = player.foodCollected;
    sim.issue({
      kind: 'move',
      player: 0,
      ids: [farmer.id],
      x: 18,
      z: 18,
      queued: true,
    });
    expect(farmer.order?.kind).toBe('farm');
    expect(player.foodCollected).toBe(collectedBefore);
    sim.step();

    expect(farmer.order).toMatchObject({ kind: 'move', x: 18, z: 18 });
    expect(farmer.orders).toHaveLength(0);
    expect(farmer.workAnimation).toBeUndefined();
    expect(player.food).toBe(foodBefore);
    expect(player.foodCollected).toBe(collectedBefore);
    expect(sim.world.entities[farm.id]).toBe(farm);
    expect(farm.built).toBe(true);

    const travelDeadline = Math.ceil(
      (Math.hypot(18 - farmer.x, 18 - farmer.z) / farmer.baseSpeed + 3) /
        SIM_DT,
    );
    for (let t = 0; t < travelDeadline; t++) sim.step();
    expect(farmer.x).toBeCloseTo(18, 5);
    expect(farmer.z).toBeCloseTo(18, 5);
    expect(farmer.order?.kind).toBe('idle');
    expect(farmer.orders).toHaveLength(0);
    expect(farmer.workAnimation).toBeUndefined();
    expect(player.food).toBe(foodBefore);
    expect(player.foodCollected).toBe(collectedBefore);
    expect(sim.world.entities[farm.id]).toBe(farm);
  });

  it('builds a Shift-queued second farm after the first farm completes and starts working', () => {
    const sim = new Sim(makeTestMap(64), 1);
    const player = sim.world.players[0];
    const farmData = CROWN_BUILDINGS.farm;
    const initialFood = player.food;
    const initialGold = player.gold;
    const worker = sim.world.spawnUnit(0, 'peasant', 23.5, 20.5);
    // One-worker table build time plus eight seconds for approach and pathfinding.
    const buildDeadline = Math.ceil((farmData.buildTime + 8) / SIM_DT);

    sim.issue({
      kind: 'build',
      player: 0,
      ids: [worker.id],
      buildingType: 'farm',
      x: 24,
      z: 20,
      queued: true,
    });
    sim.step();
    const firstFarm = buildingAt(sim, 'farm', 24, 20);
    expect(firstFarm).toMatchObject({ built: false });
    expect(player.gold).toBe(initialGold - farmData.gold);
    for (let t = 0; t < buildDeadline && !firstFarm?.built; t++) sim.step();
    expect(firstFarm).toMatchObject({ built: true, buildProgress: 1 });
    expect(worker.order).toMatchObject({
      kind: 'farm',
      targetId: firstFarm?.id,
    });
    expect(worker.workAnimation).toBe('work');

    const foodAtCompletion = player.foodCollected;
    for (let t = 0; t < 20; t++) sim.step();
    expect(player.foodCollected - foodAtCompletion).toBeCloseTo(0.5, 8);
    const collectedBeforeSecond = player.foodCollected;
    const foodBeforeSecond = player.food;

    sim.issue({
      kind: 'build',
      player: 0,
      ids: [worker.id],
      buildingType: 'farm',
      x: 28,
      z: 20,
      queued: true,
    });
    expect(worker.order).toMatchObject({
      kind: 'farm',
      targetId: firstFarm?.id,
    });
    sim.step();

    const secondFarm = buildingAt(sim, 'farm', 28, 20);
    expect(secondFarm).toMatchObject({ built: false, buildProgress: 0 });
    expect(player.gold).toBe(initialGold - 2 * farmData.gold);
    expect(player.food).toBe(foodBeforeSecond - farmData.food);
    expect(player.foodCollected).toBe(collectedBeforeSecond);
    expect(worker.order).toMatchObject({
      kind: 'build',
      targetId: secondFarm?.id,
    });
    expect(worker.orders).toHaveLength(0);
    expect(worker.workAnimation).toBeUndefined();
    expect(sim.world.entities).toContain(firstFarm);

    for (let t = 0; t < buildDeadline && !secondFarm?.built; t++) {
      sim.step();
      if (!secondFarm?.built) {
        expect(player.foodCollected).toBe(collectedBeforeSecond);
        expect(player.food).toBe(foodBeforeSecond - farmData.food);
      }
    }
    expect(secondFarm).toMatchObject({ built: true, buildProgress: 1 });
    expect(firstFarm).toMatchObject({
      built: true,
      buildProgress: 1,
      hp: farmData.hp,
    });
    expect(sim.world.entities).toContain(firstFarm);
    expect(worker.order).toMatchObject({
      kind: 'farm',
      targetId: secondFarm?.id,
    });
    expect(worker.orders).toHaveLength(0);
    expect(player.foodCollected - collectedBeforeSecond).toBeCloseTo(
      0.5 * SIM_DT,
      8,
    );

    const collectedAfterSecond = player.foodCollected;
    for (let t = 0; t < 20; t++) sim.step();
    expect(player.foodCollected - collectedAfterSecond).toBeCloseTo(0.5, 8);
    expect(player.food).toBeCloseTo(
      initialFood - 2 * farmData.food + player.foodCollected,
      8,
    );
    expect(player.gold).toBe(initialGold - 2 * farmData.gold);
  });

  it('finishes an active finite build before starting the next queued build', () => {
    const sim = new Sim(makeTestMap(32), 1);
    const player = sim.world.players[0];
    const farmData = CROWN_BUILDINGS.farm;
    const initialGold = player.gold;
    const worker = sim.world.spawnUnit(0, 'peasant', 13.5, 10.5);
    const buildDeadline = Math.ceil((farmData.buildTime + 8) / SIM_DT);
    sim.issue({
      kind: 'build',
      player: 0,
      ids: [worker.id],
      buildingType: 'farm',
      x: 14,
      z: 10,
    });
    sim.step();
    const firstFarm = buildingAt(sim, 'farm', 14, 10);
    expect(firstFarm).toMatchObject({ built: false });
    expect(firstFarm?.buildProgress).toBeGreaterThan(0);
    const progressBeforeQueue = firstFarm?.buildProgress ?? 0;

    sim.issue({
      kind: 'build',
      player: 0,
      ids: [worker.id],
      buildingType: 'farm',
      x: 20,
      z: 10,
      queued: true,
    });
    sim.step();
    const secondFarm = buildingAt(sim, 'farm', 20, 10);
    expect(player.gold).toBe(initialGold - 2 * farmData.gold);
    expect(worker.order).toMatchObject({
      kind: 'build',
      targetId: firstFarm?.id,
    });
    expect(worker.orders).toHaveLength(1);
    expect(worker.orders[0]).toMatchObject({
      kind: 'build',
      targetId: secondFarm?.id,
    });
    expect(firstFarm?.buildProgress).toBeGreaterThan(progressBeforeQueue);
    expect(secondFarm).toMatchObject({ built: false, buildProgress: 0 });

    for (let t = 0; t < buildDeadline && !firstFarm?.built; t++) {
      sim.step();
      expect(secondFarm).toMatchObject({ built: false, buildProgress: 0 });
      expect(player.foodCollected).toBe(0);
      if (!firstFarm?.built) {
        expect(worker.order?.targetId).toBe(firstFarm?.id);
      }
    }
    expect(firstFarm).toMatchObject({ built: true, buildProgress: 1 });
    expect(worker.order).toMatchObject({
      kind: 'build',
      targetId: secondFarm?.id,
    });
    expect(worker.orders).toHaveLength(0);
    expect(player.foodCollected).toBe(0);

    for (let t = 0; t < buildDeadline && !secondFarm?.built; t++) sim.step();
    expect(secondFarm).toMatchObject({ built: true, buildProgress: 1 });
    expect(sim.world.entities).toContain(firstFarm);
    expect(worker.order).toMatchObject({
      kind: 'farm',
      targetId: secondFarm?.id,
    });
    expect(worker.orders).toHaveLength(0);
    expect(player.gold).toBe(initialGold - 2 * farmData.gold);
    expect(player.foodCollected).toBeCloseTo(0.5 * SIM_DT, 8);
  });

  it('delete unfinished building cancels and refunds resources; delete building with training queue refunds queue', () => {
    const map = makeTestMap(32);
    const sim = new Sim(map, 1);
    const p0 = sim.world.players[0];
    p0.food = 500;
    p0.gold = 500;

    // 1. Unfinished building refund
    const builder = sim.world.spawnUnit(0, 'peasant', 10, 18);
    sim.issue({
      kind: 'build',
      player: 0,
      ids: [builder.id],
      buildingType: 'cottage',
      x: 10,
      z: 10,
    });
    sim.step();
    const unfinished = sim.world.entities.find(
      (entity) => entity?.kind === 'building' && entity.type === 'cottage',
    );
    if (!unfinished || unfinished.kind !== 'building') {
      throw new Error('Cottage site not found');
    }
    expect(unfinished.built).toBe(false);
    expect(unfinished.buildProgress).toBe(0);
    expect(p0.food).toBe(500);
    expect(p0.gold).toBe(470);
    const foodBefore = p0.food;
    const goldBefore = p0.gold;

    sim.issue({
      kind: 'delete',
      player: 0,
      ids: [unfinished.id],
    });
    sim.step();

    expect(sim.world.entities[unfinished.id]).toBeUndefined();
    // Cottage cost refunded (0 food, 30 gold)
    expect(p0.food).toBe(foodBefore);
    expect(p0.gold).toBe(goldBefore + 30);

    // 2. Built building with active training queue
    const barracks = sim.world.spawnBuilding(0, 'barracks', 14, 14, true);
    sim.issue({
      kind: 'train',
      player: 0,
      buildingId: barracks.id,
      unitType: 'spearman',
    });
    sim.step();
    expect(barracks.trainingQueue).toHaveLength(1);
    expect(barracks.trainingQueue[0].progress).toBeGreaterThan(0);
    const foodBeforeDel = p0.food;
    const goldBeforeDel = p0.gold;

    sim.issue({
      kind: 'delete',
      player: 0,
      ids: [barracks.id],
    });
    sim.step();

    expect(sim.world.entities[barracks.id]).toBeUndefined();
    expect(p0.food).toBe(foodBeforeDel + 35);
    expect(p0.gold).toBe(goldBeforeDel + 25);
  });

  it('deterministic steps with identical inputs produce identical world state', () => {
    const map1 = makeTestMap(32);
    const map2 = makeTestMap(32);
    const sim1 = new Sim(map1, 42);
    const sim2 = new Sim(map2, 42);

    sim1.world.players[0].food = 500;
    sim1.world.players[0].gold = 500;
    sim2.world.players[0].food = 500;
    sim2.world.players[0].gold = 500;

    const u1 = sim1.world.spawnUnit(0, 'peasant', 5, 5);
    const u2 = sim2.world.spawnUnit(0, 'peasant', 5, 5);

    const cmd = {
      kind: 'build' as const,
      player: 0,
      ids: [u1.id],
      buildingType: 'cottage',
      x: 10,
      z: 10,
    };

    sim1.issue(cmd);
    sim2.issue({ ...cmd, ids: [u2.id] });

    for (let t = 0; t < 50; t++) {
      sim1.step();
      sim2.step();
    }

    expect(u1.x).toBeCloseTo(u2.x, 5);
    expect(u1.z).toBeCloseTo(u2.z, 5);
    expect(sim1.world.players[0].food).toBe(sim2.world.players[0].food);
    expect(sim1.world.players[0].gold).toBe(sim2.world.players[0].gold);
  });
});
