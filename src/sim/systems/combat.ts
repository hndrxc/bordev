import type { AttackCommand } from '../commands.js';
import type { BuildingEntity, Combatant, UnitEntity } from '../entity.js';
import type { World } from '../world.js';
import { getBuildingData } from '../../data/buildings.js';
import {
  MELEE_HIT_FRAME,
  MELEE_REACH_BUFFER,
  MELEE_TOTAL_FRAMES,
} from '../../data/combat.js';
import { SIM_DT } from '../sim.js';
import { SpatialHash } from '../spatialHash.js';
import {
  advanceUnitOrder,
  clampUnitRadius,
  clearActiveWorkAndCartTransientState,
  computeFacing,
  computeUnitSpeed,
} from './movement.js';
import {
  applyDamage,
  areHostile,
  calculateDamage,
  isLiveCombatant,
  resolveAttackOrderTarget,
} from './damage.js';
import { spawnProjectile } from './projectiles.js';
import { findBlockingWall } from './gates.js';

export function clearCombat(unit: Combatant): void {
  unit.combat = undefined;
}

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

export function getCombatantDistance(
  source: Combatant,
  target: Combatant,
): number {
  if (source.kind === 'unit') {
    if (target.kind === 'unit') {
      return Math.hypot(source.x - target.x, source.z - target.z);
    } else {
      return distanceToFootprint(
        source.x,
        source.z,
        target.x,
        target.z,
        target.width,
        target.height,
      );
    }
  } else {
    if (target.kind === 'unit') {
      return distanceToFootprint(
        target.x,
        target.z,
        source.x,
        source.z,
        source.width,
        source.height,
      );
    } else {
      return Math.hypot(
        Math.max(
          0,
          source.x - (target.x + target.width),
          target.x - (source.x + source.width),
        ),
        Math.max(
          0,
          source.z - (target.z + target.height),
          target.z - (source.z + source.height),
        ),
      );
    }
  }

}

export function isInAttackRange(source: Combatant, target: Combatant): boolean {
  if (source.kind === 'unit') {
    const isMelee = (source.attackType ?? 'melee') === 'melee';
    if (isMelee) {
      if (target.kind === 'unit') {
        const dist = Math.hypot(source.x - target.x, source.z - target.z);
        return dist <= source.radius + target.radius + MELEE_REACH_BUFFER;
      } else {
        const dist = distanceToFootprint(
          source.x,
          source.z,
          target.x,
          target.z,
          target.width,
          target.height,
        );
        return dist <= source.radius + MELEE_REACH_BUFFER;
      }
    } else {
      const range = source.range ?? 5;
      const minRange = source.minRange ?? 0;
      const dist = getCombatantDistance(source, target);
      return dist <= range && dist >= minRange;
    }
  } else {
    const bData = getBuildingData(source.type, source.faction);
    const range = bData?.range ?? 6;
    const dist = getCombatantDistance(source, target);
    return dist <= range;
  }
}

function isRangedUnit(unit: UnitEntity): boolean {
  return (unit.attackType ?? 'melee') !== 'melee';
}

/**
 * Wall/gate that must be breached to reach `goal`. Ranged units that can already legally shoot
 * the goal never need a wall, since their projectiles need no path.
 */
function resolveBlockingWall(
  world: World,
  unit: UnitEntity,
  goal: Combatant,
): BuildingEntity | undefined {
  if (isRangedUnit(unit) && isInAttackRange(unit, goal)) {
    return undefined;
  }
  return findBlockingWall(world, unit, goal);
}

// ---------------------------------------------------------------------------
// Acquisition
// ---------------------------------------------------------------------------

interface StructureIndex {
  hash: SpatialHash;
  tick: number;
  maxExtent: number;
}

const structureIndexes = new WeakMap<World, StructureIndex>();

/**
 * Per-tick spatial index of completed, live buildings so acquisition queries
 * nearby structures instead of scanning every entity for each unit.
 */
function getStructureIndex(world: World): StructureIndex {
  let index = structureIndexes.get(world);
  if (!index) {
    index = {
      hash: new SpatialHash(world.map.size, 4, 1024),
      tick: -1,
      maxExtent: 0,
    };
    structureIndexes.set(world, index);
  }
  if (index.tick !== world.tick) {
    index.hash.clear();
    index.maxExtent = 0;
    index.tick = world.tick;
    for (let i = 0; i < world.entities.length; i++) {
      const ent = world.entities[i];
      if (
        !ent ||
        ent.kind !== 'building' ||
        !ent.built ||
        ent.hp <= 0 ||
        ent.deathTick !== undefined
      ) {
        continue;
      }
      index.hash.insert(ent.id, ent.x + ent.width / 2, ent.z + ent.height / 2);
      index.maxExtent = Math.max(index.maxExtent, ent.width, ent.height);
    }
  }
  return index;
}

interface Acquisition {
  /** What to hit now (the goal, or the wall blocking it). */
  target: Combatant;
  /** The enemy actually wanted. */
  goal: Combatant;
}

const candidateBuf: Combatant[] = [];
const candidateDist: number[] = [];

function findNearestEnemy(
  world: World,
  attacker: UnitEntity,
  maxSearchRange: number,
  requireInAttackRange: boolean,
): Acquisition | undefined {
  candidateBuf.length = 0;
  candidateDist.length = 0;
  const minRange = isRangedUnit(attacker) ? (attacker.minRange ?? 0) : 0;

  const nearbyIds = world.spatialHash.queryNearby(
    attacker.x,
    attacker.z,
    maxSearchRange,
  );
  for (let i = 0; i < nearbyIds.length; i++) {
    const id = nearbyIds[i];
    if (id === attacker.id) continue;
    const ent = world.entities[id];
    if (
      !ent ||
      ent.kind !== 'unit' ||
      !areHostile(world, attacker, ent) ||
      ent.hp <= 0 ||
      ent.deathTick !== undefined
    ) {
      continue;
    }
    const dist = Math.hypot(attacker.x - ent.x, attacker.z - ent.z);
    if (dist > maxSearchRange || dist < minRange) continue;
    if (requireInAttackRange && !isInAttackRange(attacker, ent)) continue;
    candidateBuf.push(ent);
    candidateDist.push(dist);
  }

  const index = getStructureIndex(world);
  const structureIds = index.hash.queryNearby(
    attacker.x,
    attacker.z,
    maxSearchRange + index.maxExtent,
  );
  for (let i = 0; i < structureIds.length; i++) {
    const ent = world.entities[structureIds[i]];
    if (
      !ent ||
      ent.kind !== 'building' ||
      !areHostile(world, attacker, ent) ||
      !ent.built ||
      ent.hp <= 0 ||
      ent.deathTick !== undefined
    ) {
      continue;
    }
    const dist = distanceToFootprint(
      attacker.x,
      attacker.z,
      ent.x,
      ent.z,
      ent.width,
      ent.height,
    );
    if (dist > maxSearchRange || dist < minRange) continue;
    if (requireInAttackRange && !isInAttackRange(attacker, ent)) continue;
    candidateBuf.push(ent);
    candidateDist.push(dist);
  }

  // Reachable enemies beat enclosed ones; an enclosed enemy is only chosen (via its blocking
  // wall) when no reachable candidate exists. Deterministic: nearest first, ties by id.
  let fallback: Acquisition | undefined;
  for (;;) {
    let best = -1;
    for (let i = 0; i < candidateBuf.length; i++) {
      const d = candidateDist[i];
      if (d === Infinity) continue;
      if (
        best === -1 ||
        d < candidateDist[best] - 1e-4 ||
        (Math.abs(d - candidateDist[best]) <= 1e-4 &&
          candidateBuf[i].id < candidateBuf[best].id)
      ) {
        best = i;
      }
    }
    if (best === -1) break;

    const candidate = candidateBuf[best];
    candidateDist[best] = Infinity;
    const wall = resolveBlockingWall(world, attacker, candidate);
    if (!wall) {
      return { target: candidate, goal: candidate };
    }
    if (
      fallback === undefined &&
      (!requireInAttackRange || isInAttackRange(attacker, wall))
    ) {
      fallback = { target: wall, goal: candidate };
    }
  }
  return fallback;
}

function findNearestEnemyForBuilding(
  world: World,
  building: BuildingEntity,
  range: number,
): Combatant | undefined {
  let bestCandidate: Combatant | undefined;
  let bestDist = Infinity;

  const nearbyIds = world.spatialHash.queryNearby(
    building.x + building.width / 2,
    building.z + building.height / 2,
    range + Math.max(building.width, building.height),
  );
  for (let i = 0; i < nearbyIds.length; i++) {
    const id = nearbyIds[i];
    const ent = world.entities[id];
    if (
      !ent ||
      ent.kind !== 'unit' ||
      !areHostile(world, building, ent) ||
      ent.hp <= 0 ||
      ent.deathTick !== undefined
    ) {
      continue;
    }
    const dist = distanceToFootprint(
      ent.x,
      ent.z,
      building.x,
      building.z,
      building.width,
      building.height,
    );
    if (dist > range) continue;

    if (
      dist < bestDist - 1e-4 ||
      (Math.abs(dist - bestDist) <= 1e-4 &&
        (bestCandidate === undefined || ent.id < bestCandidate.id))
    ) {
      bestDist = dist;
      bestCandidate = ent;
    }
  }

  return bestCandidate;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export function applyAttackCommand(world: World, cmd: AttackCommand): void {
  const target = world.getEntity(cmd.targetId);
  if (
    !target ||
    (target.kind !== 'unit' && target.kind !== 'building') ||
    !isLiveCombatant(world, target)
  ) {
    return;
  }

  for (let i = 0; i < cmd.ids.length; i++) {
    const id = cmd.ids[i];
    const unit = world.entities[id];
    if (
      !unit ||
      unit.kind !== 'unit' ||
      unit.player !== cmd.player ||
      unit.hp <= 0 ||
      unit.deathTick !== undefined ||
      !unit.attack ||
      unit.attack <= 0 ||
      !areHostile(world, unit, target)
    ) {
      continue;
    }

    const isBusy =
      unit.order !== undefined &&
      unit.order.kind !== 'idle' &&
      unit.order.kind !== 'stop' &&
      unit.order.kind !== 'hold';

    // The explicit order always keeps the ORIGINAL identity-checked target.
    if (cmd.queued && isBusy) {
      unit.orders.push({
        kind: 'attack',
        targetId: target.id,
        targetRef: target,
      });
    } else {
      clearActiveWorkAndCartTransientState(unit);
      unit.order = {
        kind: 'attack',
        targetId: target.id,
        targetRef: target,
      };
      unit.orders.length = 0;
      unit.orderGeneration++;
      // A blocking wall is only the temporary combat target.
      const wall = resolveBlockingWall(world, unit, target);
      unit.combat = {
        targetRef: wall ?? target,
        targetId: (wall ?? target).id,
        goalRef: wall ? target : undefined,
      };
      world.pathQueue.cancel(unit.id);
      unit.path = undefined;
      unit.pathTarget = undefined;
      unit.pathPending = false;
      unit.formationSlotX = undefined;
      unit.formationSlotZ = undefined;
      unit.stuckTicks = 0;
      unit.stuckProgressX = unit.x;
      unit.stuckProgressZ = unit.z;
      unit.stuckLastCheckTick = world.tick;
    }
  }
}

// ---------------------------------------------------------------------------
// Per-tick combat
// ---------------------------------------------------------------------------

function resetPath(world: World, unit: UnitEntity): void {
  world.pathQueue.cancel(unit.id);
  unit.path = undefined;
  unit.pathTarget = undefined;
  unit.pathPending = false;
}

/** Combat target lost: attackMove resumes its destination, idle/stop simply stop chasing. */
function onTargetLost(world: World, unit: UnitEntity): void {
  resetPath(world, unit);
  const order = unit.order;
  if (
    order?.kind === 'attackMove' &&
    order.x !== undefined &&
    order.z !== undefined
  ) {
    world.pathQueue.request(
      unit.id,
      unit.x,
      unit.z,
      order.x,
      order.z,
      unit.player,
    );
    unit.pathPending = true;
  }
}

function requestChasePath(
  world: World,
  unit: UnitEntity,
  destX: number,
  destZ: number,
  tolerance: number,
): void {
  const needsPath =
    !unit.pathPending &&
    (!unit.path ||
      unit.path.length === 0 ||
      !unit.pathTarget ||
      Math.hypot(unit.pathTarget.x - destX, unit.pathTarget.z - destZ) >
        tolerance);
  if (needsPath) {
    // Chase destinations are combat-owned: never reuse the order's formation slot.
    unit.formationSlotX = undefined;
    unit.formationSlotZ = undefined;
    world.pathQueue.request(unit.id, unit.x, unit.z, destX, destZ, unit.player);
    unit.pathPending = true;
  }
}

function chaseTarget(world: World, unit: UnitEntity, target: Combatant): void {
  let destX: number;
  let destZ: number;
  if (target.kind === 'unit') {
    destX = target.x;
    destZ = target.z;
  } else {
    destX = Math.max(target.x, Math.min(unit.x, target.x + target.width));
    destZ = Math.max(target.z, Math.min(unit.z, target.z + target.height));
  }

  const minRange = isRangedUnit(unit) ? (unit.minRange ?? 0) : 0;
  const dist = Math.hypot(destX - unit.x, destZ - unit.z);

  if (minRange > 0 && getCombatantDistance(unit, target) < minRange) {
    // Too close to fire: never approach. Back off to a legal firing distance if there is room.
    let ax = unit.x - destX;
    let az = unit.z - destZ;
    const len = Math.hypot(ax, az);
    if (len > 1e-4) {
      ax /= len;
      az /= len;
    } else {
      ax = 1;
      az = 0;
    }
    const backoff = minRange + 0.5 - getCombatantDistance(unit, target);
    const rx = unit.x + ax * backoff;
    const rz = unit.z + az * backoff;
    if (world.grid.canOccupy(rx, rz, unit.radius, unit.player)) {
      requestChasePath(world, unit, rx, rz, 1);
    }
    return;
  }

  if (dist < 1.5) {
    // Short close-in step: only translate when the destination tile area is legally passable.
    const d = dist;
    if (d > 1e-4) {
      const speed = computeUnitSpeed(world, unit);
      unit.speed = speed;
      const step = Math.min(speed * SIM_DT, d);
      const nx = unit.x + ((destX - unit.x) / d) * step;
      const nz = unit.z + ((destZ - unit.z) / d) * step;
      if (world.grid.canOccupy(nx, nz, unit.radius, unit.player)) {
        unit.facing = computeFacing(destX - unit.x, destZ - unit.z);
        unit.x = nx;
        unit.z = nz;
        clampUnitRadius(unit, world.grid);
        resetPath(world, unit);
        return;
      }
    }
  }

  requestChasePath(world, unit, destX, destZ, 1.5);
}

function updateUnitCombat(world: World, unit: UnitEntity): void {
  const kind = unit.order?.kind ?? 'idle';
  if (
    kind === 'move' ||
    kind === 'build' ||
    kind === 'repair' ||
    kind === 'farm' ||
    kind === 'pinMine'
  ) {
    // Move/work suppress combat
    if (unit.combat) unit.combat = undefined;
    return;
  }

  // 1. Resolve the intended target (goal)
  let goal: Combatant | undefined;
  if (unit.order?.kind === 'attack') {
    goal = resolveAttackOrderTarget(world, unit, unit.order);
    if (!goal) {
      advanceUnitOrder(world, unit);
      if (unit.order?.kind === 'attack') {
        goal = resolveAttackOrderTarget(world, unit, unit.order);
      }
    }
  } else if (unit.combat) {
    const intended = unit.combat.goalRef ?? unit.combat.targetRef;
    if (
      intended &&
      isLiveCombatant(world, intended) &&
      areHostile(world, unit, intended)
    ) {
      goal = intended;
    } else {
      unit.combat = undefined;
      onTargetLost(world, unit);
    }
  }

  // 2. Acquisition (every 10 ticks): idle / stop / attackMove / hold only
  if (!goal) {
    const orderKind = unit.order?.kind ?? 'idle';
    const canAcquire =
      orderKind === 'idle' ||
      orderKind === 'stop' ||
      orderKind === 'attackMove' ||
      orderKind === 'hold';
    if (!canAcquire || world.tick % 10 !== 0) return;

    const searchRange = Math.max(unit.lineOfSight, unit.range ?? 0);
    const acq = findNearestEnemy(
      world,
      unit,
      searchRange,
      orderKind === 'hold',
    );
    if (!acq) return;
    goal = acq.goal;
    // Drop any stale path (e.g. the attackMove destination path) before chasing
    resetPath(world, unit);
    unit.combat = { targetRef: acq.target, targetId: acq.target.id };
  }

  // 3. Current combat target = goal, or the reachable wall blocking it
  const combat = (unit.combat ??= {});
  const target = resolveBlockingWall(world, unit, goal) ?? goal;
  if (combat.targetRef !== target) {
    combat.targetRef = target;
    combat.targetId = target.id;
    combat.attackStartedTick = undefined;
    combat.hitApplied = undefined;
  }
  combat.goalRef = target !== goal ? goal : undefined;

  // 4. Execute
  if (isInAttackRange(unit, target)) {
    if (unit.pathPending || (unit.path && unit.path.length > 0)) {
      resetPath(world, unit);
    }

    if (target.kind === 'unit') {
      unit.facing = computeFacing(target.x - unit.x, target.z - unit.z);
    } else {
      unit.facing = computeFacing(
        target.x + target.width / 2 - unit.x,
        target.z + target.height / 2 - unit.z,
      );
    }

    if (combat.attackStartedTick !== undefined) {
      const elapsed = world.tick - combat.attackStartedTick;
      const isHitFrame = Math.floor(elapsed * SIM_DT * 12) >= MELEE_HIT_FRAME;

      if (isHitFrame && !combat.hitApplied) {
        combat.hitApplied = true;
        // Impact only if the target is still a legal, hostile, in-range, live target
        if (
          isLiveCombatant(world, target) &&
          areHostile(world, unit, target) &&
          isInAttackRange(unit, target)
        ) {
          const dmg = calculateDamage(unit, target);
          if ((unit.attackType ?? 'melee') === 'melee') {
            applyDamage(world, target, dmg, unit);
          } else {
            spawnProjectile(world, unit, target, dmg);
          }
        }
      }

      const clipTicks = Math.ceil(MELEE_TOTAL_FRAMES / 12 / SIM_DT);
      if (elapsed >= clipTicks) {
        combat.attackStartedTick = undefined;
        combat.hitApplied = undefined;
      }
    } else if (
      unit.attackCooldownUntilTick === undefined ||
      world.tick >= unit.attackCooldownUntilTick
    ) {
      const cooldownTicks = Math.round((unit.cooldown ?? 1.5) / SIM_DT);
      combat.attackStartedTick = world.tick;
      combat.attackDurationTicks = Math.ceil(MELEE_TOTAL_FRAMES / 12 / SIM_DT);
      combat.hitApplied = false;
      unit.attackCooldownUntilTick = world.tick + cooldownTicks;
    }
    return;
  }

  // Out of range
  if (unit.order?.kind === 'hold') {
    clearCombat(unit);
    return;
  }
  combat.attackStartedTick = undefined;
  combat.hitApplied = undefined;
  chaseTarget(world, unit, target);
}

function updateBuildingCombat(world: World, b: BuildingEntity): void {
  const bData = getBuildingData(b.type, b.faction);
  if (!bData || !bData.attack || bData.attack <= 0) {
    return;
  }
  if (
    b.attackCooldownUntilTick !== undefined &&
    world.tick < b.attackCooldownUntilTick
  ) {
    return;
  }

  const range = bData.range ?? 6;
  let cooldown = bData.cooldown ?? 2.0;
  if (world.players[b.player]?.lowFaith) {
    cooldown /= 0.5;
  }
  const cooldownTicks = Math.round(cooldown / SIM_DT);

  let target = b.combat?.targetRef;
  if (
    !target ||
    !isLiveCombatant(world, target) ||
    !areHostile(world, b, target) ||
    !isInAttackRange(b, target)
  ) {
    target = findNearestEnemyForBuilding(world, b, range);
  }

  if (target) {
    const dmg = calculateDamage(b, target);
    spawnProjectile(world, b, target, dmg);
    b.combat = {
      targetRef: target,
      targetId: target.id,
    };
    b.attackCooldownUntilTick = world.tick + cooldownTicks;
  }
}

export function updateCombat(world: World): void {
  // Units first, then building attacks (tower/keep)
  for (let i = 0; i < world.entities.length; i++) {
    const ent = world.entities[i];
    if (
      ent &&
      ent.kind === 'unit' &&
      ent.hp > 0 &&
      ent.deathTick === undefined &&
      ent.attack &&
      ent.attack > 0
    ) {
      updateUnitCombat(world, ent);
    }
  }
  for (let i = 0; i < world.entities.length; i++) {
    const ent = world.entities[i];
    if (
      ent &&
      ent.kind === 'building' &&
      ent.built &&
      ent.hp > 0 &&
      ent.deathTick === undefined
    ) {
      updateBuildingCombat(world, ent);
    }
  }
}
