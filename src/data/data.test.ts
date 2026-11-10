import { describe, expect, it } from 'vitest';
import { AGES } from './ages.js';
import {
  ALL_BUILDINGS,
  BUILDINGS,
  CLANS_BUILDINGS,
  CROWN_BUILDINGS,
  getBuildingData,
} from './buildings.js';
import { ECONOMY } from './economy.js';
import { FACTIONS, getFactionData } from './factions.js';
import {
  SHALLOW_SPEED_MULTIPLIER,
  TERRAIN_CODES,
  TERRAIN_PROPERTIES,
  getTerrainSpeedMultiplier,
  isTerrainPassable,
} from './terrain.js';
import type { BuildingCategory } from './types.js';
import {
  ALL_UNITS,
  CLANS_UNITS,
  CROWN_UNITS,
  getUnitData,
} from './units.js';
import {
  ALL_UPGRADES,
  CLANS_UPGRADES,
  CROWN_UPGRADES,
  getUpgradeData,
} from './upgrades.js';

describe('Data Key and Record Integrity', () => {
  it('ensures every record key matches entry.id and faction partition', () => {
    for (const [key, unit] of Object.entries(CROWN_UNITS)) {
      expect(unit.id).toBe(key);
      expect(unit.faction).toBe('crown');
    }
    for (const [key, unit] of Object.entries(CLANS_UNITS)) {
      expect(unit.id).toBe(key);
      expect(unit.faction).toBe('clans');
    }
    for (const [key, bldg] of Object.entries(CROWN_BUILDINGS)) {
      expect(bldg.id).toBe(key);
      expect(bldg.faction).toBe('crown');
    }
    for (const [key, bldg] of Object.entries(CLANS_BUILDINGS)) {
      expect(bldg.id).toBe(key);
      expect(bldg.faction).toBe('clans');
    }
    for (const [key, upg] of Object.entries(CROWN_UPGRADES)) {
      expect(upg.id).toBe(key);
      expect(upg.faction).toBe('crown');
    }
    for (const [key, upg] of Object.entries(CLANS_UPGRADES)) {
      expect(upg.id).toBe(key);
      expect(upg.faction).toBe('clans');
    }
  });
});

describe('Cross-Table Referential Invariants', () => {
  it('ensures every unit references a valid training building of the same faction', () => {
    for (const unit of ALL_UNITS) {
      const factionBuildings = BUILDINGS[unit.faction];
      expect(
        Object.hasOwn(factionBuildings, unit.from),
        `Unit ${unit.id} references invalid building ${unit.from} in faction ${unit.faction}`
      ).toBe(true);
    }
  });

  it('ensures every upgrade references a valid research building of the same faction', () => {
    for (const upgrade of ALL_UPGRADES) {
      const factionBuildings = BUILDINGS[upgrade.faction];
      expect(
        Object.hasOwn(factionBuildings, upgrade.building),
        `Upgrade ${upgrade.id} references invalid building ${upgrade.building} in faction ${upgrade.faction}`
      ).toBe(true);
    }
  });

  it('ensures all faction category mappings resolve to existing buildings of that faction', () => {
    const categories: readonly BuildingCategory[] = [
      'barracks',
      'range',
      'storehouse',
      'faith',
      'stable',
    ];
    for (const faction of ['crown', 'clans'] as const) {
      const mapping = FACTIONS[faction].categoryMapping;
      for (const cat of categories) {
        const buildingId = mapping[cat];
        expect(buildingId).toBeDefined();
        expect(
          Object.hasOwn(BUILDINGS[faction], buildingId),
          `Faction ${faction} maps category ${cat} to non-existent building ${buildingId}`
        ).toBe(true);
      }
    }
  });
});

describe('Age Progression Invariants', () => {
  it('ensures all entries have valid numeric ages (1, 2, or 3)', () => {
    for (const unit of ALL_UNITS) {
      expect([1, 2, 3]).toContain(unit.age);
    }
    for (const building of ALL_BUILDINGS) {
      expect([1, 2, 3]).toContain(building.age);
    }
    for (const upgrade of ALL_UPGRADES) {
      expect([1, 2, 3]).toContain(upgrade.age);
    }
  });

  it('ensures training building age never exceeds unit age', () => {
    for (const unit of ALL_UNITS) {
      const building = getBuildingData(unit.from, unit.faction);
      expect(building).toBeDefined();
      expect(
        building!.age <= unit.age,
        `Unit ${unit.id} (Age ${unit.age}) trained from building ${building!.id} (Age ${building!.age})`
      ).toBe(true);
    }
  });

  it('ensures research building age never exceeds upgrade age', () => {
    for (const upgrade of ALL_UPGRADES) {
      const building = getBuildingData(upgrade.building, upgrade.faction);
      expect(building).toBeDefined();
      expect(
        building!.age <= upgrade.age,
        `Upgrade ${upgrade.id} (Age ${upgrade.age}) researched from building ${building!.id} (Age ${building!.age})`
      ).toBe(true);
    }
  });

  it('ensures AGES table encodes structured requirements', () => {
    expect(AGES[1].requirement).toBeNull();

    const age2Req = AGES[2].requirement;
    expect(age2Req).not.toBeNull();
    expect(age2Req!.minDistinctBuildings).toBeGreaterThanOrEqual(2);
    expect(age2Req!.buildingCategories.length).toBeGreaterThanOrEqual(2);

    const age3Req = AGES[3].requirement;
    expect(age3Req).not.toBeNull();
    expect(age3Req!.requiredCategory).toBe('stable');
    expect(age3Req!.minDistinctBuildings).toBeGreaterThanOrEqual(1);
  });
});

describe('Unit Structural and Behavioral Invariants', () => {
  it('ensures positive hp, non-negative costs, positive speeds, positive radii, and pop >= 1', () => {
    for (const unit of ALL_UNITS) {
      expect(unit.hp).toBeGreaterThan(0);
      expect(unit.food).toBeGreaterThanOrEqual(0);
      expect(unit.gold).toBeGreaterThanOrEqual(0);
      expect(unit.trainTime).toBeGreaterThan(0);
      expect(unit.speed).toBeGreaterThan(0);
      expect(unit.radius).toBeGreaterThan(0);
      expect(unit.pop).toBeGreaterThanOrEqual(1);
      expect(unit.lineOfSight).toBeGreaterThan(0);
    }
  });

  it('ensures archers obey the LOS === range + 2 rule', () => {
    for (const unit of ALL_UNITS) {
      if (unit.tags.includes('archer')) {
        expect(
          unit.lineOfSight,
          `Archer ${unit.id} lineOfSight should equal range + 2`
        ).toBe(unit.range + 2);
      }
    }
  });

  it('ensures units with loadedSpeed travel slower loaded than unloaded', () => {
    for (const unit of ALL_UNITS) {
      if (unit.loadedSpeed !== undefined) {
        expect(unit.loadedSpeed).toBeGreaterThan(0);
        expect(unit.loadedSpeed).toBeLessThan(unit.speed);
      }
    }
  });
});

describe('Building Structural Invariants', () => {
  it('ensures positive hp, non-negative costs, valid dimensions, and line of sight', () => {
    for (const building of ALL_BUILDINGS) {
      expect(building.hp).toBeGreaterThan(0);
      expect(building.gold).toBeGreaterThanOrEqual(0);
      expect(building.food).toBeGreaterThanOrEqual(0);
      expect(building.buildTime).toBeGreaterThan(0);
      expect(building.width).toBeGreaterThanOrEqual(1);
      expect(building.height).toBeGreaterThanOrEqual(1);
      expect(building.lineOfSight).toBeGreaterThanOrEqual(4);
    }
  });

  it('ensures each faction has exactly one Town Center with additionalAge 2', () => {
    for (const faction of ['crown', 'clans'] as const) {
      const tcs = Object.values(BUILDINGS[faction]).filter((b) => b.isTownCenter);
      expect(tcs).toHaveLength(1);
      expect(tcs[0].additionalAge).toBe(2);
      expect(tcs[0].width).toBe(4);
      expect(tcs[0].height).toBe(4);
    }
  });

  it('ensures gates specify both horizontal and vertical orientations', () => {
    for (const building of ALL_BUILDINGS) {
      if (building.isGate) {
        expect(building.gateOrientations).toBeDefined();
        const { horizontal, vertical } = building.gateOrientations!;
        expect(horizontal.width).toBeGreaterThan(0);
        expect(horizontal.height).toBeGreaterThan(0);
        expect(vertical.width).toBeGreaterThan(0);
        expect(vertical.height).toBeGreaterThan(0);
        expect(horizontal.width).toBe(vertical.height);
        expect(horizontal.height).toBe(vertical.width);
      }
    }
  });
});

describe('Machine-Readable Upgrade Invariants', () => {
  it('ensures all upgrades define at least one effect with a valid kind discriminant', () => {
    for (const upgrade of ALL_UPGRADES) {
      expect(upgrade.effects.length).toBeGreaterThan(0);
      for (const eff of upgrade.effects) {
        expect(typeof eff.kind).toBe('string');
        expect(eff.kind.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('Lookup Helpers and Prototype Safety', () => {
  it('ensures lookups do not return inherited Object prototype members', () => {
    const dangerousKeys = ['constructor', '__proto__', 'toString', 'valueOf'];
    for (const key of dangerousKeys) {
      expect(getUnitData(key)).toBeUndefined();
      expect(getUnitData(key, 'crown')).toBeUndefined();
      expect(getUnitData(key, 'clans')).toBeUndefined();

      expect(getBuildingData(key)).toBeUndefined();
      expect(getBuildingData(key, 'crown')).toBeUndefined();
      expect(getBuildingData(key, 'clans')).toBeUndefined();

      expect(getUpgradeData(key)).toBeUndefined();
      expect(getUpgradeData(key, 'crown')).toBeUndefined();
      expect(getUpgradeData(key, 'clans')).toBeUndefined();

      expect(getFactionData(key)).toBeUndefined();
    }
  });

  it('resolves valid entries correctly', () => {
    expect(getUnitData('peasant', 'crown')).toBe(CROWN_UNITS.peasant);
    expect(getUnitData('thrall', 'clans')).toBe(CLANS_UNITS.thrall);
    expect(getBuildingData('keep', 'crown')).toBe(CROWN_BUILDINGS.keep);
    expect(getUpgradeData('heavy_plough', 'crown')).toBe(CROWN_UPGRADES.heavy_plough);
    expect(getFactionData('crown')).toBe(FACTIONS.crown);
    expect(getFactionData('clans')).toBe(FACTIONS.clans);
  });
});

describe('Economy and Faction Config Invariants', () => {
  it('specifies valid starting mine counts and distances', () => {
    expect(ECONOMY.startingState.nearGoldMineDistance.count).toBe(1);
    expect(ECONOMY.startingState.farGoldMineDistance.count).toBe(2);
    expect(ECONOMY.startingState.nearGoldMineDistance.min).toBeLessThan(
      ECONOMY.startingState.nearGoldMineDistance.max
    );
    expect(ECONOMY.startingState.farGoldMineDistance.min).toBeLessThan(
      ECONOMY.startingState.farGoldMineDistance.max
    );
  });

  it('specifies low faith rate multiplier in economy', () => {
    expect(ECONOMY.faith.lowFaithRateMultiplier).toBe(0.5);
  });

  it('encodes typed battle fervor numbers on Clans faction', () => {
    expect(FACTIONS.clans.battleFervor).toBeDefined();
    expect(FACTIONS.clans.battleFervor!.minFaithSurplus).toBe(5);
    expect(FACTIONS.clans.battleFervor!.attackBonus).toBe(1);
  });
});

describe('Terrain Invariants', () => {
  it('covers exactly 7 terrain codes with consistent properties', () => {
    const codes = Object.keys(TERRAIN_PROPERTIES).map(Number);
    expect(codes).toHaveLength(7);
    for (const code of codes) {
      expect(TERRAIN_PROPERTIES[code as keyof typeof TERRAIN_PROPERTIES].code).toBe(code);
    }
  });

  it('shallow water is passable with the shallow speed multiplier', () => {
    expect(isTerrainPassable(TERRAIN_CODES.SHALLOW)).toBe(true);
    expect(getTerrainSpeedMultiplier(TERRAIN_CODES.SHALLOW)).toBe(
      SHALLOW_SPEED_MULTIPLIER
    );
  });

  it('water, forest, and rock are impassable with 0 speed multiplier', () => {
    for (const code of [
      TERRAIN_CODES.WATER,
      TERRAIN_CODES.FOREST,
      TERRAIN_CODES.ROCK,
    ]) {
      expect(isTerrainPassable(code)).toBe(false);
      expect(getTerrainSpeedMultiplier(code)).toBe(0);
    }
  });

  it('returns false/0 for invalid terrain codes', () => {
    expect(isTerrainPassable(999)).toBe(false);
    expect(getTerrainSpeedMultiplier(999)).toBe(0);
  });
});
