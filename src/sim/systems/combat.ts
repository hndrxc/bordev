import type { AttackCommand } from '../commands.js';
import type { BuildingEntity, Combatant, UnitEntity } from '../entity.js';
import type { World } from '../world.js';
import { getBuildingData } from '../../data/buildings.js';
import {
  ATTACK_ANIM_FPS,
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
import { canEngage, resolveAttackTarget } from './breach.js';
import {
  distanceToCombatant,
  distanceToFootprint,
  isRangedAttacker,
} from './reach.js';

let meleeSwingTicks = 0;
function getMeleeSwingTicks(): number {
  if (meleeSwingTicks === 0) {
    meleeSwingTicks = Math.ceil(MELEE_TOTAL_FRAMES / ATTACK_ANIM_FPS / SIM_DT);
  }
  return meleeSwingTicks;
}

export function clearCombat(unit: Combatant): void {
  unit.combat = undefined;
}

export function getCombatantDistance(
  source: Combatant,
  target: Combatant,
): number {
  if (source.kind === 'unit') {
    return distanceToCombatant(source.x, source.z, target);
  }
  return distanceToFootprint(
    target.x,
    target.z,
    source.x,
    source.z,
    source.width,
    source.height,
  );
}

export function isInAttackRange(source: Combatant, target: Combatant): boolean {
  if (source.kind === 'unit') {
    if (!isRangedAttacker(source)) {
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
      const dist = distanceToCombatant(source.x, source.z, target);
      return dist <= range && dist >= minRange;
    }
  } else {
    const bData = getBuildingData(source.type, source.faction);
    const range = bData?.range ?? 6;
    const dist = getCombatantDistance(source, target);
    return dist <= range;
  }
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

function findNearestEnemy(
  world: World,
  attacker: UnitEntity,
  maxSearchRange: number,
  requireInAttackRange: boolean,
): Combatant | undefined {
  const minRange = isRangedAttacker(attacker) ? (attacker.minRange ?? 0) : 0;

  let bestCandidate: Combatant | undefined;
  let bestClass = 99;
  let bestDist = Infinity;
  let bestId = -1;

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
    if (!isInAttackRange(attacker, ent) && !canEngage(world, attacker, ent)) {
      continue;
    }

    const cls = 0;
    if (
      cls < bestClass ||
      (cls === bestClass && dist < bestDist - 1e-4) ||
      (cls === bestClass &&
        Math.abs(dist - bestDist) <= 1e-4 &&
        ent.id < bestId)
    ) {
      bestCandidate = ent;
      bestClass = cls;
      bestDist = dist;
      bestId = ent.id;
    }
  }

  // A hostile unit candidate always beats any building
  if (bestClass !== 0) {
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
      const bData = getBuildingData(ent.type, ent.faction);
      if (bData?.isWall || bData?.isGate || ent.isGate) {
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
      if (!isInAttackRange(attacker, ent) && !canEngage(world, attacker, ent)) {
        continue;
      }

      const isAttacking = (bData?.attack ?? 0) > 0;
      const cls = isAttacking ? 1 : 2;

      if (
        cls < bestClass ||
        (cls === bestClass && dist < bestDist - 1e-4) ||
        (cls === bestClass &&
          Math.abs(dist - bestDist) <= 1e-4 &&
          ent.id < bestId)
      ) {
        bestCandidate = ent;
        bestClass = cls;
        bestDist = dist;
        bestId = ent.id;
      }
    }
  }

  return bestCandidate;
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
      const currentGoal = unit.combat?.goalRef ?? unit.combat?.targetRef;
      const isSameGoal = unit.combat !== undefined && currentGoal === target;

      if (!isSameGoal) {
        const wall = resolveAttackTarget(world, unit, target);
        unit.combat = {
          targetRef: wall,
          goalRef: wall !== target ? target : undefined,
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

const DIRS_8: readonly [number, number][] = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

const BACKOFF_MAX_DEPTH = 32;
const backoffQueueX = new Int32Array(2048);
const backoffQueueZ = new Int32Array(2048);
const backoffQueueDepth = new Int32Array(2048);
let backoffVisitedToken = 1;
let backoffVisited: Int32Array | undefined;

function findReachableFiringTile(
  world: World,
  unit: UnitEntity,
  target: Combatant,
  minRange: number,
  range: number,
): { x: number; z: number } | undefined {
  const grid = world.grid;
  const size = grid.size;
  const total = size * size;

  if (!backoffVisited || backoffVisited.length < total) {
    backoffVisited = new Int32Array(total);
    backoffVisitedToken = 1;
  } else if (backoffVisitedToken >= 0x7ffffffe) {
    backoffVisited.fill(0);
    backoffVisitedToken = 1;
  }
  const token = backoffVisitedToken++;

  const startTx = Math.max(0, Math.min(size - 1, Math.floor(unit.x)));
  const startTz = Math.max(0, Math.min(size - 1, Math.floor(unit.z)));

  let head = 0;
  let tail = 0;

  backoffQueueX[tail] = startTx;
  backoffQueueZ[tail] = startTz;
  backoffQueueDepth[tail] = 0;
  tail++;
  backoffVisited[startTz * size + startTx] = token;

  let bestTile: { x: number; z: number; distToUnit: number } | undefined;
  let foundAtDepth = -1;

  while (head < tail) {
    const cx = backoffQueueX[head];
    const cz = backoffQueueZ[head];
    const depth = backoffQueueDepth[head];
    head++;

    if (foundAtDepth !== -1 && depth > foundAtDepth) {
      break;
    }

    const centerX = cx + 0.5;
    const centerZ = cz + 0.5;
    const distToTarget = distanceToCombatant(centerX, centerZ, target);

    if (
      distToTarget >= minRange &&
      distToTarget <= range &&
      grid.canOccupy(centerX, centerZ, unit.radius, unit.player)
    ) {
      const distToUnit = Math.hypot(centerX - unit.x, centerZ - unit.z);
      if (
        !bestTile ||
        distToUnit < bestTile.distToUnit - 1e-4 ||
        (Math.abs(distToUnit - bestTile.distToUnit) <= 1e-4 &&
          (cz < bestTile.z || (cz === bestTile.z && cx < bestTile.x)))
      ) {
        bestTile = { x: cx, z: cz, distToUnit };
        foundAtDepth = depth;
      }
    }

    if (foundAtDepth !== -1 || depth >= BACKOFF_MAX_DEPTH) {
      continue;
    }

    for (let d = 0; d < 8; d++) {
      const dx = DIRS_8[d][0];
      const dz = DIRS_8[d][1];
      const nx = cx + dx;
      const nz = cz + dz;

      if (nx < 0 || nx >= size || nz < 0 || nz >= size) continue;
      const nIdx = nz * size + nx;
      if (backoffVisited[nIdx] === token) continue;

      if (!grid.isPassable(nx, nz, unit.player)) continue;
      if (dx !== 0 && dz !== 0) {
        if (
          !grid.isPassable(cx + dx, cz, unit.player) ||
          !grid.isPassable(cx, cz + dz, unit.player)
        ) {
          continue;
        }
      }

      backoffVisited[nIdx] = token;
      if (tail < backoffQueueX.length) {
        backoffQueueX[tail] = nx;
        backoffQueueZ[tail] = nz;
        backoffQueueDepth[tail] = depth + 1;
        tail++;
      }
    }
  }

  if (bestTile) {
    return { x: bestTile.x + 0.5, z: bestTile.z + 0.5 };
  }
  return undefined;
}

function requestChasePath(
  world: World,
  unit: UnitEntity,
  destX: number,
  destZ: number,
  tolerance: number,
): void {
  const combat = unit.combat;
  const needsPath =
    !unit.pathPending &&
    (combat === undefined ||
      combat.lastDestX === undefined ||
      combat.lastDestZ === undefined ||
      combat.lastGridRevision !== world.grid.revision ||
      Math.hypot(combat.lastDestX - destX, combat.lastDestZ - destZ) >
        tolerance);
  if (needsPath) {
    // Chase destinations are combat-owned: never reuse the order's formation slot.
    unit.formationSlotX = undefined;
    unit.formationSlotZ = undefined;
    if (combat) {
      combat.lastDestX = destX;
      combat.lastDestZ = destZ;
      combat.lastGridRevision = world.grid.revision;
    }
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

  const minRange = isRangedAttacker(unit) ? (unit.minRange ?? 0) : 0;
  const dist = Math.hypot(destX - unit.x, destZ - unit.z);

  if (minRange > 0 && getCombatantDistance(unit, target) < minRange) {
    const range = unit.range ?? 16;
    const backoffTile = findReachableFiringTile(
      world,
      unit,
      target,
      minRange,
      range,
    );
    if (backoffTile) {
      requestChasePath(world, unit, backoffTile.x, backoffTile.z, 1);
    } else {
      if (unit.order?.kind === 'attack') {
        clearCombat(unit);
        advanceUnitOrder(world, unit);
        onTargetLost(world, unit);
      } else {
        clearCombat(unit);
        onTargetLost(world, unit);
      }
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

  // 2. Acquisition: idle / stop / attackMove / hold only (staggered by unit id)
  if (!goal) {
    const orderKind = unit.order?.kind ?? 'idle';
    const canAcquire =
      orderKind === 'idle' ||
      orderKind === 'stop' ||
      orderKind === 'attackMove' ||
      orderKind === 'hold';
    if (!canAcquire || (world.tick + unit.id) % 10 !== 0) return;

    const searchRange = Math.max(unit.lineOfSight, unit.range ?? 0);
    const candidate = findNearestEnemy(
      world,
      unit,
      searchRange,
      orderKind === 'hold',
    );
    if (!candidate) return;
    goal = candidate;
    // Drop any stale path (e.g. the attackMove destination path) before chasing
    resetPath(world, unit);
    unit.combat = { targetRef: goal };
  }

  // 3. Current combat target = goal, or breach wall/gate from resolveAttackTarget
  const target = resolveAttackTarget(world, unit, goal);
  if (!target) {
    // Unreachable
    if (unit.order?.kind !== 'attack') {
      unit.combat = undefined;
      onTargetLost(world, unit);
      return;
    }
    // Explicit attack order: move once toward the nearest reachable point
    const combat = (unit.combat ??= {});
    combat.targetRef = undefined;
    combat.goalRef = goal;
    chaseTarget(world, unit, goal);
    return;
  }

  const combat = (unit.combat ??= {});
  if (combat.targetRef !== target) {
    combat.targetRef = target;
    combat.attackStartedTick = undefined;
    combat.hitApplied = undefined;
    combat.lastDestX = undefined;
    combat.lastDestZ = undefined;
  }
  combat.goalRef = target !== goal ? goal : undefined;

  // 4. Execute. A started swing is committed: it is never cancelled by
  // leaving range mid-swing. The hit lands only if the target is still in
  // range at the hit frame (locked combat model, overview §Combat model).
  const swingInProgress = combat.attackStartedTick !== undefined;
  if (swingInProgress || isInAttackRange(unit, target)) {
    if (unit.pathPending || (unit.path && unit.path.length > 0)) {
      resetPath(world, unit);
    }
    combat.lastDestX = undefined;
    combat.lastDestZ = undefined;

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
      const isHitFrame =
        Math.floor(elapsed * SIM_DT * ATTACK_ANIM_FPS) >= MELEE_HIT_FRAME;

      if (isHitFrame && !combat.hitApplied) {
        combat.hitApplied = true;
        // Impact only if the target is still a legal, hostile, in-range, live target
        if (
          isLiveCombatant(world, target) &&
          areHostile(world, unit, target) &&
          isInAttackRange(unit, target)
        ) {
          const dmg = calculateDamage(unit, target);
          if (!isRangedAttacker(unit)) {
            applyDamage(world, target, dmg, unit);
          } else {
            spawnProjectile(world, unit, target, dmg);
          }
        }
      }

      if (elapsed >= getMeleeSwingTicks()) {
        combat.attackStartedTick = undefined;
        combat.hitApplied = undefined;
      }
    } else if (
      unit.attackCooldownUntilTick === undefined ||
      world.tick >= unit.attackCooldownUntilTick
    ) {
      const cooldownTicks = Math.round((unit.cooldown ?? 1.5) / SIM_DT);
      combat.attackStartedTick = world.tick;
      combat.attackDurationTicks = getMeleeSwingTicks();
      combat.hitApplied = false;
      unit.attackCooldownUntilTick = world.tick + cooldownTicks;
    }
    return;
  }

  // Out of range with no swing in progress.
  if (unit.order?.kind === 'hold') {
    clearCombat(unit);
    return;
  }
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
  const hasValidTarget =
    target !== undefined &&
    isLiveCombatant(world, target) &&
    areHostile(world, b, target) &&
    isInAttackRange(b, target);

  if (!hasValidTarget) {
    if ((world.tick + b.id) % 10 !== 0) {
      return;
    }
    target = findNearestEnemyForBuilding(world, b, range);
  }

  if (target) {
    const dmg = calculateDamage(b, target);
    spawnProjectile(world, b, target, dmg);
    if (b.combat) {
      b.combat.targetRef = target;
    } else {
      b.combat = {
        targetRef: target,
      };
    }
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
