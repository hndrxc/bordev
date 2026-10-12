import { describe, expect, it } from 'vitest';
import { type GameMap, Terrain } from '../map.js';
import { World } from '../world.js';
import { Rng } from '../rng.js';
import {
  PROJECTILE_SPEED,
  TREBUCHET_PROJECTILE_SPEED,
} from '../../data/combat.js';
import { spawnProjectile, updateProjectiles } from './projectiles.js';
import { calculateDamage } from './damage.js';

function makeTestWorld(size = 32): World {
  const map: GameMap = {
    version: 1,
    id: 'projectile_test_map',
    name: 'Projectile Test Map',
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
  // Clean up starting units/buildings for an isolated test environment
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

describe('systems/projectiles', () => {
  describe('travel time & launch behavior', () => {
    it('arrow travels at speed 8 and applies damage only on arrival, not at launch', () => {
      const world = makeTestWorld();
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
      const world = makeTestWorld();
      // Trebuchet at (10, 10), enemy building at (20, 10) -> distance 10 tiles to center
      const treb = world.spawnUnit(0, 'trebuchet', 10, 10);
      // 2x2 building at (19, 9) has center at (19 + 1, 9 + 1) = (20, 10)
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
      const world = makeTestWorld();
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
      const world = makeTestWorld();
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
      const world = makeTestWorld();
      const archer = world.spawnUnit(0, 'longbowman', 10, 10);
      const target1 = world.spawnUnit(1, 'spearman', 20, 10);
      const originalTargetId = target1.id;

      const proj = spawnProjectile(world, archer, target1, 10);

      // Advance 5 ticks
      for (let t = 0; t < 5; t++) {
        updateProjectiles(world);
      }
      expect(world.getEntity(proj.id)).toBeDefined();

      // Original target is killed / removed mid-flight by another cause
      world.removeEntity(target1.id);

      // Spawn a new entity which deterministically recycles the released ID
      const newUnit = world.spawnUnit(1, 'knight', 20, 10);
      expect(newUnit.id).toBe(originalTargetId);
      const newUnitInitialHp = newUnit.hp;

      // Update projectiles: projectile must detect targetRef !== world.getEntity(targetId)
      // and safely clean up without damaging the new unit!
      updateProjectiles(world);

      expect(world.getEntity(proj.id)).toBeUndefined();
      expect(newUnit.hp).toBe(newUnitInitialHp);
    });

    it('cleans up projectile if target died / entered remains before impact', () => {
      const world = makeTestWorld();
      const archer = world.spawnUnit(0, 'longbowman', 10, 10);
      const target = world.spawnUnit(1, 'spearman', 20, 10);

      const proj = spawnProjectile(world, archer, target, 10);

      updateProjectiles(world);
      expect(world.getEntity(proj.id)).toBeDefined();

      // Target dies (hp set to 0 and deathTick set)
      target.hp = 0;
      target.deathTick = 100;

      updateProjectiles(world);
      expect(world.getEntity(proj.id)).toBeUndefined();
    });

    it('cleans up projectile harmlessly if target changes ownership to ally/same player', () => {
      const world = makeTestWorld();
      const archer = world.spawnUnit(0, 'longbowman', 10, 10);
      const target = world.spawnUnit(1, 'spearman', 20, 10);
      const initialHp = target.hp;

      const proj = spawnProjectile(world, archer, target, 10);

      updateProjectiles(world);
      expect(world.getEntity(proj.id)).toBeDefined();

      // Ownership changes to ally / same player
      target.player = 0;

      updateProjectiles(world);
      expect(world.getEntity(proj.id)).toBeUndefined();
      expect(target.hp).toBe(initialHp);
    });
  });

  describe('siege armor ignored via actual impact', () => {
    it('trebuchet stone bypasses stone tower armor on impact', () => {
      const world = makeTestWorld();
      const treb = world.spawnUnit(0, 'trebuchet', 10, 10);
      // Stone tower has 1000 HP, 8 pierce armor, 3 melee armor
      const tower = world.spawnBuilding(1, 'stone_tower', 18, 9);
      expect(tower.pierceArmor).toBe(8);

      // Trebuchet calculates damage using siege attackType (ignoring armor)
      const dmg = calculateDamage(treb, tower);
      // Trebuchet base attack 200 + bonus building 250 = 450 (armor ignored!)
      expect(dmg).toBe(450);

      spawnProjectile(world, treb, tower, dmg);

      // Before impact: full 1000 HP
      const initialHp = tower.hp;
      expect(initialHp).toBe(1000);

      // Run until projectile impacts (distance ~10 tiles at 5 tiles/s = 40 ticks)
      for (let t = 0; t < 40; t++) {
        updateProjectiles(world);
      }

      // Exactly 450 damage applied on impact (ignoring the 8 pierce armor)
      expect(tower.hp).toBe(550);
    });
  });
});
