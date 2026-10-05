import { describe, expect, it } from 'vitest';
import { Sim } from './sim.js';
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

  it('rejects unsupported command kinds with not-implemented error', () => {
    const map = makeTestMap(32);
    const sim = new Sim(map, 1);

    expect(() => {
      sim.issue({
        kind: 'build',
        player: 0,
        ids: [1],
        buildingType: 'farm',
        x: 10,
        z: 10,
      });
    }).toThrow(/not implemented yet/);
  });
});
