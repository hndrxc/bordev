import type { AttackType } from '../../data/types.js';
import type { Combatant } from '../entity.js';

/**
 * Ranged attackers resolve hits through projectiles and may fire over obstacles.
 * Range-0 attackers (including siege rams) strike in melee reach regardless of
 * their damage type; damage type only selects the armor rule.
 */
export function isRangedAttacker(e: {
  attackType?: AttackType | null;
  range?: number;
}): boolean {
  return (e.attackType ?? 'melee') !== 'melee' && (e.range ?? 0) > 0;
}

/** Distance from a point to the nearest point of an axis-aligned footprint (0 inside). */
export function distanceToFootprint(
  px: number,
  pz: number,
  bx: number,
  bz: number,
  width: number,
  height: number,
): number {
  const cx = Math.max(bx, Math.min(px, bx + width));
  const cz = Math.max(bz, Math.min(pz, bz + height));
  return Math.hypot(px - cx, pz - cz);
}

/** Distance from a point to a unit centre or to a building footprint edge. */
export function distanceToCombatant(
  px: number,
  pz: number,
  target: Combatant,
): number {
  if (target.kind === 'unit') {
    return Math.hypot(px - target.x, pz - target.z);
  }
  return distanceToFootprint(
    px,
    pz,
    target.x,
    target.z,
    target.width,
    target.height,
  );
}
