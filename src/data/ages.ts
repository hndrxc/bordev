import type { AgeData, AgeNumber, BuildingCategory } from './types.js';

export const AGE_2_BUILDING_CATEGORIES: readonly BuildingCategory[] = [
  'barracks',
  'range',
  'storehouse',
  'faith',
];

export const AGES: Record<AgeNumber, AgeData> = {
  1: {
    age: 1,
    name: {
      crown: 'Hamlet',
      clans: 'Camp',
    },
    cost: { food: 0, gold: 0 },
    researchTime: 0,
    requirement: null,
    description: 'Starting age',
  },
  2: {
    age: 2,
    name: {
      crown: 'Borough',
      clans: 'Steading',
    },
    cost: { food: 500, gold: 200 },
    researchTime: 40,
    requirement: {
      minDistinctBuildings: 2,
      buildingCategories: AGE_2_BUILDING_CATEGORIES,
    },
    description:
      '2 distinct completed buildings among {barracks-type, range-type, storehouse-type, faith-type}',
  },
  3: {
    age: 3,
    name: {
      crown: 'Kingdom',
      clans: 'Warhold',
    },
    cost: { food: 800, gold: 600 },
    researchTime: 60,
    requirement: {
      minDistinctBuildings: 1,
      buildingCategories: AGE_2_BUILDING_CATEGORIES,
      requiredCategory: 'stable',
    },
    description:
      'completed stable-type + 1 more distinct building from the Age II list',
  },
} as const;
