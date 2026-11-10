import { describe, expect, it } from 'vitest';
import { Rng } from '../rng.js';
import { World } from '../world.js';
import { makeOpenMap } from '../testFixtures.js';
import { applyAttackCommand, updateCombat } from './combat.js';
import { applyDamage } from './damage.js';
import { isEntityVisibleTo, updateFog } from './fog.js';
import { advanceUnitOrder, updateMovement } from './movement.js';
import { updateProjectiles } from './projectiles.js';
import type { BuildingEntity, ProjectileEntity } from '../entity.js';

function createHarness(size = 40): World {
  const map = makeOpenMap({ size, players: 2 });
  const rng = new Rng(12345);
  return new World(map, rng, { 0: 'crown', 1: 'crown' });
}

describe('Fog of war combat regressions', () => {
  describe('Auto-acquisition & command acceptance require visibility', () => {
    it('idle unit does not auto-acquire hidden enemy in fog, but acquires once visible', () => {
      const world = createHarness(40);
      const spear = world.spawnUnit(0, 'spearman', 5, 5);
      // Enemy placed beyond spear line of sight (LOS ~5)
      const enemy = world.spawnUnit(1, 'spearman', 25, 25);

      updateMovement(world);
      updateFog(world);
      expect(isEntityVisibleTo(world, 0, enemy)).toBe(false);

      // Advance ticks to match acquisition cadence ((tick + unit.id) % 10 === 0)
      for (let t = 0; t < 10; t++) {
        world.tick = t;
        updateCombat(world);
      }
      expect(spear.combat).toBeUndefined();

      // Move enemy into visibility of spearman
      enemy.x = 7;
      enemy.z = 5;
      updateMovement(world);
      updateFog(world);
      expect(isEntityVisibleTo(world, 0, enemy)).toBe(true);

      for (let t = 10; t < 20; t++) {
        world.tick = t;
        updateCombat(world);
        if (spear.combat?.targetRef === enemy) break;
      }

      expect(spear.combat?.targetRef).toBe(enemy);
    });

    it('rejects explicit attack command on target hidden in fog', () => {
      const world = createHarness(40);
      const spear = world.spawnUnit(0, 'spearman', 5, 5);
      const enemy = world.spawnUnit(1, 'spearman', 30, 30);

      updateFog(world);
      expect(isEntityVisibleTo(world, 0, enemy)).toBe(false);

      applyAttackCommand(world, {
        kind: 'attack',
        player: 0,
        ids: [spear.id],
        targetId: enemy.id,
        queued: false,
      });

      expect(spear.order?.kind).not.toBe('attack');
      expect(spear.combat).toBeUndefined();
    });

    it('accepts explicit attack command when target is visible', () => {
      const world = createHarness(40);
      const spear = world.spawnUnit(0, 'spearman', 5, 5);
      const enemy = world.spawnUnit(1, 'spearman', 8, 5);

      updateFog(world);
      expect(isEntityVisibleTo(world, 0, enemy)).toBe(true);

      applyAttackCommand(world, {
        kind: 'attack',
        player: 0,
        ids: [spear.id],
        targetId: enemy.id,
        queued: false,
      });

      expect(spear.order?.kind).toBe('attack');
      expect(spear.combat?.targetRef).toBe(enemy);
    });

    it('watch tower does not acquire or fire at hidden enemy, but shoots when visible', () => {
      const world = createHarness(40);
      // Keep is required for faith rules
      world.spawnBuilding(0, 'keep', 1, 1);
      const tower = world.spawnBuilding(0, 'stone_tower', 10, 10);
      const enemy = world.spawnUnit(1, 'spearman', 30, 30);

      updateMovement(world);
      updateFog(world);
      expect(isEntityVisibleTo(world, 0, enemy)).toBe(false);

      for (let t = 0; t < 10; t++) {
        world.tick = t;
        updateCombat(world);
      }
      expect(tower.combat?.targetRef).toBeUndefined();
      expect(
        world.entities.filter((e) => e && e.kind === 'projectile').length,
      ).toBe(0);

      // Move enemy into attack range and LOS of tower
      enemy.x = 13;
      enemy.z = 10;
      updateMovement(world);
      updateFog(world);
      expect(isEntityVisibleTo(world, 0, enemy)).toBe(true);

      for (let t = 10; t < 20; t++) {
        world.tick = t;
        updateCombat(world);
        if (tower.combat?.targetRef === enemy) break;
      }
      expect(tower.combat?.targetRef).toBe(enemy);

      // Now move enemy back into fog
      enemy.x = 35;
      enemy.z = 35;
      updateMovement(world);
      updateFog(world);
      expect(isEntityVisibleTo(world, 0, enemy)).toBe(false);

      world.tick = 21;
      updateCombat(world);
      expect(tower.combat?.targetRef).toBeUndefined();
    });
  });

  describe('Loss-of-vision tracking & disengagement', () => {
    it('disengages explicit attack order to frozen last-known ground when vision lost, not tracking live hidden coordinates', () => {
      const world = createHarness(40);
      const spear = world.spawnUnit(0, 'spearman', 10, 10);
      const enemy = world.spawnUnit(1, 'spearman', 13, 10);

      updateFog(world);
      expect(isEntityVisibleTo(world, 0, enemy)).toBe(true);

      applyAttackCommand(world, {
        kind: 'attack',
        player: 0,
        ids: [spear.id],
        targetId: enemy.id,
        queued: false,
      });

      expect(spear.order?.kind).toBe('attack');
      expect(spear.combat?.targetRef).toBe(enemy);

      // Enemy moves into fog
      enemy.previousX = 13;
      enemy.previousZ = 10;
      enemy.x = 30;
      enemy.z = 30;
      updateFog(world);
      expect(isEntityVisibleTo(world, 0, enemy)).toBe(false);

      world.tick++;
      updateCombat(world);

      // Combat must be disengaged
      expect(spear.combat).toBeUndefined();
      // Order converted to move toward last-known ground
      expect(spear.order?.kind).toBe('move');
      expect(spear.order?.x).toBe(13);
      expect(spear.order?.z).toBe(10);

      // Further hidden movement in fog does NOT update spear's destination
      enemy.x = 38;
      enemy.z = 38;
      world.tick++;
      updateCombat(world);
      expect(spear.order?.x).toBe(13);
      expect(spear.order?.z).toBe(10);
    });

    it('maintains queued order semantics when vision is lost on attack order', () => {
      const world = createHarness(40);
      const spear = world.spawnUnit(0, 'spearman', 10, 10);
      const enemy = world.spawnUnit(1, 'spearman', 13, 10);

      updateFog(world);
      applyAttackCommand(world, {
        kind: 'attack',
        player: 0,
        ids: [spear.id],
        targetId: enemy.id,
        queued: false,
      });

      // Queue a follow-up move order
      spear.orders.push({ kind: 'move', x: 2, z: 2 });

      // Enemy retreats into fog
      enemy.previousX = 13;
      enemy.previousZ = 10;
      enemy.x = 35;
      enemy.z = 35;
      updateFog(world);

      world.tick++;
      updateCombat(world);

      // Active order became move to last-known ground (13, 10)
      expect(spear.order?.kind).toBe('move');
      expect(spear.order?.x).toBe(13);
      expect(spear.order?.z).toBe(10);
      // Queued orders remain preserved for when the move completes
      expect(spear.orders.length).toBe(1);
      expect(spear.orders[0]).toEqual({ kind: 'move', x: 2, z: 2 });
    });

    it('attackMove disengages lost target and resumes destination path', () => {
      const world = createHarness(40);
      const spear = world.spawnUnit(0, 'spearman', 5, 5);
      spear.order = { kind: 'attackMove', x: 35, z: 5 };

      const enemy = world.spawnUnit(1, 'spearman', 8, 5);
      updateMovement(world);
      updateFog(world);

      // Spearman auto-acquires visible enemy during attack-move
      for (let t = 0; t < 10; t++) {
        world.tick = t;
        updateCombat(world);
        if (spear.combat?.targetRef === enemy) break;
      }
      expect(spear.combat?.targetRef).toBe(enemy);

      // Enemy moves into fog
      enemy.x = 25;
      enemy.z = 25;
      updateMovement(world);
      updateFog(world);
      expect(isEntityVisibleTo(world, 0, enemy)).toBe(false);

      world.tick++;
      updateCombat(world);
      // Combat disengaged, order remains attackMove toward original destination
      expect(spear.combat).toBeUndefined();
      expect(spear.order?.kind).toBe('attackMove');
      expect(spear.order?.x).toBe(35);
      expect(spear.order?.z).toBe(5);
      expect(spear.pathPending).toBe(true);
    });

    it('ranged unit in range remains stationary during attack and lands hit without drifting toward target', () => {
      const world = createHarness(40);
      const archer = world.spawnUnit(0, 'longbowman', 10, 10);
      const cart = world.spawnUnit(1, 'ox_cart', 15, 10);
      const initialHp = cart.hp;

      updateMovement(world);
      updateFog(world);
      expect(isEntityVisibleTo(world, 0, cart)).toBe(true);

      applyAttackCommand(world, {
        kind: 'attack',
        player: 0,
        ids: [archer.id],
        targetId: cart.id,
        queued: false,
      });

      // Target is in range (distance 5.0 <= range 6.0). Step combat, movement, and projectiles.
      for (let t = 0; t < 30; t++) {
        world.tick = t;
        updateMovement(world);
        updateProjectiles(world);
        updateCombat(world);
        updateFog(world);
        // Archer must remain completely stationary at original position (never drifting toward target)
        expect(archer.x).toBe(10);
        expect(archer.z).toBe(10);
        if (cart.hp < initialHp) break;
      }

      // First shot released and successfully hit target without archer advancing
      expect(cart.hp).toBeLessThan(initialHp);
      expect(archer.x).toBe(10);
      expect(archer.z).toBe(10);
    });

    it('queued attack order on visible enemy freezes last-known ground and stops at frozen destination when promoted in fog', () => {
      const world = createHarness(40);
      const spear = world.spawnUnit(0, 'spearman', 10, 10);
      const enemy = world.spawnUnit(1, 'spearman', 14, 10);

      updateFog(world);
      expect(isEntityVisibleTo(world, 0, enemy)).toBe(true);

      // Make spear busy with a move order
      spear.order = { kind: 'move', x: 10.5, z: 10 };

      // Queue an attack on the visible enemy
      applyAttackCommand(world, {
        kind: 'attack',
        player: 0,
        ids: [spear.id],
        targetId: enemy.id,
        queued: true,
      });

      expect(spear.orders).toHaveLength(1);
      expect(spear.orders[0].kind).toBe('attack');

      // Enemy moves deep into fog while spear is still executing initial move
      enemy.previousX = 14;
      enemy.previousZ = 10;
      enemy.x = 35;
      enemy.z = 35;
      updateFog(world);
      expect(isEntityVisibleTo(world, 0, enemy)).toBe(false);

      // Complete the move order so queued attack order advances
      spear.x = 10.5;
      spear.z = 10;
      advanceUnitOrder(world, spear);

      expect(spear.order?.kind).toBe('attack');

      // Combat step detects target is hidden in fog: converts to move order targeting frozen last-known (14, 10)
      world.tick++;
      updateCombat(world);

      expect(spear.combat).toBeUndefined();
      expect(spear.order?.kind).toBe('move');
      expect(spear.order?.x).toBe(14);
      expect(spear.order?.z).toBe(10);
    });

    it('abandons unreachable hidden retaliation target after approach path is spent', () => {
      const world = createHarness(40);
      const spear = world.spawnUnit(0, 'spearman', 10, 10);
      // Place a continuous stone wall barrier across the map at x = 15
      for (let z = 0; z < 40; z++) {
        world.spawnBuilding(1, 'stone_wall', 15, z);
      }
      // The firing origin stays beyond LOS even at the nearest reachable wall edge.
      const enemy = world.spawnUnit(1, 'trebuchet', 26, 10);

      updateMovement(world);
      updateFog(world);
      expect(isEntityVisibleTo(world, 0, enemy)).toBe(false);

      // Simulate retaliation from fog with projectile origin captured
      const projectile = { originX: 26, originZ: 10 } as ProjectileEntity;
      applyDamage(world, spear, 5, enemy, projectile);

      // Spearman requests chase path to last-known attack origin
      world.tick = 0;
      updateCombat(world);
      expect(spear.pathPending).toBe(true);

      // Step movement and combat until spear reaches the wall and path is spent
      for (let t = 1; t < 300; t++) {
        world.tick = t;
        updateMovement(world);
        updateFog(world);
        updateCombat(world);
        if (!spear.combat) break;
      }

      // Approach path is spent and spot is unreachable: spearman must abandon combat
      expect(spear.combat).toBeUndefined();
      expect(spear.order?.kind).toBe('idle');

      // Spearman can now auto-acquire a visible enemy that appears on its side of the wall
      const visibleEnemy = world.spawnUnit(1, 'spearman', 11, 10);
      updateMovement(world);
      updateFog(world);
      expect(isEntityVisibleTo(world, 0, visibleEnemy)).toBe(true);

      for (let t = 0; t < 15; t++) {
        world.tick++;
        updateCombat(world);
        if (spear.combat?.targetRef === visibleEnemy) break;
      }
      expect(spear.combat?.targetRef).toBe(visibleEnemy);
    });
  });

  describe('Visible combat and breach regression', () => {
    it('continuous combat against visible target applies damage normally', () => {
      const world = createHarness(40);
      const spear = world.spawnUnit(0, 'spearman', 10, 10);
      const enemy = world.spawnUnit(1, 'spearman', 11, 10);
      const initialHp = enemy.hp;

      updateFog(world);
      expect(isEntityVisibleTo(world, 0, enemy)).toBe(true);

      applyAttackCommand(world, {
        kind: 'attack',
        player: 0,
        ids: [spear.id],
        targetId: enemy.id,
        queued: false,
      });

      expect(spear.combat?.targetRef).toBe(enemy);

      // Step combat until hit lands
      for (let t = 0; t < 40; t++) {
        world.tick = t;
        updateCombat(world);
        if (enemy.hp < initialHp) break;
      }

      expect(enemy.hp).toBeLessThan(initialHp);
    });

    it('breach targeting resolves blocking wall for visible enemy goal', () => {
      const world = createHarness(40);
      // Place a spearman at (10, 10)
      const spear = world.spawnUnit(0, 'spearman', 10, 10);
      // Place an enclosed ring of walls around the enemy at (14, 10)
      // The west wall at (12, 10) directly blocks spearman's route to enemy
      let breachWall: BuildingEntity | undefined;
      for (let x = 12; x <= 16; x++) {
        for (let z = 8; z <= 12; z++) {
          if (x === 12 || x === 16 || z === 8 || z === 12) {
            const b = world.spawnBuilding(1, 'stone_wall', x, z);
            if (x === 12 && z === 10) {
              breachWall = b;
            }
          }
        }
      }
      expect(breachWall).toBeDefined();

      // Place an enemy unit behind the wall at (14, 10), but still in spear's LOS (distance ~4)
      const enemy = world.spawnUnit(1, 'spearman', 14, 10);

      updateMovement(world);
      updateFog(world);
      expect(isEntityVisibleTo(world, 0, enemy)).toBe(true);

      applyAttackCommand(world, {
        kind: 'attack',
        player: 0,
        ids: [spear.id],
        targetId: enemy.id,
        queued: false,
      });

      // Goal is the enemy unit, but combat target is the blocking wall
      world.tick = 0;
      updateCombat(world);

      expect(spear.combat?.goalRef).toBe(enemy);
      expect(spear.combat?.targetRef).toBe(breachWall);
    });
  });
});
