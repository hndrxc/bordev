import { isProductionType, isTownCenterType } from '../../data/roles.js';
import type { UnitData } from '../../data/types.js';
import { getUnitData } from '../../data/units.js';
import type { BuildingEntity, UnitEntity } from '../entity.js';
import { isPositionVisibleTo } from '../systems/fog.js';
import { getTrainAvailability } from '../systems/production.js';
import type { AiContext } from './economyManager.js';
import { getGatherPoint } from './sitePlanner.js';

type Point = { x: number; z: number };
type AttackTarget = Point & { id?: number };

function distanceSquared(
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  return (ax - bx) ** 2 + (az - bz) ** 2;
}

export class MilitaryManager {
  private mode: 'gather' | 'attack' = 'gather';
  private readonly wave = new Set<number>();
  private readonly retreating = new Set<number>();
  private readonly unitRefs = new Map<number, UnitEntity>();
  private target: AttackTarget | null = null;

  update(ctx: AiContext): void {
    this.prune(ctx);
    const gather = getGatherPoint(ctx.world, ctx.player, ctx.view.townCenter);
    const townCenter = ctx.view.townCenter;
    const homeX = townCenter ? townCenter.x + townCenter.width / 2 : gather.x;
    const homeZ = townCenter ? townCenter.z + townCenter.height / 2 : gather.z;

    this.updateProduction(ctx, gather);

    let availableArmy = 0;
    const retreatIds: number[] = [];
    for (const unit of ctx.view.army) {
      if (
        this.wave.has(unit.id) &&
        unit.hp < ctx.params.retreatHpFraction * unit.maxHp
      ) {
        this.wave.delete(unit.id);
        this.retreating.add(unit.id);
        this.unitRefs.set(unit.id, unit);
        retreatIds.push(unit.id);
      }
      if (
        this.retreating.has(unit.id) &&
        unit.hp >= ctx.params.rejoinHpFraction * unit.maxHp
      ) {
        this.retreating.delete(unit.id);
        this.unitRefs.delete(unit.id);
      }
      if (!this.retreating.has(unit.id)) availableArmy++;
    }
    this.attackMoveOrMove(ctx, 'move', retreatIds, gather);

    const threat = this.findThreat(ctx, homeX, homeZ);
    if (threat) {
      const defenders: number[] = [];
      for (const unit of ctx.view.army) {
        if (
          this.wave.has(unit.id) &&
          distanceSquared(unit.x, unit.z, homeX, homeZ) <= 30 ** 2
        ) {
          continue;
        }
        const order = unit.order;
        if (
          order?.kind === 'attackMove' &&
          order.x !== undefined &&
          order.z !== undefined &&
          distanceSquared(order.x, order.z, threat.x, threat.z) <= 5 ** 2
        ) {
          continue;
        }
        defenders.push(unit.id);
      }
      this.attackMoveOrMove(ctx, 'attackMove', defenders, threat);
    }

    if (this.mode === 'gather') {
      if (
        !threat &&
        (availableArmy >= ctx.params.attackArmySize ||
          (ctx.world.tick >= ctx.params.firstAttackTick && availableArmy > 0))
      ) {
        this.mode = 'attack';
        const ids: number[] = [];
        for (const unit of ctx.view.army) {
          if (this.retreating.has(unit.id)) continue;
          this.wave.add(unit.id);
          this.unitRefs.set(unit.id, unit);
          ids.push(unit.id);
        }
        this.target = this.chooseTarget(ctx, gather);
        this.attackMoveOrMove(ctx, 'attackMove', ids, this.target);
      }
      return;
    }

    if (this.wave.size < ctx.params.minWaveSize) {
      this.mode = 'gather';
      const ids: number[] = [];
      for (const unit of ctx.view.army) {
        if (!this.wave.has(unit.id)) continue;
        ids.push(unit.id);
        this.unitRefs.delete(unit.id);
      }
      this.attackMoveOrMove(ctx, 'attackMove', ids, gather);
      this.wave.clear();
      this.target = null;
      return;
    }

    this.updateTarget(ctx, gather);
    const target = this.target!;
    const idle: number[] = [];
    const siegeUnits: number[] = [];
    const reinforcements: UnitEntity[] = [];
    for (const unit of ctx.view.army) {
      if (!this.wave.has(unit.id)) {
        if (
          !this.retreating.has(unit.id) &&
          distanceSquared(unit.x, unit.z, gather.x, gather.z) <= 8 ** 2
        ) {
          reinforcements.push(unit);
        }
        continue;
      }
      if (unit.tags.includes('siege') && target.id !== undefined) {
        siegeUnits.push(unit.id);
        continue;
      }
      const orderKind = unit.order?.kind ?? 'idle';
      // Combat owns target liveness. Never inspect a hostile target reference.
      if (
        (orderKind === 'idle' || orderKind === 'stop') &&
        !unit.combat?.targetRef
      ) {
        idle.push(unit.id);
      }
    }
    this.attackMoveOrMove(ctx, 'attackMove', idle, target);
    if (siegeUnits.length > 0 && target.id !== undefined) {
      ctx.issue({
        kind: 'attack',
        player: ctx.player,
        ids: siegeUnits,
        targetId: target.id,
        queued: false,
      });
    }
    if (reinforcements.length >= ctx.params.reinforceSize) {
      const ids: number[] = [];
      for (const unit of reinforcements) {
        this.wave.add(unit.id);
        this.unitRefs.set(unit.id, unit);
        ids.push(unit.id);
      }
      this.attackMoveOrMove(ctx, 'attackMove', ids, target);
    }
  }

  private prune(ctx: AiContext): void {
    for (const [id, unit] of this.unitRefs) {
      if (
        ctx.world.getEntity(id) !== unit ||
        unit.hp <= 0 ||
        unit.player !== ctx.player
      ) {
        this.wave.delete(id);
        this.retreating.delete(id);
        this.unitRefs.delete(id);
      }
    }
  }

  private updateProduction(ctx: AiContext, gather: Point): void {
    const buildings: BuildingEntity[] = [];
    const alive: Record<string, number> = {};
    const queued: Record<string, number> = {};
    for (const unit of ctx.view.army) {
      alive[unit.type] = (alive[unit.type] ?? 0) + 1;
    }
    for (const type in ctx.view.buildings) {
      if (!isProductionType(type) || isTownCenterType(type)) continue;
      for (const building of ctx.view.buildings[type]) {
        for (const item of building.trainingQueue) {
          queued[item.unitType] = (queued[item.unitType] ?? 0) + 1;
        }
        if (building.built) buildings.push(building);
      }
    }
    buildings.sort((a, b) => a.id - b.id);
    for (const building of buildings) {
      if (building.rallyPoint !== undefined) continue;
      ctx.issue({
        kind: 'setRally',
        player: ctx.player,
        buildingId: building.id,
        x: gather.x,
        z: gather.z,
      });
    }

    const player = ctx.world.players[ctx.player];
    const weights = ctx.order.army[player.age];
    if (!weights) return;
    for (const building of buildings) {
      if (building.trainingQueue.length >= 2 || building.research) continue;
      let chosen: UnitData | undefined;
      let bestRatio = Infinity;
      for (const type in weights) {
        const data = getUnitData(type, player.faction);
        if (!data || data.from !== building.type) continue;
        const count = alive[type] ?? 0;
        const maxAlive = ctx.order.maxAlive[type];
        // Include committed training so simultaneous queues cannot exceed a cap.
        if (maxAlive !== undefined && count + (queued[type] ?? 0) >= maxAlive) {
          continue;
        }
        if (
          ctx.budget.food - (ctx.reserve?.food ?? 0) < data.food ||
          ctx.budget.gold - (ctx.reserve?.gold ?? 0) < data.gold ||
          !getTrainAvailability(ctx.world, ctx.player, building.id, type)
            .allowed
        ) {
          continue;
        }
        const ratio = count / weights[type];
        if (ratio < bestRatio) {
          chosen = data;
          bestRatio = ratio;
        }
      }
      if (!chosen) continue;
      ctx.budget.food -= chosen.food;
      ctx.budget.gold -= chosen.gold;
      queued[chosen.id] = (queued[chosen.id] ?? 0) + 1;
      ctx.issue({
        kind: 'train',
        player: ctx.player,
        buildingId: building.id,
        unitType: chosen.id,
      });
    }
  }

  private findThreat(
    ctx: AiContext,
    homeX: number,
    homeZ: number,
  ): UnitEntity | null {
    let nearest: UnitEntity | null = null;
    let nearestDistance = Infinity;
    const radiusSquared = ctx.params.defendRadius ** 2;
    for (const enemy of ctx.view.visibleEnemyUnits) {
      let threatensBuilding = false;
      for (const type in ctx.view.buildings) {
        for (const building of ctx.view.buildings[type]) {
          if (
            distanceSquared(
              enemy.x,
              enemy.z,
              building.x + building.width / 2,
              building.z + building.height / 2,
            ) <= radiusSquared
          ) {
            threatensBuilding = true;
            break;
          }
        }
        if (threatensBuilding) break;
      }
      if (!threatensBuilding) continue;
      const distance = distanceSquared(enemy.x, enemy.z, homeX, homeZ);
      if (distance < nearestDistance) {
        nearest = enemy;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  private updateTarget(ctx: AiContext, gather: Point): void {
    const target = this.target;
    if (target) {
      for (const building of ctx.view.knownEnemyBuildings) {
        if (
          building.x + building.width / 2 === target.x &&
          building.z + building.height / 2 === target.z
        ) {
          // A hidden building remains a coordinate target, never a live id.
          if (building.id === undefined) delete target.id;
          else target.id = building.id;
          return;
        }
      }
      if (!isPositionVisibleTo(ctx.world, ctx.player, target.x, target.z)) {
        delete target.id;
        return;
      }
    }
    this.target = this.chooseTarget(ctx, gather);
  }

  private chooseTarget(ctx: AiContext, gather: Point): AttackTarget {
    let centroidX = 0;
    let centroidZ = 0;
    let count = 0;
    for (const unit of ctx.view.army) {
      if (!this.wave.has(unit.id)) continue;
      centroidX += unit.x;
      centroidZ += unit.z;
      count++;
    }
    centroidX = count > 0 ? centroidX / count : gather.x;
    centroidZ = count > 0 ? centroidZ / count : gather.z;

    let target: AttackTarget | null = null;
    let nearestDistance = Infinity;
    for (const building of ctx.view.knownEnemyBuildings) {
      const x = building.x + building.width / 2;
      const z = building.z + building.height / 2;
      const distance = distanceSquared(x, z, centroidX, centroidZ);
      if (distance < nearestDistance) {
        target = { x, z };
        if (building.id !== undefined) target.id = building.id;
        nearestDistance = distance;
      }
    }
    if (target) return target;

    const size = ctx.world.map.size;
    const explored = ctx.world.players[ctx.player].explored;
    for (const [startX, startZ] of ctx.view.enemyStarts) {
      const x = startX + 2;
      const z = startZ + 2;
      // Known buildings already take priority, including any at explored starts.
      if (explored[Math.floor(z) * size + Math.floor(x)] === 1) {
        continue;
      }
      const distance = distanceSquared(x, z, centroidX, centroidZ);
      if (distance < nearestDistance) {
        target = { x, z };
        nearestDistance = distance;
      }
    }
    if (target) return target;

    for (let j = 1; j <= 3; j++) {
      for (let i = 1; i <= 3; i++) {
        const x = (size * i) / 4;
        const z = (size * j) / 4;
        if (explored[Math.floor(z) * size + Math.floor(x)] !== 1) {
          return { x, z };
        }
      }
    }
    const index = Math.floor(ctx.world.tick / ctx.params.decisionInterval) % 9;
    return {
      x: (size * ((index % 3) + 1)) / 4,
      z: (size * (Math.floor(index / 3) + 1)) / 4,
    };
  }

  private attackMoveOrMove(
    ctx: AiContext,
    kind: 'attackMove' | 'move',
    ids: number[],
    point: Point,
  ): void {
    if (ids.length === 0) return;
    ctx.issue({
      kind,
      player: ctx.player,
      ids,
      x: point.x,
      z: point.z,
      queued: false,
    });
  }
}
