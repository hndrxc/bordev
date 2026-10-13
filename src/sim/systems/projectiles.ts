import type { Combatant, ProjectileEntity } from '../entity.js';
import type { World } from '../world.js';
import type { AttackType } from '../../data/types.js';
import { SIM_DT } from '../sim.js';
import {
  PROJECTILE_SPEED,
  TREBUCHET_PROJECTILE_SPEED,
} from '../../data/combat.js';
import { getBuildingData } from '../../data/buildings.js';
import { applyDamage, areHostile } from './damage.js';
import { isRangedAttacker } from './reach.js';

function getCombatantCenterX(combatant: Combatant): number {
  return combatant.kind === 'building'
    ? combatant.x + combatant.width * 0.5
    : combatant.x;
}

function getCombatantCenterZ(combatant: Combatant): number {
  return combatant.kind === 'building'
    ? combatant.z + combatant.height * 0.5
    : combatant.z;
}

/**
 * Spawns a homing projectile fired by source towards target.
 * Damage is applied only upon arrival (impact), never on launch.
 */
export function spawnProjectile(
  world: World,
  source: Combatant,
  target: Combatant,
  damage: number,
): ProjectileEntity {
  let attackType: AttackType;
  if (source.kind === 'unit') {
    attackType = source.attackType ?? 'pierce';
  } else {
    const bData = getBuildingData(source.type, source.faction);
    attackType = bData?.attackType ?? 'pierce';
  }

  const isStone =
    source.kind === 'unit' && attackType === 'siege' && isRangedAttacker(source);
  const visualKind: 'arrow' | 'stone' = isStone ? 'stone' : 'arrow';
  const speed =
    visualKind === 'stone' ? TREBUCHET_PROJECTILE_SPEED : PROJECTILE_SPEED;

  const originX = getCombatantCenterX(source);
  const originZ = getCombatantCenterZ(source);

  return world.spawnProjectile({
    player: source.player,
    x: originX,
    z: originZ,
    previousX: originX,
    previousZ: originZ,
    speed,
    targetId: target.id,
    targetRef: target,
    sourceRef: source,
    visualKind,
    originX,
    originZ,
    traveledDistance: 0,
    flightProgress: 0,
    damage,
    attackType,
  });
}

/**
 * Updates all active projectiles in the simulation.
 * Homes in on moving targets, applies impact damage via applyDamage,
 * cleans up safely if targets are removed, recycled, or become allied.
 */
export function updateProjectiles(world: World): void {
  for (let i = 0; i < world.entities.length; i++) {
    const ent = world.entities[i];
    if (!ent || ent.kind !== 'projectile') {
      continue;
    }

    const projectile = ent;

    // 1. Record previous position for render interpolation
    projectile.previousX = projectile.x;
    projectile.previousZ = projectile.z;

    // 2. Identity-safe target validation
    const target = projectile.targetRef;
    const currentEntity = world.getEntity(projectile.targetId);

    // If target was removed, ID was recycled to another entity, or target is dead / in remains
    if (
      !target ||
      currentEntity !== target ||
      target.hp <= 0 ||
      target.deathTick !== undefined
    ) {
      world.removeEntity(projectile.id);
      continue;
    }

    // 3. Ownership / alliance check: clean up harmlessly if target is friendly or allied
    if (!areHostile(world, projectile, target)) {
      world.removeEntity(projectile.id);
      continue;
    }

    // 4. Determine current target position (homes towards moving targets)
    const targetX = getCombatantCenterX(target);
    const targetZ = getCombatantCenterZ(target);
    const dx = targetX - projectile.x;
    const dz = targetZ - projectile.z;
    const dist = Math.hypot(dx, dz);
    const stepDist = projectile.speed * SIM_DT;

    // Tolerance absorbs accumulated floating-point error from repeated fixed-step additions.
    if (dist <= stepDist + 1e-9 || dist < 1e-4) {
      // Impact! Homing never misses valid targets.
      projectile.x = targetX;
      projectile.z = targetZ;
      projectile.traveledDistance += dist;
      projectile.flightProgress = 1;

      applyDamage(world, target, projectile.damage, projectile.sourceRef);
      world.removeEntity(projectile.id);
    } else {
      const invDist = 1 / dist;
      projectile.x += dx * invDist * stepDist;
      projectile.z += dz * invDist * stepDist;
      projectile.traveledDistance += stepDist;

      // Flight progress for arc rendering (monotonically approaches 1)
      const remainingDist = dist - stepDist;
      const totalEstimated = projectile.traveledDistance + remainingDist;
      projectile.flightProgress =
        totalEstimated > 1e-4
          ? Math.min(
              1,
              Math.max(0, projectile.traveledDistance / totalEstimated),
            )
          : 1;
    }
  }
}
