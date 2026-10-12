import type {
  Combatant,
  UnitEntity,
  UnitOrder,
} from '../entity.js';
import type { World } from '../world.js';
import { getBuildingData } from '../../data/buildings.js';

/** Different player AND different team. Same-team allies are never hostile. */
export function areHostile(
  world: World,
  a: { player: number },
  b: { player: number },
): boolean {
  if (a.player === b.player) return false;
  const pa = world.players[a.player];
  const pb = world.players[b.player];
  if (pa !== undefined && pb !== undefined && pa.team === pb.team) return false;
  return true;
}

/** Identity-checked liveness: still the dense entity at its id, alive, not in remains. */
export function isLiveCombatant(world: World, c: Combatant): boolean {
  return world.getEntity(c.id) === c && c.hp > 0 && c.deathTick === undefined;
}

/** Resolves an explicit attack order's original target; undefined if stale, dead, recycled or allied. */
export function resolveAttackOrderTarget(
  world: World,
  unit: UnitEntity,
  order: UnitOrder,
): Combatant | undefined {
  if (
    order.targetRef !== undefined &&
    order.targetId !== undefined &&
    order.targetId !== order.targetRef.id
  ) {
    return undefined;
  }
  const target =
    order.targetRef ??
    (order.targetId !== undefined
      ? world.getEntity(order.targetId)
      : undefined);
  if (target?.kind !== 'unit' && target?.kind !== 'building') return undefined;
  if (!isLiveCombatant(world, target)) return undefined;
  if (!areHostile(world, unit, target)) return undefined;
  return target;
}

export function calculateDamage(source: Combatant, target: Combatant): number {
  let attack = 0;
  let attackType: 'melee' | 'pierce' | 'siege' = 'melee';
  let bonusMap: Partial<Record<string, number>> | undefined;

  if (source.kind === 'unit') {
    attack = source.attack ?? 0;
    attackType = source.attackType ?? 'melee';
    bonusMap = source.bonus;
  } else {
    const bData = getBuildingData(source.type, source.faction);
    if (bData) {
      attack = bData.attack ?? 0;
      attackType =
        (bData.attackType as 'melee' | 'pierce' | 'siege') ?? 'pierce';
    }
  }

  // Base damage after armor
  let baseDamage = attack;
  if (attackType === 'siege') {
    // Siege damage ignores armor
    baseDamage = attack;
  } else if (attackType === 'melee') {
    baseDamage = Math.max(1, attack - (target.meleeArmor ?? 0));
  } else if (attackType === 'pierce') {
    baseDamage = Math.max(1, attack - (target.pierceArmor ?? 0));
  }

  // Sum bonus damage over target tags
  let bonusDamage = 0;
  if (bonusMap) {
    if (target.kind === 'unit') {
      for (let i = 0; i < target.tags.length; i++) {
        const tag = target.tags[i];
        const b = bonusMap[tag];
        if (b !== undefined) {
          bonusDamage += b;
        }
      }
    } else {
      // Building entity has 'building' tag
      const b = bonusMap['building'];
      if (b !== undefined) {
        bonusDamage += b;
      }
    }
  }

  return baseDamage + bonusDamage;
}

export function applyDamage(
  world: World,
  target: Combatant,
  damage: number,
  source?: Combatant,
): void {
  // If target already dead or removed, ignore
  if (target.hp <= 0 || target.deathTick !== undefined) {
    return;
  }
  // Same-team (or same-player) sources never deal damage
  if (source && !areHostile(world, source, target)) {
    return;
  }
  const current = world.getEntity(target.id);
  if (current !== target) {
    return;
  }

  world.emitEvent({
    kind: 'underAttack',
    entityId: target.id,
    player: target.player,
    attackerEntityId: source?.id,
    x: target.x,
    z: target.z,
  });

  target.hp -= damage;

  if (target.hp <= 0) {
    target.hp = 0;
    target.deathTick = world.tick;

    if (target.kind === 'building') {
      // Discard paid queues and research without refund
      target.trainingQueue.length = 0;
      target.research = undefined;
      target.combat = undefined;
      world.removeEntity(target.id);
      (world.remains as Combatant[]).push(target);
    } else {
      world.pathQueue.cancel(target.id);
      target.path = undefined;
      target.pathTarget = undefined;
      target.pathPending = false;
      target.order = { kind: 'idle' };
      target.orders.length = 0;
      target.combat = undefined;
      world.removeEntity(target.id);
      (world.remains as Combatant[]).push(target);
    }
    return;
  }

  // Retaliation for living unit
  if (
    target.kind === 'unit' &&
    (target.attack ?? 0) > 0 &&
    source &&
    areHostile(world, source, target) &&
    world.getEntity(source.id) === source &&
    source.hp > 0
  ) {
    const isIdleOrStop =
      !target.order ||
      target.order.kind === 'idle' ||
      target.order.kind === 'stop';
    if (isIdleOrStop && (!target.combat || !target.combat.targetRef)) {
      target.combat = {
        targetRef: source,
        targetId: source.id,
      };
    }
  }
}

export function updateRemains(world: World): void {
  const remains = world.remains as Combatant[];
  for (let i = remains.length - 1; i >= 0; i--) {
    const remain = remains[i];
    const deathTick = remain.deathTick ?? 0;
    const elapsed = world.tick - deathTick;
    const maxTicks = remain.kind === 'unit' ? 200 : 400;
    if (elapsed >= maxTicks) {
      remains.splice(i, 1);
    }
  }
}
