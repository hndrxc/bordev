import type { TerrainCode, TerrainType } from './types.js';

export const TERRAIN_CODES = {
  GRASS: 0,
  DIRT: 1,
  SAND: 2,
  SHALLOW: 3,
  WATER: 4,
  FOREST: 5,
  ROCK: 6,
} as const satisfies Record<string, TerrainCode>;

export const SHALLOW_SPEED_MULTIPLIER = 0.7;

export interface TerrainProperties {
  readonly code: TerrainCode;
  readonly type: TerrainType;
  readonly name: string;
  readonly passable: boolean;
  readonly speedMultiplier: number;
}

export const TERRAIN_PROPERTIES: Record<TerrainCode, TerrainProperties> = {
  0: {
    code: 0,
    type: 'grass',
    name: 'Grass',
    passable: true,
    speedMultiplier: 1.0,
  },
  1: {
    code: 1,
    type: 'dirt',
    name: 'Dirt',
    passable: true,
    speedMultiplier: 1.0,
  },
  2: {
    code: 2,
    type: 'sand',
    name: 'Sand',
    passable: true,
    speedMultiplier: 1.0,
  },
  3: {
    code: 3,
    type: 'shallow',
    name: 'Shallow Water',
    passable: true,
    speedMultiplier: SHALLOW_SPEED_MULTIPLIER,
  },
  4: {
    code: 4,
    type: 'water',
    name: 'Deep Water',
    passable: false,
    speedMultiplier: 0,
  },
  5: {
    code: 5,
    type: 'forest',
    name: 'Forest',
    passable: false,
    speedMultiplier: 0,
  },
  6: {
    code: 6,
    type: 'rock',
    name: 'Rock',
    passable: false,
    speedMultiplier: 0,
  },
} as const;

export function isTerrainPassable(code: number): boolean {
  if (code in TERRAIN_PROPERTIES) {
    return TERRAIN_PROPERTIES[code as TerrainCode].passable;
  }
  return false;
}

export function getTerrainSpeedMultiplier(code: number): number {
  if (code in TERRAIN_PROPERTIES) {
    return TERRAIN_PROPERTIES[code as TerrainCode].speedMultiplier;
  }
  return 0;
}
