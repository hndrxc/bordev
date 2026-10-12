import { describe, expect, it } from 'vitest';
import { type GameMap, Terrain } from '../map.js';
import { World } from '../world.js';
import { Rng } from '../rng.js';
import { updateAuras } from './auras.js';

function makeTestWorld(size = 32): World {
  const map: GameMap = {
    version: 1,
    id: 'auras_test_map',
    name: 'Auras Test Map',
    size,
    players: 2,
    tiles: new Uint8Array(size * size).fill(Terrain.GRASS),
    goldMines: [],
    starts: [
      [4, 4],
      [size - 8, size - 8],
    ],
    doodads: [],
  };
  const world = new World(map, new Rng(42), { 0: 'crown', 1: 'crown' });
  for (let i = 0; i < world.entities.length; i++) {
    const ent = world.entities[i];
    if (ent) world.removeEntity(ent.id);
  }
  world.events.length = 0;

  for (const p of world.players) {
    if (!p) continue;
    p.food = 1000;
    p.gold = 1000;
    p.age = 1;
    p.eliminated = false;
  }

  return world;
}

describe('systems/auras (Sanctuary)', () => {
  describe('timing and rate', () => {
    it('heals own damaged non-siege unit by 1 HP/s (0.05 HP per tick)', () => {
      const world = makeTestWorld();
      const chapel = world.spawnBuilding(0, 'chapel', 10, 10);
      chapel.built = true;

      // Spearman maxHp 45, place nearby at (13, 11) (within 5 tiles of footprint [10, 12]x[10, 12])
      const unit = world.spawnUnit(0, 'spearman', 13, 11);
      unit.hp = 20;

      // 1 tick = 0.05 HP
      updateAuras(world);
      expect(unit.hp).toBeCloseTo(20.05, 5);

      // 19 more ticks = total 20 ticks = 1.0 second = 1.0 HP healed
      for (let t = 0; t < 19; t++) {
        updateAuras(world);
      }
      expect(unit.hp).toBeCloseTo(21.0, 5);

      // Another 20 ticks = 2.0 seconds total = 2.0 HP healed
      for (let t = 0; t < 20; t++) {
        updateAuras(world);
      }
      expect(unit.hp).toBeCloseTo(22.0, 5);
    });
  });

  describe('cap and clamping', () => {
    it('clamps healing to unit maxHp and does not heal units already at maxHp', () => {
      const world = makeTestWorld();
      const chapel = world.spawnBuilding(0, 'chapel', 10, 10);
      chapel.built = true;

      const unit = world.spawnUnit(0, 'spearman', 13, 11);
      unit.hp = unit.maxHp - 0.02; // 44.98 HP with maxHp 45

      updateAuras(world);
      expect(unit.hp).toBe(unit.maxHp); // Clamped exactly to 45

      // Subsequent ticks do not increase HP past maxHp
      updateAuras(world);
      expect(unit.hp).toBe(unit.maxHp);
    });
  });

  describe('range boundary', () => {
    it('heals unit within 5 tiles of footprint, but does not heal unit beyond 5 tiles', () => {
      const world = makeTestWorld();
      // 2x2 chapel at (10, 10). Footprint is X in [10, 12], Z in [10, 12].
      const chapel = world.spawnBuilding(0, 'chapel', 10, 10);
      chapel.built = true;

      // Unit A at (17, 11): dx = 17 - 12 = 5.0, dz = 0 -> distance = 5.0 (within range)
      const unitA = world.spawnUnit(0, 'spearman', 17, 11);
      unitA.hp = 20;

      // Unit B at (17.5, 11): dx = 17.5 - 12 = 5.5, dz = 0 -> distance = 5.5 (out of range)
      const unitB = world.spawnUnit(0, 'spearman', 17.5, 11);
      unitB.hp = 20;

      for (let t = 0; t < 20; t++) {
        updateAuras(world);
      }

      // Unit A received 1.0 HP healing
      expect(unitA.hp).toBeCloseTo(21.0, 5);
      // Unit B was out of range and received no healing
      expect(unitB.hp).toBe(20);
    });
  });

  describe('restrictions: corpses, enemies, unfinished chapels, siege', () => {
    it('does not heal dead units or corpses in remains', () => {
      const world = makeTestWorld();
      const chapel = world.spawnBuilding(0, 'chapel', 10, 10);
      chapel.built = true;

      const deadUnit = world.spawnUnit(0, 'spearman', 13, 11);
      deadUnit.hp = 0;
      deadUnit.deathTick = 5;

      updateAuras(world);
      expect(deadUnit.hp).toBe(0);
    });

    it('does not heal enemy units', () => {
      const world = makeTestWorld();
      const chapel = world.spawnBuilding(0, 'chapel', 10, 10);
      chapel.built = true;

      // Enemy unit belonging to player 1
      const enemy = world.spawnUnit(1, 'spearman', 13, 11);
      enemy.hp = 20;

      for (let t = 0; t < 20; t++) {
        updateAuras(world);
      }

      expect(enemy.hp).toBe(20);
    });

    it('does not heal from unfinished chapels under construction', () => {
      const world = makeTestWorld();
      const chapel = world.spawnBuilding(0, 'chapel', 10, 10);
      chapel.built = false;
      chapel.buildProgress = 0.5;

      const unit = world.spawnUnit(0, 'spearman', 13, 11);
      unit.hp = 20;

      for (let t = 0; t < 20; t++) {
        updateAuras(world);
      }

      expect(unit.hp).toBe(20);
    });

    it('does not heal siege units (trebuchet)', () => {
      const world = makeTestWorld();
      const chapel = world.spawnBuilding(0, 'chapel', 10, 10);
      chapel.built = true;

      const trebuchet = world.spawnUnit(0, 'trebuchet', 13, 11);
      expect(trebuchet.tags).toContain('siege');
      trebuchet.hp = 100;

      for (let t = 0; t < 20; t++) {
        updateAuras(world);
      }

      expect(trebuchet.hp).toBe(100);
    });
  });

  describe('overlapping chapels', () => {
    it('applies additive healing from each completed chapel in range', () => {
      const world = makeTestWorld();
      // Chapel 1 at (10, 10)
      const chapel1 = world.spawnBuilding(0, 'chapel', 10, 10);
      chapel1.built = true;

      // Chapel 2 at (14, 10)
      const chapel2 = world.spawnBuilding(0, 'chapel', 14, 10);
      chapel2.built = true;

      // Unit in range of both chapels
      const unitBoth = world.spawnUnit(0, 'spearman', 13, 11);
      unitBoth.hp = 20;

      // Unit in range of chapel1 only
      const unitOne = world.spawnUnit(0, 'spearman', 8, 11);
      unitOne.hp = 20;

      // Run 20 ticks (1.0 second)
      for (let t = 0; t < 20; t++) {
        updateAuras(world);
      }

      // Two eligible chapels heal 2 HP over 20 ticks
      expect(unitBoth.hp).toBeCloseTo(22.0, 5);
      // One eligible chapel heals 1 HP over 20 ticks
      expect(unitOne.hp).toBeCloseTo(21.0, 5);
    });
  });
});
