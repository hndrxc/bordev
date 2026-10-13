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

describe('OrderController combat and contextual precedence orders', () => {
  function createTestController(
    sim: Sim,
    selectedIds: number[],
    issuedCommands: Command[],
  ) {
    const mockSession = {
      sim,
      issue: (cmd: Command) => {
        issuedCommands.push(cmd);
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

  it('emits attack command and sets sim attack order when right-clicking enemy unit', () => {
    const sim = new Sim(makeTestMap(), 1);
    const spearman = sim.world.spawnUnit(0, 'spearman', 10, 10);
    const enemy = sim.world.spawnUnit(1, 'peasant', 14, 14);

    const issued: Command[] = [];
    const controller = createTestController(sim, [spearman.id], issued);
    controller.contextOrder(enemy.x, enemy.z, false, enemy.id);
    sim.step();

    expect(issued).toHaveLength(1);
    expect(issued[0]).toEqual({
      kind: 'attack',
      player: 0,
      ids: [spearman.id],
      targetId: enemy.id,
      queued: false,
    });
    expect(spearman.order?.kind).toBe('attack');
    expect(
      spearman.order && 'targetId' in spearman.order
        ? spearman.order.targetId
        : undefined,
    ).toBe(enemy.id);
  });

  it('supports shift queue when right-clicking enemy unit', () => {
    const sim = new Sim(makeTestMap(), 1);
    const spearman = sim.world.spawnUnit(0, 'spearman', 10, 10);
    const enemy = sim.world.spawnUnit(1, 'peasant', 14, 14);

    // Initial move order so shift-queue has an active order to queue behind
    sim.issue({
      kind: 'move',
      player: 0,
      ids: [spearman.id],
      x: 20,
      z: 20,
      queued: false,
    });
    sim.step();
    expect(spearman.order?.kind).toBe('move');
    expect(spearman.orders).toHaveLength(0);

    const issued: Command[] = [];
    const controller = createTestController(sim, [spearman.id], issued);
    controller.contextOrder(enemy.x, enemy.z, true, enemy.id);
    sim.step();

    expect(issued).toHaveLength(1);
    expect(issued[0]).toEqual({
      kind: 'attack',
      player: 0,
      ids: [spearman.id],
      targetId: enemy.id,
      queued: true,
    });
    // Active order remains move, attack is queued in orders
    expect(spearman.order?.kind).toBe('move');
    expect(spearman.orders).toHaveLength(1);
    expect(spearman.orders[0]).toMatchObject({
      kind: 'attack',
      targetId: enemy.id,
    });
  });

  it('emits attack command when right-clicking enemy building', () => {
    const sim = new Sim(makeTestMap(), 1);
    const spearman = sim.world.spawnUnit(0, 'spearman', 10, 10);
    const enemyBuilding = sim.world.spawnBuilding(1, 'keep', 15, 15, true);

    const issued: Command[] = [];
    const controller = createTestController(sim, [spearman.id], issued);
    controller.contextOrder(
      enemyBuilding.x,
      enemyBuilding.z,
      false,
      enemyBuilding.id,
    );
    sim.step();

    expect(issued).toHaveLength(1);
    expect(issued[0]).toEqual({
      kind: 'attack',
      player: 0,
      ids: [spearman.id],
      targetId: enemyBuilding.id,
      queued: false,
    });
    expect(spearman.order?.kind).toBe('attack');
    expect(
      spearman.order && 'targetId' in spearman.order
        ? spearman.order.targetId
        : undefined,
    ).toBe(enemyBuilding.id);
  });

  it('does not attack allied target on same team (contract C2)', () => {
    const sim = new Sim(makeTestMap(), 1);
    const spearman = sim.world.spawnUnit(0, 'spearman', 10, 10);
    const ally = sim.world.spawnUnit(1, 'peasant', 14, 14);

    // Set player 1 to team 0 (allies)
    sim.world.setTeam(1, 0);

    const issued: Command[] = [];
    const controller = createTestController(sim, [spearman.id], issued);
    controller.contextOrder(ally.x, ally.z, false, ally.id);
    sim.step();

    expect(issued.every((cmd) => cmd.kind !== 'attack')).toBe(true);
    expect(spearman.order?.kind).not.toBe('attack');
  });

  it('routes right-click on hostile entity to move for carts and attack for combatants (contract C7)', () => {
    const sim = new Sim(makeTestMap(), 1);
    const cart = sim.world.spawnUnit(0, 'ox_cart', 10, 10);
    const enemy = sim.world.spawnUnit(1, 'peasant', 14, 14);

    // Cart-only selection: cart receives move to target position, move marker
    const issuedCart: Command[] = [];
    const cartController = createTestController(sim, [cart.id], issuedCart);
    cartController.contextOrder(enemy.x, enemy.z, false, enemy.id);
    sim.step();

    expect(issuedCart).toHaveLength(1);
    expect(issuedCart[0]).toEqual({
      kind: 'move',
      player: 0,
      ids: [cart.id],
      x: enemy.x,
      z: enemy.z,
      queued: false,
    });
    expect(cart.order?.kind).toBe('move');
    expect(cart.order && 'x' in cart.order ? cart.order.x : undefined).toBe(
      enemy.x,
    );
    expect(cart.order && 'z' in cart.order ? cart.order.z : undefined).toBe(
      enemy.z,
    );
    expect(
      cartController.markers[cartController.markers.length - 1]?.kind,
    ).toBe('move');

    // Mixed selection: spearman receives attack, cart receives move
    const spearman = sim.world.spawnUnit(0, 'spearman', 10, 12);
    const issuedMixed: Command[] = [];
    const mixedController = createTestController(
      sim,
      [cart.id, spearman.id],
      issuedMixed,
    );
    mixedController.contextOrder(enemy.x, enemy.z, false, enemy.id);
    sim.step();

    expect(issuedMixed).toHaveLength(2);
    expect(
      issuedMixed.some((c) => c.kind === 'attack' && c.ids.includes(spearman.id)),
    ).toBe(true);
    expect(
      issuedMixed.some((c) => c.kind === 'move' && c.ids.includes(cart.id)),
    ).toBe(true);
    expect(spearman.order?.kind).toBe('attack');
    expect(
      spearman.order && 'targetId' in spearman.order
        ? spearman.order.targetId
        : undefined,
    ).toBe(enemy.id);
    expect(cart.order?.kind).toBe('move');
    expect(
      mixedController.markers[mixedController.markers.length - 1]?.kind,
    ).toBe('attackMove');
  });

  it('preserves worker build precedence on own unfinished building', () => {
    const sim = new Sim(makeTestMap(), 1);
    const peasant = sim.world.spawnUnit(0, 'peasant', 10, 10);
    const unfinished = sim.world.spawnBuilding(0, 'cottage', 12, 12, false);

    const issued: Command[] = [];
    const controller = createTestController(sim, [peasant.id], issued);
    controller.contextOrder(unfinished.x, unfinished.z, false, unfinished.id);
    sim.step();

    expect(issued).toHaveLength(1);
    expect(issued[0].kind).toBe('build');
    expect(peasant.order?.kind).toBe('build');
  });

  it('preserves cart pinMine precedence on gold mine', () => {
    const sim = new Sim(makeTestMap(), 1);
    const cart = sim.world.spawnUnit(0, 'ox_cart', 10, 10);
    const mine = sim.world.spawnMine(12, 12, 1000);

    const issued: Command[] = [];
    const controller = createTestController(sim, [cart.id], issued);
    controller.contextOrder(mine.x, mine.z, false, mine.id);
    sim.step();

    expect(issued).toHaveLength(1);
    expect(issued[0].kind).toBe('pinMine');
    expect(cart.order?.kind).toBe('pinMine');
  });
});
