import type { BuildingEntity, UnitEntity } from '../entity.js';
import type { World } from '../world.js';
import { findReachablePerimeterDestination } from './work.js';

export type RallyPoint = NonNullable<BuildingEntity['rallyPoint']>;

/**
 * Resolves the live unit/building a rally point follows, or undefined when the
 * rally is a plain ground point or its target is dead, removed, or recycled.
 *
 * Identity is checked against the stored reference, so a recycled entity ID
 * (a different object in the same slot) is never mistaken for the old target.
 */
export function resolveRallyTarget(
  world: World,
  rally: RallyPoint,
  ownerPlayerId?: number,
): UnitEntity | BuildingEntity | undefined {
  const { targetId, targetRef } = rally;
  if (targetId === undefined || targetRef === undefined) return undefined;
  const ent = world.entities[targetId];
  if (!ent || ent !== targetRef) return undefined;
  if (ent.kind !== 'unit' && ent.kind !== 'building') return undefined;
  if (ent.hp <= 0) return undefined;
  if (ownerPlayerId !== undefined && ent.player !== ownerPlayerId) return undefined;
  return ent;
}

/**
 * Current world position of a rally point: the live target's position (unit
 * location or building footprint centre), else the stored ground coordinates.
 */
export function resolveRallyPoint(
  world: World,
  rally: RallyPoint,
  ownerPlayerId?: number,
): { x: number; z: number } {
  const target = resolveRallyTarget(world, rally, ownerPlayerId);
  if (!target) return { x: rally.x, z: rally.z };
  if (target.kind === 'unit') return { x: target.x, z: target.z };
  return {
    x: target.x + target.width * 0.5,
    z: target.z + target.height * 0.5,
  };
}


/**
 * Issues the rally move order to a freshly spawned unit.
 *
 * Unit target: move to its current position. Building target: move to the
 * nearest passable perimeter tile (never the blocked footprint). A stale
 * target is dropped and the unit uses the last stored ground coordinates.
 */
export function applyRallyOrder(
  world: World,
  building: BuildingEntity,
  unit: UnitEntity,
): void {
  const rally = building.rallyPoint;
  if (!rally) return;

  let destX = rally.x;
  let destZ = rally.z;

  if (rally.targetId !== undefined || rally.targetRef !== undefined) {
    const target = resolveRallyTarget(world, rally, building.player);
    if (!target) {
      delete rally.targetId;
      delete rally.targetRef;
    } else if (target.kind === 'unit') {
      destX = target.x;
      destZ = target.z;
    } else {
      const perimeter = findReachablePerimeterDestination(
        world,
        target,
        unit,
        'prefer-empty',
      );
      if (perimeter) {
        destX = perimeter.x;
        destZ = perimeter.z;
      }
    }
  }

  unit.order = { kind: 'move', x: destX, z: destZ };
  unit.orders = [];
  unit.orderGeneration++;
  unit.formationSlotX = undefined;
  unit.formationSlotZ = undefined;
  unit.path = undefined;
  unit.pathTarget = undefined;
  world.pathQueue.cancel(unit.id);
  world.pathQueue.request(unit.id, unit.x, unit.z, destX, destZ, unit.player);
  unit.pathPending = true;
}
