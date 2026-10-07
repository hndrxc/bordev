import type { FarmCommand, PinMineCommand } from '../commands.js';
import type { BuildingEntity, MineEntity, UnitEntity } from '../entity.js';
import type { World } from '../world.js';
import {
  approachTarget,
  finishWorkOrder,
  issueWorkOrder,
  isValidTarget,
} from './work.js';

export const SIM_DT = 0.05;
export const FARM_FOOD_RATE = 0.5; // food per second
export const CART_CAPACITY = 100;
export const CART_LOAD_TIME = 6; // seconds
export const CART_UNLOAD_TIME = 2; // seconds
export const MINE_RETARGET_MAX_DISTANCE = 20; // tiles
export const MAX_LOADERS_PER_MINE = 2;

const CART_LOAD_TICKS = Math.round(CART_LOAD_TIME / SIM_DT); // 120 ticks
const CART_UNLOAD_TICKS = Math.round(CART_UNLOAD_TIME / SIM_DT); // 40 ticks

interface EconomyScratch {
  activeFarmers: Map<number, UnitEntity>;
  activeLoaders: Map<number, number>;
  carts: UnitEntity[];
  waiting: UnitEntity[];
}

const economyScratch = new WeakMap<World, EconomyScratch>();

function compareWaitingCarts(a: UnitEntity, b: UnitEntity): number {
  return (b.cart?.ticks ?? 0) - (a.cart?.ticks ?? 0) || a.id - b.id;
}

// Change destinations only at a state-machine transition. Keep queued commands
// intact, but invalidate the old route and its asynchronous result.
function setCartTarget(
  world: World,
  unit: UnitEntity,
  target: BuildingEntity | MineEntity,
): void {
  const order = unit.order;
  if (
    order?.kind === 'pinMine' &&
    order.targetId === target.id &&
    order.targetRef === target
  ) {
    return;
  }
  if (unit.pathPending) world.pathQueue.cancel(unit.id);
  unit.pathPending = false;
  unit.path = undefined;
  unit.pathTarget = undefined;
  unit.formationSlotX = undefined;
  unit.formationSlotZ = undefined;
  unit.stuckTicks = 0;
  unit.stuckProgressX = unit.x;
  unit.stuckProgressZ = unit.z;
  unit.stuckLastCheckTick = world.tick;
  unit.workAnimation = undefined;
  unit.workStartedTick = undefined;
  if (order?.kind === 'pinMine') {
    order.targetId = target.id;
    order.targetRef = target;
    order.x = undefined;
    order.z = undefined;
  } else {
    unit.order = { kind: 'pinMine', targetId: target.id, targetRef: target };
  }
  unit.orderGeneration++;
}

export function isCart(unit: UnitEntity): boolean {
  return unit.type === 'ox_cart' || unit.type === 'haul_wagon';
}

export function isFarm(building: BuildingEntity): boolean {
  return (
    building.type === 'farm' ||
    building.type === 'field' ||
    building.role === 'farm'
  );
}

export function isDropOff(building: BuildingEntity): boolean {
  return building.isDropOff === true || building.isTownCenter === true;
}

export function findNearestDropOff(
  world: World,
  unit: UnitEntity,
): BuildingEntity | null {
  let best: BuildingEntity | null = null;
  let bestDistSq = Infinity;

  for (let i = 0; i < world.entities.length; i++) {
    const ent = world.entities[i];
    if (
      ent &&
      ent.kind === 'building' &&
      ent.player === unit.player &&
      ent.built &&
      ent.hp > 0 &&
      isDropOff(ent as BuildingEntity)
    ) {
      const b = ent as BuildingEntity;
      const cx = b.x + b.width / 2;
      const cz = b.z + b.height / 2;
      const dx = unit.x - cx;
      const dz = unit.z - cz;
      const distSq = dx * dx + dz * dz;

      if (
        distSq < bestDistSq ||
        (distSq === bestDistSq && best && b.id < best.id)
      ) {
        bestDistSq = distSq;
        best = b;
      }
    }
  }

  return best;
}

export function findNearestNonDepletedMine(
  world: World,
  fromX: number,
  fromZ: number,
  maxDistance = MINE_RETARGET_MAX_DISTANCE,
): MineEntity | null {
  let best: MineEntity | null = null;
  let bestDistSq = Infinity;
  const maxDistSq = maxDistance * maxDistance;

  for (let i = 0; i < world.entities.length; i++) {
    const ent = world.entities[i];
    if (ent && ent.kind === 'mine' && ent.goldRemaining > 0) {
      const m = ent as MineEntity;
      const cx = m.x + m.width / 2;
      const cz = m.z + m.height / 2;
      const dx = fromX - cx;
      const dz = fromZ - cz;
      const distSq = dx * dx + dz * dz;

      if (distSq <= maxDistSq) {
        if (
          distSq < bestDistSq ||
          (distSq === bestDistSq && best && m.id < best.id)
        ) {
          bestDistSq = distSq;
          best = m;
        }
      }
    }
  }

  return best;
}

export function applyFarmCommand(world: World, cmd: FarmCommand): void {
  const target = world.getEntity(cmd.targetId);
  if (!target || target.kind !== 'building') return;
  const farm = target as BuildingEntity;
  if (
    !isFarm(farm) ||
    farm.player !== cmd.player ||
    !farm.built ||
    farm.hp <= 0
  ) {
    return;
  }

  if (cmd.queued) {
    for (const id of cmd.ids) {
      const unit = world.getEntity(id);
      if (
        unit &&
        unit.kind === 'unit' &&
        unit.player === cmd.player &&
        unit.hp > 0 &&
        unit.tags.includes('worker')
      ) {
        issueWorkOrder(
          world,
          unit,
          { kind: 'farm', targetId: farm.id, targetRef: farm },
          true,
        );
        break; // Only assign one farmer per farm
      }
    }
  } else {
    let selectedWorker: UnitEntity | null = null;
    for (const id of cmd.ids) {
      const unit = world.getEntity(id);
      if (
        unit &&
        unit.kind === 'unit' &&
        unit.player === cmd.player &&
        unit.hp > 0 &&
        unit.tags.includes('worker')
      ) {
        selectedWorker = unit;
        break;
      }
    }
    if (!selectedWorker) return;

    // Reassignment: if another worker is currently assigned to this farm, evict it
    for (let i = 0; i < world.entities.length; i++) {
      const other = world.entities[i];
      if (
        other &&
        other.kind === 'unit' &&
        other.id !== selectedWorker.id &&
        other.hp > 0
      ) {
        if (other.order?.kind === 'farm' && other.order.targetId === farm.id) {
          finishWorkOrder(world, other);
        }
      }
    }

    issueWorkOrder(
      world,
      selectedWorker,
      { kind: 'farm', targetId: farm.id, targetRef: farm },
      false,
    );
  }
}

export function applyPinMineCommand(world: World, cmd: PinMineCommand): void {
  const target = world.getEntity(cmd.targetId);
  if (!target || target.kind !== 'mine' || target.goldRemaining <= 0) {
    return;
  }
  const mine = target as MineEntity;

  for (const id of cmd.ids) {
    const unit = world.getEntity(id);
    if (
      !unit ||
      unit.kind !== 'unit' ||
      unit.player !== cmd.player ||
      unit.hp <= 0 ||
      !isCart(unit)
    ) {
      continue;
    }

    if (cmd.queued) {
      issueWorkOrder(
        world,
        unit,
        { kind: 'pinMine', targetId: mine.id, targetRef: mine },
        true,
      );
    } else {
      issueWorkOrder(
        world,
        unit,
        { kind: 'pinMine', targetId: mine.id, targetRef: mine },
        false,
      );

      if (!unit.cart) {
        unit.cart = {
          phase: 'idle',
          carriedGold: 0,
          ticks: 0,
        };
      }

      unit.cart.pinnedMineId = mine.id;
      unit.cart.pinnedMineRef = mine;

      if (unit.cart.carriedGold === 0) {
        unit.cart.phase = 'toMine';
        unit.cart.mineId = mine.id;
        unit.cart.mineRef = mine;
        unit.cart.ticks = 0;
        unit.workAnimation = undefined;
      } else {
        const currentDropOff = isValidTarget(
          world,
          unit.cart.dropOffId,
          unit.cart.dropOffRef,
        );
        const dropOff =
          currentDropOff?.kind === 'building' &&
          currentDropOff.player === unit.player &&
          currentDropOff.built &&
          isDropOff(currentDropOff)
            ? currentDropOff
            : findNearestDropOff(world, unit);
        if (dropOff) {
          if (unit.cart.phase !== 'unloading' || dropOff !== currentDropOff) {
            unit.cart.phase = 'toDropOff';
            unit.cart.ticks = 0;
          }
          unit.cart.dropOffId = dropOff.id;
          unit.cart.dropOffRef = dropOff;
          setCartTarget(world, unit, dropOff);
        } else {
          unit.cart.phase = 'idle';
          unit.cart.ticks = 0;
          finishWorkOrder(world, unit);
        }
      }
    }
  }
}

export function updateEconomy(world: World): void {
  let scratch = economyScratch.get(world);
  if (!scratch) {
    scratch = {
      activeFarmers: new Map(),
      activeLoaders: new Map(),
      carts: [],
      waiting: [],
    };
    economyScratch.set(world, scratch);
  }
  const { activeFarmers, activeLoaders, carts, waiting } = scratch;
  activeFarmers.clear();
  activeLoaders.clear();
  carts.length = 0;
  waiting.length = 0;

  // 1. Update Farms
  for (let i = 0; i < world.entities.length; i++) {
    const ent = world.entities[i];
    if (!ent || ent.kind !== 'unit' || ent.hp <= 0) continue;
    const unit = ent as UnitEntity;

    if (unit.order?.kind === 'farm') {
      const farm = isValidTarget(
        world,
        unit.order.targetId,
        unit.order.targetRef as BuildingEntity,
      ) as BuildingEntity | null;

      if (
        !farm ||
        !farm.built ||
        farm.hp <= 0 ||
        !isFarm(farm) ||
        farm.player !== unit.player
      ) {
        finishWorkOrder(world, unit);
        continue;
      }

      // Farming is continuous: queued work takes over on the next economy tick,
      // before this farmer claims the farm or generates any more food.
      if (unit.orders.length > 0) {
        finishWorkOrder(world, unit);
        continue;
      }

      // Enforce single farmer per farm
      if (activeFarmers.has(farm.id)) {
        finishWorkOrder(world, unit);
        continue;
      }
      activeFarmers.set(farm.id, unit);

      const inRange = approachTarget(world, unit, farm);
      if (inRange) {
        unit.workAnimation = 'work';
        if (unit.workStartedTick === undefined) {
          unit.workStartedTick = world.tick;
        }
        const player = world.players[unit.player];
        const foodGain =
          FARM_FOOD_RATE * (player?.farmFoodRateMultiplier ?? 1) * SIM_DT;
        if (player) {
          player.food += foodGain;
          player.foodCollected += foodGain;
        }
      } else {
        unit.workAnimation = undefined;
        unit.workStartedTick = undefined;
      }
    }
  }

  // 2. Collect and update Carts
  for (let i = 0; i < world.entities.length; i++) {
    const ent = world.entities[i];
    if (ent && ent.kind === 'unit' && ent.hp > 0 && isCart(ent as UnitEntity)) {
      carts.push(ent as UnitEntity);
    }
  }

  // Consume a new cart's automatic activation exactly once. A previous command
  // generation also excludes moves completed before this first economy tick.
  for (const cartUnit of carts) {
    const isNew = cartUnit.cart === undefined;
    const cart =
      cartUnit.cart ??
      (cartUnit.cart = {
        phase: 'idle',
        carriedGold: 0,
        ticks: 0,
      });
    cartUnit.loaded = cart.carriedGold > 0;
    cartUnit.speed =
      cartUnit.loaded && cartUnit.loadedSpeed !== undefined
        ? cartUnit.loadedSpeed
        : cartUnit.baseSpeed;

    if (
      cartUnit.order &&
      cartUnit.order.kind !== 'idle' &&
      cartUnit.order.kind !== 'pinMine'
    ) {
      cart.phase = 'idle';
      cart.ticks = 0;
      cartUnit.workAnimation = undefined;
      cartUnit.workStartedTick = undefined;
      continue;
    }

    if (cartUnit.orders.length > 0 && cartUnit.order?.kind !== 'pinMine') {
      continue;
    }

    if (
      isNew &&
      cartUnit.orderGeneration === 0 &&
      (!cartUnit.order || cartUnit.order.kind === 'idle')
    ) {
      const dropOff = findNearestDropOff(world, cartUnit);
      const dcx = dropOff ? dropOff.x + dropOff.width / 2 : cartUnit.x;
      const dcz = dropOff ? dropOff.z + dropOff.height / 2 : cartUnit.z;
      const mine = findNearestNonDepletedMine(world, dcx, dcz);
      if (mine) {
        cart.phase = 'toMine';
        cart.mineId = mine.id;
        cart.mineRef = mine;
        setCartTarget(world, cartUnit, mine);
      }
    }

    // A manually activated/queued pin delivers preserved cargo before loading.
    if (cart.phase === 'idle' && cartUnit.order?.kind === 'pinMine') {
      const mine = isValidTarget(
        world,
        cartUnit.order.targetId,
        cartUnit.order.targetRef,
      );
      if (mine?.kind === 'mine' && mine.goldRemaining > 0) {
        cart.pinnedMineId = mine.id;
        cart.pinnedMineRef = mine;
        cart.mineId = mine.id;
        cart.mineRef = mine;
        cart.ticks = 0;
        if (cart.carriedGold === 0) {
          cart.phase = 'toMine';
        }
      } else {
        cart.pinnedMineId = undefined;
        cart.pinnedMineRef = undefined;
      }
      if (cart.carriedGold > 0) {
        const dropOff = findNearestDropOff(world, cartUnit);
        if (dropOff) {
          cart.phase = 'toDropOff';
          cart.dropOffId = dropOff.id;
          cart.dropOffRef = dropOff;
          cart.ticks = 0;
          setCartTarget(world, cartUnit, dropOff);
        }
      }
      if (cart.phase === 'idle') {
        finishWorkOrder(world, cartUnit);
      }
    }
  }

  // Count only loaders still active after manual cancellation.
  for (const unit of carts) {
    const cart = unit.cart;
    if (cart?.phase === 'loading' && cart.mineId !== undefined) {
      activeLoaders.set(cart.mineId, (activeLoaders.get(cart.mineId) ?? 0) + 1);
    }
  }

  // Active carts state machine
  for (const cartUnit of carts) {
    const cart = cartUnit.cart;
    if (!cart || cart.phase === 'idle') continue;

    // Phase: unloading
    if (cart.phase === 'unloading') {
      const dropOff = isValidTarget(
        world,
        cart.dropOffId,
        cart.dropOffRef,
      ) as BuildingEntity | null;
      if (
        !dropOff ||
        !dropOff.built ||
        dropOff.hp <= 0 ||
        dropOff.player !== cartUnit.player ||
        !isDropOff(dropOff)
      ) {
        const newDropOff = findNearestDropOff(world, cartUnit);
        if (newDropOff) {
          cart.dropOffId = newDropOff.id;
          cart.dropOffRef = newDropOff;
          cart.phase = 'toDropOff';
          cart.ticks = 0;
          setCartTarget(world, cartUnit, newDropOff);
        } else {
          cart.phase = 'idle';
          finishWorkOrder(world, cartUnit);
        }
        continue;
      }

      cartUnit.workAnimation = undefined;
      cart.ticks++;
      if (cart.ticks >= CART_UNLOAD_TICKS) {
        const delivered = cart.carriedGold;
        const player = world.players[cartUnit.player];
        if (player) {
          player.gold += delivered;
          player.goldCollected += delivered;
        }
        cart.carriedGold = 0;
        cartUnit.loaded = false;
        cartUnit.speed = cartUnit.baseSpeed;
        cart.ticks = 0;

        // If unit has queued manual orders, advance now
        if (cartUnit.orders.length > 0) {
          cart.phase = 'idle';
          finishWorkOrder(world, cartUnit);
          continue;
        }

        // Determine next mine
        let nextMine: MineEntity | null = null;
        if (cart.pinnedMineId !== undefined) {
          const pin = isValidTarget(
            world,
            cart.pinnedMineId,
            cart.pinnedMineRef,
          ) as MineEntity | null;
          if (pin && pin.goldRemaining > 0) {
            nextMine = pin;
          } else {
            cart.pinnedMineId = undefined;
            cart.pinnedMineRef = undefined;
          }
        }

        if (!nextMine) {
          const dcx = dropOff.x + dropOff.width / 2;
          const dcz = dropOff.z + dropOff.height / 2;
          nextMine = findNearestNonDepletedMine(
            world,
            dcx,
            dcz,
            MINE_RETARGET_MAX_DISTANCE,
          );
        }

        if (nextMine) {
          cart.phase = 'toMine';
          cart.mineId = nextMine.id;
          cart.mineRef = nextMine;
          setCartTarget(world, cartUnit, nextMine);
        } else {
          cart.phase = 'idle';
          finishWorkOrder(world, cartUnit);
        }
      }
      continue;
    }

    // Phase: toDropOff
    if (cart.phase === 'toDropOff') {
      let dropOff = isValidTarget(
        world,
        cart.dropOffId,
        cart.dropOffRef,
      ) as BuildingEntity | null;
      if (
        !dropOff ||
        !dropOff.built ||
        dropOff.hp <= 0 ||
        dropOff.player !== cartUnit.player ||
        !isDropOff(dropOff)
      ) {
        dropOff = findNearestDropOff(world, cartUnit);
        if (dropOff) {
          cart.dropOffId = dropOff.id;
          cart.dropOffRef = dropOff;
          setCartTarget(world, cartUnit, dropOff);
        } else {
          cart.phase = 'idle';
          finishWorkOrder(world, cartUnit);
          continue;
        }
      }

      const inRange = approachTarget(world, cartUnit, dropOff);
      if (inRange) {
        cart.phase = 'unloading';
        cart.ticks = 0;
        cartUnit.workAnimation = undefined;
      }
      continue;
    }

    // Phase: loading
    if (cart.phase === 'loading') {
      const mine = isValidTarget(
        world,
        cart.mineId,
        cart.mineRef,
      ) as MineEntity | null;
      if (!mine) {
        cart.phase = 'idle';
        cart.ticks = 0;
        cartUnit.workAnimation = undefined;
        finishWorkOrder(world, cartUnit);
        continue;
      }

      cartUnit.workAnimation = 'load';
      cart.ticks++;
      if (cart.ticks >= CART_LOAD_TICKS) {
        const amount = Math.min(
          CART_CAPACITY - cart.carriedGold,
          mine.goldRemaining,
        );
        mine.goldRemaining -= amount;
        cart.carriedGold += amount;
        cartUnit.loaded = cart.carriedGold > 0;
        if (cartUnit.loaded && cartUnit.loadedSpeed !== undefined) {
          cartUnit.speed = cartUnit.loadedSpeed;
        } else {
          cartUnit.speed = cartUnit.baseSpeed;
        }
        cartUnit.workAnimation = undefined;
        cart.ticks = 0;

        const count = activeLoaders.get(mine.id) ?? 1;
        activeLoaders.set(mine.id, Math.max(0, count - 1));

        if (cart.carriedGold > 0) {
          const dropOff = findNearestDropOff(world, cartUnit);
          if (dropOff) {
            cart.phase = 'toDropOff';
            cart.dropOffId = dropOff.id;
            cart.dropOffRef = dropOff;
            setCartTarget(world, cartUnit, dropOff);
          } else {
            cart.phase = 'idle';
            finishWorkOrder(world, cartUnit);
          }
        } else {
          if (cart.pinnedMineId === mine.id) {
            cart.pinnedMineId = undefined;
            cart.pinnedMineRef = undefined;
          }
          const dropOff = findNearestDropOff(world, cartUnit);
          const dcx = dropOff ? dropOff.x + dropOff.width / 2 : cartUnit.x;
          const dcz = dropOff ? dropOff.z + dropOff.height / 2 : cartUnit.z;
          const nextMine = findNearestNonDepletedMine(
            world,
            dcx,
            dcz,
            MINE_RETARGET_MAX_DISTANCE,
          );
          if (nextMine) {
            cart.phase = 'toMine';
            cart.mineId = nextMine.id;
            cart.mineRef = nextMine;
            setCartTarget(world, cartUnit, nextMine);
          } else {
            cart.phase = 'idle';
            finishWorkOrder(world, cartUnit);
          }
        }
      }
      continue;
    }

    // Phase: toMine
    if (cart.phase === 'toMine') {
      let mine = isValidTarget(
        world,
        cart.mineId,
        cart.mineRef,
      ) as MineEntity | null;
      if (!mine || mine.goldRemaining <= 0) {
        if (cart.pinnedMineId === cart.mineId) {
          cart.pinnedMineId = undefined;
          cart.pinnedMineRef = undefined;
        }
        const dropOff = findNearestDropOff(world, cartUnit);
        const dcx = dropOff ? dropOff.x + dropOff.width / 2 : cartUnit.x;
        const dcz = dropOff ? dropOff.z + dropOff.height / 2 : cartUnit.z;
        const nextMine = findNearestNonDepletedMine(
          world,
          dcx,
          dcz,
          MINE_RETARGET_MAX_DISTANCE,
        );
        if (nextMine) {
          cart.mineId = nextMine.id;
          cart.mineRef = nextMine;
          setCartTarget(world, cartUnit, nextMine);
          mine = nextMine;
        } else {
          cart.phase = 'idle';
          finishWorkOrder(world, cartUnit);
          continue;
        }
      }

      const inRange = approachTarget(world, cartUnit, mine);
      if (inRange) {
        const currentLoaders = activeLoaders.get(mine.id) ?? 0;
        if (currentLoaders < MAX_LOADERS_PER_MINE) {
          cart.phase = 'loading';
          cart.ticks = 0;
          cartUnit.workAnimation = 'load';
          activeLoaders.set(mine.id, currentLoaders + 1);
        } else {
          cart.phase = 'waiting';
          cart.ticks = 0;
          cartUnit.workAnimation = undefined;
          waiting.push(cartUnit);
        }
      }
      continue;
    }

    // Phase: waiting
    if (cart.phase === 'waiting') {
      const mine = isValidTarget(
        world,
        cart.mineId,
        cart.mineRef,
      ) as MineEntity | null;
      if (!mine || mine.goldRemaining <= 0) {
        if (cart.pinnedMineId === cart.mineId) {
          cart.pinnedMineId = undefined;
          cart.pinnedMineRef = undefined;
        }
        const dropOff = findNearestDropOff(world, cartUnit);
        const dcx = dropOff ? dropOff.x + dropOff.width / 2 : cartUnit.x;
        const dcz = dropOff ? dropOff.z + dropOff.height / 2 : cartUnit.z;
        const nextMine = findNearestNonDepletedMine(
          world,
          dcx,
          dcz,
          MINE_RETARGET_MAX_DISTANCE,
        );
        if (nextMine) {
          cart.phase = 'toMine';
          cart.mineId = nextMine.id;
          cart.mineRef = nextMine;
          setCartTarget(world, cartUnit, nextMine);
        } else {
          cart.phase = 'idle';
          finishWorkOrder(world, cartUnit);
        }
        continue;
      }

      if (approachTarget(world, cartUnit, mine)) {
        cart.ticks++;
        waiting.push(cartUnit);
      }
    }
  }

  // A single reusable priority buffer also preserves FIFO across mine queues.
  waiting.sort(compareWaitingCarts);
  for (const waitingCartUnit of waiting) {
    const cart = waitingCartUnit.cart!;
    const mine = isValidTarget(world, cart.mineId, cart.mineRef);
    if (!mine || mine.kind !== 'mine' || mine.goldRemaining <= 0) continue;
    const currentLoaders = activeLoaders.get(mine.id) ?? 0;
    if (currentLoaders >= MAX_LOADERS_PER_MINE) continue;
    cart.phase = 'loading';
    cart.ticks = 0;
    waitingCartUnit.workAnimation = 'load';
    activeLoaders.set(mine.id, currentLoaders + 1);
  }
}
