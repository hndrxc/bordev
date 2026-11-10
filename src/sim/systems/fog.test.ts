import { describe, expect, it } from 'vitest';
import { Rng } from '../rng.js';
import { Sim } from '../sim.js';
import { Terrain, type GameMap } from '../map.js';
import { World } from '../world.js';
import {
  isEntityVisibleTo,
  isFootprintVisible,
  isPositionVisibleTo,
} from './fog.js';
import { validatePlacement } from './construction.js';
import { makeOpenSim } from '../testFixtures.js';

function makeTwoPlayerMap(size = 32): GameMap {
  return {
    version: 1,
    id: `two_player_${size}`,
    name: 'Two Player Test Map',
    size,
    players: 2,
    tiles: new Uint8Array(size * size).fill(Terrain.GRASS),
    goldMines: [
      [20, 20],
      [15, 15],
    ],
    starts: [
      [2, 2],
      [size - 6, size - 6],
    ],
    doodads: [
      [10, 10, 'flowers'],
      [25, 25, 'ruins'],
    ],
  };
}

describe('Sim Fog of War — Initial Shroud & Starting Vision', () => {
  it('initializes real local vision around starting bases at World construction', () => {
    const map = makeTwoPlayerMap(32);
    const world = new World(map, new Rng(1));

    const p0 = world.players[0];
    const p1 = world.players[1];

    expect(p0.fogRevision).toBeGreaterThan(0);
    expect(p1.fogRevision).toBeGreaterThan(0);

    // Player 0 starting keep at (2, 2) has width 4, height 4, center (4, 4), LOS 8
    expect(isPositionVisibleTo(world, 0, 4, 4)).toBe(true);
    expect(p0.visible[4 * 32 + 4]).toBe(1);
    expect(p0.explored[4 * 32 + 4]).toBe(1);
    expect(p0.fog[4 * 32 + 4]).toBe(255);

    // Starting Keep tile (2, 2) is visible
    expect(isPositionVisibleTo(world, 0, 2, 2)).toBe(true);

    // Map center (16, 16) is far outside starting base sight (dist ~ 17 tiles > 8)
    expect(isPositionVisibleTo(world, 0, 16, 16)).toBe(false);
    expect(p0.visible[16 * 32 + 16]).toBe(0);
    expect(p0.explored[16 * 32 + 16]).toBe(0);
    expect(p0.fog[16 * 32 + 16]).toBe(0);

    // Player 0 cannot see Player 1's starting base at (26, 26)
    expect(isPositionVisibleTo(world, 0, 26, 26)).toBe(false);
    expect(p0.visible[26 * 32 + 26]).toBe(0);

    // Conversely, Player 1 can see (26, 26) but cannot see (4, 4)
    expect(isPositionVisibleTo(world, 1, 26, 26)).toBe(true);
    expect(isPositionVisibleTo(world, 1, 4, 4)).toBe(false);
  });

  it('standard Sim constructor initializes genuine vision without requiring a tick step', () => {
    const map = makeTwoPlayerMap(32);
    const sim = new Sim(map, 1);

    expect(sim.world.players[0].fogRevision).toBe(1);
    expect(isPositionVisibleTo(sim.world, 0, 4, 4)).toBe(true);
  });
});

describe('Sim Fog of War — LOS Categories & Disk Centers', () => {
  it('correctly uses unit position for unit LOS disks', () => {
    const sim = makeOpenSim({ size: 32 });
    const world = sim.world;

    // Peasant at (10, 10), LOS = 6
    world.spawnUnit(0, 'peasant', 10, 10);
    sim.updateFog();

    // Center tile (10, 10) is visible
    expect(isPositionVisibleTo(world, 0, 10, 10)).toBe(true);

    // Tile (15, 10) is dx = 5.5, dz = 0.5 -> distSq = 30.5 <= 36 -> visible
    expect(isPositionVisibleTo(world, 0, 15, 10)).toBe(true);

    // Tile (16, 10) is dx = 6.5, dz = 0.5 -> distSq = 42.5 > 36 -> outside
    expect(isPositionVisibleTo(world, 0, 16, 10)).toBe(false);

    // Longbowman with LOS = 8 at (20, 20)
    world.spawnUnit(0, 'longbowman', 20, 20);
    sim.updateFog();

    // Tile (27, 20) is dx = 7.5, dz = 0.5 -> distSq = 56.5 <= 64 -> visible
    expect(isPositionVisibleTo(world, 0, 27, 20)).toBe(true);

    // Tile (28, 20) is dx = 8.5 -> distSq = 72.5 > 64 -> outside
    expect(isPositionVisibleTo(world, 0, 28, 20)).toBe(false);
  });

  it('measures building LOS disks from footprint center (x + w/2, z + h/2)', () => {
    const sim = makeOpenSim({ size: 32 });
    const world = sim.world;

    // Cottage at (10, 10), 2x2, center is (11, 11), LOS = 4
    world.spawnBuilding(0, 'cottage', 10, 10, true);
    sim.updateFog();

    // Footprint corners (10, 10), (11, 10), (10, 11), (11, 11) must all be visible
    expect(isPositionVisibleTo(world, 0, 10, 10)).toBe(true);
    expect(isPositionVisibleTo(world, 0, 11, 10)).toBe(true);
    expect(isPositionVisibleTo(world, 0, 10, 11)).toBe(true);
    expect(isPositionVisibleTo(world, 0, 11, 11)).toBe(true);

    // Symmetric reach along +X and -X from center 11:
    // Tile (14, 11): center is (14.5, 11.5), dx = 3.5, dz = 0.5 -> 12.5 <= 16 -> visible
    expect(isPositionVisibleTo(world, 0, 14, 11)).toBe(true);
    // Tile (7, 11): center is (7.5, 11.5), dx = -3.5, dz = 0.5 -> 12.5 <= 16 -> visible
    expect(isPositionVisibleTo(world, 0, 7, 11)).toBe(true);

    // Tile (15, 11): dx = 4.5 -> 20.5 > 16 -> not visible
    expect(isPositionVisibleTo(world, 0, 15, 11)).toBe(false);
    // Tile (6, 11): dx = -4.5 -> 20.5 > 16 -> not visible
    expect(isPositionVisibleTo(world, 0, 6, 11)).toBe(false);
  });

  it('determines building and mine visibility using any footprint tile', () => {
    const sim = makeOpenSim({ size: 32 });
    const world = sim.world;

    // Enemy keep at (20, 20) with 4x4 footprint: tiles x in [20..23], z in [20..23]
    const enemyKeep = world.spawnBuilding(1, 'keep', 20, 20, true);

    // Player 0 unit placed such that only corner tile (20, 20) of keep is visible
    // Center of tile 20 is 20.5. Place unit at (15.5, 20.5) with LOS 5
    // Distance to tile (20, 20) center is 5.0 <= 5.0 -> tile (20, 20) visible
    // Other keep tiles (e.g. 23, 23) distance = Math.hypot(8, 3) = 8.54 > 5 -> not visible
    world.spawnUnit(0, 'peasant', 15.5, 20.5); // peasant LOS 6
    sim.updateFog();

    expect(isPositionVisibleTo(world, 0, 20, 20)).toBe(true);
    expect(isPositionVisibleTo(world, 0, 23, 23)).toBe(false);

    // Any-visible footprint rule: Keep IS visible to player 0
    expect(isEntityVisibleTo(world, 0, enemyKeep)).toBe(true);

    // Mine at (15, 15) has no tiles within LOS 6 of (15.5, 20.5) (dist ~ 5.5 in Z, but in X 0.5 -> dist ~ 5.5 < 6 -> tile 15,16 visible)
    // Let's place a mine far away at (28, 28)
    const farMine = world.spawnMine(28, 28, 6000);
    sim.updateFog();

    expect(isFootprintVisible(world, 0, 28, 28, 2, 2)).toBe(false);
    expect(isEntityVisibleTo(world, 0, farMine)).toBe(false);
  });
});

describe('Sim Fog of War — Boundaries & Edge Clipping', () => {
  it('clips sight disks safely at map origin (0, 0) without wrapping or index errors', () => {
    const sim = makeOpenSim({ size: 32 });
    const world = sim.world;

    // Unit exactly at origin (0, 0) with LOS = 6
    world.spawnUnit(0, 'peasant', 0.5, 0.5);
    sim.updateFog();

    const p0 = world.players[0];
    expect(p0.visible[0]).toBe(1);

    // Opposite map corner (31, 31) must NOT be visible (no wrap-around)
    expect(isPositionVisibleTo(world, 0, 31, 31)).toBe(false);
    expect(p0.visible[31 * 32 + 31]).toBe(0);

    // Out-of-bounds queries return false safely
    expect(isPositionVisibleTo(world, 0, -1, 0)).toBe(false);
    expect(isPositionVisibleTo(world, 0, 0, -1)).toBe(false);
    expect(isPositionVisibleTo(world, 0, 32, 10)).toBe(false);
    expect(isPositionVisibleTo(world, 0, 10, 32)).toBe(false);
  });

  it('clips sight disks safely at top-right boundary (size - 1, size - 1)', () => {
    const sim = makeOpenSim({ size: 32 });
    const world = sim.world;

    world.spawnUnit(0, 'peasant', 31.5, 31.5);
    sim.updateFog();

    const p0 = world.players[0];
    expect(p0.visible[31 * 32 + 31]).toBe(1);

    // Origin must NOT be visible
    expect(isPositionVisibleTo(world, 0, 0, 0)).toBe(false);
    expect(p0.visible[0]).toBe(0);
  });
});

describe('Sim Fog of War — Allies & Shared Vision', () => {
  it('shares sight immediately between allied players and revokes on team change', () => {
    const sim = makeOpenSim({ size: 32, players: 3 });
    const world = sim.world;

    // Player 0 unit at (5, 5)
    world.spawnUnit(0, 'peasant', 5.5, 5.5);

    // Player 1 unit at (25, 25)
    const p1Unit = world.spawnUnit(1, 'peasant', 25.5, 25.5);

    sim.updateFog();

    // Initially hostile/unallied: Player 0 cannot see (25, 25)
    expect(isPositionVisibleTo(world, 0, 25, 25)).toBe(false);
    expect(isEntityVisibleTo(world, 0, p1Unit)).toBe(false);

    // Form alliance: Player 1 joins Player 0's team
    world.setTeam(1, world.players[0].team);
    sim.updateFog();

    // Shared vision: Player 0 now sees (25, 25) and Player 1's unit
    expect(isPositionVisibleTo(world, 0, 25, 25)).toBe(true);
    expect(isEntityVisibleTo(world, 0, p1Unit)).toBe(true);

    // Player 1 also sees Player 0's location (5, 5)
    expect(isPositionVisibleTo(world, 1, 5, 5)).toBe(true);

    // Break alliance: Player 1 changes to team 99
    world.setTeam(1, 99);
    sim.updateFog();

    // Player 0 no longer has live visibility at (25, 25)
    expect(isPositionVisibleTo(world, 0, 25, 25)).toBe(false);

    // But tile (25, 25) remains explored (monotone 1, fog 128)
    const p0 = world.players[0];
    expect(p0.explored[25 * 32 + 25]).toBe(1);
    expect(p0.fog[25 * 32 + 25]).toBe(128);
  });
});

describe('Sim Fog of War — Movement: Visible -> Explored Hidden & Invariants', () => {
  it('transitions tiles from visible (255) to explored hidden (128) as unit moves', () => {
    const sim = makeOpenSim({ size: 32 });
    const world = sim.world;

    const unit = world.spawnUnit(0, 'peasant', 5.5, 5.5);
    sim.updateFog();

    const p0 = world.players[0];
    const initialRev = p0.fogRevision;

    // Initially at (5, 5): visible
    expect(isPositionVisibleTo(world, 0, 5, 5)).toBe(true);
    expect(p0.visible[5 * 32 + 5]).toBe(1);
    expect(p0.explored[5 * 32 + 5]).toBe(1);
    expect(p0.fog[5 * 32 + 5]).toBe(255);

    // Move unit far away to (25, 25)
    unit.x = 25.5;
    unit.z = 25.5;
    sim.updateFog();

    // Tile (5, 5) is no longer in LOS
    expect(isPositionVisibleTo(world, 0, 5, 5)).toBe(false);
    expect(p0.visible[5 * 32 + 5]).toBe(0);

    // Monotone exploration invariant: explored stays 1
    expect(p0.explored[5 * 32 + 5]).toBe(1);

    // Fog transitions to 128 (explored hidden)
    expect(p0.fog[5 * 32 + 5]).toBe(128);

    // Tile (25, 25) becomes visible (255)
    expect(isPositionVisibleTo(world, 0, 25, 25)).toBe(true);
    expect(p0.visible[25 * 32 + 25]).toBe(1);
    expect(p0.explored[25 * 32 + 25]).toBe(1);
    expect(p0.fog[25 * 32 + 25]).toBe(255);

    // Fog revision bumped due to change
    expect(p0.fogRevision).toBeGreaterThan(initialRev);

    // Stationary step: no movement, no fog changes -> revision stays the same
    const revAfterMove = p0.fogRevision;
    sim.updateFog();
    expect(p0.fogRevision).toBe(revAfterMove);
  });
});

describe('Sim Fog of War — Unseen Mutation, Destruction, Recycled IDs & Revisit', () => {
  it('freezes ghost memories with last-seen state during hidden damage, gate toggles, and mine depletion', () => {
    const sim = makeOpenSim({ size: 32, players: 2 });
    const world = sim.world;

    // Player 0 scout at (10, 10)
    const scout = world.spawnUnit(0, 'peasant', 10.5, 10.5);

    // Enemy cottage at (12, 10), HP = 550
    const enemyCottage = world.spawnBuilding(1, 'cottage', 12, 10, true);

    // Enemy stone gate at (12, 14), orientation horizontal, gateOpen false
    const enemyGate = world.spawnBuilding(
      1,
      'stone_gate',
      12,
      14,
      true,
      'horizontal',
    );

    // Neutral mine at (8, 12), gold = 6000
    const mine = world.spawnMine(8, 12, 6000);

    sim.updateFog();

    const p0 = world.players[0];
    const cottageGhostKey = 'building:12,10';
    const gateGhostKey = 'building:12,14';
    const mineGhostKey = 'mine:8,12';

    // Verify ghosts recorded
    const cottageGhost = p0.ghosts.get(cottageGhostKey);
    expect(cottageGhost).toBeDefined();
    expect(cottageGhost?.hp).toBe(enemyCottage.maxHp);
    expect(cottageGhost?.built).toBe(true);

    const gateGhost = p0.ghosts.get(gateGhostKey);
    expect(gateGhost).toBeDefined();
    expect(gateGhost?.orientation).toBe('horizontal');
    expect(gateGhost?.gateOpen).toBe(false);

    const mineGhost = p0.ghosts.get(mineGhostKey);
    expect(mineGhost).toBeDefined();
    expect(mineGhost?.goldRemaining).toBe(6000);

    // Move scout far away into shroud
    scout.x = 28.5;
    scout.z = 28.5;
    sim.updateFog();

    // Verify footprints are now hidden in fog
    expect(isFootprintVisible(world, 0, 12, 10, 2, 2)).toBe(false);
    expect(isFootprintVisible(world, 0, 12, 14, 3, 1)).toBe(false);
    expect(isFootprintVisible(world, 0, 8, 12, 2, 2)).toBe(false);

    // Unseen changes occur while hidden:
    // 1. Enemy cottage takes heavy damage
    enemyCottage.hp = 50;

    // 2. Enemy gate opens
    enemyGate.gateOpen = true;

    // 3. Mine is depleted partially
    mine.goldRemaining = 3500;

    sim.updateFog();

    // Player 0's ghosts MUST remain frozen with old observed values!
    expect(p0.ghosts.get(cottageGhostKey)?.hp).toBe(enemyCottage.maxHp);
    expect(p0.ghosts.get(gateGhostKey)?.gateOpen).toBe(false);
    expect(p0.ghosts.get(mineGhostKey)?.goldRemaining).toBe(6000);

    // Now return scout to revisit the scene
    scout.x = 10.5;
    scout.z = 10.5;
    sim.updateFog();

    // Upon revisit, ghosts are refreshed with the new observed state
    expect(p0.ghosts.get(cottageGhostKey)?.hp).toBe(50);
    expect(p0.ghosts.get(gateGhostKey)?.gateOpen).toBe(true);
    expect(p0.ghosts.get(mineGhostKey)?.goldRemaining).toBe(3500);
  });

  it('retains ghosts when destroyed while unseen, immune to recycled entity IDs, and clears only on revisit', () => {
    const sim = makeOpenSim({ size: 32, players: 2 });
    const world = sim.world;

    const scout = world.spawnUnit(0, 'peasant', 10.5, 10.5);
    const enemyCottage = world.spawnBuilding(1, 'cottage', 12, 10, true);
    const staleId = enemyCottage.id;

    sim.updateFog();

    const p0 = world.players[0];
    const ghostKey = 'building:12,10';
    expect(p0.ghosts.has(ghostKey)).toBe(true);

    // Scout leaves area
    scout.x = 28.5;
    scout.z = 28.5;
    sim.updateFog();

    expect(isFootprintVisible(world, 0, 12, 10, 2, 2)).toBe(false);

    // Destroy the enemy cottage while unseen
    world.removeEntity(staleId);

    // Spawn a new entity far away at (28, 28) which deterministically recycles staleId
    const impostor = world.spawnUnit(1, 'peasant', 28.0, 27.0);
    expect(impostor.id).toBe(staleId);

    sim.updateFog();

    // Invariant: The ghost at (12, 10) MUST NOT be erased, corrupted or linked to impostor
    const ghostWhileHidden = p0.ghosts.get(ghostKey);
    expect(ghostWhileHidden).toBeDefined();
    expect(ghostWhileHidden?.x).toBe(12);
    expect(ghostWhileHidden?.z).toBe(10);
    expect(ghostWhileHidden?.type).toBe('cottage');
    expect(ghostWhileHidden?.kind).toBe('building');

    // Scout returns to (10.5, 10.5) to revisit the old footprint
    scout.x = 10.5;
    scout.z = 10.5;
    sim.updateFog();

    // Footprint is now visible, and the building is no longer there -> ghost must be pruned!
    expect(isFootprintVisible(world, 0, 12, 10, 2, 2)).toBe(true);
    expect(p0.ghosts.has(ghostKey)).toBe(false);
  });
});

describe('Sim Fog of War — Explored-Only Placement Invariant', () => {
  it('rejects placement on unexplored tiles, but allows placement on explored hidden tiles', () => {
    const sim = makeOpenSim({ size: 32 });
    const world = sim.world;

    // Unit at (5, 5) with LOS 6
    const peasant = world.spawnUnit(0, 'peasant', 5.5, 5.5);
    sim.updateFog();

    const p0 = world.players[0];
    p0.food = 1000;
    p0.gold = 1000;

    // 1. Placement on completely unexplored tile (25, 25) must be rejected
    expect(p0.explored[25 * 32 + 25]).toBe(0);
    const unexpRes = validatePlacement(world, 0, 'cottage', 25, 25);
    expect(unexpRes.valid).toBe(false);
    expect(unexpRes.reason).toBe('Unexplored territory');

    // 2. Peasant moves to explore (20, 20)
    peasant.x = 20.5;
    peasant.z = 20.5;
    sim.updateFog();

    expect(p0.explored[20 * 32 + 20]).toBe(1);
    expect(isPositionVisibleTo(world, 0, 20, 20)).toBe(true);

    // 3. Peasant moves away from (20, 20) back to (5, 5)
    peasant.x = 5.5;
    peasant.z = 5.5;
    sim.updateFog();

    // (20, 20) is now explored hidden: visible=0, explored=1, fog=128
    expect(isPositionVisibleTo(world, 0, 20, 20)).toBe(false);
    expect(p0.explored[20 * 32 + 20]).toBe(1);
    expect(p0.fog[20 * 32 + 20]).toBe(128);

    // Placement on explored hidden tile MUST BE ALLOWED
    const exploredHiddenRes = validatePlacement(world, 0, 'cottage', 20, 20);
    expect(exploredHiddenRes.valid).toBe(true);
  });
});

describe('Sim Fog of War — isEntityVisibleTo Comprehensive Coverage', () => {
  it('covers units, buildings, mines, projectiles, doodads, and combatant remains', () => {
    const sim = makeOpenSim({ size: 32, players: 2 });
    const world = sim.world;

    // Viewer scout at (5, 5)
    world.spawnUnit(0, 'peasant', 5.5, 5.5);

    // Own unit is always visible (even far from other friendly units)
    const ownUnit = world.spawnUnit(0, 'spearman', 1, 30);
    expect(isEntityVisibleTo(world, 0, ownUnit)).toBe(true);

    // Hostile unit within LOS (at 6, 6) vs outside LOS (at 28, 28)
    const enemyNear = world.spawnUnit(1, 'peasant', 6, 6);
    const enemyFar = world.spawnUnit(1, 'peasant', 28, 28);

    sim.updateFog();

    expect(isEntityVisibleTo(world, 0, ownUnit)).toBe(true);
    expect(isEntityVisibleTo(world, 0, enemyNear)).toBe(true);
    expect(isEntityVisibleTo(world, 0, enemyFar)).toBe(false);

    // Buildings: visible if any footprint tile is visible
    const enemyBldgNear = world.spawnBuilding(1, 'cottage', 6, 6, true);
    const enemyBldgFar = world.spawnBuilding(1, 'cottage', 28, 28, true);
    expect(isEntityVisibleTo(world, 0, enemyBldgNear)).toBe(true);
    expect(isEntityVisibleTo(world, 0, enemyBldgFar)).toBe(false);

    // Mines: visible if any footprint tile is visible
    const mineNear = world.spawnMine(6, 6, 6000);
    const mineFar = world.spawnMine(28, 28, 6000);
    expect(isEntityVisibleTo(world, 0, mineNear)).toBe(true);
    expect(isEntityVisibleTo(world, 0, mineFar)).toBe(false);

    // Projectiles: visible if position is visible
    const enemyProjNear = world.spawnProjectile({
      player: 1,
      x: 6,
      z: 6,
      previousX: 6,
      previousZ: 6,
      speed: 8,
      targetId: enemyNear.id,
      targetRef: enemyNear,
      visualKind: 'arrow',
      originX: 6,
      originZ: 6,
      traveledDistance: 0,
      flightProgress: 0,
      damage: 5,
      attackType: 'pierce',
    });
    const enemyProjFar = world.spawnProjectile({
      player: 1,
      x: 28,
      z: 28,
      previousX: 28,
      previousZ: 28,
      speed: 8,
      targetId: enemyFar.id,
      targetRef: enemyFar,
      visualKind: 'arrow',
      originX: 28,
      originZ: 28,
      traveledDistance: 0,
      flightProgress: 0,
      damage: 5,
      attackType: 'pierce',
    });
    expect(isEntityVisibleTo(world, 0, enemyProjNear)).toBe(true);
    expect(isEntityVisibleTo(world, 0, enemyProjFar)).toBe(false);

    // Doodad: visible only if explored
    const doodadNear = world.spawnDoodad(5, 5, 'flowers');
    const doodadFar = world.spawnDoodad(28, 28, 'ruins');
    expect(isEntityVisibleTo(world, 0, doodadNear)).toBe(true);
    expect(isEntityVisibleTo(world, 0, doodadFar)).toBe(false);

    // Enemy remains (corpse): visible if currently in LOS
    const enemyCorpseNear = world.spawnUnit(1, 'spearman', 6, 6);
    enemyCorpseNear.hp = 0;
    world.entities[enemyCorpseNear.id] = undefined;
    world.remains.push(enemyCorpseNear);

    const enemyCorpseFar = world.spawnUnit(1, 'spearman', 28, 28);
    enemyCorpseFar.hp = 0;
    world.entities[enemyCorpseFar.id] = undefined;
    world.remains.push(enemyCorpseFar);

    expect(isEntityVisibleTo(world, 0, enemyCorpseNear)).toBe(true);
    expect(isEntityVisibleTo(world, 0, enemyCorpseFar)).toBe(false);
  });
});
