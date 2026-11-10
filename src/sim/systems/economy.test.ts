import { describe, expect, it } from 'vitest';
import type { Command } from '../commands.js';
import type { BuildingEntity, MineEntity, UnitEntity } from '../entity.js';
import { Terrain, type GameMap } from '../map.js';
import { Rng } from '../rng.js';
import { Sim, SIM_DT } from '../sim.js';
import { World } from '../world.js';
import {
  applyFarmCommand,
  applyPinMineCommand,
  CART_CAPACITY,
  CART_LOAD_TIME,
  CART_UNLOAD_TIME,
  MAX_LOADERS_PER_MINE,
  updateEconomy,
} from './economy.js';
import { updateMovement } from './movement.js';
import { INTERACTION_DIST } from './work.js';

function makeTestMap(size = 64): GameMap {
  return {
    version: 1,
    id: 'test_economy_map',
    name: 'Economy Map',
    size,
    players: 2,
    tiles: new Uint8Array(size * size).fill(Terrain.GRASS),
    goldMines: [],
    starts: [],
    doodads: [],
  };
}

// ---------------------------------------------------------------------------
// Harness: real movement + economy + tick, in the same order as Sim.step.
// ---------------------------------------------------------------------------

const OX_CART_SPEED = 1.1;
const OX_CART_LOADED_SPEED = 0.8;
// Tolerance for perimeter-point selection, A* detours and steering on top of
// the straight-line travel time. Phase deadlines are travel + load + unload
// plus this single allowance, never an inflated tick count.
const ROUTE_SLACK_SECONDS = 2;

function step(world: World): void {
  updateMovement(world);
  updateEconomy(world);
  world.tick++;
}

function ticksFor(seconds: number): number {
  return Math.ceil(seconds / SIM_DT);
}

interface Footprint {
  x: number;
  z: number;
  width: number;
  height: number;
}

/** Straight-line distance a unit must still cover before it is in work range of a footprint. */
function distanceToInteraction(
  unit: { x: number; z: number },
  target: Footprint,
): number {
  const dx = Math.max(0, target.x - unit.x, unit.x - (target.x + target.width));
  const dz = Math.max(
    0,
    target.z - unit.z,
    unit.z - (target.z + target.height),
  );
  return Math.max(0, Math.hypot(dx, dz) - INTERACTION_DIST);
}

function travelTicks(
  unit: { x: number; z: number },
  target: Footprint,
  speed: number,
): number {
  return ticksFor(
    distanceToInteraction(unit, target) / speed + ROUTE_SLACK_SECONDS,
  );
}

/** Deadline for a cart to walk to a mine and finish its first 6s load. */
function loadDeadline(unit: UnitEntity, mine: MineEntity): number {
  return travelTicks(unit, mine, OX_CART_SPEED) + ticksFor(CART_LOAD_TIME);
}

/** Deadline for a loaded cart to walk to a drop-off and finish its 2s unload. */
function deliverDeadline(unit: UnitEntity, dropOff: BuildingEntity): number {
  return (
    travelTicks(unit, dropOff, OX_CART_LOADED_SPEED) +
    ticksFor(CART_UNLOAD_TIME)
  );
}

/** Steps until `done()` holds; the state is observed right after the tick that produced it. */
function stepUntil(
  advance: () => void,
  done: () => boolean,
  maxTicks: number,
  what: string,
): number {
  for (let i = 0; i < maxTicks; i++) {
    if (done()) return i;
    advance();
  }
  if (done()) return maxTicks;
  throw new Error(
    `Timed out after ${maxTicks} ticks (${maxTicks * SIM_DT}s) waiting for ${what}`,
  );
}

function advanceFor(advance: () => void, seconds: number): void {
  const ticks = ticksFor(seconds);
  for (let i = 0; i < ticks; i++) advance();
}

function pinMine(world: World, cart: UnitEntity, mine: MineEntity): void {
  applyPinMineCommand(world, {
    kind: 'pinMine',
    player: 0,
    ids: [cart.id],
    targetId: mine.id,
  });
}

function newSim(size = 64): Sim {
  return new Sim(makeTestMap(size), 1);
}

describe('Economy System — Farm Production & Conflicts', () => {
  it('generates exactly 0.5 food/s with one worker and tracks collected counter excluding initial stock', () => {
    const world = new World(makeTestMap(), new Rng(1));
    const farm = world.spawnBuilding(0, 'farm', 10, 10, true);
    // Worker adjacent to farm
    const peasant = world.spawnUnit(0, 'peasant', 9.5, 10.5);

    expect(world.players[0].food).toBe(300);
    expect(world.players[0].foodCollected).toBe(0);

    applyFarmCommand(world, {
      kind: 'farm',
      player: 0,
      ids: [peasant.id],
      targetId: farm.id,
    });

    expect(peasant.order?.kind).toBe('farm');

    // Run for 20 ticks (1.0 second in sim time: 20 * 0.05s)
    for (let t = 0; t < 20; t++) {
      step(world);
    }

    expect(peasant.workAnimation).toBe('work');
    // 0.5 food/s * 1s = 0.5 food
    expect(world.players[0].food).toBeCloseTo(300.5, 4);
    expect(world.players[0].foodCollected).toBeCloseTo(0.5, 4);
  });

  it('enforces single farmer per farm when multiple workers are commanded', () => {
    const world = new World(makeTestMap(), new Rng(1));
    const farm = world.spawnBuilding(0, 'farm', 10, 10, true);
    const peasant1 = world.spawnUnit(0, 'peasant', 9.5, 10.5);
    const peasant2 = world.spawnUnit(0, 'peasant', 9.5, 11.5);

    // Command both peasants to the same farm
    applyFarmCommand(world, {
      kind: 'farm',
      player: 0,
      ids: [peasant1.id, peasant2.id],
      targetId: farm.id,
    });

    // Peasant 1 gets the assignment, peasant 2 does not
    expect(peasant1.order?.kind).toBe('farm');
    expect(peasant2.order?.kind).not.toBe('farm');

    for (let t = 0; t < 20; t++) {
      step(world);
    }

    // Rate is locked at 0.5 food/s (not 1.0)
    expect(world.players[0].foodCollected).toBeCloseTo(0.5, 4);
  });

  it('handles farm worker reassignment without ghost work', () => {
    const world = new World(makeTestMap(), new Rng(1));
    const farm1 = world.spawnBuilding(0, 'farm', 10, 10, true);
    const farm2 = world.spawnBuilding(0, 'farm', 16, 10, true);
    const peasant1 = world.spawnUnit(0, 'peasant', 9.5, 10.5);
    const peasant2 = world.spawnUnit(0, 'peasant', 15.5, 10.5);

    // Assign peasant1 to farm1
    applyFarmCommand(world, {
      kind: 'farm',
      player: 0,
      ids: [peasant1.id],
      targetId: farm1.id,
    });

    // Peasant2 is reassigned to farm1 (evicts peasant1)
    applyFarmCommand(world, {
      kind: 'farm',
      player: 0,
      ids: [peasant2.id],
      targetId: farm1.id,
    });

    expect(peasant1.order?.kind).toBe('idle');
    expect(peasant2.order?.kind).toBe('farm');

    // Assign peasant1 to farm2
    applyFarmCommand(world, {
      kind: 'farm',
      player: 0,
      ids: [peasant1.id],
      targetId: farm2.id,
    });

    expect(peasant1.order?.kind).toBe('farm');
    expect(peasant1.order?.targetId).toBe(farm2.id);
  });

  it('stops food generation immediately if farm is destroyed or removed', () => {
    const world = new World(makeTestMap(), new Rng(1));
    const farm = world.spawnBuilding(0, 'farm', 10, 10, true);
    const peasant = world.spawnUnit(0, 'peasant', 9.5, 10.5);

    applyFarmCommand(world, {
      kind: 'farm',
      player: 0,
      ids: [peasant.id],
      targetId: farm.id,
    });

    step(world);
    expect(peasant.workAnimation).toBe('work');

    // Destroy farm
    farm.hp = 0;
    updateEconomy(world);

    expect(peasant.order?.kind).toBe('idle');
    expect(peasant.workAnimation).toBeUndefined();

    const foodCollectedBefore = world.players[0].foodCollected;
    // Further updates produce no additional food
    for (let t = 0; t < 20; t++) {
      step(world);
    }
    expect(world.players[0].foodCollected).toBe(foodCollectedBefore);
  });

  it('rejects farm command for non-worker units or enemy farms', () => {
    const world = new World(makeTestMap(), new Rng(1));
    const farm = world.spawnBuilding(0, 'farm', 10, 10, true);
    const cart = world.spawnUnit(0, 'ox_cart', 9.5, 10.5);
    const enemyPeasant = world.spawnUnit(1, 'peasant', 9.5, 10.5);

    // Non-worker unit
    applyFarmCommand(world, {
      kind: 'farm',
      player: 0,
      ids: [cart.id],
      targetId: farm.id,
    });
    expect(cart.order?.kind).not.toBe('farm');

    // Enemy peasant cannot farm player 0's farm
    applyFarmCommand(world, {
      kind: 'farm',
      player: 1,
      ids: [enemyPeasant.id],
      targetId: farm.id,
    });
    expect(enemyPeasant.order?.kind).not.toBe('farm');
  });

  it('yields a live farm to queued farm work on the next real tick', () => {
    const world = new World(makeTestMap(), new Rng(1));
    const farm1 = world.spawnBuilding(0, 'farm', 10, 10, true);
    const farm2 = world.spawnBuilding(0, 'farm', 16, 10, true);
    const peasant = world.spawnUnit(0, 'peasant', 9.5, 10.5);
    const player = world.players[0];

    applyFarmCommand(world, {
      kind: 'farm',
      player: 0,
      ids: [peasant.id],
      targetId: farm1.id,
    });
    advanceFor(() => step(world), 1);
    const farmedCollected = player.foodCollected;
    expect(farmedCollected).toBeCloseTo(0.5, 4);

    applyFarmCommand(world, {
      kind: 'farm',
      player: 0,
      ids: [peasant.id],
      targetId: farm2.id,
      queued: true,
    });

    // Enqueue time: the live farm is still the current order, nothing activated.
    expect(peasant.order?.targetId).toBe(farm1.id);
    expect(peasant.orders).toHaveLength(1);
    expect(peasant.orders[0].targetId).toBe(farm2.id);

    // The next real tick activates the queued farm and farm1 stops producing.
    step(world);
    expect(peasant.order?.kind).toBe('farm');
    expect(peasant.order?.targetId).toBe(farm2.id);
    expect(peasant.orders).toHaveLength(0);
    expect(player.foodCollected).toBe(farmedCollected);

    // Walking to farm2 generates nothing; the first food arrives with the tick
    // that puts the peasant in range, at the locked 0.5 food/s rate.
    stepUntil(
      () => step(world),
      () => peasant.workAnimation === 'work',
      ticksFor(
        distanceToInteraction(peasant, farm2) / peasant.speed +
          ROUTE_SLACK_SECONDS,
      ),
      'peasant to start farming the queued farm',
    );
    expect(player.foodCollected).toBeCloseTo(farmedCollected + 0.025, 6);
    expect(peasant.order?.targetId).toBe(farm2.id);
  });
});

// Geometry shared by the cart suites: keep footprint is (10..14, 10..14), mines are 2x2.
// Carts start on free grass beside the keep, like the standard start position.

describe('Economy System — Cart Mining & Concurrency (3 carts <= 2 loaders)', () => {
  it('enforces maximum 2 concurrent loaders on a single mine with 3 carts', () => {
    const sim = newSim();
    const world = sim.world;
    world.spawnBuilding(0, 'keep', 10, 10, true);
    const mine = world.spawnMine(18, 10, 6000);

    const carts = [
      world.spawnUnit(0, 'ox_cart', 14.6, 10.6),
      world.spawnUnit(0, 'ox_cart', 14.6, 11.6),
      world.spawnUnit(0, 'ox_cart', 14.6, 12.6),
    ];
    for (const c of carts) pinMine(world, c, mine);

    let maxObservedLoaders = 0;
    let everWaiting = false;
    const loaderHistory: number[] = [];

    const advance = () => {
      step(world);
      const loaders = carts.filter((c) => c.cart?.phase === 'loading');
      maxObservedLoaders = Math.max(maxObservedLoaders, loaders.length);
      loaderHistory.push(loaders.length);
      if (carts.some((c) => c.cart?.phase === 'waiting')) everWaiting = true;
      // Invariant: at NO POINT in time can loaders exceed 2
      expect(loaders.length).toBeLessThanOrEqual(MAX_LOADERS_PER_MINE);
      // Loaders really walked there: each is within work range of the mine
      for (const c of loaders) {
        expect(distanceToInteraction(c, mine)).toBe(0);
      }
    };

    // The slowest cart travels, then two load waves of 6s (2 + 1 carts).
    const travel = Math.max(
      ...carts.map((c) => travelTicks(c, mine, OX_CART_SPEED)),
    );
    const deadline = travel + 2 * ticksFor(CART_LOAD_TIME);
    stepUntil(
      advance,
      () => mine.goldRemaining <= 6000 - 3 * CART_CAPACITY,
      deadline,
      'all three carts to complete a load',
    );

    expect(maxObservedLoaders).toBe(2);
    expect(everWaiting).toBe(true);
    expect(loaderHistory).toContain(2);
    expect(mine.goldRemaining).toBe(6000 - 3 * CART_CAPACITY);
  });

  it('conserves exactly 6000 gold across remaining, carried, and delivered throughout depletion', () => {
    const sim = newSim();
    const world = sim.world;
    world.spawnBuilding(0, 'keep', 10, 10, true);
    const mine = world.spawnMine(18, 10, 6000);

    const carts = [
      world.spawnUnit(0, 'ox_cart', 14.6, 10.6),
      world.spawnUnit(0, 'ox_cart', 14.6, 11.6),
      world.spawnUnit(0, 'ox_cart', 14.6, 12.6),
    ];
    for (const c of carts) pinMine(world, c, mine);

    const initialPlayerGold = world.players[0].gold; // 200
    const TOTAL_GOLD = 6000;
    const loadsPerCart = TOTAL_GOLD / CART_CAPACITY / carts.length;

    const advance = () => {
      step(world);
      const carried = carts.reduce(
        (sum, c) => sum + (c.cart?.carriedGold ?? 0),
        0,
      );
      // Invariant: remaining + carried + delivered MUST be exactly 6000 at every tick!
      expect(
        mine.goldRemaining + carried + world.players[0].goldCollected,
      ).toBe(TOTAL_GOLD);
    };

    // Upper bound for one cart cycle: load + unload + the keep-center to mine-center
    // distance walked both ways at the slower loaded speed, plus routing allowance.
    const centerDistance = Math.hypot(
      mine.x + mine.width / 2 - 12,
      mine.z + mine.height / 2 - 12,
    );
    const cycleSeconds =
      CART_LOAD_TIME +
      CART_UNLOAD_TIME +
      (2 * centerDistance) / OX_CART_LOADED_SPEED +
      ROUTE_SLACK_SECONDS;
    const deadline = ticksFor(loadsPerCart * cycleSeconds);

    stepUntil(
      advance,
      () =>
        mine.goldRemaining === 0 &&
        carts.every((c) => (c.cart?.carriedGold ?? 0) === 0),
      deadline,
      'mine depletion and delivery of every load',
    );

    expect(mine.goldRemaining).toBe(0);
    expect(world.players[0].goldCollected).toBe(TOTAL_GOLD);
    expect(world.players[0].gold).toBe(initialPlayerGold + TOTAL_GOLD);
  });

  it('adjusts unit speed and loaded flag based on carried cargo while really moving', () => {
    const sim = newSim();
    const world = sim.world;
    const keep = world.spawnBuilding(0, 'keep', 10, 10, true);
    const mine = world.spawnMine(24, 10, 1000);
    const cart = world.spawnUnit(0, 'ox_cart', 14.6, 10.6);
    const advance = () => step(world);

    expect(cart.loaded).toBeFalsy();
    expect(cart.speed).toBe(OX_CART_SPEED);

    pinMine(world, cart, mine);

    // Unloaded travel: measure real displacement over 10 ticks once a path exists.
    stepUntil(
      advance,
      () => (cart.path?.length ?? 0) > 0,
      ticksFor(1),
      'unloaded path',
    );
    let x0 = cart.x;
    let z0 = cart.z;
    for (let i = 0; i < 10; i++) advance();
    expect(cart.cart?.phase).toBe('toMine');
    expect(Math.hypot(cart.x - x0, cart.z - z0)).toBeCloseTo(
      OX_CART_SPEED * SIM_DT * 10,
      1,
    );
    expect(cart.speed).toBe(OX_CART_SPEED);

    // Run until loaded.
    stepUntil(
      advance,
      () => cart.cart?.carriedGold === CART_CAPACITY,
      loadDeadline(cart, mine),
      'cart to finish loading',
    );
    expect(cart.cart?.carriedGold).toBe(CART_CAPACITY);
    expect(cart.loaded).toBe(true);
    expect(cart.speed).toBe(OX_CART_LOADED_SPEED);

    // Loaded travel: slower per-tick displacement than unloaded.
    stepUntil(
      advance,
      () => cart.cart?.phase === 'toDropOff' && (cart.path?.length ?? 0) > 0,
      ticksFor(1),
      'loaded path to drop-off',
    );
    x0 = cart.x;
    z0 = cart.z;
    for (let i = 0; i < 10; i++) advance();
    expect(cart.cart?.phase).toBe('toDropOff');
    expect(Math.hypot(cart.x - x0, cart.z - z0)).toBeCloseTo(
      OX_CART_LOADED_SPEED * SIM_DT * 10,
      1,
    );
    expect(cart.speed).toBe(OX_CART_LOADED_SPEED);

    // Unload restores speed and the flag.
    stepUntil(
      advance,
      () => world.players[0].goldCollected === CART_CAPACITY,
      deliverDeadline(cart, keep),
      'cart to unload at keep',
    );
    expect(cart.loaded).toBe(false);
    expect(cart.speed).toBe(OX_CART_SPEED);
    expect(cart.cart?.carriedGold).toBe(0);
  });
});

describe('Economy System — Pin, Stop, Hold, & Depletion Retargeting', () => {
  it('retargets nearest non-depleted mine within 20 tiles of drop-off when mine depletes', () => {
    const sim = newSim();
    const world = sim.world;
    const keep = world.spawnBuilding(0, 'keep', 10, 10, true);
    // Mine 1 has only 100 gold
    const mine1 = world.spawnMine(18, 10, 100);
    // Mine 2 is the nearest remaining mine to the keep; mine 3 is within 20 but farther.
    const mine2 = world.spawnMine(18, 17, 6000);
    const mine3 = world.spawnMine(12, 30, 6000);
    const cart = world.spawnUnit(0, 'ox_cart', 14.6, 10.6);
    const advance = () => step(world);

    pinMine(world, cart, mine1);

    stepUntil(
      advance,
      () => cart.cart?.carriedGold === CART_CAPACITY,
      loadDeadline(cart, mine1),
      'mine1 to be loaded',
    );
    expect(mine1.goldRemaining).toBe(0);

    // Capture the retarget via predicate after the delivery.
    stepUntil(
      advance,
      () => cart.cart?.phase === 'toMine' && cart.cart.mineId === mine2.id,
      deliverDeadline(cart, keep),
      'cart to retarget mine2 after delivery',
    );

    expect(world.players[0].goldCollected).toBe(CART_CAPACITY);
    expect(mine2.goldRemaining).toBe(6000);
    expect(mine3.goldRemaining).toBe(6000);
    expect(cart.cart?.mineId).toBe(mine2.id);
    expect(cart.cart?.phase).toBe('toMine');
  });

  it('goes idle if all available mines are beyond 20 tiles from drop-off upon depletion', () => {
    const sim = newSim(128);
    const world = sim.world;
    const keep = world.spawnBuilding(0, 'keep', 10, 10, true);
    // Mine 1 has only 100 gold
    const mine1 = world.spawnMine(18, 10, 100);
    // Mine 2 is 40 tiles away (beyond 20 tiles from keep)
    const mine2 = world.spawnMine(52, 10, 6000);
    const cart = world.spawnUnit(0, 'ox_cart', 14.6, 10.6);
    const advance = () => step(world);

    pinMine(world, cart, mine1);

    stepUntil(
      advance,
      () => cart.cart?.carriedGold === CART_CAPACITY,
      loadDeadline(cart, mine1),
      'mine1 to be loaded',
    );
    stepUntil(
      advance,
      () => world.players[0].goldCollected === CART_CAPACITY,
      deliverDeadline(cart, keep),
      'cart to unload at keep',
    );

    expect(mine1.goldRemaining).toBe(0);
    // Since mine2 is > 20 tiles from dropoff, cart must go idle and stay idle
    expect(cart.cart?.phase).toBe('idle');
    expect(cart.cart?.mineId).not.toBe(mine2.id);
    expect(cart.order?.kind).toBe('idle');

    advanceFor(advance, CART_LOAD_TIME + 1);
    expect(cart.cart?.phase).toBe('idle');
    expect(mine2.goldRemaining).toBe(6000);
  });

  it.each(['stop', 'hold', 'move'] as const)(
    'manual %s keeps carried cargo and never auto-resumes delivery',
    (kind) => {
      const sim = newSim();
      const world = sim.world;
      world.spawnBuilding(0, 'keep', 10, 10, true);
      const mine = world.spawnMine(18, 10, 1000);
      const cart = world.spawnUnit(0, 'ox_cart', 14.6, 10.6);
      const advance = () => step(world);

      pinMine(world, cart, mine);
      stepUntil(
        advance,
        () => cart.cart?.carriedGold === CART_CAPACITY,
        loadDeadline(cart, mine),
        'cart to load before the manual order',
      );

      // Player order goes through the real command pipeline. The move target is
      // beside the keep, so an auto-resume would deliver within seconds.
      const target = { x: 14.5, z: 13.5 };
      const cmd: Command =
        kind === 'move'
          ? { kind, player: 0, ids: [cart.id], ...target }
          : { kind, player: 0, ids: [cart.id] };
      sim.issue(cmd);
      sim.step();

      expect(cart.cart?.phase).toBe('idle');
      expect(cart.cart?.carriedGold).toBe(CART_CAPACITY);
      expect(cart.loaded).toBe(true);
      expect(cart.workAnimation).toBeUndefined();

      if (kind === 'move') {
        const walk = ticksFor(
          Math.hypot(cart.x - target.x, cart.z - target.z) /
            OX_CART_LOADED_SPEED +
            ROUTE_SLACK_SECONDS,
        );
        stepUntil(
          advance,
          () => cart.order?.kind === 'idle',
          walk,
          'manual move to finish',
        );
        expect(cart.x).toBeCloseTo(target.x, 5);
        expect(cart.z).toBeCloseTo(target.z, 5);
      } else {
        expect(cart.order?.kind).toBe(kind);
      }

      // Long enough for a resumed cart to unload (it is in range of the keep for 'move').
      const restX = cart.x;
      const restZ = cart.z;
      advanceFor(advance, CART_UNLOAD_TIME + ROUTE_SLACK_SECONDS);
      expect(cart.cart?.phase).toBe('idle');
      expect(cart.cart?.carriedGold).toBe(CART_CAPACITY);
      expect(world.players[0].goldCollected).toBe(0);
      expect(cart.x).toBe(restX);
      expect(cart.z).toBe(restZ);
      expect(cart.order?.kind).toBe(kind === 'move' ? 'idle' : kind);
    },
  );

  describe('drop-off removal while carrying gold', () => {
    /** Cart loaded 100 gold at a mine and is 1s into the walk to the keep. */
    function loadedCartEnRoute() {
      const sim = newSim();
      const world = sim.world;
      const keep = world.spawnBuilding(0, 'keep', 10, 10, true);
      const storehouse = world.spawnBuilding(0, 'storehouse', 20, 18, true);
      const mine = world.spawnMine(20, 10, 1000);
      const cart = world.spawnUnit(0, 'ox_cart', 14.6, 10.6);
      const advance = () => step(world);

      pinMine(world, cart, mine);
      stepUntil(
        advance,
        () => cart.cart?.carriedGold === CART_CAPACITY,
        loadDeadline(cart, mine),
        'cart to load',
      );
      expect(cart.cart?.dropOffId).toBe(keep.id);
      advanceFor(advance, 1);
      expect(cart.cart?.phase).toBe('toDropOff');
      expect(distanceToInteraction(cart, keep)).toBeGreaterThan(0);
      return { sim, world, keep, storehouse, mine, cart, advance };
    }

    it('retargets another drop-off when current drop-off is deleted and delivers real cargo', () => {
      const { sim, world, storehouse, cart, advance } = loadedCartEnRoute();

      sim.issue({ kind: 'delete', player: 0, ids: [cart.cart!.dropOffId!] });
      sim.step();

      expect(cart.cart?.dropOffId).toBe(storehouse.id);
      expect(cart.cart?.dropOffRef).toBe(storehouse);
      expect(cart.cart?.carriedGold).toBe(CART_CAPACITY);
      expect(world.players[0].goldCollected).toBe(0);

      const goldBefore = world.players[0].gold;
      stepUntil(
        advance,
        () => world.players[0].goldCollected === CART_CAPACITY,
        deliverDeadline(cart, storehouse),
        'cart to unload at the storehouse',
      );
      expect(world.players[0].gold).toBe(goldBefore + CART_CAPACITY);
      expect(cart.cart?.carriedGold).toBe(0);
    });

    it('falls back to idle with cargo preserved when every drop-off is deleted', () => {
      const { sim, world, cart, storehouse, advance } = loadedCartEnRoute();

      sim.issue({ kind: 'delete', player: 0, ids: [cart.cart!.dropOffId!] });
      sim.step();
      expect(cart.cart?.dropOffId).toBe(storehouse.id);

      sim.issue({ kind: 'delete', player: 0, ids: [storehouse.id] });
      sim.step();
      expect(cart.cart?.phase).toBe('idle');
      expect(cart.cart?.carriedGold).toBe(CART_CAPACITY);

      advanceFor(advance, CART_UNLOAD_TIME + ROUTE_SLACK_SECONDS);
      expect(cart.cart?.phase).toBe('idle');
      expect(cart.cart?.carriedGold).toBe(CART_CAPACITY);
      expect(world.players[0].goldCollected).toBe(0);
    });

    it('does not deliver to a recycled drop-off id and keeps the cargo', () => {
      const { world, keep, storehouse, cart, advance } = loadedCartEnRoute();
      const staleKeepId = keep.id;

      world.removeEntity(keep.id);
      const replacement = world.spawnBuilding(0, 'storehouse', 10, 10, true);
      expect(replacement.id).toBe(staleKeepId);
      expect(replacement).not.toBe(keep);

      advance();
      expect(cart.cart?.dropOffRef).not.toBe(keep);
      expect(cart.cart?.dropOffRef).toBe(replacement);
      expect(cart.cart?.dropOffRef).not.toBe(storehouse);
      expect(cart.cart?.carriedGold).toBe(CART_CAPACITY);

      const goldBefore = world.players[0].gold;
      stepUntil(
        advance,
        () => world.players[0].goldCollected === CART_CAPACITY,
        deliverDeadline(cart, replacement),
        'cart to unload at the replacement drop-off',
      );
      expect(world.players[0].gold).toBe(goldBefore + CART_CAPACITY);
    });
  });

  it('supports queued orders after gold delivery (Shift queue)', () => {
    const sim = newSim();
    const world = sim.world;
    const keep = world.spawnBuilding(0, 'keep', 10, 10, true);
    const mine = world.spawnMine(18, 10, 1000);
    const cart = world.spawnUnit(0, 'ox_cart', 14.6, 10.6);
    const advance = () => step(world);

    pinMine(world, cart, mine);

    stepUntil(
      advance,
      () => cart.cart?.carriedGold === CART_CAPACITY,
      loadDeadline(cart, mine),
      'cart to load',
    );
    stepUntil(
      advance,
      () => cart.cart?.phase === 'unloading',
      travelTicks(cart, keep, OX_CART_LOADED_SPEED),
      'cart to start unloading at the keep',
    );

    // Player Shift-queues a move while the cart is unloading.
    const dest = { x: 20.5, z: 20.5 };
    sim.issue({
      kind: 'move',
      player: 0,
      ids: [cart.id],
      queued: true,
      ...dest,
    });
    sim.step();
    expect(cart.orders).toHaveLength(1);

    stepUntil(
      advance,
      () => world.players[0].goldCollected === CART_CAPACITY,
      ticksFor(CART_UNLOAD_TIME + 1),
      'unload to finish',
    );

    // Delivery done, queued move is now the active order and cart stays idle in economy terms.
    expect(world.players[0].gold).toBe(200 + CART_CAPACITY);
    expect(cart.cart?.carriedGold).toBe(0);
    expect(cart.cart?.phase).toBe('idle');
    expect(cart.order?.kind).toBe('move');
    expect(cart.order?.x).toBe(dest.x);
    expect(cart.order?.z).toBe(dest.z);

    const walk = ticksFor(
      Math.hypot(cart.x - dest.x, cart.z - dest.z) / OX_CART_SPEED +
        ROUTE_SLACK_SECONDS,
    );
    stepUntil(
      advance,
      () => cart.order?.kind === 'idle',
      walk,
      'queued move to complete',
    );
    expect(cart.x).toBeCloseTo(dest.x, 5);
    expect(cart.z).toBeCloseTo(dest.z, 5);

    // Finished manual order does not restart mining.
    advanceFor(advance, CART_LOAD_TIME + 1);
    expect(cart.cart?.phase).toBe('idle');
    expect(mine.goldRemaining).toBe(1000 - CART_CAPACITY);
    expect(world.players[0].goldCollected).toBe(CART_CAPACITY);
  });
});

describe('Economy System — Lazy Cart Initialization (auto-start vs manual intent)', () => {
  it('auto-starts a brand-new idle cart on the mine nearest the drop-off and keeps its order stable', () => {
    const sim = newSim();
    const world = sim.world;
    const keep = world.spawnBuilding(0, 'keep', 10, 10, true);
    const near = world.spawnMine(18, 10, 6000);
    const far = world.spawnMine(18, 22, 6000);
    // Standard start spot: just outside the keep footprint.
    const cart = world.spawnUnit(0, 'ox_cart', 14.5, 13.5);
    const advance = () => step(world);

    expect(cart.cart).toBeUndefined();

    advance();
    expect(cart.cart?.phase).toBe('toMine');
    expect(cart.cart?.mineId).toBe(near.id);

    // The approach order object (and its x/z destination) must survive economy ticks
    // so movement actually walks the cart; it must not be replaced every tick.
    advance();
    const approachOrder = cart.order;
    expect(approachOrder?.kind).toBe('pinMine');
    let previousGap = distanceToInteraction(cart, near);
    let sampled = 0;
    stepUntil(
      () => {
        advance();
        if (cart.cart?.phase === 'toMine') {
          expect(cart.order).toBe(approachOrder);
          expect(cart.order?.x).toBeDefined();
          expect(cart.order?.z).toBeDefined();
          const gap = distanceToInteraction(cart, near);
          expect(gap).toBeLessThanOrEqual(previousGap + 1e-9);
          previousGap = gap;
          sampled++;
        }
      },
      () => cart.cart?.phase === 'loading',
      travelTicks(cart, near, OX_CART_SPEED),
      'cart to reach the nearest mine',
    );
    expect(sampled).toBeGreaterThan(5);
    expect(cart.order).toBe(approachOrder);
    expect(distanceToInteraction(cart, near)).toBe(0);

    // The order is also stable while loading the same mine.
    for (let i = 0; i < 20; i++) {
      advance();
      expect(cart.cart?.phase).toBe('loading');
      expect(cart.order).toBe(approachOrder);
    }

    // Two full real delivery cycles on the auto-chosen mine.
    stepUntil(
      advance,
      () => cart.cart?.carriedGold === CART_CAPACITY,
      ticksFor(CART_LOAD_TIME),
      'first auto load',
    );
    stepUntil(
      advance,
      () => world.players[0].goldCollected === CART_CAPACITY,
      deliverDeadline(cart, keep),
      'first auto delivery',
    );
    expect(cart.cart?.phase).toBe('toMine');
    expect(cart.cart?.mineId).toBe(near.id);
    stepUntil(
      advance,
      () => cart.cart?.carriedGold === CART_CAPACITY,
      loadDeadline(cart, near),
      'second auto load',
    );
    stepUntil(
      advance,
      () => world.players[0].goldCollected === 2 * CART_CAPACITY,
      deliverDeadline(cart, keep),
      'second auto delivery',
    );

    expect(near.goldRemaining).toBe(6000 - 2 * CART_CAPACITY);
    expect(far.goldRemaining).toBe(6000);
  });

  it('does not auto-start when every mine is beyond 20 tiles of the drop-off', () => {
    const sim = newSim(128);
    const world = sim.world;
    world.spawnBuilding(0, 'keep', 10, 10, true);
    const mine = world.spawnMine(52, 10, 6000);
    const cart = world.spawnUnit(0, 'ox_cart', 14.5, 13.5);
    const advance = () => step(world);

    advanceFor(advance, CART_LOAD_TIME + 1);

    expect(cart.cart?.phase ?? 'idle').toBe('idle');
    expect(cart.order?.kind).toBe('idle');
    expect(mine.goldRemaining).toBe(6000);
  });

  const manualCases: {
    name: string;
    command: (cart: UnitEntity) => Command;
    expectedOrder: string;
    movesImmediatelyToIdle?: boolean;
  }[] = [
    {
      name: 'stop',
      command: (cart) => ({ kind: 'stop', player: 0, ids: [cart.id] }),
      expectedOrder: 'stop',
    },
    {
      name: 'hold',
      command: (cart) => ({ kind: 'hold', player: 0, ids: [cart.id] }),
      expectedOrder: 'hold',
    },
    {
      // Destination is right at the mine: a restarted cart would load at once.
      name: 'move beside the mine',
      command: (cart) => ({
        kind: 'move',
        player: 0,
        ids: [cart.id],
        x: 17.5,
        z: 11.5,
      }),
      expectedOrder: 'idle',
    },
    {
      // Movement completes this order before the first economy tick of the cart.
      name: 'move to its current position',
      command: (cart) => ({
        kind: 'move',
        player: 0,
        ids: [cart.id],
        x: cart.x,
        z: cart.z,
      }),
      expectedOrder: 'idle',
      movesImmediatelyToIdle: true,
    },
  ];

  it.each(manualCases)(
    'manual $name on a never-started cart is consumed once and never auto-starts',
    ({ command, expectedOrder, movesImmediatelyToIdle }) => {
      const sim = newSim();
      const world = sim.world;
      world.spawnBuilding(0, 'keep', 10, 10, true);
      const mine = world.spawnMine(18, 10, 6000);
      const cart = world.spawnUnit(0, 'ox_cart', 14.5, 13.5);
      const advance = () => step(world);

      expect(cart.cart).toBeUndefined();

      const cmd = command(cart);
      sim.issue(cmd);
      sim.step();
      if (movesImmediatelyToIdle) {
        expect(cart.order?.kind).toBe('idle');
        expect(cart.orderGeneration).toBeGreaterThan(0);
      }

      if (cmd.kind === 'move') {
        const walk = ticksFor(
          Math.hypot(cart.x - cmd.x, cart.z - cmd.z) / OX_CART_SPEED +
            ROUTE_SLACK_SECONDS,
        );
        stepUntil(
          advance,
          () => cart.order?.kind === 'idle',
          walk,
          'manual move to finish',
        );
        expect(cart.x).toBeCloseTo(cmd.x, 5);
        expect(cart.z).toBeCloseTo(cmd.z, 5);
      }

      // Window covers a full 6s load: a wrongly restarted cart would have mined by now.
      const restX = cart.x;
      const restZ = cart.z;
      advanceFor(advance, CART_LOAD_TIME + 1);

      expect(cart.cart?.phase ?? 'idle').toBe('idle');
      expect(cart.cart?.carriedGold ?? 0).toBe(0);
      expect(cart.order?.kind).toBe(expectedOrder);
      expect(cart.workAnimation).toBeUndefined();
      expect(mine.goldRemaining).toBe(6000);
      expect(world.players[0].goldCollected).toBe(0);
      expect(cart.x).toBe(restX);
      expect(cart.z).toBe(restZ);
    },
  );

  it('honors a manual pin on a never-started cart instead of auto-selecting the nearest mine', () => {
    const sim = newSim();
    const world = sim.world;
    const keep = world.spawnBuilding(0, 'keep', 10, 10, true);
    const near = world.spawnMine(18, 10, 6000);
    const pinned = world.spawnMine(18, 22, 6000);
    const cart = world.spawnUnit(0, 'ox_cart', 14.5, 13.5);
    const advance = () => step(world);

    expect(cart.cart).toBeUndefined();
    sim.issue({
      kind: 'pinMine',
      player: 0,
      ids: [cart.id],
      targetId: pinned.id,
    });
    sim.step();
    expect(cart.cart?.mineId).toBe(pinned.id);

    stepUntil(
      advance,
      () => cart.cart?.carriedGold === CART_CAPACITY,
      loadDeadline(cart, pinned),
      'cart to load at the pinned mine',
    );
    expect(pinned.goldRemaining).toBe(6000 - CART_CAPACITY);
    expect(near.goldRemaining).toBe(6000);

    stepUntil(
      advance,
      () => world.players[0].goldCollected === CART_CAPACITY,
      deliverDeadline(cart, keep),
      'cart to deliver',
    );
    // The pin persists across the cycle.
    expect(cart.cart?.mineId).toBe(pinned.id);
    expect(near.goldRemaining).toBe(6000);
  });
});
