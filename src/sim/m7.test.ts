import { describe, expect, it } from 'vitest';
import { Sim } from './sim.js';
import { Terrain, type GameMap } from './map.js';
import type { UnitDiedEvent } from './commands.js';
import type { UnitEntity } from './entity.js';
import { isInAttackRange } from './systems/combat.js';

function makeCleanMap(size = 48): GameMap {
  return {
    version: 1,
    id: `m7_clean_${size}`,
    name: 'M7 clean map',
    size,
    players: 2,
    tiles: new Uint8Array(size * size).fill(Terrain.GRASS),
    goldMines: [],
    starts: [
      [8, 8],
      [size - 8, size - 8],
    ],
    doodads: [],
  };
}

/** Steps once and records unitDied events; corpses expire so counts must come from events. */
function stepAndCollect(sim: Sim, deaths: UnitDiedEvent[]): void {
  sim.step();
  for (const event of sim.drainEvents()) {
    if (event.kind === 'unitDied') deaths.push(event);
  }
}

function diedIds(deaths: UnitDiedEvent[], player: number): number[] {
  return deaths
    .filter((e) => e.player === player)
    .map((e) => e.entityId)
    .sort((a, b) => a - b);
}

describe('M7 Deterministic Duel Matrix & Combat Mechanics', () => {
  it('duel matrix: 10 spearmen defeat 5 knights on clean open ground', () => {
    const sim = new Sim(makeCleanMap(48), 42);
    const world = sim.world;

    // Spawn 10 spearmen for player 0 in two ranks around x=18
    const spearmen: UnitEntity[] = [];
    for (let i = 0; i < 10; i++) {
      const sx = 18 + (i % 2) * 1.0;
      const sz = 20 + Math.floor(i / 2) * 1.0;
      spearmen.push(world.spawnUnit(0, 'spearman', sx, sz, 'crown'));
    }

    // Spawn 5 knights for player 1 around x=28
    const knights: UnitEntity[] = [];
    for (let i = 0; i < 5; i++) {
      const kx = 28;
      const kz = 20.5 + i * 1.2;
      knights.push(world.spawnUnit(1, 'knight', kx, kz, 'crown'));
    }

    // Both groups attack-move towards the opposing center
    sim.issue({
      kind: 'attackMove',
      player: 0,
      ids: spearmen.map((u) => u.id),
      x: 28,
      z: 22.5,
    });
    sim.issue({
      kind: 'attackMove',
      player: 1,
      ids: knights.map((u) => u.id),
      x: 18,
      z: 22.5,
    });

    // Run combat to resolution (up to 1200 ticks = 60s)
    const deaths: UnitDiedEvent[] = [];
    let finished = false;
    for (let tick = 0; tick < 1200 && !finished; tick++) {
      stepAndCollect(sim, deaths);
      finished =
        knights.every((k) => k.hp <= 0) || spearmen.every((s) => s.hp <= 0);
    }

    expect(finished).toBe(true);

    // 10 spearmen with +12 cavalry bonus defeat 5 knights
    expect(knights.every((k) => k.hp <= 0 && k.deathTick !== undefined)).toBe(
      true,
    );
    expect(spearmen.some((s) => s.hp > 0)).toBe(true);

    // Each knight died exactly once (corpses expire after 200 ticks, so count unitDied events)
    expect(diedIds(deaths, 1)).toEqual(knights.map((k) => k.id));
  });

  it('duel matrix: 5 knights defeat 10 longbowmen on clean open ground', () => {
    const sim = new Sim(makeCleanMap(48), 42);
    const world = sim.world;

    // Spawn 5 knights for player 0 around x=16
    const knights: UnitEntity[] = [];
    for (let i = 0; i < 5; i++) {
      const kx = 16;
      const kz = 20.5 + i * 1.2;
      knights.push(world.spawnUnit(0, 'knight', kx, kz, 'crown'));
    }

    // Spawn 10 longbowmen for player 1 in two ranks around x=28
    const longbowmen: UnitEntity[] = [];
    for (let i = 0; i < 10; i++) {
      const lx = 28 + (i % 2) * 1.0;
      const lz = 20 + Math.floor(i / 2) * 1.0;
      longbowmen.push(world.spawnUnit(1, 'longbowman', lx, lz, 'crown'));
    }

    // Both groups attack-move towards each other
    sim.issue({
      kind: 'attackMove',
      player: 0,
      ids: knights.map((u) => u.id),
      x: 28,
      z: 22.5,
    });
    sim.issue({
      kind: 'attackMove',
      player: 1,
      ids: longbowmen.map((u) => u.id),
      x: 16,
      z: 22.5,
    });

    // Run combat to resolution (up to 1200 ticks = 60s)
    const deaths: UnitDiedEvent[] = [];
    let finished = false;
    for (let tick = 0; tick < 1200 && !finished; tick++) {
      stepAndCollect(sim, deaths);
      finished =
        knights.every((k) => k.hp <= 0) || longbowmen.every((l) => l.hp <= 0);
    }

    expect(finished).toBe(true);

    // Fast, armored knights defeat fragile longbowmen
    expect(
      longbowmen.every((l) => l.hp <= 0 && l.deathTick !== undefined),
    ).toBe(true);
    expect(knights.some((k) => k.hp > 0)).toBe(true);

    // Each longbowman died exactly once
    expect(diedIds(deaths, 1)).toEqual(longbowmen.map((l) => l.id));
  });

  it('trebuchet destroys 1000 HP stone tower in 3 hits of 450 each (1000 -> 550 -> 100 -> dead)', () => {
    const sim = new Sim(makeCleanMap(48), 42);
    const world = sim.world;

    // Trebuchet at (14, 24), stone tower at (22, 24) (distance = 8 tiles, within trebuchet 4-12 range)
    const treb = world.spawnUnit(0, 'trebuchet', 14, 24, 'crown');
    const tower = world.spawnBuilding(1, 'stone_tower', 22, 24, true);

    expect(tower.hp).toBe(1000);
    expect(tower.maxHp).toBe(1000);

    sim.issue({
      kind: 'attack',
      player: 0,
      ids: [treb.id],
      targetId: tower.id,
    });

    // Step until hit 1 lands
    let hit1Tick = -1;
    for (let t = 0; t < 300; t++) {
      sim.step();
      if (tower.hp < 1000) {
        hit1Tick = t;
        break;
      }
    }
    expect(hit1Tick).toBeGreaterThanOrEqual(0);
    // Trebuchet deals 200 base + 250 bonus vs building = 450 (siege ignores armor)
    // 1000 - 450 = 550
    expect(tower.hp).toBe(550);

    // Step until hit 2 lands
    let hit2Tick = -1;
    for (let t = 0; t < 300; t++) {
      sim.step();
      if (tower.hp < 550) {
        hit2Tick = t;
        break;
      }
    }
    expect(hit2Tick).toBeGreaterThanOrEqual(0);
    // 550 - 450 = 100
    expect(tower.hp).toBe(100);

    // Step until hit 3 lands and destroys the tower
    let hit3Tick = -1;
    for (let t = 0; t < 300; t++) {
      sim.step();
      if (world.getEntity(tower.id) === undefined) {
        hit3Tick = t;
        break;
      }
    }
    expect(hit3Tick).toBeGreaterThanOrEqual(0);

    // Tower is destroyed and moved to remains
    expect(world.getEntity(tower.id)).toBeUndefined();
    const rubble = world.remains.find((r) => r.id === tower.id);
    expect(rubble).toBeDefined();
    expect(rubble?.kind).toBe('building');
    expect(rubble?.hp).toBe(0);
  });

  it('man-at-arms hitting stone wall removes exactly 3 HP per hit: max(1, 6 - 8) + 2 = 3', () => {
    const sim = new Sim(makeCleanMap(48), 42);
    const world = sim.world;

    // Man-at-arms at (15, 20), stone wall at (16, 20)
    const maa = world.spawnUnit(0, 'man_at_arms', 15.2, 20.5, 'crown');
    const wall = world.spawnBuilding(1, 'stone_wall', 16, 20, true);

    const initialHp = wall.hp;
    expect(initialHp).toBe(800);

    sim.issue({
      kind: 'attack',
      player: 0,
      ids: [maa.id],
      targetId: wall.id,
    });

    // Step until first hit lands
    let hit1 = false;
    for (let t = 0; t < 100; t++) {
      sim.step();
      if (wall.hp < initialHp) {
        hit1 = true;
        break;
      }
    }
    expect(hit1).toBe(true);
    // 800 - 3 = 797
    expect(wall.hp).toBe(initialHp - 3);

    // Step until second hit lands
    let hit2 = false;
    for (let t = 0; t < 100; t++) {
      sim.step();
      if (wall.hp < initialHp - 3) {
        hit2 = true;
        break;
      }
    }
    expect(hit2).toBe(true);
    // 797 - 3 = 794
    expect(wall.hp).toBe(initialHp - 6);
  });

  it('attackMove resumes march toward destination after defeating intermediate enemy', () => {
    const sim = new Sim(makeCleanMap(48), 42);
    const world = sim.world;

    const attacker = world.spawnUnit(0, 'spearman', 10, 20, 'crown');
    // Weak enemy along the way at x=18
    const enemy = world.spawnUnit(1, 'peasant', 18, 20, 'crown');

    // Ordered to attackMove across the map to x=32
    sim.issue({
      kind: 'attackMove',
      player: 0,
      ids: [attacker.id],
      x: 32,
      z: 20,
    });

    // Advance simulation: attacker should engage enemy, kill it, and resume toward (32, 20)
    let enemyKilled = false;
    let arrivedAtDest = false;

    for (let t = 0; t < 1000; t++) {
      sim.step();

      if (!enemyKilled && world.getEntity(enemy.id) === undefined) {
        enemyKilled = true;
      }

      if (enemyKilled && Math.hypot(attacker.x - 32, attacker.z - 20) < 1.0) {
        arrivedAtDest = true;
        break;
      }
    }

    expect(enemyKilled).toBe(true);
    expect(arrivedAtDest).toBe(true);
    expect(attacker.x).toBeGreaterThan(30);
  });

  it('hold position enforces exact immobility during observation and combat', () => {
    const sim = new Sim(makeCleanMap(48), 42);
    const world = sim.world;

    const soldier = world.spawnUnit(0, 'spearman', 20.0, 20.0, 'crown');
    sim.issue({
      kind: 'hold',
      player: 0,
      ids: [soldier.id],
    });
    sim.step();

    const startX = soldier.x;
    const startZ = soldier.z;

    // Enemy in LOS (distance 4) but outside melee range: soldier must not translate
    world.spawnUnit(1, 'peasant', 24.0, 20.0, 'crown');

    for (let t = 0; t < 60; t++) {
      sim.step();
      expect(soldier.x).toBe(startX);
      expect(soldier.z).toBe(startZ);
    }

    // Now place enemy within melee range (e.g. 0.6 tiles away)
    const closeEnemy = world.spawnUnit(1, 'peasant', 20.6, 20.0, 'crown');
    const closeEnemyInitialHp = closeEnemy.hp;

    // Soldier should attack without changing (x, z)
    let hitLanded = false;
    for (let t = 0; t < 100; t++) {
      sim.step();
      expect(soldier.x).toBe(startX);
      expect(soldier.z).toBe(startZ);
      if (closeEnemy.hp < closeEnemyInitialHp) {
        hitLanded = true;
        break;
      }
    }

    expect(hitLanded).toBe(true);
    expect(soldier.x).toBe(startX);
    expect(soldier.z).toBe(startZ);
  });

  it('explicit attack on unit pursues and defeats target', () => {
    const sim = new Sim(makeCleanMap(48), 42);
    const world = sim.world;

    const knight = world.spawnUnit(0, 'knight', 10, 20, 'crown');
    const peasant = world.spawnUnit(1, 'peasant', 18, 20, 'crown');

    sim.issue({
      kind: 'attack',
      player: 0,
      ids: [knight.id],
      targetId: peasant.id,
    });

    let defeated = false;
    for (let t = 0; t < 400; t++) {
      sim.step();
      if (world.getEntity(peasant.id) === undefined) {
        defeated = true;
        break;
      }
    }

    expect(defeated).toBe(true);
    expect(world.getEntity(peasant.id)).toBeUndefined();
  });

  it('explicit attack on building navigates to perimeter and destroys building', () => {
    const sim = new Sim(makeCleanMap(48), 42);
    const world = sim.world;

    // A full-HP cottage (550 HP, 5 damage per 2s from a man-at-arms) needs ~4400 ticks, so
    // use a low-HP isolated cottage: 3 real hits while still requiring real navigation.
    const maa = world.spawnUnit(0, 'man_at_arms', 12, 20, 'crown');
    const cottage = world.spawnBuilding(1, 'cottage', 20, 20, true);
    cottage.hp = 15;

    sim.issue({
      kind: 'attack',
      player: 0,
      ids: [maa.id],
      targetId: cottage.id,
      queued: false,
    });

    // max(1, 6 - 3) + 2 building bonus = 5 per hit
    let firstHitTick = -1;
    let destroyed = false;
    for (let t = 0; t < 600 && !destroyed; t++) {
      sim.step();
      if (firstHitTick < 0 && cottage.hp < 15) {
        firstHitTick = t;
        expect(cottage.hp).toBe(10);
        expect(isInAttackRange(maa, cottage)).toBe(true);
      }
      destroyed = world.getEntity(cottage.id) === undefined;
    }

    // The cottage is 8 tiles away at speed 0.9, so no hit can land before the unit walks there
    expect(firstHitTick).toBeGreaterThan(100);
    expect(destroyed).toBe(true);
    expect(cottage.hp).toBe(0);
    expect(world.remains.some((r) => r.id === cottage.id)).toBe(true);
    expect(world.grid.isPassable(20, 20, 0)).toBe(true);
  });

  it('queued attack and move: defeats first target, then executes queued destination', () => {
    const sim = new Sim(makeCleanMap(48), 42);
    const world = sim.world;

    const knight = world.spawnUnit(0, 'knight', 10, 20, 'crown');
    const enemy = world.spawnUnit(1, 'peasant', 14, 20, 'crown');

    // 1. Attack enemy
    sim.issue({
      kind: 'attack',
      player: 0,
      ids: [knight.id],
      targetId: enemy.id,
      queued: false,
    });

    // 2. Shift-queue move to (30, 20)
    sim.issue({
      kind: 'move',
      player: 0,
      ids: [knight.id],
      x: 30,
      z: 20,
      queued: true,
    });

    let enemyDead = false;
    let arrivedAtQueuedDest = false;

    for (let t = 0; t < 600; t++) {
      sim.step();
      if (!enemyDead && world.getEntity(enemy.id) === undefined) {
        enemyDead = true;
      }
      if (enemyDead && Math.hypot(knight.x - 30, knight.z - 20) < 1.0) {
        arrivedAtQueuedDest = true;
        break;
      }
    }

    expect(enemyDead).toBe(true);
    expect(arrivedAtQueuedDest).toBe(true);
    expect(knight.x).toBeGreaterThan(28);
  });

  it('hold issued mid-swing cancels the original impact; reacquisition swings later', () => {
    const sim = new Sim(makeCleanMap(48), 42);
    const world = sim.world;

    const knight = world.spawnUnit(0, 'knight', 20, 20, 'crown');
    const target = world.spawnUnit(1, 'peasant', 20.6, 20, 'crown');

    sim.issue({
      kind: 'attack',
      player: 0,
      ids: [knight.id],
      targetId: target.id,
      queued: false,
    });
    sim.step(); // tick 0: swing starts; hit frame would land at tick 9

    sim.issue({ kind: 'hold', player: 0, ids: [knight.id], queued: false });

    // Hold retains the cooldown; the next idle/hold acquisition scan runs at tick 10
    while (world.tick < 10) {
      sim.step();
      expect(knight.order?.kind).toBe('hold');
      expect(target.hp).toBe(target.maxHp);
    }

    // The retained 1.8s cooldown delays the next hit to at least tick 36
    let damageTick = -1;
    while (world.tick < 80 && damageTick < 0) {
      const stepTick = world.tick;
      sim.step();
      if (target.hp < target.maxHp) damageTick = stepTick;
    }
    expect(damageTick).toBeGreaterThanOrEqual(36);
    expect(target.hp).toBe(target.maxHp - 10);

  });

  it('move order out of range cancels the swing and deals no damage while leaving', () => {
    const sim = new Sim(makeCleanMap(48), 42);
    const world = sim.world;

    const knight = world.spawnUnit(0, 'knight', 20, 20, 'crown');
    const target = world.spawnUnit(1, 'peasant', 20.6, 20, 'crown');

    sim.issue({
      kind: 'attack',
      player: 0,
      ids: [knight.id],
      targetId: target.id,
      queued: false,
    });
    sim.step(); // swing starts at tick 0

    sim.issue({
      kind: 'move',
      player: 0,
      ids: [knight.id],
      x: 20,
      z: 30,
      queued: false,
    });
    for (let t = 0; t < 60; t++) {
      sim.step();
      expect(target.hp).toBe(target.maxHp);
    }

    expect(isInAttackRange(knight, target)).toBe(false);
    expect(knight.combat).toBeUndefined();
  });

  it('stale recycled target id is never damaged by a pending attack', () => {
    const sim = new Sim(makeCleanMap(48), 42);
    const world = sim.world;

    const knight = world.spawnUnit(0, 'knight', 20, 20, 'crown');
    const target = world.spawnUnit(1, 'peasant', 20.6, 20, 'crown');
    const oldId = target.id;

    sim.issue({
      kind: 'attack',
      player: 0,
      ids: [knight.id],
      targetId: oldId,
      queued: false,
    });
    sim.step(); // swing in progress against the original target

    world.removeEntity(oldId);
    const innocent = world.spawnUnit(0, 'peasant', 20.6, 20, 'crown');
    expect(innocent.id).toBe(oldId);

    for (let t = 0; t < 60; t++) sim.step();
    expect(innocent.hp).toBe(innocent.maxHp);
    expect(knight.combat?.targetRef).not.toBe(innocent);
  });

  it('unit death: corpse persists exactly 200 ticks and frees population', () => {
    const sim = new Sim(makeCleanMap(48), 42);
    const world = sim.world;
    const p1 = world.players[1];

    const victim = world.spawnUnit(1, 'peasant', 20, 20, 'crown');
    const victimId = victim.id;
    const initialPop = p1.pop;

    const killer = world.spawnUnit(0, 'knight', 20.6, 20, 'crown');
    sim.issue({
      kind: 'attack',
      player: 0,
      ids: [killer.id],
      targetId: victimId,
      queued: false,
    });

    // Knight deals 10 per hit to the 25 HP peasant: 25 -> 15 -> 5 -> 0
    const deaths: UnitDiedEvent[] = [];
    const hpSeen: number[] = [];
    let deathTick = -1;
    for (let t = 0; t < 200 && deathTick < 0; t++) {
      const stepTick = world.tick;
      const lastHp = victim.hp;
      stepAndCollect(sim, deaths);
      if (victim.hp !== lastHp) hpSeen.push(victim.hp);
      if (deaths.some((e) => e.entityId === victimId)) deathTick = stepTick;
    }

    expect(hpSeen).toEqual([15, 5, 0]);
    expect(deathTick).toBeGreaterThanOrEqual(0);
    expect(diedIds(deaths, 1)).toEqual([victimId]);
    // deathTick is the tick being processed when damage landed; world.tick already advanced
    expect(world.tick).toBe(deathTick + 1);
    expect(victim.deathTick).toBe(deathTick);

    // Removed from active entities and population freed immediately; retained in remains
    expect(world.getEntity(victimId)).toBeUndefined();
    expect(p1.pop).toBe(initialPop - 1);
    expect(world.remains).toContain(victim);

    // Step on every tick whose elapsed time is below 200: corpse still present
    while (world.tick < deathTick + 200) sim.step();
    expect(world.remains).toContain(victim);

    // The step processing elapsed == 200 culls it
    sim.step();
    expect(world.remains).not.toContain(victim);
  });

  it('building death: grid freed, paid queue discarded without refund, rubble persists exactly 400 ticks', () => {
    const sim = new Sim(makeCleanMap(48), 42);
    const world = sim.world;
    const p1 = world.players[1];

    const barracks = world.spawnBuilding(1, 'barracks', 24, 24, true);
    // A single trebuchet hit (200 + 250 building bonus = 450) destroys it
    barracks.hp = 450;

    // Building blocks grid across its 3x3 footprint
    expect(world.grid.isPassable(24, 24, 0)).toBe(false);
    expect(world.grid.isPassable(26, 26, 0)).toBe(false);

    // Pay for a real queue item through the train command
    sim.issue({
      kind: 'train',
      player: 1,
      buildingId: barracks.id,
      unitType: 'spearman',
    });
    sim.step();
    expect(barracks.trainingQueue).toHaveLength(1);
    expect(barracks.trainingQueue[0]).toMatchObject({
      unitType: 'spearman',
      food: 35,
      gold: 25,
    });
    const foodAfterPaying = p1.food;
    const goldAfterPaying = p1.gold;

    const treb = world.spawnUnit(0, 'trebuchet', 16, 25, 'crown');
    sim.issue({
      kind: 'attack',
      player: 0,
      ids: [treb.id],
      targetId: barracks.id,
      queued: false,
    });

    let deathTick = -1;
    for (let t = 0; t < 400 && deathTick < 0; t++) {
      const stepTick = world.tick;
      sim.step();
      if (world.getEntity(barracks.id) === undefined) deathTick = stepTick;
    }

    expect(deathTick).toBeGreaterThanOrEqual(0);
    expect(world.tick).toBe(deathTick + 1);
    expect(barracks.deathTick).toBe(deathTick);
    expect(barracks.hp).toBe(0);

    // Footprint freed on grid immediately
    expect(world.grid.isPassable(24, 24, 0)).toBe(true);
    expect(world.grid.isPassable(26, 26, 0)).toBe(true);

    // Paid queue discarded WITHOUT refund
    expect(barracks.trainingQueue).toHaveLength(0);
    expect(p1.food).toBe(foodAfterPaying);
    expect(p1.gold).toBe(goldAfterPaying);

    // Rubble retained for exactly 400 ticks
    expect(world.remains).toContain(barracks);
    while (world.tick < deathTick + 400) sim.step();
    expect(world.remains).toContain(barracks);
    sim.step();
    expect(world.remains).not.toContain(barracks);
  });
});
