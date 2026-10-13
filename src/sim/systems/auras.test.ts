import { describe, expect, it } from 'vitest';
import { makeOpenSim } from '../testFixtures.js';
import { applyDamage } from './damage.js';

describe('systems/auras (Sanctuary)', () => {
  describe('timing and rate', () => {
    it('heals own damaged non-siege unit by exact integer HP once per second through Sim.step', () => {
      const sim = makeOpenSim({ size: 32 });
      const world = sim.world;

      // Spawn real completed Chapel using default built = true from World API
      const chapel = world.spawnBuilding(0, 'chapel', 10, 10);
      expect(chapel.built).toBe(true);

      // Spearman maxHp 45, place nearby at (13, 11) (within 5 tiles of footprint [10, 12]x[10, 12])
      const unit = world.spawnUnit(0, 'spearman', 13, 11);
      unit.hp = 20;

      // Advance 19 ticks: unit should remain at exactly 20 HP
      for (let t = 0; t < 19; t++) {
        sim.step();
      }
      // Note: tick 0 is a 20-tick boundary (0 % 20 === 0), so it healed +1 HP on tick 0
      expect(unit.hp).toBe(21);

      // 20th tick completes the first 20 ticks (1.0 second)
      sim.step();
      expect(unit.hp).toBe(21);

      // Step to the next 1-second boundary (tick 20 processed during step 21)
      sim.step();
      expect(unit.hp).toBe(22);

      // Run another 19 ticks (ticks 21 to 39 processed)
      for (let t = 0; t < 19; t++) {
        sim.step();
      }
      expect(unit.hp).toBe(22);

      // Tick 40 boundary processed: heals another 1 HP
      sim.step();
      expect(unit.hp).toBe(23);
    });
  });

  describe('cap and clamping', () => {
    it('clamps healing to unit maxHp and does not heal units already at maxHp', () => {
      const sim = makeOpenSim({ size: 32 });
      const world = sim.world;
      world.spawnBuilding(0, 'chapel', 10, 10);

      const unit = world.spawnUnit(0, 'spearman', 13, 11);
      unit.hp = unit.maxHp - 1; // 44 HP with maxHp 45

      // Step past healing tick
      sim.step();
      expect(unit.hp).toBe(unit.maxHp); // Clamped exactly to 45

      // Subsequent ticks do not increase HP past maxHp
      for (let t = 0; t < 40; t++) {
        sim.step();
      }
      expect(unit.hp).toBe(unit.maxHp);
    });
  });

  describe('range boundary', () => {
    it('heals unit within 5 tiles of footprint, but does not heal unit beyond 5 tiles', () => {
      const sim = makeOpenSim({ size: 32 });
      const world = sim.world;

      // 2x2 chapel at (10, 10). Footprint is X in [10, 12], Z in [10, 12].
      world.spawnBuilding(0, 'chapel', 10, 10);

      // Unit A at (17, 11): dx = 17 - 12 = 5.0, dz = 0 -> distance = 5.0 (within range)
      const unitA = world.spawnUnit(0, 'spearman', 17, 11);
      unitA.hp = 20;

      // Unit B at (17.5, 11): dx = 17.5 - 12 = 5.5, dz = 0 -> distance = 5.5 (out of range)
      const unitB = world.spawnUnit(0, 'spearman', 17.5, 11);
      unitB.hp = 20;

      for (let t = 0; t < 20; t++) {
        sim.step();
      }

      // Unit A received 1 HP healing
      expect(unitA.hp).toBe(21);
      // Unit B was out of range and received no healing
      expect(unitB.hp).toBe(20);
    });
  });

  describe('restrictions: corpses, enemies, allies, unfinished chapels, siege', () => {
    it('does not heal corpses in world.remains', () => {
      const sim = makeOpenSim({ size: 32 });
      const world = sim.world;
      world.spawnBuilding(0, 'chapel', 10, 10);

      const deadUnit = world.spawnUnit(0, 'spearman', 13, 11);
      applyDamage(world, deadUnit, 999);
      expect(world.remains.includes(deadUnit)).toBe(true);
      expect(world.getEntity(deadUnit.id)).toBeUndefined();
      expect(deadUnit.hp).toBe(0);

      for (let t = 0; t < 20; t++) {
        sim.step();
      }
      expect(deadUnit.hp).toBe(0);
    });

    it('does not heal enemy units', () => {
      const sim = makeOpenSim({ size: 32 });
      const world = sim.world;
      world.spawnBuilding(0, 'chapel', 10, 10);

      // Enemy unit belonging to player 1
      const enemy = world.spawnUnit(1, 'spearman', 13, 11);
      enemy.hp = 20;

      for (let t = 0; t < 20; t++) {
        sim.step();
      }

      expect(enemy.hp).toBe(20);
    });

    it('does not heal allied (not own) units', () => {
      const sim = makeOpenSim({ size: 32 });
      const world = sim.world;
      world.setTeam(0, 0);
      world.setTeam(1, 0); // Player 1 is allied with player 0

      world.spawnBuilding(0, 'chapel', 10, 10);

      const ally = world.spawnUnit(1, 'spearman', 13, 11);
      ally.hp = 20;

      for (let t = 0; t < 20; t++) {
        sim.step();
      }

      expect(ally.hp).toBe(20);
    });

    it('does not heal from unfinished chapels under construction', () => {
      const sim = makeOpenSim({ size: 32 });
      const world = sim.world;
      const chapel = world.spawnBuilding(0, 'chapel', 10, 10, false);
      expect(chapel.built).toBe(false);

      const unit = world.spawnUnit(0, 'spearman', 13, 11);
      unit.hp = 20;

      for (let t = 0; t < 20; t++) {
        sim.step();
      }

      expect(unit.hp).toBe(20);
    });

    it('does not heal siege units (trebuchet)', () => {
      const sim = makeOpenSim({ size: 32 });
      const world = sim.world;
      world.spawnBuilding(0, 'chapel', 10, 10);

      const trebuchet = world.spawnUnit(0, 'trebuchet', 13, 11);
      expect(trebuchet.tags).toContain('siege');
      trebuchet.hp = 100;

      for (let t = 0; t < 20; t++) {
        sim.step();
      }

      expect(trebuchet.hp).toBe(100);
    });
  });

  describe('overlapping chapels', () => {
    it('applies additive integer healing from each completed chapel in range', () => {
      const sim = makeOpenSim({ size: 32 });
      const world = sim.world;

      // Chapel 1 at (10, 10)
      world.spawnBuilding(0, 'chapel', 10, 10);

      // Chapel 2 at (14, 10)
      world.spawnBuilding(0, 'chapel', 14, 10);

      // Unit in range of both chapels
      const unitBoth = world.spawnUnit(0, 'spearman', 13, 11);
      unitBoth.hp = 20;

      // Unit in range of chapel 1 only
      const unitOne = world.spawnUnit(0, 'spearman', 8, 11);
      unitOne.hp = 20;

      // Run 20 ticks (1.0 second)
      for (let t = 0; t < 20; t++) {
        sim.step();
      }

      // Two eligible chapels heal 2 HP
      expect(unitBoth.hp).toBe(22);
      // One eligible chapel heals 1 HP
      expect(unitOne.hp).toBe(21);
    });
  });

  describe('lethal damage after healing (regression for Damage#4)', () => {
    it('kills unit when applying damage equal to exact nominal HP after healing', () => {
      const sim = makeOpenSim({ size: 32 });
      const world = sim.world;
      world.spawnBuilding(0, 'chapel', 10, 10);

      const unit = world.spawnUnit(0, 'spearman', 13, 11);
      unit.hp = 20;

      // 100 ticks = 5 s => 5 healing ticks => exact nominal HP is 25
      for (let t = 0; t < 100; t++) {
        sim.step();
      }
      expect(unit.hp).toBe(25);

      const enemy = world.spawnUnit(1, 'spearman', 14, 11);
      applyDamage(world, unit, 25, enemy);

      expect(world.getEntity(unit.id)).toBeUndefined();
      expect(world.remains.includes(unit)).toBe(true);
      expect(unit.hp).toBe(0);
    });
  });
});
