import { describe, expect, it } from 'vitest';
import alphaTestMapJson from '../../public/maps/alpha_test.json' with { type: 'json' };
import { getBuildingData } from '../data/buildings.js';
import { getUnitData } from '../data/units.js';
import { Sim } from './sim.js';
import { Terrain, parseMap, type GameMap } from './map.js';
import type { BuildingEntity, MineEntity, UnitEntity } from './entity.js';
import { validatePlacement } from './systems/construction.js';

const isUnit = (e: unknown, player: number, type?: string): e is UnitEntity => {
  const u = e as UnitEntity | undefined;
  return (
    !!u &&
    u.kind === 'unit' &&
    u.player === player &&
    (type === undefined || u.type === type)
  );
};

function playerUnits(sim: Sim, player: number, type?: string): UnitEntity[] {
  return sim.world.entities.filter((e): e is UnitEntity =>
    isUnit(e, player, type),
  );
}

function playerKeep(sim: Sim, player: number): BuildingEntity {
  const keep = sim.world.entities.find(
    (e): e is BuildingEntity =>
      !!e && e.kind === 'building' && e.player === player && !!e.isTownCenter,
  );
  if (!keep) throw new Error(`Player ${player} has no town center`);
  return keep;
}

function makeCleanMap48(goldMines: [number, number][]): GameMap {
  return {
    version: 1,
    id: 'm5_clean48',
    name: 'M5 clean 48',
    size: 48,
    players: 2,
    tiles: new Uint8Array(48 * 48).fill(Terrain.GRASS),
    goldMines,
    starts: [
      [8, 8],
      [38, 38],
    ],
    doodads: [],
  };
}

describe('M5 Alpha acceptance: economy standard start', () => {
  it('builds 2 farms + cottage, trains a 2nd cart and collects >=250 food / >=500 gold in 6000 ticks', () => {
    const sim = new Sim(parseMap(alphaTestMapJson), 7);
    const world = sim.world;
    const player = world.players[0];
    const keep = playerKeep(sim, 0);
    const workers = playerUnits(sim, 0, 'peasant');

    // Locked starting state.
    expect(player.food).toBe(300);
    expect(player.gold).toBe(200);
    expect(workers).toHaveLength(4);
    expect(playerUnits(sim, 0, 'ox_cart')).toHaveLength(1);
    expect(player.foodCollected).toBe(0);
    expect(player.goldCollected).toBe(0);

    // Choose three nearby non-overlapping sites via the shared validator.
    const plan: {
      type: string;
      x: number;
      z: number;
      width: number;
      height: number;
    }[] = [];
    for (const [i, type] of ['farm', 'farm', 'cottage'].entries()) {
      const worker = workers[i];
      let best:
        | { x: number; z: number; width: number; height: number; d: number }
        | undefined;
      for (let z = Math.floor(keep.z) - 6; z <= Math.floor(keep.z) + 9; z++) {
        for (let x = Math.floor(keep.x) - 6; x <= Math.floor(keep.x) + 9; x++) {
          const result = validatePlacement(world, 0, type, x, z);
          if (!result.valid) continue;
          const overlaps = plan.some(
            (s) =>
              x < s.x + s.width &&
              x + result.width > s.x &&
              z < s.z + s.height &&
              z + result.height > s.z,
          );
          if (overlaps) continue;
          const d = Math.hypot(
            x + result.width / 2 - worker.x,
            z + result.height / 2 - worker.z,
          );
          // Strict '<' keeps the first (lowest z, then lowest x) site on ties.
          if (!best || d < best.d) {
            best = { x, z, width: result.width, height: result.height, d };
          }
        }
      }
      if (!best) throw new Error(`No valid ${type} site near the keep`);
      plan.push({
        type,
        x: best.x,
        z: best.z,
        width: best.width,
        height: best.height,
      });
    }
    expect(plan).toHaveLength(3);

    for (const [i, site] of plan.entries()) {
      sim.issue({
        kind: 'build',
        player: 0,
        ids: [workers[i].id],
        buildingType: site.type,
        x: site.x,
        z: site.z,
      });
    }
    sim.issue({
      kind: 'train',
      player: 0,
      buildingId: keep.id,
      unitType: 'ox_cart',
    });

    const completedIds: number[] = [];
    for (let t = 0; t < 6000; t++) {
      sim.step();
      for (const e of sim.drainEvents()) {
        if (e.kind === 'buildingCompleted') completedIds.push(e.entityId);
      }
    }
    expect(world.tick).toBe(6000);

    // Consumer built entities exist, completed, at the chosen sites.
    for (const site of plan) {
      const matches = world.entities.filter(
        (e): e is BuildingEntity =>
          !!e &&
          e.kind === 'building' &&
          e.player === 0 &&
          e.type === site.type &&
          e.x === site.x &&
          e.z === site.z,
      );
      expect(matches).toHaveLength(1);
      expect(matches[0].built).toBe(true);
      expect(completedIds.filter((id) => id === matches[0].id)).toHaveLength(1);
    }
    expect(
      world.entities.filter(
        (e) =>
          e &&
          e.kind === 'building' &&
          e.player === 0 &&
          e.type === 'farm' &&
          e.built,
      ),
    ).toHaveLength(2);
    expect(
      world.entities.filter(
        (e) =>
          e &&
          e.kind === 'building' &&
          e.player === 0 &&
          e.type === 'cottage' &&
          e.built,
      ),
    ).toHaveLength(1);
    expect(playerUnits(sim, 0, 'ox_cart')).toHaveLength(2);

    expect(player.foodCollected).toBeGreaterThanOrEqual(250);
    expect(player.goldCollected).toBeGreaterThanOrEqual(500);

    // Stock accounting from table costs.
    const cart = getUnitData('ox_cart', player.faction)!;
    const farm = getBuildingData('farm', player.faction)!;
    const cottage = getBuildingData('cottage', player.faction)!;
    expect(player.food).toBeCloseTo(300 - cart.food + player.foodCollected, 8);
    expect(player.gold).toBe(
      200 - (2 * farm.gold + cottage.gold) - cart.gold + player.goldCollected,
    );
  });
});

describe('M5 Alpha acceptance: Low Faith training time through Sim', () => {
  function setup(low: boolean) {
    const sim = new Sim(makeCleanMap48([]), 3);
    const world = sim.world;
    const player = world.players[0];
    const keep = playerKeep(sim, 0);
    const peasantCount = () => playerUnits(sim, 0, 'peasant').length;

    if (low) {
      player.age = 2;
      world.spawnBuilding(0, 'stable', 20, 5, true);
      world.spawnBuilding(0, 'stone_tower', 24, 5, true);
      sim.step();
      expect(player.faithProduced).toBe(5);
      expect(player.faithUsed).toBe(5);
      expect(player.lowFaith).toBe(false);

      const worker = playerUnits(sim, 0, 'peasant')[0];
      sim.issue({
        kind: 'build',
        player: 0,
        ids: [worker.id],
        buildingType: 'barracks',
        x: 13,
        z: 11,
      });
      let barracks: BuildingEntity | undefined;
      let sawUnfinished = false;
      for (let t = 0; t < 2000; t++) {
        sim.step();
        barracks = world.entities.find(
          (e): e is BuildingEntity =>
            !!e &&
            e.kind === 'building' &&
            e.player === 0 &&
            e.type === 'barracks',
        );
        if (barracks && barracks.built) break;
        if (barracks) {
          // Unfinished barracks must not count toward faith usage.
          sawUnfinished = true;
          expect(player.faithProduced).toBe(5);
          expect(player.faithUsed).toBe(5);
          expect(player.lowFaith).toBe(false);
        }
      }
      expect(barracks?.built).toBe(true);
      expect(sawUnfinished).toBe(true);
      expect(player.faithProduced).toBe(5);
      expect(player.faithUsed).toBe(7);
      expect(player.lowFaith).toBe(true);
    }

    return { sim, keep, player, peasantCount };
  }

  function trainPeasant(low: boolean, expectedTicks: number): void {
    const { sim, keep, player, peasantCount } = setup(low);
    const before = peasantCount();
    sim.issue({
      kind: 'train',
      player: 0,
      buildingId: keep.id,
      unitType: 'peasant',
    });

    for (let t = 1; t < expectedTicks; t++) {
      sim.step();
      expect(peasantCount()).toBe(before);
      expect(player.lowFaith).toBe(low);
    }
    sim.step();
    expect(peasantCount()).toBe(before + 1);
    expect(player.lowFaith).toBe(low);
    expect(keep.trainingQueue).toHaveLength(0);
  }

  it('normal faith: keep peasant arrives at exactly tick 400', () => {
    trainPeasant(false, 400);
  });

  it('5 produced / 7 used after real barracks completion: keep peasant arrives at exactly tick 800', () => {
    trainPeasant(true, 800);
  });
});

describe('M5 Alpha acceptance: three-cart gold mine concurrency and conservation', () => {
  it('<=2 loaders, conserves 6000 gold every tick, depletes and delivers all cargo', () => {
    const sim = new Sim(makeCleanMap48([[16, 8]]), 11);
    const world = sim.world;
    const player = world.players[0];
    const opponent = world.players[1];

    const carts = playerUnits(sim, 0, 'ox_cart');
    carts.push(
      world.spawnUnit(0, 'ox_cart', 12.5, 7.5),
      world.spawnUnit(0, 'ox_cart', 13.5, 7.5),
    );
    expect(carts).toHaveLength(3);
    const mine = world.entities.find(
      (e): e is MineEntity => !!e && e.kind === 'mine',
    );
    if (!mine) throw new Error('Missing gold mine');
    expect(mine.goldRemaining).toBe(6000);
    expect(player.gold).toBe(200);

    // Opponent units are stopped so its starting cart cannot mine.
    sim.issue({
      kind: 'stop',
      player: 1,
      ids: playerUnits(sim, 1).map((u) => u.id),
    });
    sim.issue({
      kind: 'pinMine',
      player: 0,
      ids: carts.map((c) => c.id),
      targetId: mine.id,
    });

    const carried = () =>
      carts.reduce((sum, c) => sum + (c.cart?.carriedGold ?? 0), 0);
    let maxLoading = 0;
    let depletedTick = -1;
    let finished = false;
    for (let t = 0; t < 40000; t++) {
      sim.step();
      const loading = carts.filter((c) => c.cart?.phase === 'loading').length;
      maxLoading = Math.max(maxLoading, loading);
      expect(loading).toBeLessThanOrEqual(2);
      expect(mine.goldRemaining + carried() + player.goldCollected).toBe(6000);
      if (mine.goldRemaining === 0 && depletedTick < 0) {
        depletedTick = world.tick;
        expect(player.goldCollected + carried()).toBe(6000);
      }
      if (mine.goldRemaining === 0 && carried() === 0) {
        finished = true;
        break;
      }
    }

    expect(finished).toBe(true);
    expect(maxLoading).toBe(2);
    expect(depletedTick).toBeGreaterThan(0);
    expect(player.goldCollected).toBe(6000);
    expect(mine.goldRemaining).toBe(0);
    expect(carried()).toBe(0);
    expect(player.gold).toBe(200 + 6000);
    expect(opponent.goldCollected).toBe(0);
  });
});
