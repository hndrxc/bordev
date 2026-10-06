import type {
  BuildingEntity,
  MineEntity,
  UnitEntity,
  UnitOrder,
} from '../entity.js';
import { ComponentManager, findStartComponent } from '../path/components.js';
import type { World } from '../world.js';
import { advanceUnitOrder } from './movement.js';

export const INTERACTION_DIST = 1.2;
const INTERACTION_DIST_SQ = INTERACTION_DIST * INTERACTION_DIST;

const componentManagers = new WeakMap<World, ComponentManager>();

export function isValidTarget(
  world: World,
  targetId?: number,
  targetRef?: BuildingEntity | MineEntity,
): (BuildingEntity | MineEntity) | null {
  if (
    targetId === undefined ||
    targetId < 0 ||
    targetId >= world.entities.length
  ) {
    return null;
  }
  const ent = world.entities[targetId];
  if (!ent) return null;
  if (ent.kind !== 'building' && ent.kind !== 'mine') return null;
  if (targetRef !== undefined && ent !== targetRef) return null;
  if (ent.kind === 'building' && ent.hp <= 0) return null;
  return ent as BuildingEntity | MineEntity;
}

export function issueWorkOrder(
  world: World,
  unit: UnitEntity,
  order: UnitOrder,
  queued = false,
): void {
  if (order.targetRef === undefined && order.targetId !== undefined) {
    const target = world.entities[order.targetId];
    if (target && (target.kind === 'building' || target.kind === 'mine')) {
      order.targetRef = target;
    }
  }

  const isCurrentIdle =
    !unit.order ||
    unit.order.kind === 'idle' ||
    unit.order.kind === 'stop' ||
    unit.order.kind === 'hold';

  if (!queued || isCurrentIdle) {
    unit.orders.length = 0;
    if (unit.pathPending) {
      world.pathQueue.cancel(unit.id);
      unit.pathPending = false;
    }
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

    unit.order = order;
    unit.orderGeneration++;
  } else {
    unit.orders.push(order);
  }
}

export function finishWorkOrder(world: World, unit: UnitEntity): void {
  if (unit.pathPending) {
    world.pathQueue.cancel(unit.id);
  }
  unit.workAnimation = undefined;
  unit.workStartedTick = undefined;
  unit.path = undefined;
  unit.pathTarget = undefined;
  unit.pathPending = false;
  advanceUnitOrder(world, unit);
}

export function approachTarget(
  world: World,
  unit: UnitEntity,
  target: BuildingEntity | MineEntity,
): boolean {
  const grid = world.grid;
  const dx = Math.max(0, target.x - unit.x, unit.x - (target.x + target.width));
  const dz = Math.max(
    0,
    target.z - unit.z,
    unit.z - (target.z + target.height),
  );

  if (
    dx * dx + dz * dz <= INTERACTION_DIST_SQ &&
    grid.canOccupy(unit.x, unit.z, unit.radius, unit.player)
  ) {
    if (unit.pathPending) {
      world.pathQueue.cancel(unit.id);
      unit.pathPending = false;
    }
    unit.path = undefined;
    unit.pathTarget = undefined;
    if (unit.order) {
      unit.order.x = unit.x;
      unit.order.z = unit.z;
    }
    return true;
  }

  // ComponentManager caches by player/revision, so keep each cache scoped to its World.
  let components = componentManagers.get(world);
  if (!components) {
    components = new ComponentManager();
    componentManagers.set(world, components);
  }
  const labels = components.getLabels(grid, unit.player);
  const size = grid.size;
  const startTx = Math.max(0, Math.min(size - 1, Math.floor(unit.x)));
  const startTz = Math.max(0, Math.min(size - 1, Math.floor(unit.z)));
  let startComponent = labels[startTz * size + startTx];
  if (startComponent === 0) {
    startComponent = findStartComponent(
      grid,
      labels,
      unit.x,
      unit.z,
      unit.player,
    ).compId;
  }

  // Do not replace a pending or active route every construction/economy tick.
  if (
    unit.pathTarget &&
    (unit.pathPending || (unit.path && unit.path.length > 0))
  ) {
    const px = unit.pathTarget.x;
    const pz = unit.pathTarget.z;
    const pdx = Math.max(0, target.x - px, px - (target.x + target.width));
    const pdz = Math.max(0, target.z - pz, pz - (target.z + target.height));
    if (
      pdx * pdx + pdz * pdz <= INTERACTION_DIST_SQ &&
      unit.stuckTicks < 40 &&
      startComponent !== 0 &&
      grid.canOccupy(px, pz, unit.radius, unit.player) &&
      labels[Math.floor(pz) * size + Math.floor(px)] === startComponent
    ) {
      return false;
    }
  }

  let bestX = unit.x;
  let bestZ = unit.z;
  let bestDistSq = Infinity;

  // Row-major perimeter traversal gives a stable tile-index tie-break.
  for (let tz = target.z - 1; tz <= target.z + target.height; tz++) {
    for (let tx = target.x - 1; tx <= target.x + target.width; tx++) {
      if (
        tx >= target.x &&
        tx < target.x + target.width &&
        tz >= target.z &&
        tz < target.z + target.height
      )
        continue;
      if (tx < 0 || tx >= size || tz < 0 || tz >= size) continue;
      // PathQueue snaps unreachable requests; filter first so the chosen endpoint stays adjacent.
      if (startComponent === 0 || labels[tz * size + tx] !== startComponent)
        continue;
      const cx = tx + 0.5;
      const cz = tz + 0.5;
      if (!grid.canOccupy(cx, cz, unit.radius, unit.player)) continue;
      const distanceSq =
        (unit.x - cx) * (unit.x - cx) + (unit.z - cz) * (unit.z - cz);
      if (distanceSq >= bestDistSq) continue;

      let occupied = false;
      // The hash is a pre-movement snapshot; use current coordinates for exact clearance.
      for (let otherId = 0; otherId < world.entities.length; otherId++) {
        const other = world.entities[otherId];
        if (!other || other.kind !== 'unit' || other === unit || other.hp <= 0)
          continue;
        const radius = unit.radius + other.radius;
        const ox = other.x - cx;
        const oz = other.z - cz;
        if (ox * ox + oz * oz < radius * radius) {
          occupied = true;
          break;
        }
      }
      if (occupied) continue;

      bestDistSq = distanceSq;
      bestX = cx;
      bestZ = cz;
    }
  }

  unit.path = undefined;
  if (bestDistSq === Infinity) {
    if (unit.pathPending) world.pathQueue.cancel(unit.id);
    unit.pathPending = false;
    unit.pathTarget = undefined;
    if (unit.order) {
      unit.order.x = unit.x;
      unit.order.z = unit.z;
    }
    return false;
  }

  if (unit.order) {
    unit.order.x = bestX;
    unit.order.z = bestZ;
  }
  if (unit.pathTarget) {
    unit.pathTarget.x = bestX;
    unit.pathTarget.z = bestZ;
  } else {
    unit.pathTarget = { x: bestX, z: bestZ };
  }
  unit.stuckTicks = 0;
  unit.stuckProgressX = unit.x;
  unit.stuckProgressZ = unit.z;
  unit.stuckLastCheckTick = world.tick;
  world.pathQueue.request(unit.id, unit.x, unit.z, bestX, bestZ, unit.player);
  unit.pathPending = true;
  return false;
}
