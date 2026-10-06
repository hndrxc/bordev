import { getBuildingData } from '../../data/buildings.js';
import type { BuildCommand, RepairCommand } from '../commands.js';
import type { BuildingEntity, UnitEntity, UnitOrder } from '../entity.js';
import { FLAG_BUILDING, FLAG_GATE, FLAG_TERRAIN } from '../grid.js';
import { ComponentManager } from '../path/components.js';
import { SIM_DT } from '../sim.js';
import type { World } from '../world.js';
import {
  approachTarget,
  finishWorkOrder,
  issueWorkOrder,
  isValidTarget,
} from './work.js';

export interface PlacementValidationResult {
  valid: boolean;
  reason?: string;
  width: number;
  height: number;
}

export function validatePlacement(
  world: World,
  player: number,
  buildingType: string,
  x: number,
  z: number,
  orientation?: 'horizontal' | 'vertical',
): PlacementValidationResult {
  if (!Number.isInteger(x) || !Number.isInteger(z)) {
    return { valid: false, reason: 'Invalid coordinates', width: 0, height: 0 };
  }

  const pState = world.players[player];
  if (!pState || pState.eliminated) {
    return { valid: false, reason: 'Invalid player', width: 0, height: 0 };
  }

  const bData =
    getBuildingData(buildingType, pState.faction) ??
    getBuildingData(buildingType);
  if (!bData) {
    return {
      valid: false,
      reason: 'Unknown building type',
      width: 0,
      height: 0,
    };
  }

  let width = bData.width;
  let height = bData.height;
  if (bData.gateOrientations && orientation) {
    const dims = bData.gateOrientations[orientation];
    if (dims) {
      width = dims.width;
      height = dims.height;
    }
  }

  const gridSize = world.grid.size;
  if (x < 0 || z < 0 || x + width > gridSize || z + height > gridSize) {
    return { valid: false, reason: 'Out of bounds', width, height };
  }

  if (bData.faction !== pState.faction) {
    return { valid: false, reason: 'Invalid faction', width, height };
  }

  const isTownCenter =
    bData.isTownCenter ??
    (buildingType === 'keep' || buildingType === 'great_hall');
  if (isTownCenter) {
    let hasExistingTC = false;
    for (let i = 0; i < world.entities.length; i++) {
      const e = world.entities[i];
      if (
        e &&
        e.kind === 'building' &&
        e.player === player &&
        (e.isTownCenter || e.type === 'keep' || e.type === 'great_hall')
      ) {
        hasExistingTC = true;
        break;
      }
    }
    const requiredAge = hasExistingTC ? (bData.additionalAge ?? 2) : bData.age;
    if (pState.age < requiredAge) {
      return { valid: false, reason: 'Age requirement not met', width, height };
    }
  } else if (pState.age < bData.age) {
    return { valid: false, reason: 'Age requirement not met', width, height };
  }

  if (pState.food < bData.food || pState.gold < bData.gold) {
    return { valid: false, reason: 'Insufficient resources', width, height };
  }

  const explored = pState.explored;
  const gridFlags = world.grid.flags;
  const blockedMask = FLAG_TERRAIN | FLAG_BUILDING | FLAG_GATE;

  for (let dz = 0; dz < height; dz++) {
    const tz = z + dz;
    const rowOffset = tz * gridSize;
    for (let dx = 0; dx < width; dx++) {
      const tx = x + dx;
      const idx = rowOffset + tx;

      if (explored && explored[idx] === 0) {
        return { valid: false, reason: 'Unexplored territory', width, height };
      }

      if ((gridFlags[idx] & blockedMask) !== 0) {
        return { valid: false, reason: 'Tile is blocked', width, height };
      }
    }
  }

  return { valid: true, width, height };
}

interface DisplacementPosition {
  x: number;
  z: number;
}

type DisplacementPlan = Map<UnitEntity, DisplacementPosition>;
const displacementComponents = new WeakMap<World, ComponentManager>();

function planUnitDisplacements(
  world: World,
  bx: number,
  bz: number,
  bw: number,
  bh: number,
): DisplacementPlan | null | undefined {
  const gridSize = world.grid.size;
  let plan: DisplacementPlan | undefined;

  for (let i = 0; i < world.entities.length; i++) {
    const unit = world.entities[i];
    if (!unit || unit.kind !== 'unit') continue;

    const r = unit.radius;
    const inFootprintX = unit.x >= bx - r && unit.x <= bx + bw + r;
    const inFootprintZ = unit.z >= bz - r && unit.z <= bz + bh + r;
    if (!inFootprintX || !inFootprintZ) continue;

    const reservedPositions = (plan ??= new Map());
    let components = displacementComponents.get(world);
    if (!components) {
      components = new ComponentManager();
      displacementComponents.set(world, components);
    }
    // Read the original component before the foundation changes the grid. Do not
    // substitute a nearest component through blocked terrain for a trapped unit.
    const labels = components.getLabels(world.grid, unit.player);
    const startX = Math.floor(unit.x);
    const startZ = Math.floor(unit.z);
    if (startX < 0 || startX >= gridSize || startZ < 0 || startZ >= gridSize)
      return null;
    const startComponent = labels[startZ * gridSize + startX];
    if (startComponent === 0) return null;

    let bestDistSq = Infinity;
    let bestCx = unit.x;
    let bestCz = unit.z;
    let bestIdx = Infinity;

    const checkCandidate = (tx: number, tz: number) => {
      if (tx < 0 || tx >= gridSize || tz < 0 || tz >= gridSize) return;
      const idx = tz * gridSize + tx;
      if (labels[idx] !== startComponent) return;

      const cx = tx + 0.5;
      const cz = tz + 0.5;
      if (!world.grid.canOccupy(cx, cz, r, unit.player)) return;
      // Reserve against the future footprint without mutating or copying the grid.
      if (cx > bx - r && cx < bx + bw + r && cz > bz - r && cz < bz + bh + r)
        return;

      for (let otherId = 0; otherId < world.entities.length; otherId++) {
        const other = world.entities[otherId];
        if (!other || other.kind !== 'unit' || other === unit || other.hp <= 0)
          continue;
        const reserved = reservedPositions.get(other);
        const separation = r + other.radius;
        const ox = (reserved?.x ?? other.x) - cx;
        const oz = (reserved?.z ?? other.z) - cz;
        if (ox * ox + oz * oz < separation * separation) return;
      }
      const dx = unit.x - cx;
      const dz = unit.z - cz;
      const distSq = dx * dx + dz * dz;

      if (distSq < bestDistSq || (distSq === bestDistSq && idx < bestIdx)) {
        bestDistSq = distSq;
        bestCx = cx;
        bestCz = cz;
        bestIdx = idx;
      }
    };

    const zTop = bz - 1;
    const zBottom = bz + bh;
    for (let tx = bx - 1; tx <= bx + bw; tx++) {
      checkCandidate(tx, zTop);
      checkCandidate(tx, zBottom);
    }
    const xLeft = bx - 1;
    const xRight = bx + bw;
    for (let tz = bz; tz < bz + bh; tz++) {
      checkCandidate(xLeft, tz);
      checkCandidate(xRight, tz);
    }
    for (let ring = 2; bestDistSq === Infinity && ring < gridSize; ring++) {
      const left = bx - ring;
      const right = bx + bw + ring - 1;
      const top = bz - ring;
      const bottom = bz + bh + ring - 1;
      for (let tx = left; tx <= right; tx++) {
        checkCandidate(tx, top);
        checkCandidate(tx, bottom);
      }
      for (let tz = top + 1; tz < bottom; tz++) {
        checkCandidate(left, tz);
        checkCandidate(right, tz);
      }
    }

    if (bestDistSq === Infinity) return null;
    plan.set(unit, { x: bestCx, z: bestCz });
  }

  return plan;
}

function displaceUnits(world: World, plan: DisplacementPlan): void {
  for (const [unit, position] of plan) {
    unit.x = position.x;
    unit.z = position.z;
    unit.previousX = position.x;
    unit.previousZ = position.z;
    if (unit.pathPending) {
      world.pathQueue.cancel(unit.id);
      unit.pathPending = false;
    }
    unit.path = undefined;
    // Movement endpoints may be substituted targets or formation slots. Keep
    // their actual endpoint until the surviving order is repathed below.
    if (unit.order?.kind !== 'move' && unit.order?.kind !== 'attackMove') {
      unit.pathTarget = undefined;
    }
    unit.stuckTicks = 0;
    unit.stuckProgressX = position.x;
    unit.stuckProgressZ = position.z;
    unit.stuckLastCheckTick = world.tick;
  }

  world.spatialHash.clear();
  for (let i = 0; i < world.entities.length; i++) {
    const ent = world.entities[i];
    if (ent && ent.kind === 'unit') {
      world.spatialHash.insert(ent.id, ent.x, ent.z);
    }
  }
}

export function applyBuildCommand(world: World, cmd: BuildCommand): void {
  if (cmd.targetId !== undefined) {
    const building = world.entities[cmd.targetId];
    if (
      !building ||
      building.kind !== 'building' ||
      building.player !== cmd.player ||
      building.built
    ) {
      return;
    }

    for (let i = 0; i < cmd.ids.length; i++) {
      const unit = world.entities[cmd.ids[i]];
      if (
        !unit ||
        unit.kind !== 'unit' ||
        unit.player !== cmd.player ||
        unit.hp <= 0 ||
        !unit.tags.includes('worker')
      )
        continue;

      const order: UnitOrder = {
        kind: 'build',
        targetId: building.id,
        targetRef: building,
        x: building.x,
        z: building.z,
      };
      issueWorkOrder(world, unit, order, cmd.queued ?? false);
      if (unit.order === order) {
        approachTarget(world, unit, building);
      }
    }
    return;
  }

  const validation = validatePlacement(
    world,
    cmd.player,
    cmd.buildingType,
    cmd.x,
    cmd.z,
    cmd.orientation,
  );
  if (!validation.valid) {
    return;
  }

  const pState = world.players[cmd.player];
  const bData = getBuildingData(cmd.buildingType, pState.faction);
  if (!pState || !bData) return;

  const displacementPlan = planUnitDisplacements(
    world,
    cmd.x,
    cmd.z,
    validation.width,
    validation.height,
  );
  if (displacementPlan === null) return;

  pState.food -= bData.food;
  pState.gold -= bData.gold;

  const building = world.spawnBuilding(
    cmd.player,
    cmd.buildingType,
    cmd.x,
    cmd.z,
    false,
    cmd.orientation,
  );

  if (displacementPlan) displaceUnits(world, displacementPlan);

  for (let i = 0; i < cmd.ids.length; i++) {
    const unit = world.entities[cmd.ids[i]];
    if (
      !unit ||
      unit.kind !== 'unit' ||
      unit.player !== cmd.player ||
      unit.hp <= 0 ||
      !unit.tags.includes('worker')
    )
      continue;

    const order: UnitOrder = {
      kind: 'build',
      targetId: building.id,
      targetRef: building,
      x: building.x,
      z: building.z,
    };
    issueWorkOrder(world, unit, order, cmd.queued ?? false);
    if (unit.order === order) {
      approachTarget(world, unit, building);
    }
  }

  // Submit after builder orders are assigned, avoiding a redundant request for
  // any displaced mover whose active order was replaced by this build command.
  if (displacementPlan) {
    for (const unit of displacementPlan.keys()) {
      if (unit.order?.kind !== 'move' && unit.order?.kind !== 'attackMove')
        continue;
      const targetX = unit.pathTarget?.x ?? unit.formationSlotX ?? unit.order.x;
      const targetZ = unit.pathTarget?.z ?? unit.formationSlotZ ?? unit.order.z;
      if (targetX === undefined || targetZ === undefined) continue;
      unit.pathTarget ??= { x: targetX, z: targetZ };
      world.pathQueue.request(
        unit.id,
        unit.x,
        unit.z,
        targetX,
        targetZ,
        unit.player,
      );
      unit.pathPending = true;
    }
  }
}

export function applyRepairCommand(world: World, cmd: RepairCommand): void {
  const building = world.entities[cmd.targetId];
  if (
    !building ||
    building.kind !== 'building' ||
    building.player !== cmd.player
  ) {
    return;
  }
  if (!building.built || building.hp >= building.maxHp) {
    return;
  }

  for (let i = 0; i < cmd.ids.length; i++) {
    const unit = world.entities[cmd.ids[i]];
    if (
      !unit ||
      unit.kind !== 'unit' ||
      unit.player !== cmd.player ||
      unit.hp <= 0 ||
      !unit.tags.includes('worker')
    )
      continue;

    const order: UnitOrder = {
      kind: 'repair',
      targetId: building.id,
      targetRef: building,
      x: building.x,
      z: building.z,
    };
    issueWorkOrder(world, unit, order, cmd.queued ?? false);
    if (unit.order === order) {
      approachTarget(world, unit, building);
    }
  }
}

export function cancelConstruction(
  world: World,
  building: BuildingEntity,
): void {
  if (building.built || world.entities[building.id] !== building) {
    return;
  }

  const pState = world.players[building.player];
  const bData = getBuildingData(building.type, building.faction);
  if (pState && bData) {
    if (building.buildProgress === 0) {
      pState.food += bData.food;
      pState.gold += bData.gold;
    } else {
      pState.food += Math.floor(bData.food * 0.5);
      pState.gold += Math.floor(bData.gold * 0.5);
    }
  }

  const buildingId = building.id;
  world.removeEntity(buildingId);

  for (let i = 0; i < world.entities.length; i++) {
    const u = world.entities[i];
    if (
      u &&
      u.kind === 'unit' &&
      u.order &&
      (u.order.kind === 'build' || u.order.kind === 'repair')
    ) {
      if (u.order.targetId === buildingId || u.order.targetRef === building) {
        finishWorkOrder(world, u);
      }
    }
  }
}

interface BuildingWorkGroup {
  building: BuildingEntity;
  builders: UnitEntity[];
  repairers: UnitEntity[];
}

const MAX_ACTIVE_BUILDINGS = 64;
const workGroups: BuildingWorkGroup[] = Array.from(
  { length: MAX_ACTIVE_BUILDINGS },
  () => ({
    building: null as unknown as BuildingEntity,
    builders: [],
    repairers: [],
  }),
);
let workGroupsCount = 0;

export function updateConstruction(world: World): void {
  for (let i = 0; i < workGroupsCount; i++) {
    workGroups[i].builders.length = 0;
    workGroups[i].repairers.length = 0;
  }
  workGroupsCount = 0;

  for (let i = 0; i < world.entities.length; i++) {
    const unit = world.entities[i];
    if (!unit || unit.kind !== 'unit' || !unit.order) continue;

    const orderKind = unit.order.kind;
    if (orderKind !== 'build' && orderKind !== 'repair') continue;

    const target = isValidTarget(
      world,
      unit.order.targetId,
      unit.order.targetRef,
    );
    if (!target || target.kind !== 'building') {
      finishWorkOrder(world, unit);
      continue;
    }
    if (
      unit.hp <= 0 ||
      unit.player !== target.player ||
      !unit.tags.includes('worker')
    ) {
      finishWorkOrder(world, unit);
      continue;
    }

    if (orderKind === 'build' && target.built) {
      finishWorkOrder(world, unit);
      continue;
    }

    if (
      orderKind === 'repair' &&
      (!target.built || target.hp >= target.maxHp)
    ) {
      finishWorkOrder(world, unit);
      continue;
    }

    const arrived = approachTarget(world, unit, target);
    if (arrived) {
      unit.workAnimation = 'work';
      if (unit.workStartedTick === undefined) {
        unit.workStartedTick = world.tick;
      }

      let group: BuildingWorkGroup | undefined;
      for (let g = 0; g < workGroupsCount; g++) {
        if (workGroups[g].building.id === target.id) {
          group = workGroups[g];
          break;
        }
      }

      if (!group && workGroupsCount < MAX_ACTIVE_BUILDINGS) {
        group = workGroups[workGroupsCount++];
        group.building = target;
        group.builders.length = 0;
        group.repairers.length = 0;
      }

      if (group) {
        if (orderKind === 'build') {
          group.builders.push(unit);
        } else {
          group.repairers.push(unit);
        }
      }
    } else {
      unit.workAnimation = undefined;
    }
  }

  for (let g = 0; g < workGroupsCount; g++) {
    const group = workGroups[g];
    const building = group.building;
    if (world.entities[building.id] !== building) continue;

    const bData = getBuildingData(building.type, building.faction);
    const nominalT = bData ? bData.buildTime : 60;

    // Construction progress
    if (group.builders.length > 0 && !building.built) {
      const n = group.builders.length;
      // 3T / (n + 2) rule: progress per second = (n + 2) / (3 * T)
      const progressDelta = ((n + 2) / (3 * nominalT)) * SIM_DT;
      building.buildProgress = Math.min(
        1,
        building.buildProgress + progressDelta,
      );
      building.hp = Math.max(
        1,
        Math.min(
          building.maxHp,
          Math.floor(building.maxHp * building.buildProgress),
        ),
      );

      if (building.buildProgress >= 1) {
        world.completeBuilding(building);

        const isFarm =
          building.role === 'farm' ||
          building.type === 'farm' ||
          building.type === 'field';
        let autoAssignedFarmer = false;

        for (let b = 0; b < group.builders.length; b++) {
          const builder = group.builders[b];
          if (isFarm && !autoAssignedFarmer && builder.orders.length === 0) {
            autoAssignedFarmer = true;
            builder.order = {
              kind: 'farm',
              targetId: building.id,
              targetRef: building,
              x: building.x,
              z: building.z,
            };
            builder.orderGeneration++;
          } else {
            finishWorkOrder(world, builder);
          }
        }
      }
    }

    // Repair progress: free half-rate repair
    if (
      group.repairers.length > 0 &&
      building.built &&
      building.hp < building.maxHp
    ) {
      const n = group.repairers.length;
      // Half nominal build rate by HP fraction
      const hpDelta =
        0.5 * ((n + 2) / (3 * nominalT)) * building.maxHp * SIM_DT;
      building.hp = Math.min(building.maxHp, building.hp + hpDelta);

      if (building.hp >= building.maxHp) {
        building.hp = building.maxHp;
        for (let r = 0; r < group.repairers.length; r++) {
          finishWorkOrder(world, group.repairers[r]);
        }
      }
    }
  }
}
