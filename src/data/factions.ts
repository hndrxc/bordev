import type { Faction, FactionData } from './types.js';

export const FACTIONS = {
  crown: {
    id: 'crown',
    name: 'Crown',
    buildingMaterial: 'stone',
    defaultMeleeArmor: 3,
    defaultPierceArmor: 8,
    ability: {
      id: 'sanctuary',
      name: 'Sanctuary',
      description:
        'Each completed Chapel heals own non-siege units within 5 tiles by 1 HP/s.',
    },
    townCenterId: 'keep',
    workerId: 'peasant',
    cartId: 'ox_cart',
    categoryMapping: {
      barracks: 'barracks',
      range: 'archery_range',
      storehouse: 'storehouse',
      faith: 'chapel',
      stable: 'stable',
    },
  },
  clans: {
    id: 'clans',
    name: 'Clans',
    buildingMaterial: 'wood',
    defaultMeleeArmor: 1,
    defaultPierceArmor: 5,
    ability: {
      id: 'battle_fervor',
      name: 'Battle Fervor',
      description:
        'While Faith Produced − Faith Used ≥ 5, all Clans units get +1 attack.',
    },
    battleFervor: {
      minFaithSurplus: 5,
      attackBonus: 1,
    },
    townCenterId: 'great_hall',
    workerId: 'thrall',
    cartId: 'haul_wagon',
    categoryMapping: {
      barracks: 'mead_hall',
      range: 'hunters_lodge',
      storehouse: 'hoard',
      faith: 'war_shrine',
      stable: 'horse_pen',
    },
  },
} as const satisfies {
  readonly crown: FactionData<'crown'>;
  readonly clans: FactionData<'clans'>;
};

export function getFactionData(faction: string): FactionData | undefined {
  if (Object.hasOwn(FACTIONS, faction)) {
    return FACTIONS[faction as Faction];
  }
  return undefined;
}
