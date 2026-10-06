import type { World } from '../world.js';
import type { BuildingEntity } from '../entity.js';
import type { TrainCommand, CancelTrainCommand } from '../commands.js';
import { getUnitData } from '../../data/units.js';

export const SIM_DT = 0.05;

/**
 * Checks whether a candidate position is blocked by another live unit.
 */
function isPositionBlockedByUnit(
  world: World,
  px: number,
  pz: number,
  radius: number,
): boolean {
  // Query spatial hash first if populated
  const nearby = world.spatialHash.queryNearby(px, pz, radius + 1.0);
  if (nearby.length > 0) {
    for (let i = 0; i < nearby.length; i++) {
      const u = world.entities[nearby[i]];
      if (u && u.kind === 'unit' && u.hp > 0) {
        const dx = u.x - px;
        const dz = u.z - pz;
        const minDist = radius + u.radius;
        if (dx * dx + dz * dz < (minDist - 1e-4) * (minDist - 1e-4)) {
          return true;
        }
      }
    }
  }

  // Fallback to checking living units directly for tests or when spatial hash is unpopulated
  for (let i = 0; i < world.entities.length; i++) {
    const u = world.entities[i];
    if (u && u.kind === 'unit' && u.hp > 0) {
      const dx = u.x - px;
      const dz = u.z - pz;
      const minDist = radius + u.radius;
      if (dx * dx + dz * dz < (minDist - 1e-4) * (minDist - 1e-4)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Finds a collision-safe spawn position on the perimeter of a building.
 *
 * Expands in rings (d = 1..5) around the building footprint.
 * Prefers tiles closest to the building's rally point if set, or closest
 * to the south perimeter by default.
 */
export function findSpawnPosition(
  world: World,
  building: BuildingEntity,
  unitRadius: number,
): { x: number; z: number } | undefined {
  const mapSize = world.map.size;
  const targetX = building.rallyPoint?.x ?? building.x + building.width * 0.5;
  const targetZ = building.rallyPoint?.z ?? building.z + building.height + 0.5;

  let fallbackPassable: { x: number; z: number; distSq: number } | undefined;

  for (let d = 1; d <= 5; d++) {
    const minTx = building.x - d;
    const maxTx = building.x + building.width - 1 + d;
    const minTz = building.z - d;
    const maxTz = building.z + building.height - 1 + d;

    const candidates: { x: number; z: number; distSq: number }[] = [];

    // Perimeter tiles of ring d
    for (let tx = minTx; tx <= maxTx; tx++) {
      for (let tz = minTz; tz <= maxTz; tz++) {
        // Only evaluate outer boundary of the current ring d
        const isBorder =
          tx === minTx || tx === maxTx || tz === minTz || tz === maxTz;
        if (!isBorder) continue;

        if (tx < 0 || tx >= mapSize || tz < 0 || tz >= mapSize) {
          continue;
        }

        const px = tx + 0.5;
        const pz = tz + 0.5;

        if (!world.grid.canOccupy(px, pz, unitRadius, building.player)) {
          continue;
        }

        const distSq = (px - targetX) ** 2 + (pz - targetZ) ** 2;

        if (!fallbackPassable || distSq < fallbackPassable.distSq) {
          fallbackPassable = { x: px, z: pz, distSq };
        }

        if (!isPositionBlockedByUnit(world, px, pz, unitRadius)) {
          candidates.push({ x: px, z: pz, distSq });
        }
      }
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => a.distSq - b.distSq);
      return { x: candidates[0].x, z: candidates[0].z };
    }
  }

  // If all passable perimeter tiles within 5 rings are crowded with units,
  // use the best passable tile rather than deadlock forever.
  if (fallbackPassable) {
    return { x: fallbackPassable.x, z: fallbackPassable.z };
  }

  return undefined;
}

/**
 * Validates and queues a unit training command.
 *
 * Enforces:
 * - Completed living building owned by player
 * - Max queue capacity of 5
 * - Unit data table matches faction, age, building type ('from')
 * - Player has sufficient food and gold
 * - Deducts cost immediately upon queueing
 */
export function applyTrainCommand(world: World, cmd: TrainCommand): boolean {
  const player = world.players[cmd.player];
  if (!player || player.eliminated) {
    return false;
  }

  const building = world.getEntity(cmd.buildingId);
  if (
    !building ||
    building.kind !== 'building' ||
    building.player !== cmd.player ||
    !building.built ||
    building.hp <= 0
  ) {
    return false;
  }

  building.trainingQueue = building.trainingQueue ?? [];
  if (building.trainingQueue.length >= 5) {
    return false;
  }

  const unitData = getUnitData(cmd.unitType, building.faction);
  if (!unitData) {
    return false;
  }

  // Faction validation
  if (
    unitData.faction !== player.faction ||
    unitData.faction !== building.faction
  ) {
    return false;
  }

  // Age validation
  if (unitData.age > player.age) {
    return false;
  }

  // Building validation: unitData.from must match building type
  if (unitData.from !== building.type) {
    return false;
  }

  // Resource validation
  if (player.food < unitData.food || player.gold < unitData.gold) {
    return false;
  }

  // Deduct resources
  player.food -= unitData.food;
  player.gold -= unitData.gold;

  // Add to training queue
  building.trainingQueue.push({
    unitType: cmd.unitType,
    progress: 0,
    food: unitData.food,
    gold: unitData.gold,
  });

  return true;
}

/**
 * Cancels a training queue item with 100% resource refund.
 *
 * If slotIndex is omitted, cancels the last item in the queue.
 */
export function applyCancelTrainCommand(
  world: World,
  cmd: CancelTrainCommand,
): boolean {
  const player = world.players[cmd.player];
  if (!player) {
    return false;
  }

  const building = world.getEntity(cmd.buildingId);
  if (
    !building ||
    building.kind !== 'building' ||
    building.player !== cmd.player ||
    !building.trainingQueue ||
    building.trainingQueue.length === 0
  ) {
    return false;
  }

  let targetIndex: number;
  if (cmd.slotIndex !== undefined) {
    if (cmd.slotIndex < 0 || cmd.slotIndex >= building.trainingQueue.length) {
      return false;
    }
    targetIndex = cmd.slotIndex;
  } else {
    targetIndex = building.trainingQueue.length - 1;
  }

  const [removed] = building.trainingQueue.splice(targetIndex, 1);
  if (removed) {
    player.food += removed.food;
    player.gold += removed.gold;
    return true;
  }

  return false;
}

/**
 * Advances unit production for all buildings in the world.
 *
 * Rules:
 * - Cap pause: if adding the unit would exceed popCap, training progress pauses.
 * - Low Faith: if player.lowFaith is true, progress is halved (0.025s / tick vs 0.05s / tick).
 * - On completion, spawns collision-safe on the building perimeter.
 * - If building has a rally point, issues a ground move order.
 */
export function updateProduction(world: World): void {
  for (let i = 0; i < world.entities.length; i++) {
    const building = world.entities[i];
    if (
      !building ||
      building.kind !== 'building' ||
      !building.built ||
      building.hp <= 0 ||
      !building.trainingQueue ||
      building.trainingQueue.length === 0
    ) {
      continue;
    }

    const player = world.players[building.player];
    if (!player || player.eliminated) {
      continue;
    }

    const item = building.trainingQueue[0];
    const unitData = getUnitData(item.unitType, building.faction);
    if (!unitData) {
      building.trainingQueue.shift();
      continue;
    }

    // Population cap pause
    if (player.pop + unitData.pop > player.popCap) {
      continue;
    }

    // Advance progress (halved if in Low Faith state)
    const progressDelta = player.lowFaith ? SIM_DT * 0.5 : SIM_DT;
    item.progress += progressDelta;

    // Check completion
    if (item.progress >= unitData.trainTime - 1e-6) {
      const spawnPos = findSpawnPosition(world, building, unitData.radius);
      if (!spawnPos) {
        // Paused at completion if no passable tile is currently available
        item.progress = unitData.trainTime;
        continue;
      }

      // Pop from queue
      building.trainingQueue.shift();

      // Spawn unit
      const unit = world.spawnUnit(
        building.player,
        item.unitType,
        spawnPos.x,
        spawnPos.z,
        building.faction,
      );

      // Apply ground rally if set
      if (building.rallyPoint) {
        const rx = building.rallyPoint.x;
        const rz = building.rallyPoint.z;
        unit.order = { kind: 'move', x: rx, z: rz };
        unit.orders = [];
        unit.orderGeneration++;
        unit.formationSlotX = undefined;
        unit.formationSlotZ = undefined;
        unit.path = undefined;
        unit.pathTarget = undefined;
        world.pathQueue.cancel(unit.id);
        world.pathQueue.request(unit.id, unit.x, unit.z, rx, rz, unit.player);
        unit.pathPending = true;
      }
    }
  }
}
