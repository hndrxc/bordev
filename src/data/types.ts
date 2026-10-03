export type Faction = 'crown' | 'clans';

export type AgeNumber = 1 | 2 | 3;

export type AttackType = 'melee' | 'pierce' | 'siege';

export type UnitTag =
  | 'infantry'
  | 'cavalry'
  | 'archer'
  | 'siege'
  | 'vehicle'
  | 'worker'
  | 'building';

export type CrownUnitId =
  | 'peasant'
  | 'ox_cart'
  | 'spearman'
  | 'man_at_arms'
  | 'halberdier'
  | 'longbowman'
  | 'crossbowman'
  | 'sergeant'
  | 'knight'
  | 'trebuchet';

export type ClansUnitId =
  | 'thrall'
  | 'haul_wagon'
  | 'axeman'
  | 'shield_bearer'
  | 'berserker'
  | 'javelineer'
  | 'hunter'
  | 'horse_raider'
  | 'war_rider'
  | 'battering_ram';

export type UnitId = CrownUnitId | ClansUnitId;

export type CrownBuildingId =
  | 'keep'
  | 'cottage'
  | 'farm'
  | 'storehouse'
  | 'chapel'
  | 'barracks'
  | 'archery_range'
  | 'stable'
  | 'siege_workshop'
  | 'stone_tower'
  | 'stone_wall'
  | 'stone_gate';

export type ClansBuildingId =
  | 'great_hall'
  | 'longhouse'
  | 'field'
  | 'hoard'
  | 'war_shrine'
  | 'mead_hall'
  | 'hunters_lodge'
  | 'horse_pen'
  | 'ram_shed'
  | 'watchtower'
  | 'palisade'
  | 'palisade_gate';

export type BuildingId = CrownBuildingId | ClansBuildingId;

export type FactionUnitId<F extends Faction> = F extends 'crown'
  ? CrownUnitId
  : ClansUnitId;

export type FactionBuildingId<F extends Faction> = F extends 'crown'
  ? CrownBuildingId
  : ClansBuildingId;

export type FactionUpgradeId<F extends Faction> = F extends 'crown'
  ? CrownUpgradeId
  : ClansUpgradeId;

export type BuildingRole =
  | 'town_center'
  | 'housing'
  | 'farming'
  | 'drop_off'
  | 'faith'
  | 'barracks'
  | 'range'
  | 'stable'
  | 'siege'
  | 'tower'
  | 'wall'
  | 'gate';

export type BuildingCategory =
  | 'barracks'
  | 'range'
  | 'storehouse'
  | 'faith'
  | 'stable';

export type CrownUpgradeId =
  | 'heavy_plough'
  | 'crop_rotation'
  | 'iron_axles'
  | 'gambeson'
  | 'chainmail'
  | 'bodkin'
  | 'barding'
  | 'devotion';

export type ClansUpgradeId =
  | 'slash_burn'
  | 'tended_fields'
  | 'sledge_runners'
  | 'hide_armor'
  | 'scale_armor'
  | 'barbed_javelins'
  | 'steppe_breeding'
  | 'blood_rites';

export type UpgradeId = CrownUpgradeId | ClansUpgradeId;

export type UpgradeEffect =
  | {
      readonly kind: 'farm_food_rate_pct';
      readonly percent: number;
    }
  | {
      readonly kind: 'cart_capacity_bonus';
      readonly amount: number;
    }
  | {
      readonly kind: 'cart_speed_pct';
      readonly percent: number;
    }
  | {
      readonly kind: 'unit_armor_bonus';
      readonly tag: UnitTag;
      readonly meleeArmor?: number;
      readonly pierceArmor?: number;
    }
  | {
      readonly kind: 'unit_stat_bonus';
      readonly tag: UnitTag;
      readonly attack?: number;
      readonly range?: number;
    }
  | {
      readonly kind: 'unit_specific_stat_bonus';
      readonly unitId: UnitId;
      readonly range: number;
    }
  | {
      readonly kind: 'unit_hp_bonus';
      readonly tag: UnitTag;
      readonly amount: number;
    }
  | {
      readonly kind: 'unit_speed_pct';
      readonly tag: UnitTag;
      readonly percent: number;
    }
  | {
      readonly kind: 'building_faith_bonus';
      readonly buildingId: BuildingId;
      readonly amount: number;
    }
  | {
      readonly kind: 'sanctuary_heal_rate';
      readonly healPerSec: number;
    }
  | {
      readonly kind: 'battle_fervor_attack_bonus';
      readonly attackBonus: number;
    };

export interface UnitData<
  TId extends UnitId = UnitId,
  TFaction extends Faction = Faction,
> {
  readonly id: TId;
  readonly faction: TFaction;
  readonly name: string;
  readonly age: AgeNumber;
  readonly from: FactionBuildingId<TFaction>;
  readonly food: number;
  readonly gold: number;
  readonly hp: number;
  readonly trainTime: number;
  readonly attack: number;
  readonly attackType: AttackType | null;
  readonly range: number;
  readonly minRange: number;
  readonly cooldown: number;
  readonly meleeArmor: number;
  readonly pierceArmor: number;
  readonly speed: number;
  readonly loadedSpeed?: number;
  readonly radius: number;
  readonly tags: readonly UnitTag[];
  readonly bonus: Readonly<Partial<Record<UnitTag, number>>>;
  readonly pop: number;
  readonly lineOfSight: number;
  readonly regenHpPerSec?: number;
}

export interface GateOrientations {
  readonly horizontal: { readonly width: number; readonly height: number };
  readonly vertical: { readonly width: number; readonly height: number };
}

export interface SanctuaryAuraData {
  readonly name: 'sanctuary';
  readonly radius: number;
  readonly healPerSec: number;
  readonly target: 'non-siege';
}

export interface BuildingData<
  TId extends BuildingId = BuildingId,
  TFaction extends Faction = Faction,
> {
  readonly id: TId;
  readonly faction: TFaction;
  readonly name: string;
  readonly age: AgeNumber;
  readonly additionalAge?: AgeNumber;
  readonly food: number;
  readonly gold: number;
  readonly hp: number;
  readonly width: number;
  readonly height: number;
  readonly buildTime: number;
  readonly faith: number;
  readonly pop: number;
  readonly meleeArmor: number;
  readonly pierceArmor: number;
  readonly role: BuildingRole;
  readonly roleDescription: string;
  readonly isTownCenter?: boolean;
  readonly isDropOff?: boolean;
  readonly isHousing?: boolean;
  readonly isFarm?: boolean;
  readonly isWall?: boolean;
  readonly isGate?: boolean;
  readonly gateOrientations?: GateOrientations;
  readonly attack?: number;
  readonly attackType?: AttackType;
  readonly range?: number;
  readonly cooldown?: number;
  readonly lineOfSight: number;
  readonly aura?: SanctuaryAuraData;
  readonly foodRate?: number;
}

export interface UpgradeData<
  TId extends UpgradeId = UpgradeId,
  TFaction extends Faction = Faction,
> {
  readonly id: TId;
  readonly faction: TFaction;
  readonly name: string;
  readonly building: FactionBuildingId<TFaction>;
  readonly age: AgeNumber;
  readonly food: number;
  readonly gold: number;
  readonly time: number;
  readonly effectDescription: string;
  readonly effects: readonly UpgradeEffect[];
}

export interface AgeRequirements {
  readonly minDistinctBuildings: number;
  readonly buildingCategories: readonly BuildingCategory[];
  readonly requiredCategory?: BuildingCategory;
}

export interface AgeData {
  readonly age: AgeNumber;
  readonly name: Record<Faction, string>;
  readonly cost: { readonly food: number; readonly gold: number };
  readonly researchTime: number;
  readonly requirement: AgeRequirements | null;
  readonly description: string;
}

export interface FactionData<TFaction extends Faction = Faction> {
  readonly id: TFaction;
  readonly name: string;
  readonly buildingMaterial: 'stone' | 'wood';
  readonly defaultMeleeArmor: number;
  readonly defaultPierceArmor: number;
  readonly ability: {
    readonly id: 'sanctuary' | 'battle_fervor';
    readonly name: string;
    readonly description: string;
  };
  readonly battleFervor?: {
    readonly minFaithSurplus: number;
    readonly attackBonus: number;
  };
  readonly townCenterId: FactionBuildingId<TFaction>;
  readonly workerId: FactionUnitId<TFaction>;
  readonly cartId: FactionUnitId<TFaction>;
  readonly categoryMapping: Record<BuildingCategory, FactionBuildingId<TFaction>>;
}

export interface EconomyStartingState {
  readonly food: number;
  readonly gold: number;
  readonly townCenters: number;
  readonly workers: number;
  readonly carts: number;
  readonly nearGoldMineDistance: {
    readonly min: number;
    readonly max: number;
    readonly count: number;
  };
  readonly farGoldMineDistance: {
    readonly min: number;
    readonly max: number;
    readonly count: number;
  };
}

export interface PopulationParameters {
  readonly cap: number;
  readonly townCenterPop: number;
  readonly housePop: number;
}

export interface GoldMineParameters {
  readonly capacity: number;
  readonly width: number;
  readonly height: number;
  readonly maxSimultaneousCarts: number;
  readonly loadAmount: number;
  readonly loadTimeSec: number;
  readonly unloadTimeSec: number;
  readonly retargetRadiusTiles: number;
}

export interface FarmParameters {
  readonly maxWorkers: number;
  readonly infinite: boolean;
}

export interface FaithParameters {
  readonly lowFaithRateMultiplier: number;
}

export interface EconomyData {
  readonly startingState: EconomyStartingState;
  readonly population: PopulationParameters;
  readonly goldMine: GoldMineParameters;
  readonly farm: FarmParameters;
  readonly faith: FaithParameters;
}

export type TerrainCode = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type TerrainType =
  | 'grass'
  | 'dirt'
  | 'sand'
  | 'shallow'
  | 'water'
  | 'forest'
  | 'rock';
