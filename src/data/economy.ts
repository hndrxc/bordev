import type { EconomyData } from './types.js';

export const ECONOMY: EconomyData = {
  startingState: {
    food: 300,
    gold: 200,
    townCenters: 1,
    workers: 4,
    carts: 1,
    nearGoldMineDistance: { min: 6, max: 8, count: 1 },
    farGoldMineDistance: { min: 14, max: 18, count: 2 },
  },
  population: {
    cap: 150,
    townCenterPop: 10,
    housePop: 10,
  },
  goldMine: {
    capacity: 6000,
    width: 2,
    height: 2,
    maxSimultaneousCarts: 2,
    loadAmount: 100,
    loadTimeSec: 6,
    unloadTimeSec: 2,
    retargetRadiusTiles: 20,
  },
  farm: {
    maxWorkers: 1,
    infinite: true,
  },
  faith: {
    lowFaithRateMultiplier: 0.5,
  },
} as const;
