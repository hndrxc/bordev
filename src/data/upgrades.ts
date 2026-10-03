import type {
  ClansUpgradeId,
  CrownUpgradeId,
  Faction,
  UpgradeData,
} from './types.js';

export const CROWN_UPGRADES = {
  heavy_plough: {
    id: 'heavy_plough',
    faction: 'crown',
    name: 'Heavy Plough',
    building: 'keep',
    age: 2,
    food: 100,
    gold: 100,
    time: 30,
    effectDescription: 'Farms +20 % food',
    effects: [
      {
        kind: 'farm_food_rate_pct',
        percent: 20,
      },
    ],
  },
  crop_rotation: {
    id: 'crop_rotation',
    faction: 'crown',
    name: 'Crop Rotation',
    building: 'keep',
    age: 3,
    food: 250,
    gold: 150,
    time: 45,
    effectDescription: 'Farms +20 % food (stacks additively)',
    effects: [
      {
        kind: 'farm_food_rate_pct',
        percent: 20,
      },
    ],
  },
  iron_axles: {
    id: 'iron_axles',
    faction: 'crown',
    name: 'Iron Axles',
    building: 'storehouse',
    age: 2,
    food: 100,
    gold: 100,
    time: 30,
    effectDescription: 'Carts +25 capacity, +10 % speed',
    effects: [
      {
        kind: 'cart_capacity_bonus',
        amount: 25,
      },
      {
        kind: 'cart_speed_pct',
        percent: 10,
      },
    ],
  },
  gambeson: {
    id: 'gambeson',
    faction: 'crown',
    name: 'Padded Gambeson',
    building: 'barracks',
    age: 2,
    food: 100,
    gold: 50,
    time: 40,
    effectDescription: 'Infantry +1 pierce armor',
    effects: [
      {
        kind: 'unit_armor_bonus',
        tag: 'infantry',
        meleeArmor: 0,
        pierceArmor: 1,
      },
    ],
  },
  chainmail: {
    id: 'chainmail',
    faction: 'crown',
    name: 'Chainmail',
    building: 'barracks',
    age: 3,
    food: 200,
    gold: 100,
    time: 50,
    effectDescription: 'Infantry +1/+1 armor',
    effects: [
      {
        kind: 'unit_armor_bonus',
        tag: 'infantry',
        meleeArmor: 1,
        pierceArmor: 1,
      },
    ],
  },
  bodkin: {
    id: 'bodkin',
    faction: 'crown',
    name: 'Bodkin Arrows',
    building: 'archery_range',
    age: 2,
    food: 100,
    gold: 100,
    time: 35,
    effectDescription: 'Archers +1 attack, +1 range',
    effects: [
      {
        kind: 'unit_stat_bonus',
        tag: 'archer',
        attack: 1,
        range: 1,
      },
    ],
  },
  barding: {
    id: 'barding',
    faction: 'crown',
    name: 'Barding',
    building: 'stable',
    age: 3,
    food: 150,
    gold: 150,
    time: 50,
    effectDescription: 'Cavalry +2 melee armor, +20 HP',
    effects: [
      {
        kind: 'unit_armor_bonus',
        tag: 'cavalry',
        meleeArmor: 2,
        pierceArmor: 0,
      },
      {
        kind: 'unit_hp_bonus',
        tag: 'cavalry',
        amount: 20,
      },
    ],
  },
  devotion: {
    id: 'devotion',
    faction: 'crown',
    name: 'Devotion',
    building: 'chapel',
    age: 2,
    food: 100,
    gold: 100,
    time: 30,
    effectDescription: 'Chapels +5 Faith; Sanctuary 2 HP/s',
    effects: [
      {
        kind: 'building_faith_bonus',
        buildingId: 'chapel',
        amount: 5,
      },
      {
        kind: 'sanctuary_heal_rate',
        healPerSec: 2,
      },
    ],
  },
} as const satisfies { readonly [K in CrownUpgradeId]: UpgradeData<K, 'crown'> };

export const CLANS_UPGRADES = {
  slash_burn: {
    id: 'slash_burn',
    faction: 'clans',
    name: 'Slash-and-Burn',
    building: 'great_hall',
    age: 2,
    food: 100,
    gold: 100,
    time: 30,
    effectDescription: 'Fields +20 % food',
    effects: [
      {
        kind: 'farm_food_rate_pct',
        percent: 20,
      },
    ],
  },
  tended_fields: {
    id: 'tended_fields',
    faction: 'clans',
    name: 'Tended Fields',
    building: 'great_hall',
    age: 3,
    food: 250,
    gold: 150,
    time: 45,
    effectDescription: 'Fields +20 % food',
    effects: [
      {
        kind: 'farm_food_rate_pct',
        percent: 20,
      },
    ],
  },
  sledge_runners: {
    id: 'sledge_runners',
    faction: 'clans',
    name: 'Sledge Runners',
    building: 'hoard',
    age: 2,
    food: 100,
    gold: 100,
    time: 30,
    effectDescription: 'Wagons +25 capacity, +10 % speed',
    effects: [
      {
        kind: 'cart_capacity_bonus',
        amount: 25,
      },
      {
        kind: 'cart_speed_pct',
        percent: 10,
      },
    ],
  },
  hide_armor: {
    id: 'hide_armor',
    faction: 'clans',
    name: 'Hide Armor',
    building: 'mead_hall',
    age: 2,
    food: 100,
    gold: 50,
    time: 40,
    effectDescription: 'Infantry +1 pierce armor',
    effects: [
      {
        kind: 'unit_armor_bonus',
        tag: 'infantry',
        meleeArmor: 0,
        pierceArmor: 1,
      },
    ],
  },
  scale_armor: {
    id: 'scale_armor',
    faction: 'clans',
    name: 'Scale Armor',
    building: 'mead_hall',
    age: 3,
    food: 200,
    gold: 100,
    time: 50,
    effectDescription: 'Infantry +1/+1 armor',
    effects: [
      {
        kind: 'unit_armor_bonus',
        tag: 'infantry',
        meleeArmor: 1,
        pierceArmor: 1,
      },
    ],
  },
  barbed_javelins: {
    id: 'barbed_javelins',
    faction: 'clans',
    name: 'Barbed Javelins',
    building: 'hunters_lodge',
    age: 2,
    food: 100,
    gold: 100,
    time: 35,
    effectDescription: 'Ranged +1 attack; javelineer +1 range',
    effects: [
      {
        kind: 'unit_stat_bonus',
        tag: 'archer',
        attack: 1,
      },
      {
        kind: 'unit_specific_stat_bonus',
        unitId: 'javelineer',
        range: 1,
      },
    ],
  },
  steppe_breeding: {
    id: 'steppe_breeding',
    faction: 'clans',
    name: 'Steppe Breeding',
    building: 'horse_pen',
    age: 3,
    food: 150,
    gold: 150,
    time: 50,
    effectDescription: 'Cavalry +15 % speed, +15 HP',
    effects: [
      {
        kind: 'unit_speed_pct',
        tag: 'cavalry',
        percent: 15,
      },
      {
        kind: 'unit_hp_bonus',
        tag: 'cavalry',
        amount: 15,
      },
    ],
  },
  blood_rites: {
    id: 'blood_rites',
    faction: 'clans',
    name: 'Blood Rites',
    building: 'war_shrine',
    age: 2,
    food: 100,
    gold: 100,
    time: 30,
    effectDescription: 'War Shrines +5 Faith; Battle Fervor +2 attack instead of +1',
    effects: [
      {
        kind: 'building_faith_bonus',
        buildingId: 'war_shrine',
        amount: 5,
      },
      {
        kind: 'battle_fervor_attack_bonus',
        attackBonus: 2,
      },
    ],
  },
} as const satisfies { readonly [K in ClansUpgradeId]: UpgradeData<K, 'clans'> };

export const UPGRADES = {
  crown: CROWN_UPGRADES,
  clans: CLANS_UPGRADES,
} as const;

export const ALL_UPGRADES: readonly UpgradeData[] = [
  ...Object.values(CROWN_UPGRADES),
  ...Object.values(CLANS_UPGRADES),
];

export function getUpgradeData(id: string, faction?: Faction): UpgradeData | undefined {
  if (faction) {
    const factionUpgrades = UPGRADES[faction];
    if (Object.hasOwn(factionUpgrades, id)) {
      return (factionUpgrades as Record<string, UpgradeData>)[id];
    }
    return undefined;
  }
  if (Object.hasOwn(CROWN_UPGRADES, id)) {
    return (CROWN_UPGRADES as Record<string, UpgradeData>)[id];
  }
  if (Object.hasOwn(CLANS_UPGRADES, id)) {
    return (CLANS_UPGRADES as Record<string, UpgradeData>)[id];
  }
  return undefined;
}
