import { describe, expect, it } from 'vitest';
import { makeOpenMap } from '../testFixtures.js';
import { World } from '../world.js';
import { Rng } from '../rng.js';
import {
  PROJECTILE_SPEED,
  TREBUCHET_PROJECTILE_SPEED,
} from '../../data/combat.js';
import { spawnProjectile, updateProjectiles } from './projectiles.js';
import { applyDamage } from './damage.js';
import { Sim } from '../sim.js';

function createHarnessWorld(size = 32): World {
  return new World(makeOpenMap({ size }), new Rng(42), {
    0: 'crown',
    1: 'crown',
  });
}

describe('systems/projectiles', () => {
  describe('travel time & launch behavior', () => {
    it('arrow travels at speed 8 and applies damage only on arrival, not at launch', () => {
      const world = createHarnessWorld();
      // Shooter at (10, 10), target at (18, 10) -> distance exactly 8 tiles
      const archer = world.spawnUnit(0, 'longbowman', 10, 10);
      const enemy = world.spawnUnit(1, 'spearman', 18, 10);
      const initialHp = enemy.hp;
      const damage = 5;

      const proj = spawnProjectile(world, archer, enemy, damage);

      expect(proj.visualKind).toBe('arrow');
      expect(proj.speed).toBe(PROJECTILE_SPEED);
      expect(proj.damage).toBe(damage);

      // No damage at launch!
      expect(enemy.hp).toBe(initialHp);

      // Distance 8 tiles at 8 tiles/s = 1.0 second = 20 ticks at SIM_DT = 0.05 (0.4 tiles/tick)
      // Step 19 ticks: projectile should still be in flight and target unharmed
      for (let t = 0; t < 19; t++) {
        updateProjectiles(world);
        expect(enemy.hp).toBe(initialHp);
        expect(world.getEntity(proj.id)).toBeDefined();
        expect(proj.flightProgress).toBeGreaterThan(0);
        expect(proj.flightProgress).toBeLessThan(1);
      }

      // 20th tick: impact!
      updateProjectiles(world);
      expect(enemy.hp).toBe(initialHp - damage);
      // Projectile should be removed on impact
      expect(world.getEntity(proj.id)).toBeUndefined();
    });

    it('trebuchet stone travels at speed 5 and takes exact ticks to arrival', () => {
      const world = createHarnessWorld();
      // Trebuchet at (10, 10), enemy building at (19, 9) -> distance 10 tiles to center (20, 10)
      const treb = world.spawnUnit(0, 'trebuchet', 10, 10);
      const targetBuilding = world.spawnBuilding(1, 'chapel', 19, 9);
      const initialHp = targetBuilding.hp;
      const damage = 450;

      const proj = spawnProjectile(world, treb, targetBuilding, damage);

      expect(proj.visualKind).toBe('stone');
      expect(proj.speed).toBe(TREBUCHET_PROJECTILE_SPEED);

      // Distance 10 at 5 tiles/s = 2.0 seconds = 40 ticks (0.25 tiles/tick)
      for (let t = 0; t < 39; t++) {
        updateProjectiles(world);
        expect(targetBuilding.hp).toBe(initialHp);
      }

      // 40th tick: impact!
      updateProjectiles(world);
      expect(targetBuilding.hp).toBe(initialHp - damage);
      expect(world.getEntity(proj.id)).toBeUndefined();
    });

    it('populates previous positions for render interpolation and flight progress monotonically increases', () => {
      const world = createHarnessWorld();
      const archer = world.spawnUnit(0, 'longbowman', 10, 10);
      const enemy = world.spawnUnit(1, 'spearman', 18, 10);

      const proj = spawnProjectile(world, archer, enemy, 5);

      let prevFlightProgress = 0;
      for (let t = 0; t < 20; t++) {
        const lastX = proj.x;
        const lastZ = proj.z;
        updateProjectiles(world);

        if (world.getEntity(proj.id)) {
          expect(proj.previousX).toBeCloseTo(lastX, 5);
          expect(proj.previousZ).toBeCloseTo(lastZ, 5);
          expect(proj.flightProgress).toBeGreaterThanOrEqual(
            prevFlightProgress,
          );
          prevFlightProgress = proj.flightProgress;
        }
      }
    });
  });

  describe('moving target homing', () => {
    it('homes towards a moving target and never misses', () => {
      const world = createHarnessWorld();
      const archer = world.spawnUnit(0, 'longbowman', 10, 10);
      const target = world.spawnUnit(1, 'spearman', 14, 10);
      const initialHp = target.hp;
      const damage = 5;

      const proj = spawnProjectile(world, archer, target, damage);

      // Simulate the target moving diagonally away each tick at speed 2
      let hit = false;
      for (let t = 0; t < 60; t++) {
        target.x += 0.05;
        target.z += 0.05;
        updateProjectiles(world);

        if (world.getEntity(proj.id) === undefined) {
          hit = true;
          break;
        }
      }

      expect(hit).toBe(true);
      expect(target.hp).toBe(initialHp - damage);
    });
  });

  describe('recycled ID safety & target removal', () => {
    it('does not damage newly spawned unit with recycled ID if original target was removed mid-flight', () => {
      const world = createHarnessWorld();
      const archer = world.spawnUnit(0, 'longbowman', 10, 10);
      const target1 = world.spawnUnit(1, 'spearman', 20, 10);
      const originalTargetId = target1.id;

      const proj = spawnProjectile(world, archer, target1, 10);

      // Advance 5 ticks
      for (let t = 0; t < 5; t++) {
        updateProjectiles(world);
      }
      expect(world.getEntity(proj.id)).toBeDefined();

      // Original target is removed mid-flight
      world.removeEntity(target1.id);

      // Spawn a new entity which deterministically recycles the released ID
      const newUnit = world.spawnUnit(1, 'knight', 20, 10);
      expect(newUnit.id).toBe(originalTargetId);
      const newUnitInitialHp = newUnit.hp;

      // Update projectiles: projectile detects target identity mismatch and safely cleans up
      updateProjectiles(world);

      expect(world.getEntity(proj.id)).toBeUndefined();
      expect(newUnit.hp).toBe(newUnitInitialHp);
    });

    it('cleans up projectile without error if target died and entered remains before impact (rewritten from SimTests#12)', () => {
      const world = createHarnessWorld();
      const archer = world.spawnUnit(0, 'longbowman', 10, 10);
      const target = world.spawnUnit(1, 'spearman', 20, 10);

      const proj = spawnProjectile(world, archer, target, 10);

      updateProjectiles(world);
      expect(world.getEntity(proj.id)).toBeDefined();

      // Target legitimately dies from combat/damage and is moved to remains
      applyDamage(world, target, 999);
      expect(world.remains.includes(target)).toBe(true);
      expect(world.getEntity(target.id)).toBeUndefined();

      // Update projectiles: projectile must vanish without error
      updateProjectiles(world);
      expect(world.getEntity(proj.id)).toBeUndefined();
      expect(target.hp).toBe(0);
    });

    it('safely reuses freed projectile entity IDs for subsequent entity allocations', () => {
      const world = createHarnessWorld();
      const archer = world.spawnUnit(0, 'longbowman', 10, 10);
      const target = world.spawnUnit(1, 'spearman', 18, 10);

      const proj1 = spawnProjectile(world, archer, target, 5);
      const freedId = proj1.id;

      // Advance until proj1 reaches target and completes
      for (let t = 0; t < 20; t++) {
        updateProjectiles(world);
      }
      expect(world.getEntity(freedId)).toBeUndefined();

      // Spawn a second projectile which reuses freedId
      const proj2 = spawnProjectile(world, archer, target, 10);
      expect(proj2.id).toBe(freedId);
      expect(proj2.flightProgress).toBe(0);
      expect(proj2.damage).toBe(10);

      // Ensure proj2 updates cleanly
      updateProjectiles(world);
      expect(proj2.flightProgress).toBeGreaterThan(0);
    });
  });

  describe('shooter death and fixed damage', () => {
    it('damage is fixed at release and arrows still hit after the shooter dies', () => {
      const world = createHarnessWorld();
      const archer = world.spawnUnit(0, 'longbowman', 10, 10);
      const target = world.spawnUnit(1, 'spearman', 18, 10);
      const initialHp = target.hp;
      const damage = 12;

      const proj = spawnProjectile(world, archer, target, damage);
      const projId = proj.id;

      // Shooter killed mid-flight by another combatant
      applyDamage(world, archer, 999);
      expect(world.getEntity(archer.id)).toBeUndefined();

      // Projectile still in flight
      for (let t = 0; t < 19; t++) {
        updateProjectiles(world);
        expect(world.getEntity(projId)).toBeDefined();
        expect(target.hp).toBe(initialHp);
      }

      // 20th tick: arrow impacts and applies the full fixed damage
      updateProjectiles(world);
      expect(world.getEntity(projId)).toBeUndefined();
      expect(target.hp).toBe(initialHp - damage);
    });
  });

  describe('siege attack classification: stones vs rams', () => {
    it('trebuchets fire stone projectiles, but battering rams strike in melee reach and never spawn projectiles', () => {
      const sim = new Sim(makeOpenMap({ size: 32 }), 1, {
        0: 'clans',
        1: 'crown',
      });
      const world = sim.world;

      // 1. Trebuchet (ranged siege) fires stone projectile
      const treb = world.spawnUnit(1, 'trebuchet', 10, 10);
      const warShrine = world.spawnBuilding(0, 'war_shrine', 20, 10);
      const stoneProj = spawnProjectile(world, treb, warShrine, 450);
      expect(stoneProj.visualKind).toBe('stone');
      expect(stoneProj.speed).toBe(TREBUCHET_PROJECTILE_SPEED);
      world.removeEntity(stoneProj.id);
      world.removeEntity(treb.id);
      world.removeEntity(warShrine.id);
      // 2. Clans battering ram (range 0 siege) attacks in melee reach without spawning projectiles
      const ram = world.spawnUnit(0, 'battering_ram', 10, 10);
      const targetBldg = world.spawnBuilding(1, 'chapel', 11, 10);
      const initialBldgHp = targetBldg.hp;

      sim.issue({
        kind: 'attack',
        player: 0,
        ids: [ram.id],
        targetId: targetBldg.id,
        queued: false,
      });

      let projectileObserved = false;
      for (let t = 0; t < 60; t++) {
        sim.step();
        for (let i = 0; i < world.entities.length; i++) {
          const e = world.entities[i];
          if (e && e.kind === 'projectile') {
            projectileObserved = true;
          }
        }
      }

      // Ram damaged the building directly
      expect(targetBldg.hp).toBeLessThan(initialBldgHp);
      // No projectile was ever spawned by the ram attack
      expect(projectileObserved).toBe(false);
    });
  });
});
