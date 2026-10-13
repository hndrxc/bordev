import { describe, expect, it } from 'vitest';
import { Sim } from './sim.js';
import type { UnitDiedEvent } from './commands.js';
import type { UnitEntity } from './entity.js';
import { isInAttackRange } from './systems/combat.js';
import { makeOpenSim } from './testFixtures.js';

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
    const sim = makeOpenSim({
      size: 48,
      seed: 42,
      players: 2,
      starts: [
        [8, 8],
        [40, 40],
      ],
    });
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
    const sim = makeOpenSim({
      size: 48,
      seed: 42,
      players: 2,
      starts: [
        [8, 8],
        [40, 40],
      ],
    });
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
    const sim = makeOpenSim({ size: 48, seed: 42, players: 2 });
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
    const sim = makeOpenSim({ size: 48, seed: 42, players: 2 });
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

  it('hold position enforces exact immobility during observation and combat', () => {
    const sim = makeOpenSim({ size: 48, seed: 42, players: 2 });
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

  it('explicit attack on building navigates to perimeter and destroys building', () => {
    const sim = makeOpenSim({ size: 48, seed: 42, players: 2 });
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
    const sim = makeOpenSim({ size: 48, seed: 42, players: 2 });
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

  it('hold issued mid-swing cancels original impact and resets to exact 36-tick cadence on reacquisition', () => {
    const sim = makeOpenSim({ size: 48, seed: 42, players: 2 });
    const world = sim.world;

    const knight = world.spawnUnit(0, 'knight', 20, 20, 'crown');
    const target = world.spawnUnit(1, 'peasant', 20.6, 20, 'crown');
    target.hp = 1000;
    target.maxHp = 1000;

    sim.issue({
      kind: 'attack',
      player: 0,
      ids: [knight.id],
      targetId: target.id,
      queued: false,
    });
    sim.step(); // tick 0: swing starts; without hold, impact would land at tick 9

    sim.issue({ kind: 'hold', player: 0, ids: [knight.id], queued: false });

    const hitTicks: number[] = [];
    let lastHp = target.hp;
    for (let t = 1; t < 200; t++) {
      const tick = world.tick;
      sim.step();
      if (target.hp !== lastHp) {
        hitTicks.push(tick);
        lastHp = target.hp;
      }
    }

    // Mid-swing hold cancels hit at tick 9; first hit lands after cooldown at tick 45
    expect(hitTicks).toEqual([45, 81, 117, 153, 189]);
    for (let i = 1; i < hitTicks.length; i++) {
      expect(hitTicks[i] - hitTicks[i - 1]).toBe(36);
    }
  });

  it('move order out of range cancels the swing and deals no damage while leaving', () => {
    const sim = makeOpenSim({ size: 48, seed: 42, players: 2 });
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
    expect(knight.z).toBeGreaterThan(24);
  });

  it('stale recycled target id is never damaged by pending attack against hostile innocent', () => {
    const sim = makeOpenSim({ size: 48, seed: 42, players: 2 });
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
    // Innocent is HOSTILE (player 1) to verify real identity check, not accidental team hostility filter
    const innocent = world.spawnUnit(1, 'peasant', 20.6, 20, 'crown');
    expect(innocent.id).toBe(oldId);

    // Old in-progress swing targeting oldId must not land on innocent at tick 9 or any tick through 44
    for (let t = 1; t <= 44; t++) {
      sim.step();
      expect(innocent.hp).toBe(innocent.maxHp);
    }

    // Legitimate re-acquisition attack after cooldown lands on tick 45
    sim.step(); // tick 45
    expect(innocent.hp).toBeLessThan(innocent.maxHp);
  });

  it('unit death: corpse persists exactly 200 ticks and frees population', () => {
    const sim = makeOpenSim({ size: 48, seed: 42, players: 2 });
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

  it('building death: grid freed, training queue discarded without unit spawn or refund, rubble persists exactly 400 ticks', () => {
    const sim = makeOpenSim({ size: 48, seed: 42, players: 2 });
    const world = sim.world;
    const p1 = world.players[1];

    const barracks = world.spawnBuilding(1, 'barracks', 24, 24, true);
    // A single trebuchet hit (200 + 250 building bonus = 450) destroys it
    barracks.hp = 450;

    // Building blocks grid across its 3x3 footprint
    expect(world.grid.isPassable(24, 24, 0)).toBe(false);
    expect(world.grid.isPassable(26, 26, 0)).toBe(false);

    // Pay for a unit in queue
    sim.issue({
      kind: 'train',
      player: 1,
      buildingId: barracks.id,
      unitType: 'spearman',
    });
    sim.step();
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
    expect(p1.food).toBe(foodAfterPaying);
    expect(p1.gold).toBe(goldAfterPaying);

    // Rubble retained for exactly 400 ticks from deathTick
    expect(world.remains).toContain(barracks);
    while (world.tick < deathTick + 400) sim.step();
    expect(world.remains).toContain(barracks);
    sim.step();
    expect(world.remains).not.toContain(barracks);

    // Continue stepping past spearman training duration (400 ticks from deathTick) to assert no unit ever spawns
    for (let t = 0; t < 50; t++) sim.step();
    const p1Units = world.entities.filter(
      (e) => e && e.kind === 'unit' && e.player === 1 && e.hp > 0,
    );
    expect(p1Units).toHaveLength(0);
    expect(p1.food).toBe(foodAfterPaying);
    expect(p1.gold).toBe(goldAfterPaying);
  });

  it('building death: research in progress discarded without completion or refund', () => {
    const sim = makeOpenSim({ size: 48, seed: 42, players: 2 });
    const world = sim.world;
    const p1 = world.players[1];
    p1.food = 1000;
    p1.gold = 1000;

    const keep = world.spawnBuilding(1, 'keep', 20, 20, true);
    world.spawnBuilding(1, 'barracks', 25, 20, true);
    world.spawnBuilding(1, 'storehouse', 20, 25, true);

    sim.issue({
      kind: 'research',
      player: 1,
      buildingId: keep.id,
      upgradeId: 'age_2',
    });
    sim.step();
    const foodAfterPay = p1.food;
    const goldAfterPay = p1.gold;

    keep.hp = 100;
    const treb = world.spawnUnit(0, 'trebuchet', 12, 20, 'crown');
    sim.issue({
      kind: 'attack',
      player: 0,
      ids: [treb.id],
      targetId: keep.id,
    });

    for (let t = 0; t < 200; t++) sim.step();

    expect(world.getEntity(keep.id)).toBeUndefined();
    expect(p1.age).toBe(1);
    expect(p1.food).toBe(foodAfterPay);
    expect(p1.gold).toBe(goldAfterPay);
  });

  it('ranged attack spawns projectile with flight delay, and arrow released before shooter death still hits', () => {
    const sim = makeOpenSim({ size: 48, seed: 42, players: 2 });
    const world = sim.world;

    const archer = world.spawnUnit(0, 'longbowman', 10, 20);
    const target = world.spawnUnit(1, 'ox_cart', 15, 20);
    target.hp = 100;
    target.maxHp = 100;

    sim.issue({
      kind: 'attack',
      player: 0,
      ids: [archer.id],
      targetId: target.id,
    });

    let spawnTick = -1;
    let hitTick = -1;

    for (let t = 0; t < 60; t++) {
      const tick = world.tick;
      sim.step();
      const hasProjectile = world.entities.some(
        (e) => e && e.kind === 'projectile',
      );
      if (hasProjectile && spawnTick < 0) {
        spawnTick = tick;
        // Target has not received damage upon projectile release
        expect(target.hp).toBe(100);
      }
      if (target.hp < 100 && hitTick < 0) {
        hitTick = tick;
        break;
      }
    }

    expect(spawnTick).toBe(9);
    expect(hitTick).toBeGreaterThan(spawnTick);
    expect(hitTick - spawnTick).toBe(12); // travel time across 5 tiles at 8 tiles/s
    expect(target.hp).toBe(97);

    // Second test: arrow released before shooter dies still reaches and hits target
    const archer2 = world.spawnUnit(0, 'longbowman', 10, 20);
    const target2 = world.spawnUnit(1, 'ox_cart', 15, 20);
    target2.hp = 100;
    target2.maxHp = 100;

    sim.issue({
      kind: 'attack',
      player: 0,
      ids: [archer2.id],
      targetId: target2.id,
    });

    // Step until projectile spawns
    for (let t = 0; t < 50; t++) {
      sim.step();
      if (world.entities.some((e) => e && e.kind === 'projectile')) break;
    }

    // Kill shooter mid-flight
    world.removeEntity(archer2.id);
    expect(world.getEntity(archer2.id)).toBeUndefined();
    expect(target2.hp).toBe(100);

    // Advance ticks: projectile arrives and deals damage
    for (let t = 0; t < 50; t++) {
      sim.step();
      if (target2.hp < 100) break;
    }
    expect(target2.hp).toBe(97);
  });

  it('corpse in remains and live unit sharing a reused entity ID operate independently at sim level', () => {
    const sim = makeOpenSim({ size: 48, seed: 42, players: 2 });
    const world = sim.world;

    const unitA = world.spawnUnit(1, 'peasant', 10, 10);
    const recycledId = unitA.id;
    const killer = world.spawnUnit(0, 'knight', 10.6, 10);
    sim.issue({
      kind: 'attack',
      player: 0,
      ids: [killer.id],
      targetId: recycledId,
    });

    let deathTick = -1;
    for (let t = 0; t < 100; t++) {
      const tick = world.tick;
      sim.step();
      if (unitA.hp <= 0 && deathTick < 0) {
        deathTick = tick;
        break;
      }
    }
    expect(deathTick).toBeGreaterThanOrEqual(0);
    const corpse = world.remains.find((r) => r.id === recycledId);
    expect(corpse).toBeDefined();

    // Spawn Unit B reusing recycledId
    const unitB = world.spawnUnit(1, 'spearman', 25, 25);
    expect(unitB.id).toBe(recycledId);
    expect(world.getEntity(recycledId)).toBe(unitB);

    sim.issue({
      kind: 'move',
      player: 1,
      ids: [unitB.id],
      x: 30,
      z: 25,
    });

    // Step until corpse expires (at deathTick + 200)
    while (world.tick <= deathTick + 200) {
      sim.step();
    }

    expect(world.remains.find((r) => r.id === recycledId)).toBeUndefined();
    expect(world.getEntity(recycledId)).toBe(unitB);
    expect(unitB.hp).toBe(45);
    expect(unitB.x).toBe(30);
    expect(unitB.z).toBe(25);
  });

  it('combat determinism: identical seed and orders produce identical event and HP history across two runs', () => {
    function runMatch(seed: number) {
      const sim = makeOpenSim({ size: 40, seed });
      const world = sim.world;

      const p0Units: UnitEntity[] = [];
      for (let i = 0; i < 5; i++) {
        p0Units.push(world.spawnUnit(0, 'spearman', 15, 18 + i * 1.2));
      }
      const p1Units: UnitEntity[] = [];
      for (let i = 0; i < 5; i++) {
        p1Units.push(world.spawnUnit(1, 'peasant', 25, 18 + i * 1.2));
      }

      sim.issue({
        kind: 'attackMove',
        player: 0,
        ids: p0Units.map((u) => u.id),
        x: 25,
        z: 20,
      });
      sim.issue({
        kind: 'attackMove',
        player: 1,
        ids: p1Units.map((u) => u.id),
        x: 15,
        z: 20,
      });

      const hpHistory: number[][] = [];
      const eventHistory: string[] = [];

      for (let t = 0; t < 400; t++) {
        sim.step();
        hpHistory.push([...p0Units.map((u) => u.hp), ...p1Units.map((u) => u.hp)]);
        const events = sim.drainEvents();
        if (events.length > 0) {
          eventHistory.push(
            `${world.tick}:${events.map((e) => `${e.kind}:${'entityId' in e ? e.entityId : ''}`).join(',')}`,
          );
        }
      }

      return { hpHistory, eventHistory };
    }

    const run1 = runMatch(12345);
    const run2 = runMatch(12345);

    expect(run1.hpHistory).toEqual(run2.hpHistory);
    expect(run1.eventHistory).toEqual(run2.eventHistory);
    expect(run1.eventHistory.length).toBeGreaterThan(0);
  });
});
