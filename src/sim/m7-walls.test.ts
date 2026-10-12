import { describe, expect, it } from 'vitest';
import { Terrain, type GameMap } from './map.js';
import { FLAG_BUILDING, FLAG_GATE } from './grid.js';
import { ComponentManager } from './path/components.js';
import { PathQueue } from './path/pathQueue.js';
import { Sim } from './sim.js';
import { applyDamage } from './systems/damage.js';
import { updateGates, findBlockingWall } from './systems/gates.js';
import type { BuildingEntity } from './entity.js';

const MAP_SIZE = 32;

/**
 * Map with three players and no starting bases, so no keeps, peasants or carts
 * contaminate target acquisition, gate proximity or component labels.
 */
function makeEmptyMap(size = MAP_SIZE): GameMap {
  return {
    version: 1,
    id: 'test_walls_map',
    name: 'Test Walls Map',
    size,
    players: 3,
    tiles: new Uint8Array(size * size).fill(Terrain.GRASS),
    goldMines: [],
    starts: [],
    doodads: [],
  };
}

function makeSim(map: GameMap = makeEmptyMap()): Sim {
  const sim = new Sim(map, 1);
  expect(sim.world.entities.filter((e) => e !== undefined)).toHaveLength(0);
  return sim;
}

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
  it('enemy detours around a closed wall ring while its only gate is blocked for enemies', () => {
    const sim = makeSim();
    const { world } = sim;

    // Closed 5x5 ring of player 0 walls at x=12..16, z=12..16 with a vertical gate
    // on the west column replacing the walls at z=13..15.
    const gate = world.spawnBuilding(0, 'stone_gate', 12, 13, true, 'vertical');
    expect(gate.width).toBe(1);
    expect(gate.height).toBe(3);
    for (let x = 12; x <= 16; x++) {
      for (let z = 12; z <= 16; z++) {
        const onPerimeter = x === 12 || x === 16 || z === 12 || z === 16;
        const isGateTile = x === 12 && z >= 13 && z <= 15;
        if (onPerimeter && !isGateTile) {
          world.spawnBuilding(0, 'stone_wall', x, z, true);
        }
      }
    }

    // Owner passes the gate tiles, the enemy does not
    for (let z = 13; z <= 15; z++) {
      expect(world.grid.isPassable(12.5, z + 0.5, 0)).toBe(true);
      expect(world.grid.isPassable(12.5, z + 0.5, 1)).toBe(false);
    }

    // Component labels: enemy interior is sealed off, owner reaches it through the gate
    const cm = new ComponentManager();
    const enemyLabels = cm.getLabels(world.grid, 1);
    const ownerLabels = cm.getLabels(world.grid, 0);
    const outsideIdx = 14 * MAP_SIZE + 8;
    const insideIdx = 14 * MAP_SIZE + 14;
    expect(enemyLabels[outsideIdx]).toBeGreaterThan(0);
    expect(enemyLabels[insideIdx]).toBeGreaterThan(0);
    expect(enemyLabels[insideIdx]).not.toBe(enemyLabels[outsideIdx]);
    expect(ownerLabels[insideIdx]).toBe(ownerLabels[outsideIdx]);

    // Enemy (player 1) west of the ring, destination east of the ring on the same row
    const enemy = world.spawnUnit(1, 'man_at_arms', 8.5, 14.5);
    sim.issue({
      kind: 'move',
      player: 1,
      ids: [enemy.id],
      x: 21.5,
      z: 14.5,
      queued: false,
    });

    let enteredRingBounds = false;
    let maxDeviationZ = 0;
    let arrived = false;

    for (let tick = 0; tick < 1500; tick++) {
      sim.step();

      if (enemy.x > 12 && enemy.x < 17 && enemy.z > 12 && enemy.z < 17) {
        enteredRingBounds = true;
      }
      maxDeviationZ = Math.max(maxDeviationZ, Math.abs(enemy.z - 14.5));

      if (Math.hypot(enemy.x - 21.5, enemy.z - 14.5) <= 0.6) {
        arrived = true;
        break;
      }
    }

    expect(arrived).toBe(true);
    // Never crossed the ring (neither through walls nor through the closed gate)
    expect(enteredRingBounds).toBe(false);
    // Went around the ring: past the north or south outer edge (ring spans z=12..17)
    expect(maxDeviationZ).toBeGreaterThan(2.5);
  });

  it('owner passes gate; gate opens on approach and closes when the owner moves away', () => {
    const sim = makeSim();
    const { world } = sim;
    const gate = buildGatedWallLine(sim, 0);

    updateGates(world);
    expect(gate.gateOpen).toBe(false);

    const owner = world.spawnUnit(0, 'man_at_arms', 8.5, 15.5);

    // Owner is far from the gate (6.5 tiles), so it stays closed
    updateGates(world);
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

    // Owner is far on the other side, gate closes
    updateGates(world);
    expect(gate.gateOpen).toBe(false);
  });

  it('allied player passes gate only once allied; gate opens for the ally', () => {
    const sim = makeSim();
    const { world } = sim;
    const gate = buildGatedWallLine(sim, 0);

    // Before the alliance player 2 is blocked
    updateGates(world);
    expect(world.grid.isAlly(0, 2)).toBe(false);
    expect(world.grid.isPassable(15.5, 15.5, 2)).toBe(false);

    // Player 2 joins player 0's team
    world.players[2].team = world.players[0].team;
    updateGates(world);
    expect(world.grid.isAlly(0, 2)).toBe(true);
    expect(world.grid.isPassable(15.5, 15.5, 2)).toBe(true);
    // Unrelated player 1 is still blocked
    expect(world.grid.isPassable(15.5, 15.5, 1)).toBe(false);

    const ally = world.spawnUnit(2, 'man_at_arms', 22.5, 15.5);
    sim.issue({
      kind: 'move',
      player: 2,
      ids: [ally.id],
      x: 8.5,
      z: 15.5,
      queued: false,
    });

    let observedGateOpen = false;
    let allyPassedGate = false;

    for (let tick = 0; tick < 600; tick++) {
      sim.step();

      if (gate.gateOpen) {
        observedGateOpen = true;
      }
      if (Math.abs(ally.x - 15.5) < 0.5 && Math.abs(ally.z - 15.5) < 1.5) {
        allyPassedGate = true;
      }
      if (Math.hypot(ally.x - 8.5, ally.z - 15.5) <= 0.6) {
        break;
      }
    }

    expect(allyPassedGate).toBe(true);
    expect(observedGateOpen).toBe(true);
    expect(Math.hypot(ally.x - 8.5, ally.z - 15.5)).toBeLessThanOrEqual(0.6);

    updateGates(world);
    expect(gate.gateOpen).toBe(false);
  });

  it('enemy cannot pass open gate even when gateOpen is true', () => {
    const sim = makeSim();
    const { world } = sim;
    const gate = buildGatedWallLine(sim, 0);

    // Owner peasant east of the gate on hold: keeps the gate open, cannot be lured away,
    // and (hold) only engages enemies within melee reach.
    const keeper = world.spawnUnit(0, 'peasant', 16.5, 15.5);
    sim.issue({ kind: 'hold', player: 0, ids: [keeper.id], queued: false });
    sim.step();
    updateGates(world);
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
    const sim = makeSim();
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

    // Player 2 allied with player 0
    world.players[2].team = world.players[0].team;
    updateGates(world);

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
    world.spawnUnit(0, 'peasant', 9.5, 10.5);
    updateGates(world);
    expect(unfinishedGate.gateOpen).toBe(false);

    // Complete the gate
    world.completeBuilding(unfinishedGate);
    expect(unfinishedGate.built).toBe(true);
    updateGates(world);

    // Now passable for owner and ally, still blocked for enemy
    expect(world.grid.isPassable(10.5, 10.5, 0)).toBe(true);
    expect(world.grid.canOccupy(10.5, 10.5, 0.4, 0)).toBe(true);
    expect(world.grid.isPassable(10.5, 10.5, 2)).toBe(true);
    expect(world.grid.isPassable(10.5, 10.5, 1)).toBe(false);
    // And opens because the peasant is adjacent
    expect(unfinishedGate.gateOpen).toBe(true);
  });

  it('explicit attack on a no-gate enclosed enemy breaks the wall through combat, then kills the original target', () => {
    const sim = makeSim();
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

    // Enclosed: attacker must resolve to the west wall directly between it and the target
    expect(findBlockingWall(world, attacker, target)).toBe(breachWall);

    const cm = new ComponentManager();
    const sealedLabels = cm.getLabels(world.grid, 0);
    const outsideIdx = 12 * MAP_SIZE + 5;
    const insideIdx = 12 * MAP_SIZE + 12;
    const breachIdx = 12 * MAP_SIZE + 10;
    expect(sealedLabels[outsideIdx]).toBeGreaterThan(0);
    expect(sealedLabels[insideIdx]).toBeGreaterThan(0);
    expect(sealedLabels[insideIdx]).not.toBe(sealedLabels[outsideIdx]);
    expect(world.grid.isPassable(10.5, 12.5, 0)).toBe(false);
    const sealedRevision = world.grid.revision;

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
    let blockerAtBreach: BuildingEntity | undefined = breachWall;
    let breachTilePassable = false;
    let breachTileFlags = -1;
    let revisionAtBreach = sealedRevision;
    let mergedAtBreach = false;

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
        revisionAtBreach = world.grid.revision;
        breachTilePassable = world.grid.isPassable(10.5, 12.5, 0);
        breachTileFlags = world.grid.flags[breachIdx];
        const labels = cm.getLabels(world.grid, 0);
        mergedAtBreach =
          labels[outsideIdx] > 0 && labels[outsideIdx] === labels[insideIdx];
        blockerAtBreach = findBlockingWall(world, attacker, target);
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

    // Grid and component recovery at the moment of breach
    expect(revisionAtBreach).toBeGreaterThan(sealedRevision);
    expect(breachTileFlags).toBe(0);
    expect(breachTilePassable).toBe(true);
    expect(mergedAtBreach).toBe(true);
    expect(blockerAtBreach).toBeUndefined();

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

  it('destruction of wall invalidates paths and connected components', () => {
    const sim = makeSim();
    const { world } = sim;

    // Enclose x=10..14, z=10..14
    let wallPiece: BuildingEntity | undefined;
    for (let x = 10; x <= 14; x++) {
      for (let z = 10; z <= 14; z++) {
        if (x === 10 || x === 14 || z === 10 || z === 14) {
          const w = world.spawnBuilding(1, 'stone_wall', x, z, true);
          if (x === 10 && z === 12) wallPiece = w;
        }
      }
    }
    if (!wallPiece) {
      throw new Error('wall piece was not created');
    }

    const cm = new ComponentManager();
    const initialRevision = world.grid.revision;

    // Component labels for player 0
    const labelsBefore = cm.getLabels(world.grid, 0);
    const outsideComp = labelsBefore[12 * MAP_SIZE + 5];
    const insideComp = labelsBefore[12 * MAP_SIZE + 12];

    expect(outsideComp).toBeGreaterThan(0);
    expect(insideComp).toBeGreaterThan(0);
    expect(outsideComp).not.toBe(insideComp);

    // Path request from outside to inside snaps destination to the nearest tile in the start component
    const queue = new PathQueue(world.grid);
    queue.request(1, 5.5, 12.5, 12.5, 12.5, 0);
    const resultsBefore = queue.process();
    expect(resultsBefore).toHaveLength(1);
    expect(resultsBefore[0].path.length).toBeGreaterThan(0);
    const lastPointBefore =
      resultsBefore[0].path[resultsBefore[0].path.length - 1];
    expect(
      labelsBefore[
        Math.floor(lastPointBefore.z) * MAP_SIZE +
          Math.floor(lastPointBefore.x)
      ],
    ).toBe(outsideComp);

    // Destroy the wall piece through the real damage path
    applyDamage(world, wallPiece, wallPiece.hp);
    expect(wallPiece.hp).toBe(0);
    expect(world.getEntity(wallPiece.id)).toBeUndefined();
    expect(world.remains).toContain(wallPiece);

    // Grid revision incremented and tile freed
    expect(world.grid.revision).toBeGreaterThan(initialRevision);
    expect(world.grid.isPassable(10.5, 12.5, 0)).toBe(true);

    // Components recomputed: inside and outside now share the same component
    const labelsAfter = cm.getLabels(world.grid, 0);
    const outsideCompAfter = labelsAfter[12 * MAP_SIZE + 5];
    const insideCompAfter = labelsAfter[12 * MAP_SIZE + 12];
    expect(outsideCompAfter).toBeGreaterThan(0);
    expect(outsideCompAfter).toBe(insideCompAfter);

    // Path request now reaches all the way inside to (12.5, 12.5)
    queue.request(2, 5.5, 12.5, 12.5, 12.5, 0);
    const resultsAfter = queue.process();
    expect(resultsAfter).toHaveLength(1);
    expect(resultsAfter[0].path.length).toBeGreaterThan(0);
    const lastPointAfter =
      resultsAfter[0].path[resultsAfter[0].path.length - 1];
    expect(lastPointAfter.x).toBeCloseTo(12.5, 1);
    expect(lastPointAfter.z).toBeCloseTo(12.5, 1);
  });

  it('synchronizes same-team allies without grid revision churn', () => {
    const sim = makeSim();
    const { world } = sim;

    // Players 0 and 1 are placed on team 0
    world.players[0].team = 0;
    world.players[1].team = 0;
    world.players[2].team = 1;

    // First call syncs
    updateGates(world);
    const revAfterSync = world.grid.revision;

    expect(world.grid.isAlly(0, 1)).toBe(true);
    expect(world.grid.isAlly(0, 2)).toBe(false);

    // Subsequent calls when teams have not changed must NOT increment revision
    for (let i = 0; i < 20; i++) {
      updateGates(world);
    }
    expect(world.grid.revision).toBe(revAfterSync);
  });

  it('findBlockingWall never returns unrelated building or arbitrary wall across map', () => {
    const map = makeEmptyMap();

    // Create an isolated island surrounded by water
    for (let x = 8; x <= 16; x++) {
      for (let z = 8; z <= 16; z++) {
        if (x === 8 || x === 16 || z === 8 || z === 16) {
          map.tiles[z * MAP_SIZE + x] = Terrain.WATER;
        }
      }
    }

    const sim = makeSim(map);
    const { world } = sim;

    // Target is on the island (player 1)
    const islandTarget = world.spawnUnit(1, 'peasant', 12.5, 12.5);

    // Enemy also owns a wall piece far away on the mainland and an unrelated building
    world.spawnBuilding(1, 'stone_wall', 28, 28, true);
    world.spawnBuilding(1, 'barracks', 24, 24, true);

    const attacker = world.spawnUnit(0, 'man_at_arms', 2.5, 2.5);

    // Island target has no blocking wall (water is blocking, not wall)
    expect(findBlockingWall(world, attacker, islandTarget)).toBeUndefined();
  });
});
