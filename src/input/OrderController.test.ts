import { describe, expect, it } from 'vitest';
import { OrderController } from './OrderController';
import { Sim } from '../sim/sim';
import { resolveRallyPoint } from '../sim/systems/rally';
import { type GameMap, Terrain } from '../sim/map';
import type { GameSession } from '../game/GameSession';
import type { SelectionController } from './SelectionController';
import type { Command } from '../sim/commands';

function makeTestMap(size = 32): GameMap {
  return {
    version: 1,
    id: 'test_map',
    name: 'Test Map',
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

describe('OrderController functional rally outcomes in Sim', () => {
  function createController(sim: Sim, selectedIds: number[]) {
    const mockSession = {
      sim,
      issue: (cmd: Command) => {
        sim.issue(cmd);
      },
      showStatus: () => {},
    } as unknown as GameSession;

    const mockSelection = {
      ids: selectedIds,
      addSelectionChangeListener: () => () => {},
    } as unknown as SelectionController;

    return new OrderController(mockSession, mockSelection);
  }

  it('enemy target order establishes ground rally that does not follow enemy movement', () => {
    const sim = new Sim(makeTestMap(), 1);
    const keep = sim.world.spawnBuilding(0, 'keep', 4, 4, true);
    const enemyUnit = sim.world.spawnUnit(1, 'peasant', 20, 20);

    const controller = createController(sim, [keep.id]);
    controller.contextOrder(enemyUnit.x, enemyUnit.z, false, enemyUnit.id);
    sim.step();

    expect(keep.rallyPoint).toBeDefined();
    expect(keep.rallyPoint?.targetId).toBeUndefined();
    expect(keep.rallyPoint?.x).toBe(20);
    expect(keep.rallyPoint?.z).toBe(20);

    // Enemy moves; rally point must remain anchored at original ground point
    enemyUnit.x = 28;
    enemyUnit.z = 28;
    expect(resolveRallyPoint(sim.world, keep.rallyPoint!)).toEqual({
      x: 20,
      z: 20,
    });
  });

  it('own target order establishes target rally that tracks unit movement', () => {
    const sim = new Sim(makeTestMap(), 1);
    const keep = sim.world.spawnBuilding(0, 'keep', 4, 4, true);
    const ownUnit = sim.world.spawnUnit(0, 'peasant', 10, 10);

    const controller = createController(sim, [keep.id]);
    controller.contextOrder(ownUnit.x, ownUnit.z, false, ownUnit.id);
    sim.step();

    expect(keep.rallyPoint).toBeDefined();
    expect(keep.rallyPoint?.targetId).toBe(ownUnit.id);
    expect(resolveRallyPoint(sim.world, keep.rallyPoint!)).toEqual({
      x: 10,
      z: 10,
    });

    // Own unit moves; resolved rally point tracks moving unit
    ownUnit.x = 16;
    ownUnit.z = 16;
    expect(resolveRallyPoint(sim.world, keep.rallyPoint!)).toEqual({
      x: 16,
      z: 16,
    });
  });

  it('self target order excludes self identity and records ground coordinates', () => {
    const sim = new Sim(makeTestMap(), 1);
    const keep = sim.world.spawnBuilding(0, 'keep', 4, 4, true);

    const controller = createController(sim, [keep.id]);
    controller.contextOrder(keep.x + 2, keep.z + 2, false, keep.id);
    sim.step();

    expect(keep.rallyPoint).toBeDefined();
    expect(keep.rallyPoint?.targetId).toBeUndefined();
    expect(keep.rallyPoint?.x).toBe(keep.x + 2);
    expect(keep.rallyPoint?.z).toBe(keep.z + 2);
  });
});
