import type { Faction } from '../data/types.js';
import { getUnitData } from '../data/units.js';
import { getBuildingData } from '../data/buildings.js';
import type { GameMap } from './map.js';
import { Grid } from './grid.js';
import { Rng } from './rng.js';
import { SpatialHash } from './spatialHash.js';
import { PathQueue } from './path/pathQueue.js';
import type {
  Entity,
  UnitEntity,
  BuildingEntity,
  MineEntity,
  DoodadEntity,
} from './entity.js';
import type { SimEvent } from './commands.js';

export interface PlayerState {
  id: number;
  faction: Faction;
  team: number;
  age: 1 | 2 | 3;
  food: number;
  gold: number;
  foodCollected: number;
  goldCollected: number;
  faithProduced: number;
  faithUsed: number;
  lowFaith: boolean;
  pop: number;
  popCap: number;
  eliminated: boolean;
  explored: Uint8Array;
  upgrades: Set<string>;
  farmFoodRateMultiplier: number;
}

export class World {
  readonly map: GameMap;
  readonly grid: Grid;
  readonly rng: Rng;
  readonly spatialHash: SpatialHash;
  readonly pathQueue: PathQueue;
  readonly players: PlayerState[] = [];
  readonly entities: (Entity | undefined)[] = [];
  readonly events: SimEvent[] = [];

  tick = 0;
  private readonly freeIds: number[] = [];

  constructor(
    map: GameMap,
    rng: Rng,
    playerFactions?: Record<number, Faction>,
  ) {
    this.map = map;
    this.grid = new Grid(map);
    this.rng = rng;
    this.spatialHash = new SpatialHash(map.size, 2, 2048);
    this.pathQueue = new PathQueue(this.grid);

    this.initPlayers(playerFactions);
    this.initMines();
    this.initDoodads();
    this.initStartingBases();
  }

  emitEvent(event: SimEvent): void {
    this.events.push(event);
  }

  getEntity(id: number): Entity | undefined {
    return this.entities[id];
  }

  private allocateId(): number {
    if (this.freeIds.length > 0) {
      // Deterministically pop smallest ID
      return this.freeIds.pop()!;
    }
    return this.entities.length;
  }

  private releaseId(id: number): void {
    this.entities[id] = undefined;
    // Insert into freeIds keeping it sorted descending so .pop() yields smallest id
    let insertIdx = 0;
    while (insertIdx < this.freeIds.length && this.freeIds[insertIdx] > id) {
      insertIdx++;
    }
    this.freeIds.splice(insertIdx, 0, id);
  }

  spawnUnit(
    player: number,
    type: string,
    x: number,
    z: number,
    explicitFaction?: Faction,
  ): UnitEntity {
    const pState = this.players[player];
    const faction: Faction = explicitFaction ?? pState?.faction ?? 'crown';
    const uData = getUnitData(type, faction);
    if (!uData) {
      throw new Error(`Unknown unit type '${type}' for faction '${faction}'`);
    }

    const radius = uData.radius;
    const speed = uData.speed;
    const hp = uData.hp;
    const pop = uData.pop;
    const lineOfSight = uData.lineOfSight;
    const tags = uData.tags;
    const id = this.allocateId();
    const unit: UnitEntity = {
      id,
      kind: 'unit',
      player,
      type,
      faction,
      x,
      z,
      previousX: x,
      previousZ: z,
      radius,
      speed,
      baseSpeed: speed,
      facing: 0,
      hp,
      maxHp: hp,
      pop,
      lineOfSight,
      tags,
      order: { kind: 'idle' },
      orders: [],
      orderGeneration: 0,
      stuckTicks: 0,
      stuckProgressX: x,
      stuckProgressZ: z,
      stuckLastCheckTick: this.tick,
      attack: uData?.attack,
      attackType: uData?.attackType,
      range: uData?.range,
      minRange: uData?.minRange,
      cooldown: uData?.cooldown,
      meleeArmor: uData?.meleeArmor,
      pierceArmor: uData?.pierceArmor,
      bonus: uData?.bonus,
      loadedSpeed: uData?.loadedSpeed,
    };

    if (id < this.entities.length) {
      this.entities[id] = unit;
    } else {
      this.entities.push(unit);
    }

    if (pState) {
      pState.pop += pop;
    }

    this.emitEvent({
      kind: 'unitCreated',
      entityId: id,
      player,
      unitType: type,
      x,
      z,
    });

    return unit;
  }

  spawnBuilding(
    player: number,
    type: string,
    x: number,
    z: number,
    built = true,
    orientation?: 'horizontal' | 'vertical',
    explicitFaction?: Faction,
  ): BuildingEntity {
    const pState = this.players[player];
    const faction: Faction = explicitFaction ?? pState?.faction ?? 'crown';
    const bData = getBuildingData(type, faction);
    if (!bData) {
      throw new Error(
        `Unknown building type '${type}' for faction '${faction}'`,
      );
    }

    let width = bData.width;
    let height = bData.height;
    const isGate = bData.isGate ?? type.includes('gate');
    const resolvedOrientation =
      orientation ??
      (isGate && bData.gateOrientations ? 'horizontal' : undefined);
    if (resolvedOrientation && bData.gateOrientations) {
      const gateDim = bData.gateOrientations[resolvedOrientation];
      if (gateDim) {
        width = gateDim.width;
        height = gateDim.height;
      }
    }

    const hp = bData.hp;
    const pop = bData.pop;
    const faith = bData.faith;
    const lineOfSight = bData.lineOfSight;
    const meleeArmor = bData.meleeArmor;
    const pierceArmor = bData.pierceArmor;
    const isTownCenter =
      bData.isTownCenter ?? (type === 'keep' || type === 'great_hall');
    const isDropOff = bData.isDropOff ?? isTownCenter;
    const id = this.allocateId();
    const building: BuildingEntity = {
      id,
      kind: 'building',
      player,
      type,
      faction,
      x,
      z,
      previousX: x,
      previousZ: z,
      width,
      height,
      hp: built ? hp : 1,
      maxHp: hp,
      built,
      buildProgress: built ? 1 : 0,
      pop,
      faith,
      lineOfSight,
      meleeArmor,
      pierceArmor,
      role: bData?.role,
      isTownCenter,
      isDropOff,
      isGate,
      orientation: resolvedOrientation,
      trainingQueue: [],
    };

    if (id < this.entities.length) {
      this.entities[id] = building;
    } else {
      this.entities.push(building);
    }

    this.grid.setBuilding(x, z, width, height, true);
    if (isGate) {
      this.grid.setGate(x, z, width, height, player);
    }

    if (built && pState) {
      pState.popCap = Math.min(150, pState.popCap + pop);
      if (faith > 0) {
        pState.faithProduced += faith;
      } else if (faith < 0) {
        pState.faithUsed += -faith;
      }
      this.emitEvent({
        kind: 'buildingCompleted',
        entityId: id,
        player,
        buildingType: type,
        x,
        z,
      });
    }

    return building;
  }

  completeBuilding(building: BuildingEntity): void {
    if (building.built || this.entities[building.id] !== building) {
      return;
    }
    building.built = true;
    building.buildProgress = 1;
    building.hp = building.maxHp;

    const pState = this.players[building.player];
    if (pState) {
      pState.popCap = Math.min(150, pState.popCap + building.pop);
      if (building.faith > 0) {
        pState.faithProduced += building.faith;
      } else if (building.faith < 0) {
        pState.faithUsed += -building.faith;
      }
    }

    this.emitEvent({
      kind: 'buildingCompleted',
      entityId: building.id,
      player: building.player,
      buildingType: building.type,
      x: building.x,
      z: building.z,
    });
  }

  spawnMine(x: number, z: number, goldRemaining = 6000): MineEntity {
    const id = this.allocateId();
    const mine: MineEntity = {
      id,
      kind: 'mine',
      type: 'gold_mine',
      x,
      z,
      previousX: x,
      previousZ: z,
      width: 2,
      height: 2,
      goldRemaining,
    };

    if (id < this.entities.length) {
      this.entities[id] = mine;
    } else {
      this.entities.push(mine);
    }

    this.grid.setBuilding(x, z, 2, 2, true);
    return mine;
  }

  spawnDoodad(x: number, z: number, type: string): DoodadEntity {
    const id = this.allocateId();
    const doodad: DoodadEntity = {
      id,
      kind: 'doodad',
      type,
      x,
      z,
      previousX: x,
      previousZ: z,
    };

    if (id < this.entities.length) {
      this.entities[id] = doodad;
    } else {
      this.entities.push(doodad);
    }

    return doodad;
  }

  removeEntity(id: number): Entity | undefined {
    const ent = this.entities[id];
    if (!ent) {
      return undefined;
    }

    if (ent.kind === 'building') {
      this.grid.setBuilding(ent.x, ent.z, ent.width, ent.height, false);
      if (ent.isGate) {
        this.grid.setGate(ent.x, ent.z, ent.width, ent.height, -1);
      }
      const pState = this.players[ent.player];
      if (pState && ent.built) {
        pState.popCap = Math.max(0, Math.min(150, pState.popCap - ent.pop));
        if (ent.faith > 0) {
          pState.faithProduced = Math.max(0, pState.faithProduced - ent.faith);
        } else if (ent.faith < 0) {
          pState.faithUsed = Math.max(0, pState.faithUsed - -ent.faith);
        }
      }

      if (ent.isTownCenter) {
        const hasOtherTC = this.entities.some(
          (e) =>
            e &&
            e.kind === 'building' &&
            e.player === ent.player &&
            e.isTownCenter &&
            e.id !== ent.id,
        );
        if (!hasOtherTC && pState && !pState.eliminated) {
          pState.eliminated = true;
          this.emitEvent({
            kind: 'playerEliminated',
            player: ent.player,
          });
        }
      }
    } else if (ent.kind === 'mine') {
      this.grid.setBuilding(ent.x, ent.z, ent.width, ent.height, false);
    } else if (ent.kind === 'unit') {
      this.pathQueue.cancel(ent.id);
      const pState = this.players[ent.player];
      if (pState) {
        pState.pop = Math.max(0, pState.pop - ent.pop);
      }
      this.emitEvent({
        kind: 'unitDied',
        entityId: ent.id,
        player: ent.player,
        x: ent.x,
        z: ent.z,
      });
    }

    this.releaseId(id);
    return ent;
  }

  private initPlayers(playerFactions?: Record<number, Faction>): void {
    const count = this.map.players;
    const totalTiles = this.map.size * this.map.size;
    for (let i = 0; i < count; i++) {
      const faction: Faction = playerFactions?.[i] ?? 'crown';
      const explored = new Uint8Array(totalTiles);
      explored.fill(1);
      this.players.push({
        id: i,
        faction,
        team: i,
        age: 1,
        food: 300,
        gold: 200,
        foodCollected: 0,
        goldCollected: 0,
        faithProduced: 0,
        faithUsed: 0,
        lowFaith: false,
        pop: 0,
        popCap: 0,
        eliminated: false,
        explored,
        upgrades: new Set<string>(),
        farmFoodRateMultiplier: 1,
      });
    }
  }

  private initMines(): void {
    for (const [mx, mz] of this.map.goldMines) {
      this.spawnMine(mx, mz, 6000);
    }
  }

  private initDoodads(): void {
    for (const [dx, dz, type] of this.map.doodads) {
      this.spawnDoodad(dx, dz, type);
    }
  }

  private initStartingBases(): void {
    for (let p = 0; p < this.players.length; p++) {
      const start = this.map.starts[p];
      if (!start) continue;
      const [sx, sz] = start;
      const player = this.players[p];
      const tcType = player.faction === 'crown' ? 'keep' : 'great_hall';
      this.spawnBuilding(p, tcType, sx, sz, true, undefined, player.faction);

      const peasantType = player.faction === 'crown' ? 'peasant' : 'thrall';
      const cartType = player.faction === 'crown' ? 'ox_cart' : 'haul_wagon';

      // 4 peasants and 1 cart placed near TC on passable tiles
      const peasantOffsets: [number, number][] = [
        [sx + 4.5, sz + 1.5],
        [sx + 4.5, sz + 2.5],
        [sx + 1.5, sz + 4.5],
        [sx + 2.5, sz + 4.5],
      ];

      for (const [px, pz] of peasantOffsets) {
        this.spawnUnit(p, peasantType, px, pz, player.faction);
      }

      this.spawnUnit(p, cartType, sx + 4.5, sz + 3.5, player.faction);
    }
  }
}
