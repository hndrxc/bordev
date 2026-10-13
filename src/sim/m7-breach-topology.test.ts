import { describe, expect, it } from 'vitest';
import type { BuildingEntity } from './entity.js';
import { Terrain } from './map.js';
import type { Sim } from './sim.js';
import { canEngage, resolveAttackTarget } from './systems/breach.js';
import { makeOpenSim } from './testFixtures.js';

const MAP_SIZE = 32;

/** Hollow square ring of 1x1 stone walls spanning x/z in [lo, hi]. */
function buildRing(
  sim: Sim,
  owner: number,
  lo: number,
  hi: number,
): BuildingEntity[] {
  const walls: BuildingEntity[] = [];
  for (let x = lo; x <= hi; x++) {
    for (let z = lo; z <= hi; z++) {
      if (x === lo || x === hi || z === lo || z === hi) {
        walls.push(sim.world.spawnBuilding(owner, 'stone_wall', x, z, true));
      }
    }
  }
  return walls;
}

describe('M7 breach topology', () => {
  it('chooses a wall whose removal actually breaches the ring, never an unrelated spur', () => {
    const sim = makeOpenSim({ size: MAP_SIZE });
    const { world } = sim;
    buildRing(sim, 1, 10, 14);
    // Spur toward the attacker that separates nothing.
    for (let x = 6; x <= 9; x++) {
      world.spawnBuilding(1, 'stone_wall', x, 12, true);
    }
    const target = world.spawnUnit(1, 'peasant', 12.5, 12.9);
    const attacker = world.spawnUnit(0, 'man_at_arms', 3.5, 12.5);

    expect(canEngage(world, attacker, target)).toBe(false);
    const wall = resolveAttackTarget(world, attacker, target);
    expect(wall).toBeDefined();
    expect(wall?.kind).toBe('building');
    if (wall && wall.kind === 'building') {
      // Only (10,11) and (10,13) reach the interior: (10,12) is shielded by the
      // spur tile (9,12) and diagonal moves cannot cut the corners.
      expect(wall.x).toBe(10);
      expect([11, 13]).toContain(wall.z);
      expect(resolveAttackTarget(world, attacker, target)).toBe(wall);

      world.removeEntity(wall.id);
      expect(canEngage(world, attacker, target)).toBe(true);
      expect(resolveAttackTarget(world, attacker, target)).toBe(target);
    }
  });

  // SimTests#5: Layered breach end-to-end through combat (outer wall falls, then inner, then target dies)
  it('breaches multiple wall layers in sequence along the real route through combat until target dies', () => {
    const sim = makeOpenSim({ size: MAP_SIZE });
    const { world } = sim;
    const outerWalls = buildRing(sim, 1, 8, 16);
    const innerWalls = buildRing(sim, 1, 10, 14);
    // Set 3 HP (1 melee hit by man-at-arms dealing 3 damage to walls)
    for (const w of outerWalls) {
      w.hp = 3;
    }
    for (const w of innerWalls) {
      w.hp = 3;
    }

    const target = world.spawnUnit(1, 'peasant', 12.5, 12.5);
    const targetMaxHp = target.maxHp;
    const attacker = world.spawnUnit(0, 'man_at_arms', 3.5, 12.5);

    sim.issue({
      kind: 'attack',
      player: 0,
      ids: [attacker.id],
      targetId: target.id,
      queued: false,
    });

    let outerFellTick = -1;
    let innerFellTick = -1;
    let targetDiedTick = -1;
    let targetHpAtOuterBreach = -1;
    let targetHpAtInnerBreach = -1;
    let breachedOuter: BuildingEntity | undefined;
    let breachedInner: BuildingEntity | undefined;

    for (let t = 0; t < 1000 && target.hp > 0; t++) {
      sim.step();

      const deadOuter = outerWalls.filter(w => world.getEntity(w.id) === undefined);
      if (outerFellTick < 0 && deadOuter.length > 0) {
        outerFellTick = t;
        breachedOuter = deadOuter[0];
        targetHpAtOuterBreach = target.hp;
      }

      const deadInner = innerWalls.filter(w => world.getEntity(w.id) === undefined);
      if (innerFellTick < 0 && deadInner.length > 0) {
        innerFellTick = t;
        breachedInner = deadInner[0];
        targetHpAtInnerBreach = target.hp;
      }

      if (targetDiedTick < 0 && target.hp <= 0) {
        targetDiedTick = t;
      }
    }

    // Outer wall was destroyed first; inner wall was destroyed second; target died last
    expect(outerFellTick).toBeGreaterThanOrEqual(0);
    expect(innerFellTick).toBeGreaterThan(outerFellTick);
    expect(targetDiedTick).toBeGreaterThan(innerFellTick);

    // Breached walls were along the western approach route
    expect(breachedOuter).toBeDefined();
    expect(breachedOuter?.x).toBe(8);
    expect(breachedOuter?.z).toBe(12);

    expect(breachedInner).toBeDefined();
    expect(breachedInner?.x).toBe(10);
    expect(breachedInner?.z).toBe(12);

    // Target was undamaged while outer and inner walls were standing
    expect(targetHpAtOuterBreach).toBe(targetMaxHp);
    expect(targetHpAtInnerBreach).toBe(targetMaxHp);

    // Target is dead and both breached walls are in remains
    expect(target.hp).toBe(0);
    expect(world.remains).toContain(breachedOuter);
    expect(world.remains).toContain(breachedInner);
    expect(world.remains).toContain(target);
    expect(attacker.hp).toBeGreaterThan(0);
  });

  it('breaches toward a building footprint through its enclosing ring', () => {
    const sim = makeOpenSim({ size: MAP_SIZE });
    const { world } = sim;
    buildRing(sim, 1, 8, 16);
    const barracks = world.spawnBuilding(1, 'barracks', 11, 11, true);
    const attacker = world.spawnUnit(0, 'man_at_arms', 3.5, 12.5);

    expect(canEngage(world, attacker, barracks)).toBe(false);
    const wall = resolveAttackTarget(world, attacker, barracks);
    expect(wall).toBeDefined();
    expect(wall?.kind).toBe('building');
    if (wall && wall.kind === 'building') {
      const onOuterRing = wall.x === 8 || wall.x === 16 || wall.z === 8 || wall.z === 16;
      expect(onOuterRing).toBe(true);
      expect(wall.x).toBe(8);

      world.removeEntity(wall.id);
      expect(canEngage(world, attacker, barracks)).toBe(true);
      expect(resolveAttackTarget(world, attacker, barracks)).toBe(barracks);
    }
  });

  it('terrain-isolated enemy does not trigger an arbitrary wall attack', () => {
    const sim = makeOpenSim({
      size: MAP_SIZE,
      mutate: (tiles, size) => {
        for (let x = 8; x <= 16; x++) {
          for (let z = 8; z <= 16; z++) {
            if (x === 8 || x === 16 || z === 8 || z === 16) {
              tiles[z * size + x] = Terrain.WATER;
            }
          }
        }
      },
    });
    const { world } = sim;
    const islandTarget = world.spawnUnit(1, 'peasant', 12.5, 12.5);
    // Enemy walls on the shore and elsewhere cannot bridge the water.
    const shoreWall1 = world.spawnBuilding(1, 'stone_wall', 6, 12, true);
    const shoreWall2 = world.spawnBuilding(1, 'stone_wall', 7, 12, true);
    const farWall = world.spawnBuilding(1, 'stone_wall', 28, 28, true);
    const attacker = world.spawnUnit(0, 'man_at_arms', 3.5, 12.5);

    expect(canEngage(world, attacker, islandTarget)).toBe(false);
    expect(resolveAttackTarget(world, attacker, islandTarget)).toBeUndefined();

    // Observable Sim-level behavior: issue attack order, attacker must not damage unrelated walls
    sim.issue({
      kind: 'attack',
      player: 0,
      ids: [attacker.id],
      targetId: islandTarget.id,
      queued: false,
    });
    for (let t = 0; t < 150; t++) {
      sim.step();
    }

    expect(shoreWall1.hp).toBe(shoreWall1.maxHp);
    expect(shoreWall2.hp).toBe(shoreWall2.maxHp);
    expect(farWall.hp).toBe(farWall.maxHp);
    expect(islandTarget.hp).toBe(islandTarget.maxHp);
  });

  it('ranged attacker with a reachable firing tile is not redirected to a wall', () => {
    const sim = makeOpenSim({ size: MAP_SIZE });
    const { world } = sim;
    buildRing(sim, 1, 10, 14);
    const target = world.spawnUnit(1, 'peasant', 12.5, 12.5);

    // Already in range (5 tiles, range 6) behind the ring.
    const inRange = world.spawnUnit(0, 'longbowman', 7.5, 12.5);
    expect(canEngage(world, inRange, target)).toBe(true);
    expect(resolveAttackTarget(world, inRange, target)).toBe(target);

    // Out of range (9 tiles) but its component contains firing tiles outside the ring.
    const farAway = world.spawnUnit(0, 'longbowman', 3.5, 12.5);
    expect(canEngage(world, farAway, target)).toBe(true);
    expect(resolveAttackTarget(world, farAway, target)).toBe(target);
  });

  it('ranged attacker with no reachable firing tile breaches the wall nearest a firing position', () => {
    const sim = makeOpenSim({ size: MAP_SIZE });
    const { world } = sim;
    // Solid 13x13 wall block with a single hollow tile at (12,12).
    for (let x = 6; x <= 18; x++) {
      for (let z = 6; z <= 18; z++) {
        if (x !== 12 || z !== 12) {
          world.spawnBuilding(1, 'stone_wall', x, z, true);
        }
      }
    }
    const target = world.spawnUnit(1, 'peasant', 12.5, 12.5);
    const archer = world.spawnUnit(0, 'longbowman', 3.5, 12.5);

    // Every free tile is >6 tiles from the target; (6,12) is the first wall
    // tile on the cheapest route whose own centre is within range 6.
    expect(canEngage(world, archer, target)).toBe(false);
    const wall = resolveAttackTarget(world, archer, target);
    expect(wall).toBeDefined();
    expect(wall?.kind).toBe('building');
    if (wall && wall.kind === 'building') {
      expect(wall.x).toBe(6);
      expect(wall.z).toBe(12);
    }
  });

  // Phase 1 regression: Breach wall chosen nearest attacker (breach_choice.ts)
  it('breach wall is chosen nearest the attacker, not nearest the target', () => {
    const sim = makeOpenSim({ size: 64 });
    const { world } = sim;

    const ringWalls: BuildingEntity[] = [];
    for (let x = 10; x <= 50; x++) {
      for (let z = 10; z <= 50; z++) {
        if (x === 10 || x === 50 || z === 10 || z === 50) {
          ringWalls.push(world.spawnBuilding(1, 'stone_wall', x, z, true));
        }
      }
    }

    const target = world.spawnUnit(1, 'peasant', 48.5, 30.5);
    const attacker = world.spawnUnit(0, 'man_at_arms', 7.5, 30.5);

    // West wall at x=10 is 2.5 tiles from attacker; east wall at x=50 is ~40 tiles away.
    const chosenWall = resolveAttackTarget(world, attacker, target);
    expect(chosenWall).toBeDefined();
    expect(chosenWall?.kind).toBe('building');
    if (chosenWall && chosenWall.kind === 'building') {
      expect(chosenWall.x).toBe(10);
      expect(chosenWall.z).toBe(30);
    }

    // Observable combat execution: attacker advances to the west wall and damages it.
    sim.issue({
      kind: 'attack',
      player: 0,
      ids: [attacker.id],
      targetId: target.id,
      queued: false,
    });

    let firstDamagedWall: BuildingEntity | undefined;
    for (let t = 0; t < 150; t++) {
      sim.step();
      const damaged = ringWalls.find(w => w.hp < w.maxHp);
      if (damaged) {
        firstDamagedWall = damaged;
        break;
      }
    }

    expect(firstDamagedWall).toBeDefined();
    expect(firstDamagedWall?.x).toBe(10);
    expect(firstDamagedWall?.z).toBe(30);
    // East walls (x=50) never touched
    const eastDamaged = ringWalls.filter(w => w.x === 50 && w.hp < w.maxHp);
    expect(eastDamaged).toHaveLength(0);
  });

  // Phase 1 regression: Moving goal inside ring keeps breach wall sticky without flapping (moving_target2.ts, breach-flap.ts)
  it('moving goal inside a ring keeps the breach wall sticky without flapping', () => {
    const sim = makeOpenSim({ size: 64 });
    const { world } = sim;

    const ringWalls: BuildingEntity[] = [];
    for (let x = 20; x <= 40; x++) {
      for (let z = 20; z <= 40; z++) {
        if (x === 20 || x === 40 || z === 20 || z === 40) {
          ringWalls.push(world.spawnBuilding(1, 'stone_wall', x, z, true));
        }
      }
    }

    const target = world.spawnUnit(1, 'ox_cart', 22.5, 30.5);
    const attacker = world.spawnUnit(0, 'man_at_arms', 30.5, 14.5);

    sim.issue({
      kind: 'attack',
      player: 0,
      ids: [attacker.id],
      targetId: target.id,
      queued: false,
    });

    // Move target back and forth inside the ring every 100 ticks.
    for (let t = 0; t < 800; t++) {
      if (t % 100 === 0) {
        const destX = (t / 100) % 2 === 0 ? 38.5 : 22.5;
        sim.issue({
          kind: 'move',
          player: 1,
          ids: [target.id],
          x: destX,
          z: 30.5,
          queued: false,
        });
      }
      sim.step();
    }

    const damagedWalls = ringWalls.filter(w => w.hp < w.maxHp);
    // Sticky target: only ONE wall was targeted and damaged throughout the movement
    expect(damagedWalls).toHaveLength(1);
    expect(damagedWalls[0].x).toBe(30);
    expect(damagedWalls[0].z).toBe(20);
    const totalWallDamage = damagedWalls[0].maxHp - damagedWalls[0].hp;
    // Continuous hits delivered (not cancelled by flapping)
    expect(totalWallDamage).toBeGreaterThanOrEqual(45);
  });

  // Phase 1 regression: Diagonally sealed pocket is treated as enclosed and breached (diag_seal3.ts)
  it('diagonally sealed pocket is treated as enclosed and breached instead of parking', () => {
    const sim = makeOpenSim({ size: 48 });
    const { world } = sim;

    const ringWalls: BuildingEntity[] = [];
    for (let x = 16; x <= 20; x++) {
      for (let z = 16; z <= 20; z++) {
        if (x === 16 || x === 20 || z === 16 || z === 20) {
          if (!(x === 20 && z === 20)) {
            ringWalls.push(world.spawnBuilding(1, 'stone_wall', x, z, true));
          }
        }
      }
    }

    const target = world.spawnUnit(1, 'ox_cart', 19.5, 19.5);
    const attacker = world.spawnUnit(0, 'man_at_arms', 26.5, 26.5);

    // Diagonal-only contact through (20,20) is not engageable
    expect(canEngage(world, attacker, target)).toBe(false);
    const resolved = resolveAttackTarget(world, attacker, target);
    expect(resolved).toBeDefined();
    expect(resolved?.kind).toBe('building');
    if (resolved && resolved.kind === 'building') {
      expect(resolved.x).toBe(19);
      expect(resolved.z).toBe(20);

      // Combat: attacker must breach the orthogonal wall rather than parking indefinitely at (20,20)
      sim.issue({
        kind: 'attack',
        player: 0,
        ids: [attacker.id],
        targetId: target.id,
        queued: false,
      });

      let wallDamaged = false;
      for (let t = 0; t < 300; t++) {
        sim.step();
        if (resolved.hp < resolved.maxHp) {
          wallDamaged = true;
          break;
        }
      }

      expect(wallDamaged).toBe(true);
      expect(resolved.hp).toBeLessThan(resolved.maxHp);
    }
  });

  // Phase 1 regression: Target ringed only by non-wall buildings resolves to undefined and attackers do not breach or hang
  it('target ringed only by non-wall buildings resolves to undefined and attackers do not breach or hang the sim', () => {
    const sim = makeOpenSim({ size: 48 });
    const { world } = sim;

    const buildings: BuildingEntity[] = [
      world.spawnBuilding(1, 'barracks', 14, 11, true),
      world.spawnBuilding(1, 'barracks', 14, 17, true),
      world.spawnBuilding(1, 'barracks', 11, 14, true),
      world.spawnBuilding(1, 'barracks', 17, 14, true),
    ];

    const target = world.spawnUnit(1, 'peasant', 15.5, 15.5);
    const attacker = world.spawnUnit(0, 'man_at_arms', 5.5, 15.5);

    expect(canEngage(world, attacker, target)).toBe(false);
    expect(resolveAttackTarget(world, attacker, target)).toBeUndefined();

    sim.issue({
      kind: 'attack',
      player: 0,
      ids: [attacker.id],
      targetId: target.id,
      queued: false,
    });

    // Step 200 ticks: attacker moves toward reachable point, sim does not freeze, buildings not breached
    for (let t = 0; t < 200; t++) {
      sim.step();
    }

    for (const b of buildings) {
      expect(b.hp).toBe(b.maxHp);
    }
    expect(target.hp).toBe(target.maxHp);
    // Attacker reached closest reachable point outside the buildings and is not moving
    expect(attacker.x).toBeGreaterThan(12.0);
    expect(attacker.x).toBeLessThan(14.0);
  });
});
