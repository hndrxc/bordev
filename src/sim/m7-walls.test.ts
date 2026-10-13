import { describe, expect, it } from 'vitest';
import type { BuildingEntity, Combatant } from './entity.js';
import { FLAG_BUILDING, FLAG_GATE } from './grid.js';
import type { Sim } from './sim.js';
import { resolveAttackTarget } from './systems/breach.js';
import { makeOpenSim } from './testFixtures.js';

const MAP_SIZE = 32;

/** Vertical wall line at x=lineX spanning the whole map with a vertical 1x3 gate at z=14..16. */
function buildGatedWallLine(
  sim: Sim,
  owner: number,
  lineX = 15,
): BuildingEntity {
  const gate = sim.world.spawnBuilding(
    owner,
    'stone_gate',
    lineX,
    14,
    true,
    'vertical',
  );
  expect(gate.width).toBe(1);
  expect(gate.height).toBe(3);
  for (let z = 0; z < MAP_SIZE; z++) {
    if (z < 14 || z > 16) {
      sim.world.spawnBuilding(owner, 'stone_wall', lineX, z, true);
    }
  }
  return gate;
}

describe('M7 Wall and Gate Systems & Acceptance', () => {
  // SimTests#10: enemy detours around closed ring while friendly control passes through gates
  it('enemy detours around a closed wall ring while friendly control passes through gates', () => {
    const sim = makeOpenSim({ size: MAP_SIZE });
    const { world } = sim;

    // Closed 5x5 ring of player 0 walls at x=12..16, z=12..16 with vertical gates
    // on both west (x=12, z=13..15) and east (x=16, z=13..15) sides.
    const westGate = world.spawnBuilding(0, 'stone_gate', 12, 13, true, 'vertical');
    const eastGate = world.spawnBuilding(0, 'stone_gate', 16, 13, true, 'vertical');
    expect(westGate.width).toBe(1);
    expect(westGate.height).toBe(3);
    expect(eastGate.width).toBe(1);
    expect(eastGate.height).toBe(3);

    for (let x = 12; x <= 16; x++) {
      for (let z = 12; z <= 16; z++) {
        const onPerimeter = x === 12 || x === 16 || z === 12 || z === 16;
        const isGateTile = (x === 12 || x === 16) && z >= 13 && z <= 15;
        if (onPerimeter && !isGateTile) {
          world.spawnBuilding(0, 'stone_wall', x, z, true);
        }
      }
    }

    // Owner passes the gate tiles, the enemy does not
    for (let z = 13; z <= 15; z++) {
      expect(world.grid.isPassable(12.5, z + 0.5, 0)).toBe(true);
      expect(world.grid.isPassable(12.5, z + 0.5, 1)).toBe(false);
      expect(world.grid.isPassable(16.5, z + 0.5, 0)).toBe(true);
      expect(world.grid.isPassable(16.5, z + 0.5, 1)).toBe(false);
    }

    // Friendly control unit passes straight through both gates
    const friendly = world.spawnUnit(0, 'man_at_arms', 8.5, 14.5);
    sim.issue({
      kind: 'move',
      player: 0,
      ids: [friendly.id],
      x: 21.5,
      z: 14.5,
      queued: false,
    });

    // Enemy unit on the exact same trajectory must detour around
    const enemy = world.spawnUnit(1, 'man_at_arms', 8.5, 14.5);
    sim.issue({
      kind: 'move',
      player: 1,
      ids: [enemy.id],
      x: 21.5,
      z: 14.5,
      queued: false,
    });

    let friendlyEnteredRing = false;
    let enemyEnteredRing = false;
    let friendlyMaxDevZ = 0;
    let enemyMaxDevZ = 0;
    let friendlyArrived = false;
    let enemyArrived = false;

    for (let tick = 0; tick < 1500; tick++) {
      sim.step();

      if (friendly.x > 12 && friendly.x < 16 && friendly.z > 12 && friendly.z < 16) {
        friendlyEnteredRing = true;
      }
      if (enemy.x > 12 && enemy.x < 16 && enemy.z > 12 && enemy.z < 16) {
        enemyEnteredRing = true;
      }

      friendlyMaxDevZ = Math.max(friendlyMaxDevZ, Math.abs(friendly.z - 14.5));
      enemyMaxDevZ = Math.max(enemyMaxDevZ, Math.abs(enemy.z - 14.5));

      if (!friendlyArrived && Math.hypot(friendly.x - 21.5, friendly.z - 14.5) <= 0.6) {
        friendlyArrived = true;
      }
      if (!enemyArrived && Math.hypot(enemy.x - 21.5, enemy.z - 14.5) <= 0.6) {
        enemyArrived = true;
      }

      if (friendlyArrived && enemyArrived) {
        break;
      }
    }

    // Friendly crossed through both gates into the ring interior with direct straight-line path
    expect(friendlyArrived).toBe(true);
    expect(friendlyEnteredRing).toBe(true);
    expect(friendlyMaxDevZ).toBeLessThan(1.0);

    // Enemy was blocked by the gates, never entered the ring, and detoured around the outer perimeter
    expect(enemyArrived).toBe(true);
    expect(enemyEnteredRing).toBe(false);
    expect(enemyMaxDevZ).toBeGreaterThan(2.5);
  });

  // SimTests#8: Gate open radius boundary (<= 1 tile vs > 1 tile) and adjacent hostile check
  it('gate opens for owner within 1 tile, stays closed beyond 1 tile, and stays closed for adjacent hostile unit', () => {
    // 1. Static boundary checks
    {
      const sim = makeOpenSim({ size: MAP_SIZE });
      const { world } = sim;
      const gate = world.spawnBuilding(0, 'stone_gate', 15, 14, true, 'vertical');
      // Adjacent hostile at dx=0.5 (x=14.5, z=15.5): gate stays closed
      const hostile = world.spawnUnit(1, 'man_at_arms', 14.5, 15.5);
      sim.issue({ kind: 'hold', player: 1, ids: [hostile.id], queued: false });
      sim.step();
      expect(gate.gateOpen).toBe(false);
    }

    {
      const sim = makeOpenSim({ size: MAP_SIZE });
      const { world } = sim;
      const gate = world.spawnBuilding(0, 'stone_gate', 15, 14, true, 'vertical');

      // Friendly unit at dx=1.1 (x=13.9, z=15.5): gate stays closed
      const owner = world.spawnUnit(0, 'man_at_arms', 13.9, 15.5);
      sim.issue({ kind: 'hold', player: 0, ids: [owner.id], queued: false });
      sim.step();
      expect(gate.gateOpen).toBe(false);
    }

    {
      const sim = makeOpenSim({ size: MAP_SIZE });
      const { world } = sim;
      const gate = world.spawnBuilding(0, 'stone_gate', 15, 14, true, 'vertical');

      // Friendly unit at dx=1.0 (x=14.0, z=15.5): gate opens
      const owner = world.spawnUnit(0, 'man_at_arms', 14.0, 15.5);
      sim.issue({ kind: 'hold', player: 0, ids: [owner.id], queued: false });
      sim.step();
      expect(gate.gateOpen).toBe(true);
    }

    // 2. Dynamic movement: gate opens on approach and closes when owner moves away
    {
      const sim = makeOpenSim({ size: MAP_SIZE });
      const { world } = sim;
      const gate = buildGatedWallLine(sim, 0);

      const owner = world.spawnUnit(0, 'man_at_arms', 8.5, 15.5);
      sim.issue({ kind: 'hold', player: 0, ids: [owner.id], queued: false });
      sim.step();
      expect(gate.gateOpen).toBe(false);

      sim.issue({
        kind: 'move',
        player: 0,
        ids: [owner.id],
        x: 22.5,
        z: 15.5,
        queued: false,
      });

      let observedGateOpen = false;
      let passedThroughGate = false;

      for (let tick = 0; tick < 600; tick++) {
        sim.step();

        if (gate.gateOpen) {
          observedGateOpen = true;
        }
        if (Math.abs(owner.x - 15.5) < 0.5 && Math.abs(owner.z - 15.5) < 1.5) {
          passedThroughGate = true;
        }
        if (Math.hypot(owner.x - 22.5, owner.z - 15.5) <= 0.6) {
          break;
        }
      }

      expect(passedThroughGate).toBe(true);
      expect(observedGateOpen).toBe(true);
      expect(Math.hypot(owner.x - 22.5, owner.z - 15.5)).toBeLessThanOrEqual(0.6);
      expect(gate.gateOpen).toBe(false);
    }
  });

  // Phase 1 regression: world.setTeam updates alliances on tick 0 (ally_first_tick.ts)
  it('world.setTeam immediately updates grid passability and lets ally pass gate on the very first tick', () => {
    const sim = makeOpenSim({ size: MAP_SIZE });
    const { world } = sim;
    const gate = buildGatedWallLine(sim, 0);

    // Before alliance, player 2 is blocked
    expect(world.grid.isAlly(0, 2)).toBe(false);
    expect(world.grid.isPassable(15.5, 15.5, 2)).toBe(false);

    // Player 2 joins player 0's team via world.setTeam
    world.setTeam(2, world.players[0].team);

    // Tick 0 passability immediately updated
    expect(world.grid.isAlly(0, 2)).toBe(true);
    expect(world.grid.isPassable(15.5, 15.5, 2)).toBe(true);
    // Enemy player 1 is still blocked
    expect(world.grid.isPassable(15.5, 15.5, 1)).toBe(false);

    const ally = world.spawnUnit(2, 'man_at_arms', 10.5, 15.5);
    sim.issue({
      kind: 'move',
      player: 2,
      ids: [ally.id],
      x: 22.5,
      z: 15.5,
      queued: false,
    });

    let observedGateOpen = false;
    let allyCrossedGate = false;

    for (let tick = 0; tick < 600; tick++) {
      sim.step();

      if (gate.gateOpen) {
        observedGateOpen = true;
      }
      if (ally.x > 16.0) {
        allyCrossedGate = true;
      }
      if (Math.hypot(ally.x - 22.5, ally.z - 15.5) <= 0.6) {
        break;
      }
    }

    expect(allyCrossedGate).toBe(true);
    expect(observedGateOpen).toBe(true);
    expect(Math.hypot(ally.x - 22.5, ally.z - 15.5)).toBeLessThanOrEqual(0.6);
    expect(gate.gateOpen).toBe(false);
  });

  it('enemy cannot pass open gate even when gateOpen is true', () => {
    const sim = makeOpenSim({ size: MAP_SIZE });
    const { world } = sim;
    const gate = buildGatedWallLine(sim, 0);

    // Owner peasant east of the gate on hold: keeps the gate open, cannot be lured away,
    // and (hold) only engages enemies within melee reach.
    const keeper = world.spawnUnit(0, 'peasant', 16.5, 15.5);
    sim.issue({ kind: 'hold', player: 0, ids: [keeper.id], queued: false });
    sim.step();
    expect(gate.gateOpen).toBe(true);

    const enemy = world.spawnUnit(1, 'man_at_arms', 10.5, 15.5);

    // Grid rejects the enemy on every open-gate tile
    for (let z = 14; z <= 16; z++) {
      expect(world.grid.isTilePassable(z * MAP_SIZE + 15, 1)).toBe(false);
    }
    expect(world.grid.isPassable(15.5, 15.5, 1)).toBe(false);
    expect(world.grid.canOccupy(15.5, 15.5, enemy.radius, 1)).toBe(false);
    // ...while the owner is accepted there
    expect(world.grid.isPassable(15.5, 15.5, 0)).toBe(true);

    sim.issue({
      kind: 'move',
      player: 1,
      ids: [enemy.id],
      x: 15.5,
      z: 15.5,
      queued: false,
    });

    let maxEnemyX = enemy.x;
    for (let tick = 0; tick < 200; tick++) {
      sim.step();
      maxEnemyX = Math.max(maxEnemyX, enemy.x);
    }

    // Gate stayed open the whole time, yet the enemy never crossed or stood on it
    expect(gate.gateOpen).toBe(true);
    expect(maxEnemyX).toBeLessThanOrEqual(15 - enemy.radius + 1e-3);
  });

  it('unfinished gate stays blocked for owner and allies until completed', () => {
    const sim = makeOpenSim({ size: MAP_SIZE });
    const { world } = sim;

    const unfinishedGate = world.spawnBuilding(
      0,
      'stone_gate',
      10,
      10,
      false,
      'vertical',
    );
    expect(unfinishedGate.built).toBe(false);
    expect(unfinishedGate.height).toBe(3);

    // Player 2 allied with player 0 via world.setTeam
    world.setTeam(2, world.players[0].team);

    // Grid flags on every gate tile: FLAG_BUILDING, not FLAG_GATE
    for (let z = 10; z <= 12; z++) {
      const idx = z * MAP_SIZE + 10;
      expect(world.grid.flags[idx] & FLAG_BUILDING).toBe(FLAG_BUILDING);
      expect(world.grid.flags[idx] & FLAG_GATE).toBe(0);
    }

    // Impassable for owner and ally
    expect(world.grid.isPassable(10.5, 10.5, 0)).toBe(false);
    expect(world.grid.canOccupy(10.5, 10.5, 0.4, 0)).toBe(false);
    expect(world.grid.isPassable(10.5, 10.5, 2)).toBe(false);

    // A worker standing next to it does NOT open an unfinished gate
    const peasant = world.spawnUnit(0, 'peasant', 9.5, 10.5);
    sim.issue({ kind: 'hold', player: 0, ids: [peasant.id], queued: false });
    sim.step();
    expect(unfinishedGate.gateOpen).toBe(false);

    // Complete the gate
    world.completeBuilding(unfinishedGate);
    expect(unfinishedGate.built).toBe(true);
    sim.step();
    // Now passable for owner and ally, still blocked for enemy
    expect(world.grid.isPassable(10.5, 10.5, 0)).toBe(true);
    expect(world.grid.canOccupy(10.5, 10.5, 0.4, 0)).toBe(true);
    expect(world.grid.isPassable(10.5, 10.5, 2)).toBe(true);
    expect(world.grid.isPassable(10.5, 10.5, 1)).toBe(false);
    // And opens because the peasant is adjacent
    expect(unfinishedGate.gateOpen).toBe(true);
  });

  // SimTests#8: Gate destruction frees tiles for enemies, and gate as breach target (gatebreach.ts)
  it('gate destruction frees its tiles for enemy passage and gate can be targeted for breach', () => {
    const sim = makeOpenSim({ size: MAP_SIZE });
    const { world } = sim;

    const gate = world.spawnBuilding(1, 'stone_gate', 15, 14, true, 'vertical');
    gate.hp = 6; // 2 melee hits to destroy

    for (let z = 0; z < MAP_SIZE; z++) {
      if (z < 14 || z > 16) {
        world.spawnBuilding(1, 'stone_wall', 15, z, true);
      }
    }

    const target = world.spawnUnit(1, 'peasant', 20.5, 15.5);
    const attacker = world.spawnUnit(0, 'man_at_arms', 10.5, 15.5);

    // Gate is selected as the breach target
    expect(resolveAttackTarget(world, attacker, target)).toBe(gate);

    sim.issue({
      kind: 'attack',
      player: 0,
      ids: [attacker.id],
      targetId: target.id,
      queued: false,
    });

    let gateDestroyedTick = -1;
    let targetDamagedTick = -1;
    let targetDiedTick = -1;

    for (let t = 0; t < 600 && target.hp > 0; t++) {
      sim.step();
      const gateAlive = world.getEntity(gate.id) === gate;
      if (gateDestroyedTick < 0 && !gateAlive) {
        gateDestroyedTick = t;
        // All 3 gate tiles become passable for enemy player 0
        for (let z = 14; z <= 16; z++) {
          expect(world.grid.isPassable(15.5, z + 0.5, 0)).toBe(true);
          expect(world.grid.flags[z * MAP_SIZE + 15] & FLAG_GATE).toBe(0);
        }
      }
      if (targetDamagedTick < 0 && target.hp < target.maxHp) {
        targetDamagedTick = t;
      }
      if (targetDiedTick < 0 && target.hp <= 0) {
        targetDiedTick = t;
      }
    }

    expect(gateDestroyedTick).toBeGreaterThanOrEqual(0);
    expect(targetDamagedTick).toBeGreaterThan(gateDestroyedTick);
    expect(targetDiedTick).toBeGreaterThan(targetDamagedTick);
    expect(target.hp).toBe(0);
    expect(world.remains).toContain(gate);
    expect(world.remains).toContain(target);
  });

  it('explicit attack on a no-gate enclosed enemy breaks the wall through combat, then kills the original target', () => {
    const sim = makeOpenSim({ size: MAP_SIZE });
    const { world } = sim;

    // Enclose an enemy target completely in a 5x5 stone wall ring (no gates): x=10..14, z=10..14
    const ringWalls: BuildingEntity[] = [];
    let westWall: BuildingEntity | undefined;
    for (let x = 10; x <= 14; x++) {
      for (let z = 10; z <= 14; z++) {
        if (x === 10 || x === 14 || z === 10 || z === 14) {
          const w = world.spawnBuilding(1, 'stone_wall', x, z, true);
          ringWalls.push(w);
          if (x === 10 && z === 12) {
            westWall = w;
          }
        }
      }
    }
    if (!westWall) {
      throw new Error('west wall was not created');
    }
    // Bound runtime: the wall facing the attacker falls after two real melee hits.
    // Every other ring wall keeps full HP and must stay untouched.
    const breachWall = westWall;
    const breachWallStartHp = 6;
    breachWall.hp = breachWallStartHp;

    const target = world.spawnUnit(1, 'peasant', 12.5, 12.5);
    const targetMaxHp = target.maxHp;
    const attacker = world.spawnUnit(0, 'man_at_arms', 5.5, 12.5);

    // Enclosed: attacker resolves to the west wall directly between it and the target
    expect(resolveAttackTarget(world, attacker, target)).toBe(breachWall);

    // Real explicit attack command on the enclosed enemy; no manual breach, no move substitution
    sim.issue({
      kind: 'attack',
      player: 0,
      ids: [attacker.id],
      targetId: target.id,
      queued: false,
    });

    let firstWallDamageTick = -1;
    let wallDestroyedTick = -1;
    let firstTargetDamageTick = -1;
    let targetKilledTick = -1;
    let wallGoneWhenTargetFirstDamaged = false;
    let targetHpAtBreach = -1;
    let targetAtBreachResolved: Combatant | undefined;
    let breachTilePassable = false;
    let breachTileFlags = -1;

    for (let i = 0; i < 2000 && targetKilledTick < 0; i++) {
      const tick = world.tick;
      sim.step();
      const wallAlive = world.getEntity(breachWall.id) === breachWall;

      if (firstWallDamageTick < 0 && breachWall.hp < breachWallStartHp) {
        firstWallDamageTick = tick;
      }
      if (wallDestroyedTick < 0 && !wallAlive) {
        wallDestroyedTick = tick;
        targetHpAtBreach = target.hp;
        breachTilePassable = world.grid.isPassable(10.5, 12.5, 0);
        breachTileFlags = world.grid.flags[12 * MAP_SIZE + 10];
        targetAtBreachResolved = resolveAttackTarget(world, attacker, target);
      }
      if (firstTargetDamageTick < 0 && target.hp < targetMaxHp) {
        firstTargetDamageTick = tick;
        wallGoneWhenTargetFirstDamaged = !wallAlive;
      }
      if (target.hp <= 0) {
        targetKilledTick = tick;
      }
    }

    // Wall took damage first and fell; only then was the original target damaged
    expect(firstWallDamageTick).toBeGreaterThanOrEqual(0);
    expect(wallDestroyedTick).toBeGreaterThanOrEqual(firstWallDamageTick);
    expect(firstTargetDamageTick).toBeGreaterThan(firstWallDamageTick);
    expect(firstTargetDamageTick).toBeGreaterThanOrEqual(wallDestroyedTick);
    expect(wallGoneWhenTargetFirstDamaged).toBe(true);
    expect(targetHpAtBreach).toBe(targetMaxHp);
    expect(world.remains).toContain(breachWall);

    // Grid recovery at the moment of breach: tile is freed and passable, resolver returns target
    expect(breachTileFlags).toBe(0);
    expect(breachTilePassable).toBe(true);
    expect(targetAtBreachResolved).toBe(target);

    // Original target is killed by the same attacker, which survives
    expect(targetKilledTick).toBeGreaterThan(wallDestroyedTick);
    expect(target.hp).toBe(0);
    expect(world.getEntity(target.id)).not.toBe(target);
    expect(world.remains).toContain(target);
    expect(attacker.hp).toBeGreaterThan(0);
    expect(world.getEntity(attacker.id)).toBe(attacker);

    // No other ring wall was damaged
    for (const wall of ringWalls) {
      if (wall !== breachWall) {
        expect(wall.hp).toBe(wall.maxHp);
        expect(world.getEntity(wall.id)).toBe(wall);
      }
    }
  });
});
