import { getBuildingData } from '../../data/buildings.js';
import { FACTIONS } from '../../data/factions.js';
import { getUnitData } from '../../data/units.js';
import type { Command } from '../commands.js';
import type { BuildingEntity, UnitEntity } from '../entity.js';
import { isDropOff } from '../systems/economy.js';
import { getTrainAvailability } from '../systems/production.js';
import {
  getResearchAvailability,
  getResearchDefinition,
} from '../systems/research.js';
import type { World } from '../world.js';
import type { BuildOrder, BuildStep } from './buildOrder.js';
import type { AiParams } from './difficulty.js';
import type { AiView } from './perception.js';
import { findBuildSite, getGatherPoint } from './sitePlanner.js';

export interface AiContext {
  world: World;
  player: number;
  params: AiParams;
  order: BuildOrder;
  view: AiView;
  budget: { food: number; gold: number };
  reserve?: { food: number; gold: number };
  issue: (cmd: Command) => void;
}

type Position = { x: number; z: number };
type Cost = { food: number; gold: number };
type PlannedBuilding = Position & {
  type: string;
  width: number;
  height: number;
};

function distanceSquared(a: Position, b: Position): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function centre(building: {
  x: number;
  z: number;
  width: number;
  height: number;
}): Position {
  return {
    x: building.x + building.width / 2,
    z: building.z + building.height / 2,
  };
}

function canAfford(ctx: AiContext, cost: Cost): boolean {
  return ctx.budget.food >= cost.food && ctx.budget.gold >= cost.gold;
}

function spend(ctx: AiContext, cost: Cost): void {
  ctx.budget.food -= cost.food;
  ctx.budget.gold -= cost.gold;
}

function isIdle(unit: UnitEntity): boolean {
  return !unit.order || unit.order.kind === 'idle';
}

function offsetAnchor(
  world: World,
  townCenter: BuildingEntity,
  distance: number,
): Position {
  const origin = centre(townCenter);
  const dx = world.map.size / 2 - origin.x;
  const dz = world.map.size / 2 - origin.z;
  const length = Math.hypot(dx, dz);
  return {
    x: origin.x + (length > 0 ? dx / length : 1) * distance,
    z: origin.z + (length > 0 ? dz / length : 0) * distance,
  };
}

function firstUnstartedStep(ctx: AiContext): BuildStep | undefined {
  const occurrences = new Map<string, number>();
  for (const step of ctx.order.steps) {
    if (step.kind === 'build') {
      const count = (occurrences.get(step.buildingType) ?? 0) + 1;
      occurrences.set(step.buildingType, count);
      if ((ctx.view.buildings[step.buildingType]?.length ?? 0) < count) {
        return step;
      }
    } else {
      const targetAge = getResearchDefinition(
        ctx.order.faction,
        step.upgradeId,
      )?.targetAge;
      if (
        (targetAge === undefined ||
          ctx.world.players[ctx.player].age < targetAge) &&
        ctx.view.townCenter?.research?.upgradeId !== step.upgradeId
      ) {
        return step;
      }
    }
  }
  return undefined;
}

function chooseBuilder(
  peasants: readonly UnitEntity[],
  position: Position,
  assigned: ReadonlySet<number>,
): UnitEntity | null {
  let idle: UnitEntity | null = null;
  let builder: UnitEntity | null = null;
  let idleDistance = Infinity;
  let builderDistance = Infinity;
  for (const peasant of peasants) {
    if (assigned.has(peasant.id)) continue;
    const distance = distanceSquared(peasant, position);
    if (isIdle(peasant)) {
      if (
        distance < idleDistance ||
        (distance === idleDistance && idle && peasant.id < idle.id)
      ) {
        idle = peasant;
        idleDistance = distance;
      }
    } else if (peasant.order?.kind === 'build') {
      if (
        distance < builderDistance ||
        (distance === builderDistance && builder && peasant.id < builder.id)
      ) {
        builder = peasant;
        builderDistance = distance;
      }
    }
  }
  return idle ?? builder;
}

function placeBuilding(
  ctx: AiContext,
  buildingType: string,
  anchor: Position,
  minRadius: number,
  maxRadius: number,
  assigned: Set<number>,
  planned: PlannedBuilding[],
): void {
  const data = getBuildingData(buildingType, ctx.order.faction);
  if (!data || !canAfford(ctx, data)) return;

  for (let radius = minRadius; radius <= maxRadius; radius++) {
    const site = findBuildSite(
      ctx.world,
      ctx.player,
      buildingType,
      anchor.x,
      anchor.z,
      radius,
      radius,
    );
    if (!site) continue;
    // Issued placements have not reached the grid yet; preserve their margins too.
    if (
      planned.some(
        (other) =>
          site.x < other.x + other.width + 1 &&
          site.x + data.width + 1 > other.x &&
          site.z < other.z + other.height + 1 &&
          site.z + data.height + 1 > other.z,
      )
    ) {
      continue;
    }
    const builder = chooseBuilder(
      ctx.view.peasants,
      { x: site.x + data.width / 2, z: site.z + data.height / 2 },
      assigned,
    );
    if (!builder) return;
    ctx.issue({
      kind: 'build',
      player: ctx.player,
      ids: [builder.id],
      buildingType,
      x: site.x,
      z: site.z,
      queued: false,
    });
    spend(ctx, data);
    assigned.add(builder.id);
    planned.push({
      ...site,
      type: buildingType,
      width: data.width,
      height: data.height,
    });
    return;
  }
}

export function runEconomy(ctx: AiContext): void {
  const { world, player, params, view } = ctx;
  const state = world.players[player];
  const ids = FACTIONS[ctx.order.faction];
  const townCenter = view.townCenter;
  const assigned = new Set<number>();
  const planned: PlannedBuilding[] = [];
  const buildings = Object.values(view.buildings).flat();
  const peasants = view.peasants.length;
  const carts = view.carts.length;
  const farmTarget = peasants - Math.ceil(peasants / 4);
  const farms = view.buildings[ids.farmId] ?? [];
  const nextStep = firstUnstartedStep(ctx);
  const nextResearch =
    nextStep?.kind === 'research'
      ? getResearchDefinition(ctx.order.faction, nextStep.upgradeId)
      : undefined;

  // 1. Housing stays behind the Town Center, away from the military approach.
  let queuedPop = 0;
  for (const building of buildings) queuedPop += building.trainingQueue.length;
  if (
    townCenter &&
    state.popCap < 150 &&
    state.pop + queuedPop >= state.popCap - params.housingMargin &&
    !(view.buildings[ids.housingId] ?? []).some((building) => !building.built)
  ) {
    placeBuilding(
      ctx,
      ids.housingId,
      offsetAnchor(world, townCenter, -6),
      2,
      12,
      assigned,
      planned,
    );
  }

  // 2. Keep the Town Center free for an affordable, eligible age transition.
  if (
    townCenter?.built &&
    !townCenter.research &&
    townCenter.trainingQueue.length === 0 &&
    !(
      nextStep &&
      peasants >= nextStep.minPeasants &&
      nextResearch &&
      canAfford(ctx, nextResearch)
    )
  ) {
    let unitType: string | undefined;
    if (carts < params.targetCarts && carts * 3 < peasants) {
      unitType = ids.cartId;
    } else if (peasants < params.targetPeasants) {
      unitType = ids.workerId;
    } else if (carts < params.targetCarts) {
      unitType = ids.cartId;
    }
    const data = unitType
      ? getUnitData(unitType, ctx.order.faction)
      : undefined;
    if (
      data &&
      canAfford(ctx, data) &&
      getTrainAvailability(world, player, townCenter.id, data.id).allowed
    ) {
      ctx.issue({
        kind: 'train',
        player,
        buildingId: townCenter.id,
        unitType: data.id,
      });
      spend(ctx, data);
    }
  }

  // 3. Leave one quarter of the peasants available for construction.
  if (
    townCenter &&
    farms.length < farmTarget &&
    !farms.some((farm) => !farm.built)
  ) {
    placeBuilding(
      ctx,
      ids.farmId,
      centre(townCenter),
      3,
      14,
      assigned,
      planned,
    );
  }

  // 4. Only the first unstarted build-order step may claim resources.
  if (nextStep) {
    const cost =
      nextStep.kind === 'build'
        ? getBuildingData(nextStep.buildingType, ctx.order.faction)
        : nextResearch;
    if (cost && !canAfford(ctx, cost)) {
      ctx.reserve = { food: cost.food, gold: cost.gold };
    } else if (cost && peasants >= nextStep.minPeasants) {
      if (nextStep.kind === 'build' && townCenter) {
        const faithSite = nextStep.buildingType === ids.categoryMapping.faith;
        placeBuilding(
          ctx,
          nextStep.buildingType,
          faithSite
            ? getGatherPoint(world, player, townCenter)
            : offsetAnchor(world, townCenter, 8),
          2,
          faithSite ? 6 : 14,
          assigned,
          planned,
        );
      } else if (
        nextStep.kind === 'research' &&
        townCenter &&
        getResearchAvailability(
          world,
          player,
          townCenter.id,
          nextStep.upgradeId,
        ).allowed
      ) {
        ctx.issue({
          kind: 'research',
          player,
          buildingId: townCenter.id,
          upgradeId: nextStep.upgradeId,
        });
        spend(ctx, cost);
      }
    }
  }

  // 5. Expand drop-offs only when fewer than two explored mines are nearby.
  const dropOffs = buildings.filter(isDropOff);
  const exploredMines = view.mines.filter(
    (mine) => mine.explored && mine.goldRemaining > 0,
  );
  if (
    townCenter &&
    !(view.buildings[ids.categoryMapping.storehouse] ?? []).some(
      (building) => !building.built,
    ) &&
    !planned.some(
      (building) => building.type === ids.categoryMapping.storehouse,
    )
  ) {
    const origin = centre(townCenter);
    const nearDistance = params.farStorehouseDistance ** 2;
    let nearMines = 0;
    let fartherMine: (typeof exploredMines)[number] | null = null;
    let fartherDistance = Infinity;
    for (const mine of exploredMines) {
      const position = centre(mine);
      let dropOffDistance = Infinity;
      for (const dropOff of dropOffs) {
        dropOffDistance = Math.min(
          dropOffDistance,
          distanceSquared(position, centre(dropOff)),
        );
      }
      if (dropOffDistance <= nearDistance) {
        nearMines++;
      } else {
        const distance = distanceSquared(origin, position);
        if (
          distance < fartherDistance ||
          (distance === fartherDistance &&
            fartherMine &&
            mine.id < fartherMine.id)
        ) {
          fartherMine = mine;
          fartherDistance = distance;
        }
      }
    }
    if (nearMines < 2 && fartherMine) {
      placeBuilding(
        ctx,
        ids.categoryMapping.storehouse,
        centre(fartherMine),
        2,
        6,
        assigned,
        planned,
      );
    }
  }

  // 6. All placements above claim one distinct idle peasant or existing builder.
  // 7. Idle peasants fill distinct free farms before joining unfinished buildings.
  const workedFarms = new Set<number>();
  let farmerCount = 0;
  for (const units of [view.peasants, view.carts, view.army]) {
    for (const unit of units) {
      if (unit.order?.kind !== 'farm') continue;
      farmerCount++;
      if (unit.order.targetId !== undefined)
        workedFarms.add(unit.order.targetId);
    }
  }
  for (const peasant of view.peasants) {
    if (assigned.has(peasant.id) || !isIdle(peasant)) continue;
    let farm: BuildingEntity | null = null;
    let farmDistance = Infinity;
    if (farmerCount < farmTarget) {
      for (const candidate of farms) {
        if (!candidate.built || workedFarms.has(candidate.id)) continue;
        const distance = distanceSquared(peasant, centre(candidate));
        if (
          distance < farmDistance ||
          (distance === farmDistance && farm && candidate.id < farm.id)
        ) {
          farm = candidate;
          farmDistance = distance;
        }
      }
    }
    if (farm) {
      ctx.issue({
        kind: 'farm',
        player,
        ids: [peasant.id],
        targetId: farm.id,
        queued: false,
      });
      assigned.add(peasant.id);
      workedFarms.add(farm.id);
      farmerCount++;
      continue;
    }
    let unfinished: BuildingEntity | null = null;
    let unfinishedDistance = Infinity;
    for (const candidate of buildings) {
      if (candidate.built) continue;
      const distance = distanceSquared(peasant, centre(candidate));
      if (
        distance < unfinishedDistance ||
        (distance === unfinishedDistance &&
          unfinished &&
          candidate.id < unfinished.id)
      ) {
        unfinished = candidate;
        unfinishedDistance = distance;
      }
    }
    if (unfinished) {
      ctx.issue({
        kind: 'build',
        player,
        ids: [peasant.id],
        buildingType: unfinished.type,
        x: unfinished.x,
        z: unfinished.z,
        targetId: unfinished.id,
        queued: false,
      });
      assigned.add(peasant.id);
    }
  }

  // 8. Prefer short mine-to-drop-off routes, with a soft cap of three carts.
  const completedDropOffs = dropOffs.filter((dropOff) => dropOff.built);
  if (completedDropOffs.length === 0 || exploredMines.length === 0) return;
  const mineDistances = new Map<number, number>();
  const mineCarts = new Map<number, number>();
  for (const mine of exploredMines) {
    let distance = Infinity;
    for (const dropOff of completedDropOffs) {
      distance = Math.min(
        distance,
        distanceSquared(centre(mine), centre(dropOff)),
      );
    }
    mineDistances.set(mine.id, distance);
    let count = 0;
    for (const cart of view.carts) {
      if (cart.cart?.mineId === mine.id || cart.cart?.pinnedMineId === mine.id)
        count++;
    }
    mineCarts.set(mine.id, count);
  }
  for (const cart of view.carts) {
    if (
      cart.cart?.phase !== 'idle' &&
      !(!cart.cart && cart.orderGeneration > 0 && isIdle(cart))
    ) {
      continue;
    }
    let mine: (typeof exploredMines)[number] | null = null;
    let bestDistance = Infinity;
    let capped = true;
    for (const candidate of exploredMines) {
      const candidateCapped = (mineCarts.get(candidate.id) ?? 0) >= 3;
      const distance = mineDistances.get(candidate.id)!;
      if (
        (capped && !candidateCapped) ||
        (capped === candidateCapped &&
          (distance < bestDistance ||
            (distance === bestDistance && mine && candidate.id < mine.id)))
      ) {
        mine = candidate;
        bestDistance = distance;
        capped = candidateCapped;
      }
    }
    if (!mine) continue;
    ctx.issue({
      kind: 'pinMine',
      player,
      ids: [cart.id],
      targetId: mine.id,
      queued: false,
    });
    const oldMine = cart.cart?.mineId;
    const oldPinned = cart.cart?.pinnedMineId;
    if (oldMine !== undefined) {
      mineCarts.set(oldMine, (mineCarts.get(oldMine) ?? 0) - 1);
    }
    if (oldPinned !== undefined && oldPinned !== oldMine) {
      mineCarts.set(oldPinned, (mineCarts.get(oldPinned) ?? 0) - 1);
    }
    const activeMine = (cart.cart?.carriedGold ?? 0) > 0 ? oldMine : mine.id;
    if (activeMine !== undefined) {
      mineCarts.set(activeMine, (mineCarts.get(activeMine) ?? 0) + 1);
    }
    if (mine.id !== activeMine) {
      mineCarts.set(mine.id, (mineCarts.get(mine.id) ?? 0) + 1);
    }
  }
}
