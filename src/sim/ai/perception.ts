import {
  isCartType,
  isTownCenterType,
  isWorkerType,
} from '../../data/roles.js';
import type { BuildingEntity, MineEntity, UnitEntity } from '../entity.js';
import type { World } from '../world.js';
import { areHostile } from '../systems/damage.js';
import { isEntityVisibleTo } from '../systems/fog.js';

export interface AiView {
  peasants: UnitEntity[];
  carts: UnitEntity[];
  army: UnitEntity[];
  buildings: Record<string, BuildingEntity[]>;
  townCenter: BuildingEntity | null;
  visibleEnemyUnits: UnitEntity[];
  knownEnemyBuildings: {
    x: number;
    z: number;
    width: number;
    height: number;
    player: number;
    type: string;
    id?: number;
  }[];
  mines: (MineEntity & { explored: boolean })[];
  enemyStarts: readonly [number, number][];
}

export function perceive(world: World, player: number): AiView {
  const view: AiView = {
    peasants: [],
    carts: [],
    army: [],
    buildings: {},
    townCenter: null,
    visibleEnemyUnits: [],
    knownEnemyBuildings: [],
    mines: [],
    enemyStarts: [],
  };
  const viewer = { player };
  const playerState = world.players[player];
  const knownBuildings = new Map<
    string,
    AiView['knownEnemyBuildings'][number]
  >();

  // Entity slots are indexed by id, so each own group is already in id order.
  for (let id = 0; id < world.entities.length; id++) {
    const entity = world.entities[id];
    if (!entity) continue;

    if (entity.kind === 'mine') {
      if (entity.goldRemaining > 0) {
        let explored = true;
        for (let dz = 0; dz < entity.height && explored; dz++) {
          const row = (entity.z + dz) * world.map.size;
          for (let dx = 0; dx < entity.width; dx++) {
            if (playerState?.explored[row + entity.x + dx] !== 1) {
              explored = false;
              break;
            }
          }
        }
        view.mines.push({ ...entity, explored });
      }
      continue;
    }

    if (entity.kind !== 'unit' && entity.kind !== 'building') continue;
    if (entity.player === player) {
      if (entity.kind === 'unit') {
        if (isWorkerType(entity.type)) {
          view.peasants.push(entity);
        } else if (isCartType(entity.type)) {
          view.carts.push(entity);
        } else if ((entity.attack ?? 0) > 0) {
          view.army.push(entity);
        }
      } else {
        (view.buildings[entity.type] ??= []).push(entity);
        if (
          isTownCenterType(entity.type) &&
          (!view.townCenter || (!view.townCenter.built && entity.built))
        ) {
          view.townCenter = entity;
        }
      }
      continue;
    }

    if (
      !areHostile(world, viewer, entity) ||
      !isEntityVisibleTo(world, player, entity)
    ) {
      continue;
    }
    if (entity.kind === 'unit') {
      view.visibleEnemyUnits.push(entity);
    } else {
      knownBuildings.set(`${entity.x},${entity.z}`, {
        x: entity.x,
        z: entity.z,
        width: entity.width,
        height: entity.height,
        player: entity.player,
        type: entity.type,
        id: entity.id,
      });
    }
  }

  if (playerState) {
    for (const ghost of playerState.ghosts.values()) {
      if (
        ghost.kind !== 'building' ||
        ghost.player === undefined ||
        ghost.type === undefined ||
        !areHostile(world, viewer, { player: ghost.player })
      ) {
        continue;
      }
      const key = `${ghost.x},${ghost.z}`;
      if (knownBuildings.has(key)) continue;
      // Never resolve a ghost's old id against the live world behind the fog.
      knownBuildings.set(key, {
        x: ghost.x,
        z: ghost.z,
        width: ghost.width,
        height: ghost.height,
        player: ghost.player,
        type: ghost.type,
      });
    }
  }
  view.knownEnemyBuildings = [...knownBuildings.values()].sort(
    (a, b) => a.z - b.z || a.x - b.x,
  );

  const enemyStarts: [number, number][] = [];
  for (const other of world.players) {
    if (other.eliminated || !areHostile(world, viewer, { player: other.id })) {
      continue;
    }
    const start = world.map.starts[other.id];
    if (start) enemyStarts.push(start);
  }
  view.enemyStarts = enemyStarts;
  return view;
}
