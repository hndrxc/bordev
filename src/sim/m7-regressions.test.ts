import { describe, expect, it } from 'vitest';
import { Sim, SIM_DT } from './sim.js';
import { Terrain } from './map.js';
import type { BuildingEntity, UnitEntity } from './entity.js';
import { CROWN_UNITS } from '../data/units.js';
import { isInAttackRange } from './systems/combat.js';
import { makeOpenMap, makeOpenSim } from './testFixtures.js';

describe('M7 combat regressions', () => {
  it('idle melee unit chases an enemy at line-of-sight distance and hits it', () => {
    const sim = makeOpenSim({ size: 40, seed: 7 });
    const { world } = sim;
    const spear = world.spawnUnit(0, 'spearman', 10, 20);
    // Ox carts have no attack, so the bait cannot move or retaliate
    const bait = world.spawnUnit(1, 'ox_cart', 15.5, 20);
    expect(Math.hypot(spear.x - bait.x, spear.z - bait.z)).toBeGreaterThan(5);
    expect(Math.hypot(spear.x - bait.x, spear.z - bait.z)).toBeLessThan(
      CROWN_UNITS.spearman.lineOfSight,
    );

    for (let t = 0; t < 250 && bait.hp === bait.maxHp; t++) sim.step();

    expect(bait.hp).toBe(bait.maxHp - CROWN_UNITS.spearman.attack);
    expect(spear.x).toBeGreaterThan(13);
    expect(isInAttackRange(spear, bait)).toBe(true);
  });

  it('idle unit retaliates against a tower that shoots it from beyond its own sight', () => {
    const sim = makeOpenSim({ size: 40, seed: 7 });
    const { world } = sim;
    // Tower owner has a Keep so it is not silently in Low Faith
    world.spawnBuilding(1, 'keep', 35, 20, true);
    const tower = world.spawnBuilding(1, 'stone_tower', 24, 20, true);
    // 6.3 tiles from the tower footprint: inside tower range 7, outside spearman sight 6
    const spear = world.spawnUnit(0, 'spearman', 17.7, 20.5);
    const startDistance = Math.hypot(spear.x - tower.x, spear.z - tower.z);

    for (let t = 0; t < 300 && spear.hp > 0 && tower.hp === tower.maxHp; t++)
      sim.step();

    expect(spear.hp).toBeLessThan(spear.maxHp);
    expect(spear.hp).toBeGreaterThan(0);
    // Melee 3 against tower melee armor 3 is the 1 HP minimum
    expect(tower.hp).toBe(tower.maxHp - 1);
    expect(Math.hypot(spear.x - tower.x, spear.z - tower.z)).toBeLessThan(
      startDistance - 3,
    );
  });

  it('attackMove stays on an off-route enemy until it dies, then resumes to its destination', () => {
    const sim = makeOpenSim({ size: 40, seed: 7 });
    const { world } = sim;
    const marcher = world.spawnUnit(0, 'spearman', 10, 20);
    const bait = world.spawnUnit(1, 'ox_cart', 14, 23);
    bait.hp = 9; // three spearman hits
    sim.issue({
      kind: 'attackMove',
      player: 0,
      ids: [marcher.id],
      x: 30,
      z: 20,
    });

    let hits = 0;
    let lastHp = bait.hp;
    for (let t = 0; t < 600 && bait.hp > 0; t++) {
      sim.step();
      if (bait.hp !== lastHp) {
        hits++;
        lastHp = bait.hp;
      }
      if (hits > 0 && bait.hp > 0) {
        // Neither drifted toward the destination nor completed the order mid-fight
        expect(marcher.order?.kind).toBe('attackMove');
        expect(isInAttackRange(marcher, bait)).toBe(true);
      }
    }
    expect(hits).toBe(3);
    expect(bait.hp).toBe(0);

    for (
      let t = 0;
      t < 1000 && Math.hypot(marcher.x - 30, marcher.z - 20) > 1;
      t++
    )
      sim.step();
    expect(Math.hypot(marcher.x - 30, marcher.z - 20)).toBeLessThanOrEqual(1);
  });

  it('same-team units never attack each other and towers shoot the real enemy instead', () => {
    const sim = makeOpenSim({ size: 40, seed: 7 });
    const { world } = sim;
    world.setTeam(1, world.players[0].team);
    // Player 1 has a Keep so its tower is not silently in Low Faith
    world.spawnBuilding(1, 'keep', 35, 35, true);

    const soldier = world.spawnUnit(0, 'spearman', 10, 20);
    const ally = world.spawnUnit(1, 'ox_cart', 10.6, 20);
    for (let t = 0; t < 100; t++) sim.step();
    expect(ally.hp).toBe(ally.maxHp);

    sim.issue({
      kind: 'attack',
      player: 0,
      ids: [soldier.id],
      targetId: ally.id,
    });
    for (let t = 0; t < 100; t++) sim.step();
    expect(soldier.order?.kind).not.toBe('attack');
    expect(ally.hp).toBe(ally.maxHp);

    // Allied tower with a nearer allied unit and a farther real enemy in range
    const tower = world.spawnBuilding(1, 'stone_tower', 30, 30, true);
    const nearAlly = world.spawnUnit(0, 'ox_cart', 27.5, 30.5);
    const enemy = world.spawnUnit(2, 'ox_cart', 24.5, 30.5);
    expect(Math.hypot(nearAlly.x - tower.x, nearAlly.z - tower.z)).toBeLessThan(
      Math.hypot(enemy.x - tower.x, enemy.z - tower.z),
    );
    for (let t = 0; t < 150 && enemy.hp === enemy.maxHp; t++) {
      sim.step();
      expect(nearAlly.hp).toBe(nearAlly.maxHp);
    }
    // Tower 6 pierce - ox cart pierce armor 2
    expect(enemy.hp).toBe(enemy.maxHp - (6 - CROWN_UNITS.ox_cart.pierceArmor));
  });

  it('trebuchet never advances into a too-close target and only fires from legal range', () => {
    const sim = makeOpenSim({ size: 40, seed: 7 });
    const { world } = sim;
    const minRange = CROWN_UNITS.trebuchet.minRange;
    const treb = world.spawnUnit(0, 'trebuchet', 20, 20);
    const target = world.spawnUnit(1, 'ox_cart', 22, 20);
    const startDistance = Math.hypot(treb.x - target.x, treb.z - target.z);
    expect(startDistance).toBeLessThan(minRange);
    sim.issue({
      kind: 'attack',
      player: 0,
      ids: [treb.id],
      targetId: target.id,
    });

    let closest = startDistance;
    for (let t = 0; t < 800 && target.hp === target.maxHp; t++) {
      sim.step();
      closest = Math.min(
        closest,
        Math.hypot(treb.x - target.x, treb.z - target.z),
      );
    }

    expect(closest).toBeGreaterThanOrEqual(startDistance - 1e-6);
    expect(target.hp).toBeLessThan(target.maxHp);
    expect(Math.hypot(treb.x - target.x, treb.z - target.z)).toBeGreaterThanOrEqual(
      minRange,
    );
    expect(isInAttackRange(treb, target)).toBe(true);
  });

  it('idle trebuchet does not acquire or approach an enemy inside its minimum range', () => {
    const sim = makeOpenSim({ size: 40, seed: 7 });
    const { world } = sim;
    const treb = world.spawnUnit(0, 'trebuchet', 20, 20);
    const target = world.spawnUnit(1, 'ox_cart', 22, 20);
    const start = { x: treb.x, z: treb.z };

    for (let t = 0; t < 200; t++) sim.step();

    expect(target.hp).toBe(target.maxHp);
    expect(treb.x).toBe(start.x);
    expect(treb.z).toBe(start.z);
  });

  describe('close-range chase respects blocked tiles', () => {
    const wallRows = [17, 18, 19, 20, 21, 22, 23];
    const barriers: [string, (sim: Sim) => void][] = [
      [
        'enemy wall',
        (sim) => {
          for (const z of wallRows)
            sim.world.spawnBuilding(1, 'stone_wall', 15, z, true);
        },
      ],
      [
        'enemy gate',
        (sim) => {
          sim.world.spawnBuilding(1, 'stone_gate', 15, 19, true, 'vertical');
          for (const z of [17, 18, 22, 23])
            sim.world.spawnBuilding(1, 'stone_wall', 15, z, true);
        },
      ],
      [
        'water',
        () => undefined,
      ],
    ];

    it.each(barriers)(
      'attacker never steps through %s toward a target 1.4 tiles away',
      (name, build) => {
        const sim = makeOpenSim({
          size: 40,
          seed: 7,
          mutate:
            name === 'water'
              ? (tiles, size) => {
                  for (const z of wallRows) tiles[z * size + 15] = Terrain.WATER;
                }
              : undefined,
        });
        const { world } = sim;
        build(sim);
        const attacker = world.spawnUnit(0, 'spearman', 14.8, 20.5);
        const target = world.spawnUnit(1, 'peasant', 16.2, 20.5);
        target.hp = CROWN_UNITS.spearman.attack; // one hit
        sim.issue({ kind: 'hold', player: 1, ids: [target.id] });
        expect(
          Math.hypot(attacker.x - target.x, attacker.z - target.z),
        ).toBeLessThan(1.5);
        sim.issue({
          kind: 'attack',
          player: 0,
          ids: [attacker.id],
          targetId: target.id,
        });

        let maxDeviation = 0;
        for (let t = 0; t < 900 && target.hp > 0; t++) {
          sim.step();
          expect(
            world.grid.canOccupy(
              attacker.x,
              attacker.z,
              attacker.radius,
              attacker.player,
            ),
          ).toBe(true);
          maxDeviation = Math.max(maxDeviation, Math.abs(attacker.z - 20.5));
        }

        // It went around the barrier (rows 17..23) and killed the target
        expect(maxDeviation).toBeGreaterThan(3);
        expect(target.hp).toBe(0);
      },
    );
  });

  it('re-issuing the same attack order every 4, 5, 7, and 8 ticks preserves swing and hits at exact tick cadence', () => {
    const cooldownTicks = Math.round(CROWN_UNITS.knight.cooldown / SIM_DT);
    expect(cooldownTicks).toBe(36);
    const expectedHits = [9, 45, 81, 117, 153, 189];

    function runTest(reissuePeriod?: number): number[] {
      const sim = makeOpenSim({ size: 40, seed: 7 });
      const { world } = sim;
      const knight = world.spawnUnit(0, 'knight', 20, 20);
      const target = world.spawnUnit(1, 'ox_cart', 20.6, 20);
      target.hp = 1000;
      target.maxHp = 1000;

      sim.issue({
        kind: 'attack',
        player: 0,
        ids: [knight.id],
        targetId: target.id,
      });

      const hitTicks: number[] = [];
      let lastHp = target.hp;
      for (let t = 0; t < 200; t++) {
        if (reissuePeriod && t > 0 && world.tick % reissuePeriod === 0) {
          sim.issue({
            kind: 'attack',
            player: 0,
            ids: [knight.id],
            targetId: target.id,
          });
        }
        const tick = world.tick;
        sim.step();
        if (target.hp !== lastHp) {
          hitTicks.push(tick);
          lastHp = target.hp;
        }
      }
      return hitTicks;
    }

    // Single order hit cadence
    const singleOrderHits = runTest();
    expect(singleOrderHits).toEqual(expectedHits);

    // Spamming attack re-issues mid-swing (every 4, 5, 7, and 8 ticks) does not reset the swing
    for (const period of [4, 5, 7, 8]) {
      const spammedHits = runTest(period);
      expect(spammedHits).toEqual(expectedHits);
    }
  });

  it('a unit that kills one target waits out its cooldown before hitting the next', () => {
    const sim = makeOpenSim({ size: 40, seed: 7 });
    const { world } = sim;
    const knight = world.spawnUnit(0, 'knight', 20, 20);
    const first = world.spawnUnit(1, 'ox_cart', 20.6, 20);
    const second = world.spawnUnit(1, 'ox_cart', 19.4, 20);
    first.hp = CROWN_UNITS.knight.attack; // one hit
    sim.issue({
      kind: 'attack',
      player: 0,
      ids: [knight.id],
      targetId: first.id,
    });
    const cooldownTicks = Math.round(CROWN_UNITS.knight.cooldown / SIM_DT);
    expect(cooldownTicks).toBe(36);

    let killTick = -1;
    let nextHitTick = -1;
    for (let t = 0; t < 200 && nextHitTick < 0; t++) {
      const tick = world.tick;
      sim.step();
      if (killTick < 0 && first.hp <= 0) killTick = tick;
      if (second.hp < second.maxHp) nextHitTick = tick;
    }

    expect(knight.hp).toBe(knight.maxHp);
    expect(killTick).toBe(9);
    expect(nextHitTick).toBe(45);
    expect(nextHitTick - killTick).toBe(cooldownTicks);
  });

  it('ranged unit shoots an in-range enemy inside a wall ring without damaging the walls', () => {
    const sim = makeOpenSim({ size: 40, seed: 7 });
    const { world } = sim;
    const ring: BuildingEntity[] = [];
    for (let x = 12; x <= 16; x++) {
      for (let z = 18; z <= 22; z++) {
        if (x === 12 || x === 16 || z === 18 || z === 22) {
          ring.push(world.spawnBuilding(1, 'stone_wall', x, z, true));
        }
      }
    }
    const target = world.spawnUnit(1, 'ox_cart', 14.5, 20.5);
    target.hp = 3;
    const archer = world.spawnUnit(0, 'longbowman', 9.5, 20.5);
    expect(
      Math.hypot(archer.x - target.x, archer.z - target.z),
    ).toBeLessThanOrEqual(CROWN_UNITS.longbowman.range);
    sim.issue({
      kind: 'attack',
      player: 0,
      ids: [archer.id],
      targetId: target.id,
    });

    for (let t = 0; t < 200 && target.hp > 0; t++) sim.step();

    expect(target.hp).toBe(0);
    expect(archer.x).toBe(9.5);
    for (const wall of ring) expect(wall.hp).toBe(wall.maxHp);
  });

  it('a peasant ordered to attack stops playing the work animation', () => {
    const sim = makeOpenSim({ size: 40, seed: 7 });
    const { world } = sim;
    const site = world.spawnBuilding(0, 'cottage', 14, 14, false);
    const peasant = world.spawnUnit(0, 'peasant', 12.5, 14.5);
    const target = world.spawnUnit(1, 'ox_cart', 8, 14.5);
    target.hp = CROWN_UNITS.peasant.attack; // one hit
    sim.issue({
      kind: 'build',
      player: 0,
      ids: [peasant.id],
      buildingType: 'cottage',
      x: 14,
      z: 14,
      targetId: site.id,
    });
    for (let t = 0; t < 600 && peasant.workAnimation !== 'work'; t++)
      sim.step();
    expect(peasant.workAnimation).toBe('work');

    sim.issue({
      kind: 'attack',
      player: 0,
      ids: [peasant.id],
      targetId: target.id,
    });
    for (let t = 0; t < 300 && target.hp > 0; t++) {
      sim.step();
      expect(peasant.workAnimation).toBeUndefined();
    }
    expect(target.hp).toBe(0);
    expect(site.built).toBe(false);
  });

  it('stone tower fire cadence is exactly 40 ticks with normal faith and doubles to 80 ticks under Low Faith', () => {
    // Normal faith: Keep provides 5 faith > 2 used by stone tower
    const simNormal = makeOpenSim({ size: 40, seed: 1 });
    const wNormal = simNormal.world;
    wNormal.spawnBuilding(0, 'keep', 5, 5, true);
    wNormal.spawnBuilding(0, 'stone_tower', 20, 20, true);
    const targetNormal = wNormal.spawnUnit(1, 'ox_cart', 23, 20);
    targetNormal.hp = 1000;
    targetNormal.maxHp = 1000;

    const hitsNormal: number[] = [];
    let lastHpNormal = targetNormal.hp;
    for (let t = 0; t < 200; t++) {
      const tick = wNormal.tick;
      simNormal.step();
      if (targetNormal.hp !== lastHpNormal) {
        hitsNormal.push(tick);
        lastHpNormal = targetNormal.hp;
      }
    }
    expect(hitsNormal).toEqual([15, 55, 95, 135, 175]);
    for (let i = 1; i < hitsNormal.length; i++) {
      expect(hitsNormal[i] - hitsNormal[i - 1]).toBe(40);
    }

    // Low Faith: no Keep means 2 faith used > 0 produced -> lowFaith = true
    const simLow = makeOpenSim({ size: 40, seed: 1 });
    const wLow = simLow.world;
    wLow.spawnBuilding(0, 'stone_tower', 20, 20, true);
    simLow.step(); // tick 0 faith update marks lowFaith = true
    const targetLow = wLow.spawnUnit(1, 'ox_cart', 23, 20);
    targetLow.hp = 1000;
    targetLow.maxHp = 1000;

    const hitsLow: number[] = [];
    let lastHpLow = targetLow.hp;
    for (let t = 0; t < 300; t++) {
      const tick = wLow.tick;
      simLow.step();
      if (targetLow.hp !== lastHpLow) {
        hitsLow.push(tick);
        lastHpLow = targetLow.hp;
      }
    }
    expect(hitsLow).toEqual([16, 96, 176, 256]);
    for (let i = 1; i < hitsLow.length; i++) {
      expect(hitsLow[i] - hitsLow[i - 1]).toBe(80);
    }
  });

  it('Keep arrow fire cadence is exactly 40 ticks with normal faith and doubles to 80 ticks under Low Faith', () => {
    // Normal faith: Keep produces 5 faith and uses 0
    const simNormal = makeOpenSim({ size: 40, seed: 1 });
    const wNormal = simNormal.world;
    wNormal.spawnBuilding(0, 'keep', 20, 20, true);
    const targetNormal = wNormal.spawnUnit(1, 'ox_cart', 23, 20);
    targetNormal.hp = 1000;
    targetNormal.maxHp = 1000;

    const hitsNormal: number[] = [];
    let lastHpNormal = targetNormal.hp;
    for (let t = 0; t < 200; t++) {
      const tick = wNormal.tick;
      simNormal.step();
      if (targetNormal.hp !== lastHpNormal) {
        hitsNormal.push(tick);
        lastHpNormal = targetNormal.hp;
      }
    }
    expect(hitsNormal).toEqual([5, 45, 85, 125, 165]);
    for (let i = 1; i < hitsNormal.length; i++) {
      expect(hitsNormal[i] - hitsNormal[i - 1]).toBe(40);
    }

    // Low Faith: 3 stables use 9 faith > 5 produced
    const simLow = makeOpenSim({ size: 40, seed: 1 });
    const wLow = simLow.world;
    wLow.spawnBuilding(0, 'keep', 20, 20, true);
    wLow.spawnBuilding(0, 'stable', 5, 5, true);
    wLow.spawnBuilding(0, 'stable', 5, 10, true);
    wLow.spawnBuilding(0, 'stable', 5, 15, true);
    simLow.step(); // tick 0 faith update marks lowFaith = true

    const targetLow = wLow.spawnUnit(1, 'ox_cart', 23, 20);
    targetLow.hp = 1000;
    targetLow.maxHp = 1000;

    const hitsLow: number[] = [];
    let lastHpLow = targetLow.hp;
    for (let t = 0; t < 300; t++) {
      const tick = wLow.tick;
      simLow.step();
      if (targetLow.hp !== lastHpLow) {
        hitsLow.push(tick);
        lastHpLow = targetLow.hp;
      }
    }
    expect(hitsLow).toEqual([15, 95, 175, 255]);
    for (let i = 1; i < hitsLow.length; i++) {
      expect(hitsLow[i] - hitsLow[i - 1]).toBe(80);
    }
  });

  it('unfinished tower never fires arrows', () => {
    const sim = makeOpenSim({ size: 40, seed: 1 });
    const world = sim.world;
    world.spawnBuilding(0, 'keep', 5, 5, true);
    world.spawnBuilding(0, 'stone_tower', 20, 20, false); // built: false
    const target = world.spawnUnit(1, 'ox_cart', 23, 20);
    const initialHp = target.hp;

    for (let t = 0; t < 100; t++) sim.step();

    expect(target.hp).toBe(initialHp);
  });

  it('battering ram damages buildings and units in melee reach with direct damage and no projectile', () => {
    const map = makeOpenMap({ size: 40, players: 2 });
    const sim = new Sim(map, 1, { 0: 'clans', 1: 'crown' });
    const { world } = sim;

    // Ram vs building
    const ram = world.spawnUnit(0, 'battering_ram', 15, 20, 'clans');
    const cottage = world.spawnBuilding(1, 'cottage', 17, 20, true);
    const cottageHpBefore = cottage.hp;

    sim.issue({
      kind: 'attack',
      player: 0,
      ids: [ram.id],
      targetId: cottage.id,
    });

    for (let t = 0; t < 200 && cottage.hp === cottageHpBefore; t++) {
      sim.step();
      expect(
        world.entities.some((e) => e && e.kind === 'projectile'),
      ).toBe(false);
    }
    expect(cottage.hp).toBeLessThan(cottageHpBefore);

    // Ram vs unit
    const ram2 = world.spawnUnit(0, 'battering_ram', 25, 20, 'clans');
    const peasant = world.spawnUnit(1, 'peasant', 27, 20, 'crown');
    const peasantHpBefore = peasant.hp;

    sim.issue({
      kind: 'attack',
      player: 0,
      ids: [ram2.id],
      targetId: peasant.id,
    });

    for (let t = 0; t < 200 && peasant.hp === peasantHpBefore; t++) {
      sim.step();
      expect(
        world.entities.some((e) => e && e.kind === 'projectile'),
      ).toBe(false);
    }
    expect(peasant.hp).toBeLessThan(peasantHpBefore);
  });

  it('idle unit next to hostile wall retaliates against enemy attacking it instead of the wall', () => {
    const sim = makeOpenSim({ size: 40, seed: 7 });
    const { world } = sim;
    const wall = world.spawnBuilding(1, 'stone_wall', 20, 20, true);
    const mine = world.spawnUnit(0, 'spearman', 19.5, 21.5);
    const raider = world.spawnUnit(1, 'spearman', 13.6, 21.5);

    for (let t = 0; t < 650 && mine.hp > 0; t++) sim.step();

    // The defending spearman retaliated against the raider, leaving the wall untouched at full 800 HP
    expect(raider.hp).toBeLessThan(raider.maxHp);
    expect(wall.hp).toBe(800);
  });

  it('attackMove passes enemy walls without attacking them and reaches its destination', () => {
    const sim = makeOpenSim({ size: 64, seed: 1 });
    const { world } = sim;
    for (let x = 10; x <= 30; x++)
      world.spawnBuilding(1, 'stone_wall', x, 20, true);
    const u = world.spawnUnit(0, 'spearman', 5.5, 18.5);

    sim.issue({
      kind: 'attackMove',
      player: 0,
      ids: [u.id],
      x: 40.5,
      z: 18.5,
      queued: false,
    });

    let wallHits = 0;
    for (let t = 0; t < 1200; t++) {
      sim.step();
      for (const e of sim.drainEvents()) {
        if (e.kind === 'underAttack') wallHits++;
      }
    }

    expect(wallHits).toBe(0);
    expect(Math.hypot(u.x - 40.5, u.z - 18.5)).toBeLessThan(0.5);
  });

  it('units outrank buildings in automatic acquisition priority', () => {
    const sim = makeOpenSim({ size: 40, seed: 1 });
    const { world } = sim;
    world.spawnUnit(0, 'spearman', 10, 20);
    const cottage = world.spawnBuilding(1, 'cottage', 12, 20, true);
    const enemyUnit = world.spawnUnit(1, 'peasant', 14, 20);

    for (let t = 0; t < 150 && enemyUnit.hp === enemyUnit.maxHp; t++)
      sim.step();

    expect(enemyUnit.hp).toBeLessThan(enemyUnit.maxHp);
    expect(cottage.hp).toBe(550);
  });

  it('across-water hostile target is never auto-acquired while a reachable enemy is in range', () => {
    const map = makeOpenMap({
      size: 128,
      mutate: (tiles, size) => {
        for (let z = 0; z < size; z++) {
          for (let x = 62; x <= 65; x++) tiles[z * size + x] = Terrain.WATER;
        }
      },
    });
    const sim = new Sim(map, 7);
    const { world } = sim;
    const mine = world.spawnUnit(0, 'spearman', 60.5, 64.5);
    const across = world.spawnUnit(1, 'ox_cart', 66.3, 64.5);
    const raider = world.spawnUnit(1, 'spearman', 54.6, 64.5);

    for (let t = 0; t < 650 && mine.hp > 0; t++) sim.step();

    expect(raider.hp).toBeLessThan(raider.maxHp);
    expect(across.hp).toBe(80);
  });

  it('trebuchet with direct back-off path blocked repositions to a legal firing tile, or gives up if none exists', () => {
    const sim = makeOpenSim({ size: 40, seed: 7 });
    const { world } = sim;
    const enemy = world.spawnBuilding(1, 'barracks', 12, 19, true);
    // Friendly barracks blocks straight-line retreat
    world.spawnBuilding(0, 'barracks', 7, 19, true);
    const treb = world.spawnUnit(0, 'trebuchet', 10.5, 20.5);

    sim.issue({
      kind: 'attack',
      player: 0,
      ids: [treb.id],
      targetId: enemy.id,
      queued: false,
    });

    for (let t = 0; t < 1200 && enemy.hp > 0; t++) sim.step();
    expect(enemy.hp).toBe(0);

    // Give up case: surrounded on all sides by stone walls with no legal firing tile reachable
    const simEnclosed = makeOpenSim({ size: 40, seed: 1 });
    const wEnc = simEnclosed.world;
    const trebEnc = wEnc.spawnUnit(0, 'trebuchet', 20.5, 20.5);
    for (let x = 19; x <= 21; x++) {
      for (let z = 19; z <= 21; z++) {
        if (x !== 20 || z !== 20) wEnc.spawnBuilding(0, 'stone_wall', x, z, true);
      }
    }
    const enemyEnc = wEnc.spawnUnit(1, 'ox_cart', 22.5, 20.5);

    simEnclosed.issue({
      kind: 'attack',
      player: 0,
      ids: [trebEnc.id],
      targetId: enemyEnc.id,
      queued: false,
    });

    for (let t = 0; t < 20; t++) simEnclosed.step();
    expect(trebEnc.order?.kind).toBe('idle');
  });

  it('staggered acquisition ensures every unit in a group acquires within 10 ticks', () => {
    const sim = makeOpenSim({ size: 40, seed: 1 });
    const { world } = sim;
    const spearmen: UnitEntity[] = [];
    for (let i = 0; i < 10; i++) {
      spearmen.push(world.spawnUnit(0, 'spearman', 15, 15 + i));
    }
    for (let i = 0; i < 10; i++) {
      world.spawnUnit(1, 'peasant', 18, 15 + i);
    }

    const initialX = spearmen.map((s) => s.x);
    for (let t = 0; t < 10; t++) sim.step();

    // Stagger scans when (tick + id) % 10 === 0; over 10 ticks all 10 have scanned and started moving
    for (let i = 0; i < spearmen.length; i++) {
      const movedOrPathing =
        spearmen[i].x !== initialX[i] || spearmen[i].pathPending;
      expect(movedOrPathing).toBe(true);
    }
  });

  it('stop stance unit retaliates and chases enemy attacker', () => {
    const sim = makeOpenSim({ size: 40, seed: 1 });
    const { world } = sim;
    const defender = world.spawnUnit(0, 'spearman', 20, 20);
    sim.issue({ kind: 'stop', player: 0, ids: [defender.id] });
    sim.step();
    expect(defender.order?.kind).toBe('stop');

    const attacker = world.spawnUnit(1, 'spearman', 17, 20);
    sim.issue({
      kind: 'attack',
      player: 1,
      ids: [attacker.id],
      targetId: defender.id,
    });

    for (let t = 0; t < 200 && attacker.hp === attacker.maxHp; t++) sim.step();
    expect(attacker.hp).toBeLessThan(attacker.maxHp);
  });

  it('ranged unit on hold damages in-range targets while remaining strictly immobile and ignores out-of-range targets', () => {
    const sim = makeOpenSim({ size: 40, seed: 1 });
    const { world } = sim;
    const archer = world.spawnUnit(0, 'longbowman', 20, 20);
    sim.issue({ kind: 'hold', player: 0, ids: [archer.id] });
    sim.step();

    // 1. Enemy in LOS but outside longbowman range (range 6; distance 7): no damage and no movement
    const farEnemy = world.spawnUnit(1, 'ox_cart', 27, 20);
    for (let t = 0; t < 60; t++) sim.step();
    expect(farEnemy.hp).toBe(farEnemy.maxHp);
    expect(archer.x).toBe(20);
    expect(archer.z).toBe(20);

    // 2. Enemy within longbowman range (distance 5): damaged while archer stays strictly at (20, 20)
    const nearEnemy = world.spawnUnit(1, 'ox_cart', 25, 20);
    for (let t = 0; t < 100 && nearEnemy.hp === nearEnemy.maxHp; t++) sim.step();
    expect(nearEnemy.hp).toBeLessThan(nearEnemy.maxHp);
    expect(archer.x).toBe(20);
    expect(archer.z).toBe(20);
  });

  it('queued attack whose target dies before it starts completes cleanly without freezing or repath thrash', () => {
    const sim = makeOpenSim({ size: 40, seed: 1 });
    const { world } = sim;
    const knight = world.spawnUnit(0, 'knight', 10, 20);
    const enemy = world.spawnUnit(1, 'peasant', 30, 20);

    sim.issue({
      kind: 'move',
      player: 0,
      ids: [knight.id],
      x: 15,
      z: 20,
      queued: false,
    });
    sim.issue({
      kind: 'attack',
      player: 0,
      ids: [knight.id],
      targetId: enemy.id,
      queued: true,
    });
    sim.step();

    // Destroy target while knight is moving
    world.removeEntity(enemy.id);

    for (let t = 0; t < 200; t++) sim.step();

    expect(knight.order?.kind).toBe('idle');
    expect(Math.hypot(knight.x - 15, knight.z - 20)).toBeLessThan(0.1);
  });
});
