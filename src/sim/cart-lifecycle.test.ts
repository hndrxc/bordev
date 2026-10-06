import { describe, expect, it } from 'vitest';
import type { BuildingEntity, MineEntity, UnitEntity } from './entity.js';
import { Terrain, type GameMap } from './map.js';
import { Sim } from './sim.js';
import type { PlayerState } from './world.js';

function playerCarts(sim: Sim, player = 0): UnitEntity[] {
  return sim.world.entities.filter(
    (entity): entity is UnitEntity =>
      !!entity &&
      entity.kind === 'unit' &&
      entity.player === player &&
      entity.type === 'ox_cart',
  );
}

function carried(cart: UnitEntity): number {
  return cart.cart?.carriedGold ?? 0;
}

function atPoint(cart: UnitEntity, point: { x: number; z: number }): boolean {
  return Math.hypot(cart.x - point.x, cart.z - point.z) <= 0.05;
}

interface CartFixture {
  sim: Sim;
  mine: MineEntity;
  cart: UnitEntity;
  keep: BuildingEntity;
  player: PlayerState;
  step(): void;
  until(predicate: () => boolean, maxTicks: number): void;
}

function makeFixture(): CartFixture {
  const map: GameMap = {
    version: 1,
    id: 'cart_lifecycle_clean32',
    name: 'Cart lifecycle clean 32',
    size: 32,
    players: 2,
    tiles: new Uint8Array(32 * 32).fill(Terrain.GRASS),
    goldMines: [[12, 4]],
    starts: [
      [4, 4],
      [24, 24],
    ],
    doodads: [],
  };
  const sim = new Sim(map, 17);
  const mine = sim.world.entities.find(
    (entity): entity is MineEntity => !!entity && entity.kind === 'mine',
  );
  const keep = sim.world.entities.find(
    (entity): entity is BuildingEntity =>
      !!entity &&
      entity.kind === 'building' &&
      entity.player === 0 &&
      !!entity.isTownCenter,
  );
  if (!mine || !keep) throw new Error('Missing standard-start mine or keep');
  const carts = playerCarts(sim);
  expect(carts).toHaveLength(1);
  const cart = carts[0];
  const player = sim.world.players[0];
  expect(mine.goldRemaining).toBe(6000);
  expect(player.goldCollected).toBe(0);
  sim.issue({
    kind: 'stop',
    player: 1,
    ids: playerCarts(sim, 1).map((unit) => unit.id),
  });

  function step(): void {
    sim.step();
    let cargo = 0;
    for (const entity of sim.world.entities) {
      if (entity && entity.kind === 'unit' && entity.player === 0)
        cargo += carried(entity);
    }
    // Keep the original mine reference when testing removal: removing a target
    // must not also erase the cart's cargo or its already-delivered gold.
    expect(
      mine!.goldRemaining + cargo + player.goldCollected,
      `Gold at tick ${sim.world.tick}`,
    ).toBe(6000);
    expect(sim.world.players[1].goldCollected).toBe(0);
  }

  function until(predicate: () => boolean, maxTicks: number): void {
    for (let tick = 0; tick < maxTicks && !predicate(); tick++) step();
    expect(predicate(), `Condition unmet at tick ${sim.world.tick}`).toBe(true);
  }

  return { sim, mine, cart, keep, player, step, until };
}

function loadFirstCargo(fixture: CartFixture): void {
  fixture.until(() => carried(fixture.cart) === 100, 1000);
  expect(fixture.mine.goldRemaining).toBe(5900);
  expect(fixture.player.goldCollected).toBe(0);
  expect(fixture.cart.loaded).toBe(true);
}

function expectInterruptedCargo(
  cart: UnitEntity,
  kind: 'stop' | 'hold' | 'move',
): void {
  expect(cart.order?.kind).toBe(kind);
  expect(cart.cart?.phase).toBe('idle');
  expect(cart.cart?.ticks).toBe(0);
  expect(cart.cart?.mineId).toBeUndefined();
  expect(cart.cart?.dropOffId).toBeUndefined();
  expect(cart.cart?.pinnedMineId).toBeUndefined();
  expect(cart.workAnimation).toBeUndefined();
  expect(cart.workStartedTick).toBeUndefined();
  expect(carried(cart)).toBe(100);
  expect(cart.loaded).toBe(true);
  expect(cart.speed).toBe(cart.loadedSpeed);
}

function deliverExistingCargo(fixture: CartFixture): void {
  for (
    let tick = 0;
    tick < 1500 && fixture.player.goldCollected === 0;
    tick++
  ) {
    fixture.step();
    expect(fixture.mine.goldRemaining).toBe(5900);
    if (fixture.player.goldCollected === 0) {
      expect(carried(fixture.cart)).toBe(100);
      expect(fixture.cart.cart?.phase).not.toBe('loading');
    }
  }
  expect(fixture.player.goldCollected).toBe(100);
  expect(fixture.mine.goldRemaining).toBe(5900);
  expect(carried(fixture.cart)).toBe(0);
}

function finishMine(fixture: CartFixture): void {
  fixture.until(() => fixture.player.goldCollected === 6000, 30000);
  expect(fixture.mine.goldRemaining).toBe(0);
  expect(playerCarts(fixture.sim).every((cart) => carried(cart) === 0)).toBe(
    true,
  );
}

function expectQueuedMoveReached(
  fixture: CartFixture,
  cart: UnitEntity,
  point: { x: number; z: number },
  cargo: number,
): void {
  fixture.until(() => cart.order?.kind === 'move', 200);
  expect(cart.orders).toHaveLength(0);
  expect(carried(cart)).toBe(cargo);
  expect(cart.loaded).toBe(cargo > 0);
  fixture.until(
    () => cart.order?.kind === 'idle' && atPoint(cart, point),
    1500,
  );
  for (let tick = 0; tick < 160; tick++) {
    fixture.step();
    expect(cart.order?.kind).toBe('idle');
    expect(atPoint(cart, point)).toBe(true);
    expect(carried(cart)).toBe(cargo);
  }
}

function trainStoppedCart(fixture: CartFixture): UnitEntity {
  const before = playerCarts(fixture.sim);
  fixture.sim.issue({
    kind: 'train',
    player: 0,
    buildingId: fixture.keep.id,
    unitType: 'ox_cart',
  });
  fixture.until(
    () => playerCarts(fixture.sim).length === before.length + 1,
    600,
  );
  const cart = playerCarts(fixture.sim).find((unit) => !before.includes(unit));
  if (!cart) throw new Error('Cart training did not create a new cart');
  fixture.sim.issue({ kind: 'stop', player: 0, ids: [cart.id] });
  fixture.step();
  return cart;
}

describe('Cart cargo interruption through Sim', () => {
  it('delivers its real 100 cargo after Stop then queued pin before loading again, and collects all 6000', () => {
    const fixture = makeFixture();
    loadFirstCargo(fixture);
    fixture.sim.issue({ kind: 'stop', player: 0, ids: [fixture.cart.id] });
    fixture.step();
    expectInterruptedCargo(fixture.cart, 'stop');
    for (let tick = 0; tick < 160; tick++) {
      fixture.step();
      expectInterruptedCargo(fixture.cart, 'stop');
      expect(fixture.player.goldCollected).toBe(0);
    }
    fixture.sim.issue({
      kind: 'pinMine',
      player: 0,
      ids: [fixture.cart.id],
      targetId: fixture.mine.id,
      queued: true,
    });
    deliverExistingCargo(fixture);
    finishMine(fixture);
    expect(fixture.player.gold).toBe(6200);
  });

  it('finishes a loaded manual Move then delivers its cargo before its queued pin can reload, and collects 6000', () => {
    const fixture = makeFixture();
    loadFirstCargo(fixture);
    const point = { x: 16.5, z: 12.5 };
    fixture.sim.issue({
      kind: 'move',
      player: 0,
      ids: [fixture.cart.id],
      ...point,
    });
    fixture.sim.issue({
      kind: 'pinMine',
      player: 0,
      ids: [fixture.cart.id],
      targetId: fixture.mine.id,
      queued: true,
    });
    fixture.step();
    expectInterruptedCargo(fixture.cart, 'move');
    expect(fixture.cart.orders.map((order) => order.kind)).toEqual(['pinMine']);
    fixture.until(() => {
      expect(fixture.mine.goldRemaining).toBe(5900);
      expect(fixture.player.goldCollected).toBe(0);
      expect(carried(fixture.cart)).toBe(100);
      return fixture.cart.order?.kind === 'pinMine';
    }, 1000);
    expect(atPoint(fixture.cart, point)).toBe(true);
    expect(fixture.cart.orders).toHaveLength(0);
    deliverExistingCargo(fixture);
    finishMine(fixture);
    expect(fixture.player.gold).toBe(6200);
  });

  it('Hold interrupts a real unload without losing cargo or restarting until explicitly pinned', () => {
    const fixture = makeFixture();
    loadFirstCargo(fixture);
    fixture.until(() => fixture.cart.cart?.phase === 'unloading', 500);
    fixture.sim.issue({ kind: 'hold', player: 0, ids: [fixture.cart.id] });
    fixture.step();
    for (let tick = 0; tick < 400; tick++) {
      expectInterruptedCargo(fixture.cart, 'hold');
      expect(fixture.player.goldCollected).toBe(0);
      fixture.step();
    }
    fixture.sim.issue({
      kind: 'pinMine',
      player: 0,
      ids: [fixture.cart.id],
      targetId: fixture.mine.id,
      queued: true,
    });
    deliverExistingCargo(fixture);
    finishMine(fixture);
  });
});

describe('Cart terminal queues through Sim', () => {
  it.each(['toMine', 'loading'] as const)(
    'activates and reaches its queued move when its mine is removed during %s',
    (phase) => {
      const fixture = makeFixture();
      fixture.until(() => fixture.cart.cart?.phase === phase, 1000);
      expect(fixture.cart.order?.kind).toBe('pinMine');
      const point = { x: 18.5, z: 12.5 };
      fixture.sim.issue({
        kind: 'move',
        player: 0,
        ids: [fixture.cart.id],
        ...point,
        queued: true,
      });
      fixture.sim.world.removeEntity(fixture.mine.id);
      fixture.step();
      expectQueuedMoveReached(fixture, fixture.cart, point, 0);
      expect(fixture.mine.goldRemaining).toBe(6000);
      expect(fixture.player.goldCollected).toBe(0);
    },
  );

  it('delivers cargo loaded before mine removal and then activates its queued move', () => {
    const fixture = makeFixture();
    loadFirstCargo(fixture);
    const point = { x: 18.5, z: 12.5 };
    fixture.sim.issue({
      kind: 'move',
      player: 0,
      ids: [fixture.cart.id],
      ...point,
      queued: true,
    });
    fixture.sim.world.removeEntity(fixture.mine.id);
    deliverExistingCargo(fixture);
    expectQueuedMoveReached(fixture, fixture.cart, point, 0);
    expect(fixture.player.goldCollected).toBe(100);
  });

  it.each(['loading', 'toDropOff', 'unloading'] as const)(
    'keeps actual cargo and reaches its queued move when all owned drop-offs disappear during %s',
    (phase) => {
      const fixture = makeFixture();
      fixture.until(() => fixture.cart.cart?.phase === phase, 1000);
      const point = { x: 18.5, z: 12.5 };
      fixture.sim.issue({
        kind: 'move',
        player: 0,
        ids: [fixture.cart.id],
        ...point,
        queued: true,
      });
      fixture.sim.issue({ kind: 'delete', player: 0, ids: [fixture.keep.id] });
      fixture.step();
      expect(fixture.sim.world.getEntity(fixture.keep.id)).toBeUndefined();
      expectQueuedMoveReached(fixture, fixture.cart, point, 100);
      expect(fixture.mine.goldRemaining).toBe(5900);
      expect(fixture.player.goldCollected).toBe(0);
    },
  );

  it('naturally depletes 6000 and releases both the final zero-load cart and the waiting cart into their queued moves', () => {
    const fixture = makeFixture();
    fixture.until(() => fixture.player.goldCollected === 5900, 30000);
    expect(fixture.mine.goldRemaining).toBe(100);
    expect(carried(fixture.cart)).toBe(0);
    fixture.sim.issue({ kind: 'stop', player: 0, ids: [fixture.cart.id] });
    fixture.step();
    const carts = [
      fixture.cart,
      trainStoppedCart(fixture),
      trainStoppedCart(fixture),
    ];
    const staging = [
      { x: 11.5, z: 4.5 },
      { x: 11.5, z: 5.5 },
      { x: 11.5, z: 3.5 },
    ];
    for (const [index, cart] of carts.entries()) {
      fixture.sim.issue({
        kind: 'move',
        player: 0,
        ids: [cart.id],
        ...staging[index],
      });
    }
    fixture.until(
      () =>
        carts.every((cart) => {
          const dx = Math.max(
            0,
            fixture.mine.x - cart.x,
            cart.x - (fixture.mine.x + fixture.mine.width),
          );
          const dz = Math.max(
            0,
            fixture.mine.z - cart.z,
            cart.z - (fixture.mine.z + fixture.mine.height),
          );
          return cart.order?.kind === 'idle' && Math.hypot(dx, dz) <= 1.2;
        }),
      1000,
    );
    fixture.sim.issue({
      kind: 'pinMine',
      player: 0,
      ids: carts.map((cart) => cart.id),
      targetId: fixture.mine.id,
    });
    fixture.step();
    expect(carts.map((cart) => cart.cart?.phase)).toEqual([
      'loading',
      'loading',
      'waiting',
    ]);
    expect(fixture.mine.goldRemaining).toBe(100);
    const destinations = [
      { x: 18.5, z: 10.5 },
      { x: 18.5, z: 12.5 },
      { x: 18.5, z: 14.5 },
    ];
    for (const [index, cart] of carts.entries()) {
      fixture.sim.issue({
        kind: 'move',
        player: 0,
        ids: [cart.id],
        ...destinations[index],
        queued: true,
      });
    }
    fixture.until(
      () => carts[1].order?.kind === 'move' && carts[2].order?.kind === 'move',
      200,
    );
    expect(fixture.mine.goldRemaining).toBe(0);
    expect(fixture.player.goldCollected).toBe(5900);
    expect(carried(carts[0])).toBe(100);
    expect(carried(carts[1])).toBe(0);
    expect(carried(carts[2])).toBe(0);
    expect(carts[1].orders).toHaveLength(0);
    expect(carts[2].orders).toHaveLength(0);
    fixture.until(
      () =>
        carts.every(
          (cart, index) =>
            cart.order?.kind === 'idle' && atPoint(cart, destinations[index]),
        ),
      1500,
    );
    expect(
      carts.every((cart) => cart.orders.length === 0 && carried(cart) === 0),
    ).toBe(true);
    expect(fixture.player.goldCollected).toBe(6000);
    expect(fixture.player.gold).toBe(6120);
  });
});

describe('Fresh cart automatic activation through Sim', () => {
  function expectNonAutomatic(
    fixture: CartFixture,
    point: { x: number; z: number },
  ): void {
    expect(atPoint(fixture.cart, point)).toBe(true);
    expect(fixture.cart.cart?.phase).toBe('idle');
    expect(carried(fixture.cart)).toBe(0);
    expect(fixture.mine.goldRemaining).toBe(6000);
    expect(fixture.player.goldCollected).toBe(0);
  }

  it('a cart trained through the keep automatically loops while the stopped starting cart collects nothing', () => {
    const fixture = makeFixture();
    fixture.sim.issue({ kind: 'stop', player: 0, ids: [fixture.cart.id] });
    fixture.sim.issue({
      kind: 'train',
      player: 0,
      buildingId: fixture.keep.id,
      unitType: 'ox_cart',
    });
    fixture.until(() => playerCarts(fixture.sim).length === 2, 700);
    const trained = playerCarts(fixture.sim).find(
      (cart) => cart !== fixture.cart,
    );
    if (!trained) throw new Error('Trained cart was not created');
    expect(fixture.player.goldCollected).toBe(0);
    fixture.until(() => fixture.player.goldCollected >= 200, 2000);
    expect(fixture.cart.order?.kind).toBe('stop');
    expect(carried(fixture.cart)).toBe(0);
    expect(fixture.cart.cart?.phase).toBe('idle');
    expect(trained.cart).toBeDefined();
  });

  it.each(['stop', 'hold'] as const)(
    'a fresh cart given %s before its first economy tick stays nonautomatic',
    (kind) => {
      const fixture = makeFixture();
      const start = { x: fixture.cart.x, z: fixture.cart.z };
      fixture.sim.issue({ kind, player: 0, ids: [fixture.cart.id] });
      for (let tick = 0; tick < 400; tick++) {
        fixture.step();
        expect(fixture.cart.order?.kind).toBe(kind);
        expectNonAutomatic(fixture, start);
      }
    },
  );

  it('a fresh manual Move finishes at its point without delayed automatic mining', () => {
    const fixture = makeFixture();
    const point = { x: 16.5, z: 12.5 };
    fixture.sim.issue({
      kind: 'move',
      player: 0,
      ids: [fixture.cart.id],
      ...point,
    });
    fixture.step();
    expect(fixture.cart.cart?.phase).toBe('idle');
    fixture.until(
      () => fixture.cart.order?.kind === 'idle' && atPoint(fixture.cart, point),
      1000,
    );
    for (let tick = 0; tick < 400; tick++) {
      fixture.step();
      expect(fixture.cart.order?.kind).toBe('idle');
      expectNonAutomatic(fixture, point);
    }
  });
});
