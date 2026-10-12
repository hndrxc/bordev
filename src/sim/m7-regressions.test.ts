import { describe, expect, it } from 'vitest';
import { Sim, SIM_DT } from './sim.js';
import { Terrain, type GameMap } from './map.js';
import type { BuildingEntity } from './entity.js';
import { CROWN_UNITS } from '../data/units.js';
import { isInAttackRange } from './systems/combat.js';

const MAP_SIZE = 40;

/** Three players, no starting bases: nothing but the test's own entities can fight or block. */
function makeMap(mutate?: (tiles: Uint8Array) => void): GameMap {
  const tiles = new Uint8Array(MAP_SIZE * MAP_SIZE).fill(Terrain.GRASS);
  mutate?.(tiles);
  return {
    version: 1,
    id: 'm7_regressions',
    name: 'M7 regressions',
    size: MAP_SIZE,
    players: 3,
    tiles,
    goldMines: [],
    starts: [],
    doodads: [],
  };
}

function makeSim(map: GameMap = makeMap()): Sim {
  return new Sim(map, 7);
}

function dist(
  a: { x: number; z: number },
  b: { x: number; z: number },
): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

describe('M7 combat regressions', () => {
  it('idle melee unit chases an enemy at line-of-sight distance and hits it', () => {
    const sim = makeSim();
    const { world } = sim;
    const spear = world.spawnUnit(0, 'spearman', 10, 20);
    // Ox carts have no attack, so the bait cannot move or retaliate
    const bait = world.spawnUnit(1, 'ox_cart', 15.5, 20);
    expect(dist(spear, bait)).toBeGreaterThan(5);
    expect(dist(spear, bait)).toBeLessThan(CROWN_UNITS.spearman.lineOfSight);

    for (let t = 0; t < 250 && bait.hp === bait.maxHp; t++) sim.step();

    expect(bait.hp).toBe(bait.maxHp - CROWN_UNITS.spearman.attack);
    expect(spear.x).toBeGreaterThan(13);
    expect(isInAttackRange(spear, bait)).toBe(true);
  });

  it('idle unit retaliates against a tower that shoots it from beyond its own sight', () => {
    const sim = makeSim();
    const { world } = sim;
    const tower = world.spawnBuilding(1, 'stone_tower', 24, 20, true);
    // 6.3 tiles from the tower footprint: inside tower range 7, outside spearman sight 6
    const spear = world.spawnUnit(0, 'spearman', 17.7, 20.5);
    const startDistance = dist(spear, tower);

    for (let t = 0; t < 300 && spear.hp > 0 && tower.hp === tower.maxHp; t++)
      sim.step();

    expect(spear.hp).toBeLessThan(spear.maxHp);
    expect(spear.hp).toBeGreaterThan(0);
    // Melee 3 against tower melee armor 3 is the 1 HP minimum
    expect(tower.hp).toBe(tower.maxHp - 1);
    expect(dist(spear, tower)).toBeLessThan(startDistance - 3);
  });

  it('attackMove stays on an off-route enemy until it dies, then resumes to its destination', () => {
    const sim = makeSim();
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

    for (let t = 0; t < 1000 && dist(marcher, { x: 30, z: 20 }) > 1; t++)
      sim.step();
    expect(dist(marcher, { x: 30, z: 20 })).toBeLessThanOrEqual(1);
  });

  it('same-team units never attack each other and towers shoot the real enemy instead', () => {
    const sim = makeSim();
    const { world } = sim;
    world.players[1].team = world.players[0].team;

    const soldier = world.spawnUnit(0, 'spearman', 10, 20);
    const ally = world.spawnUnit(1, 'ox_cart', 10.6, 20);
    for (let t = 0; t < 100; t++) sim.step();
    expect(ally.hp).toBe(ally.maxHp);
    expect(soldier.combat?.targetRef).toBeUndefined();

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
    expect(dist(nearAlly, tower)).toBeLessThan(dist(enemy, tower));
    for (let t = 0; t < 150 && enemy.hp === enemy.maxHp; t++) {
      sim.step();
      expect(nearAlly.hp).toBe(nearAlly.maxHp);
    }
    // Tower 6 pierce - ox cart pierce armor 2
    expect(enemy.hp).toBe(enemy.maxHp - (6 - CROWN_UNITS.ox_cart.pierceArmor));
  });

  it('trebuchet never advances into a too-close target and only fires from legal range', () => {
    const sim = makeSim();
    const { world } = sim;
    const minRange = CROWN_UNITS.trebuchet.minRange;
    const treb = world.spawnUnit(0, 'trebuchet', 20, 20);
    const target = world.spawnUnit(1, 'ox_cart', 22, 20);
    const startDistance = dist(treb, target);
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
      closest = Math.min(closest, dist(treb, target));
    }

    expect(closest).toBeGreaterThanOrEqual(startDistance - 1e-6);
    expect(target.hp).toBeLessThan(target.maxHp);
    expect(dist(treb, target)).toBeGreaterThanOrEqual(minRange);
    expect(isInAttackRange(treb, target)).toBe(true);
  });

  it('idle trebuchet does not acquire or approach an enemy inside its minimum range', () => {
    const sim = makeSim();
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
    const barriers: [string, () => GameMap, (sim: Sim) => void][] = [
      [
        'enemy wall',
        () => makeMap(),
        (sim) => {
          for (const z of wallRows)
            sim.world.spawnBuilding(1, 'stone_wall', 15, z, true);
        },
      ],
      [
        'enemy gate',
        () => makeMap(),
        (sim) => {
          sim.world.spawnBuilding(1, 'stone_gate', 15, 19, true, 'vertical');
          for (const z of [17, 18, 22, 23])
            sim.world.spawnBuilding(1, 'stone_wall', 15, z, true);
        },
      ],
      [
        'water',
        () =>
          makeMap((tiles) => {
            for (const z of wallRows) tiles[z * MAP_SIZE + 15] = Terrain.WATER;
          }),
        () => undefined,
      ],
    ];

    it.each(barriers)(
      'attacker never steps through %s toward a target 1.4 tiles away',
      (_name, map, build) => {
        const sim = makeSim(map());
        const { world } = sim;
        build(sim);
        const attacker = world.spawnUnit(0, 'spearman', 14.8, 20.5);
        const target = world.spawnUnit(1, 'peasant', 16.2, 20.5);
        target.hp = CROWN_UNITS.spearman.attack; // one hit
        sim.issue({ kind: 'hold', player: 1, ids: [target.id] });
        expect(dist(attacker, target)).toBeLessThan(1.5);
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

  it('re-issuing the same attack order does not skip the attack cooldown', () => {
    const sim = makeSim();
    const { world } = sim;
    const knight = world.spawnUnit(0, 'knight', 20, 20);
    const target = world.spawnUnit(1, 'ox_cart', 20.6, 20);
    const cooldownTicks = Math.round(CROWN_UNITS.knight.cooldown / SIM_DT);

    const hitTicks: number[] = [];
    let lastHp = target.hp;
    for (let t = 0; t < 200; t++) {
      // A spammed right-click, slower than the hit frame but faster than the cooldown
      if (world.tick % 12 === 0) {
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

    expect(hitTicks.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < hitTicks.length; i++) {
      expect(hitTicks[i] - hitTicks[i - 1]).toBeGreaterThanOrEqual(
        cooldownTicks,
      );
    }
  });

  it('a unit that kills one target waits out its cooldown before hitting the next', () => {
    const sim = makeSim();
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

    let killTick = -1;
    let nextHitTick = -1;
    for (let t = 0; t < 200 && nextHitTick < 0; t++) {
      const tick = world.tick;
      sim.step();
      if (killTick < 0 && first.hp <= 0) killTick = tick;
      if (second.hp < second.maxHp) nextHitTick = tick;
    }

    expect(knight.hp).toBe(knight.maxHp);
    expect(killTick).toBeGreaterThanOrEqual(0);
    expect(nextHitTick - killTick).toBeGreaterThanOrEqual(cooldownTicks);
  });

  it('ranged unit shoots an in-range enemy inside a wall ring without damaging the walls', () => {
    const sim = makeSim();
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
    expect(dist(archer, target)).toBeLessThanOrEqual(
      CROWN_UNITS.longbowman.range,
    );
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
    const sim = makeSim();
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
      expect(peasant.workStartedTick).toBeUndefined();
    }
    expect(target.hp).toBe(0);
    expect(site.built).toBe(false);
  });
});
