import { describe, expect, it } from 'vitest';
import alphaTestMapJson from '../../../public/maps/alpha_test.json' with { type: 'json' };
import { parseMap } from '../map.js';
import { Sim } from '../sim.js';
import { makeOpenSim } from '../testFixtures.js';
import { parseBuildOrder } from './buildOrder.js';
import { perceive } from './perception.js';

function entitySnapshot(sim: Sim) {
  return sim.world.entities.flatMap((entity) =>
    entity === undefined
      ? []
      : [
          [
            entity.id,
            'type' in entity ? entity.type : entity.kind,
            entity.x,
            entity.z,
            'hp' in entity ? entity.hp : null,
          ],
        ],
  );
}

describe('Crown Normal AI', () => {
  it(
    'grows its economy and military buildings without Low Faith before its chapel exists',
    { timeout: 120_000 },
    () => {
      const sim = new Sim(parseMap(alphaTestMapJson), 3, undefined, {
        1: 'normal',
      });
      const player = sim.world.players[1];
      let chapelSeen = false;
      let lowFaithBeforeChapelTick: number | null = null;

      for (let tick = 0; tick < 12000; tick++) {
        sim.step();
        if (!chapelSeen) {
          chapelSeen = sim.world.entities.some(
            (entity) =>
              entity?.kind === 'building' &&
              entity.player === 1 &&
              entity.type === 'chapel',
          );
          if (
            !chapelSeen &&
            player.lowFaith &&
            lowFaithBeforeChapelTick === null
          ) {
            lowFaithBeforeChapelTick = sim.world.tick;
          }
        }
        if (sim.world.tick % 200 === 0) sim.drainEvents();
      }

      const view = perceive(sim.world, 1);
      expect(sim.world.tick).toBe(12000);
      expect(view.peasants.length).toBeGreaterThanOrEqual(12);
      expect(view.carts.length).toBeGreaterThanOrEqual(4);
      expect(view.buildings.barracks?.some((building) => building.built)).toBe(
        true,
      );
      expect(
        view.buildings.archery_range?.some((building) => building.built),
      ).toBe(true);
      expect(lowFaithBeforeChapelTick).toBeNull();
    },
  );

  it(
    'produces exactly identical entity state for identical seeds',
    { timeout: 120_000 },
    () => {
      const first = new Sim(parseMap(alphaTestMapJson), 3, undefined, {
        1: 'normal',
      });
      const second = new Sim(parseMap(alphaTestMapJson), 3, undefined, {
        1: 'normal',
      });

      for (let tick = 0; tick < 4000; tick++) {
        first.step();
        second.step();
        if (first.world.tick % 200 === 0) {
          first.drainEvents();
          second.drainEvents();
        }
      }

      expect(first.world.tick).toBe(4000);
      expect(second.world.tick).toBe(4000);
      expect(perceive(first.world, 1).peasants.length).toBeGreaterThan(4);
      expect(entitySnapshot(first)).toEqual(entitySnapshot(second));
    },
  );

  it('knows only visible hostile buildings and retains id-free ghosts when vision is lost', () => {
    const sim = makeOpenSim({ size: 48, players: 2 });
    const world = sim.world;
    const enemy = world.spawnBuilding(0, 'cottage', 32, 32, true);
    const scout = world.spawnUnit(1, 'peasant', 5.5, 5.5);
    sim.updateFog();

    expect(perceive(world, 1).knownEnemyBuildings).toEqual([]);

    scout.x = 30.5;
    scout.z = 32.5;
    sim.updateFog();
    expect(perceive(world, 1).knownEnemyBuildings).toEqual([
      {
        x: 32,
        z: 32,
        width: 2,
        height: 2,
        player: 0,
        type: 'cottage',
        id: enemy.id,
      },
    ]);

    scout.x = 5.5;
    scout.z = 5.5;
    sim.updateFog();
    expect(perceive(world, 1).knownEnemyBuildings).toEqual([
      {
        x: 32,
        z: 32,
        width: 2,
        height: 2,
        player: 0,
        type: 'cottage',
      },
    ]);
  });

  it('rejects unknown building ids in a build order', () => {
    expect(() =>
      parseBuildOrder({
        faction: 'crown',
        steps: [{ build: 'unknown_building' }],
        army: { '1': { spearman: 1 } },
        maxAlive: {},
      }),
    ).toThrow(/Invalid build order crown:/);
  });
});

describe('Clans Normal AI', () => {
  it(
    'grows its economy, fields and military buildings',
    { timeout: 120_000 },
    () => {
      const sim = new Sim(
        parseMap(alphaTestMapJson),
        3,
        { 1: 'clans' },
        { 1: 'normal' },
      );

      for (let tick = 0; tick < 12000; tick++) {
        sim.step();
        if (sim.world.tick % 200 === 0) sim.drainEvents();
      }

      const view = perceive(sim.world, 1);
      expect(sim.world.tick).toBe(12000);
      expect(view.peasants.length).toBeGreaterThanOrEqual(12);
      expect(view.carts.length).toBeGreaterThanOrEqual(4);
      expect(view.buildings.mead_hall?.some((building) => building.built)).toBe(
        true,
      );
      expect(
        view.buildings.hunters_lodge?.some((building) => building.built),
      ).toBe(true);
      expect(view.buildings.field?.some((building) => building.built)).toBe(
        true,
      );
    },
  );
});
