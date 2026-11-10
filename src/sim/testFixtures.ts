import type { Faction } from '../data/types.js';
import { Terrain, type GameMap } from './map.js';
import { Sim } from './sim.js';
import type { World } from './world.js';

export interface OpenMapOptions {
  size?: number;
  players?: number;
  /** Keep start positions; omitted means no starting bases, so only staged entities exist. */
  starts?: [number, number][];
  /** Edit the grass tile array before the map is built (e.g. paint water). */
  mutate?: (tiles: Uint8Array, size: number) => void;
  /**
   * When true, initializes player exploration to fully explored (monotone 1)
   * without granting live visibility (visible remains 0 unless in real LOS; fog becomes 128 explored hidden).
   */
  explored?: boolean;
}

/** All-grass test map; defaults to 32×32, three players and no starting bases. */
export function makeOpenMap({
  size = 32,
  players = 3,
  starts = [],
  mutate,
}: OpenMapOptions = {}): GameMap {
  const tiles = new Uint8Array(size * size).fill(Terrain.GRASS);
  mutate?.(tiles, size);
  return {
    version: 1,
    id: `test_open_${size}`,
    name: 'Test open map',
    size,
    players,
    tiles,
    goldMines: [],
    starts,
    doodads: [],
  };
}

/** Sim on {@link makeOpenMap}; with no starts the world begins empty. */
export function makeOpenSim(
  options: OpenMapOptions & {
    seed?: number;
    explored?: boolean;
    factions?: Readonly<Record<number, Faction>>;
  } = {},
): Sim {
  const sim = new Sim(
    makeOpenMap(options),
    options.seed ?? 1,
    options.factions,
  );
  if (options.explored) {
    for (let p = 0; p < sim.world.players.length; p++) {
      sim.world.players[p].explored.fill(1);
    }
    sim.updateFog();
  }
  return sim;
}

/** Mark explored for intentional fixture setup without granting artificial live visibility. */
export function revealExplored(world: World, playerId?: number): void {
  if (playerId !== undefined) {
    world.players[playerId]?.explored.fill(1);
  } else {
    for (let p = 0; p < world.players.length; p++) {
      world.players[p].explored.fill(1);
    }
  }
  world.players.forEach((p) => {
    for (let i = 0; i < p.fog.length; i++) {
      if (p.visible[i] === 0 && p.explored[i] === 1) {
        p.fog[i] = 128;
      }
    }
    p.fogRevision++;
  });
}
