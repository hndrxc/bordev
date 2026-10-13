import { Terrain, type GameMap } from './map.js';
import { Sim } from './sim.js';

export interface OpenMapOptions {
  size?: number;
  players?: number;
  /** Keep start positions; omitted means no starting bases, so only staged entities exist. */
  starts?: [number, number][];
  /** Edit the grass tile array before the map is built (e.g. paint water). */
  mutate?: (tiles: Uint8Array, size: number) => void;
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
export function makeOpenSim(options: OpenMapOptions & { seed?: number } = {}): Sim {
  return new Sim(makeOpenMap(options), options.seed ?? 1);
}
