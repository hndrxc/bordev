import { describe, expect, it } from 'vitest';
import { getBuildingData } from '../data/buildings.js';
import { AGES } from '../data/ages.js';
import { CROWN_UPGRADES } from '../data/upgrades.js';
import { Sim } from './sim.js';
import { Terrain, type GameMap } from './map.js';
import type { BuildingEntity, UnitEntity } from './entity.js';
import type { PlayerState } from './world.js';
import { getResearchAvailability } from './systems/research.js';
import {
  completeUpgrade,
  recomputeUpgradeModifiers,
} from './systems/upgrades.js';

/**
 * M6 Alpha acceptance: age research, requirements, timing, cancellation,
 * duplicate/in-progress locks and the first wired upgrade (Heavy Plough).
 * Every assertion crosses `Sim.issue` / `Sim.step`; only world setup (completed
 * buildings, resources, starting age) is written directly.
 */

function makeCleanMap48(): GameMap {
  return {
    version: 1,
    id: 'm6_clean48',
    name: 'M6 clean 48',
    size: 48,
    players: 2,
    tiles: new Uint8Array(48 * 48).fill(Terrain.GRASS),
    goldMines: [],
    starts: [
      [8, 8],
      [38, 38],
    ],
    doodads: [],
  };
}

/** Non-overlapping 3x3-or-smaller sites clear of both Keeps (8,8) and (38,38). */
const SITES: readonly (readonly [number, number])[] = [
  [16, 16],
  [21, 16],
  [26, 16],
  [16, 21],
  [21, 21],
  [26, 21],
  [16, 26],
  [21, 26],
];
const SECOND_KEEP_SITE: readonly [number, number] = [28, 28];

const BARRACKS_NAME = getBuildingData('barracks', 'crown')!.name;
const RANGE_NAME = getBuildingData('archery_range', 'crown')!.name;
const STABLE_NAME = getBuildingData('stable', 'crown')!.name;

interface Fixture {
  sim: Sim;
  player: PlayerState;
  keep: BuildingEntity;
  next: number;
}

function makeFixture(): Fixture {
  const sim = new Sim(makeCleanMap48(), 5);
  const player = sim.world.players[0];
  player.food = 5000;
  player.gold = 5000;
  const keep = sim.world.entities.find(
    (e): e is BuildingEntity =>
      !!e && e.kind === 'building' && e.player === 0 && !!e.isTownCenter,
  );
  if (!keep) throw new Error('Player 0 has no Keep');
  return { sim, player, keep, next: 0 };
}

/** Completed (or unfinished) building at the next free site. */
function put(
  fx: Fixture,
  type: string,
  options: { owner?: number; built?: boolean } = {},
): BuildingEntity {
  const site = SITES[fx.next++];
  if (!site) throw new Error('Out of test sites');
  return fx.sim.world.spawnBuilding(
    options.owner ?? 0,
    type,
    site[0],
    site[1],
    options.built ?? true,
  );
}

function stepN(sim: Sim, n: number): void {
  for (let i = 0; i < n; i++) sim.step();
}

function research(fx: Fixture, upgradeId: string, building = fx.keep): void {
  fx.sim.issue({
    kind: 'research',
    player: 0,
    buildingId: building.id,
    upgradeId,
  });
}

/** Asserts denial both in availability and through the real command path. */
function expectDenied(
  fx: Fixture,
  upgradeId: string,
  building = fx.keep,
): string {
  const { sim, player } = fx;
  const availability = getResearchAvailability(
    sim.world,
    0,
    building.id,
    upgradeId,
  );
  expect(availability.allowed).toBe(false);
  expect(availability.reason).toBeTruthy();

  const before = { food: player.food, gold: player.gold, age: player.age };
  const hadResearch = building.research;
  research(fx, upgradeId, building);
  sim.step();
  expect(building.research).toBe(hadResearch);
  expect(player.food).toBe(before.food);
  expect(player.gold).toBe(before.gold);
  expect(player.age).toBe(before.age);
  return availability.reason ?? '';
}

function expectAllowed(
  fx: Fixture,
  upgradeId: string,
  building = fx.keep,
): void {
  expect(
    getResearchAvailability(fx.sim.world, 0, building.id, upgradeId),
  ).toEqual({ allowed: true });
}

/**
 * Issues research and steps until the building's research clears. Returns the
 * 1-based tick on which it completed; asserts the research started and that the
 * owner's age flips only on that tick.
 */
function runResearchToCompletion(
  fx: Fixture,
  upgradeId: string,
  maxTicks: number,
  building = fx.keep,
): number {
  const { sim, player } = fx;
  const ageBefore = player.age;
  research(fx, upgradeId, building);
  sim.step();
  expect(building.research?.upgradeId).toBe(upgradeId);
  for (let t = 2; t <= maxTicks; t++) {
    sim.step();
    if (!building.research) return t;
    expect(player.age).toBe(ageBefore);
  }
  return Infinity;
}

function ageEvents(sim: Sim): { player: number; age: number }[] {
  return sim
    .drainEvents()
    .filter((e) => e.kind === 'ageReached')
    .map((e) => ({ player: e.player, age: e.age }));
}

describe('M6 Alpha acceptance: Age II research', () => {
  it('is unavailable until two distinct completed owned categories exist', () => {
    const fx = makeFixture();
    const { sim, player } = fx;

    // Nothing built: the tooltip reason lists every Age II option.
    const none = expectDenied(fx, 'age_2');
    expect(none).toContain(BARRACKS_NAME);
    expect(none).toContain(RANGE_NAME);

    // One category is still short by exactly one.
    put(fx, 'barracks');
    const one = expectDenied(fx, 'age_2');
    expect(one).not.toContain(BARRACKS_NAME);
    expect(one).toContain(RANGE_NAME);
    expect(one).toMatch(/1 more/);

    // A duplicate of an owned category does not count twice.
    put(fx, 'barracks');
    expectDenied(fx, 'age_2');

    // Unfinished buildings never count.
    const unfinishedRange = put(fx, 'archery_range', { built: false });
    expectDenied(fx, 'age_2');

    // Enemy completed buildings never count for the researching player.
    put(fx, 'storehouse', { owner: 1 });
    expectDenied(fx, 'age_2');

    // A stable is not on the Age II list.
    put(fx, 'stable');
    expectDenied(fx, 'age_2');

    // Completing the second distinct category unlocks it.
    sim.world.completeBuilding(unfinishedRange);
    expectAllowed(fx, 'age_2');
    expect(player.age).toBe(1);

    // Non-Keep buildings cannot research ages.
    const barracks = sim.world.entities.find(
      (e): e is BuildingEntity =>
        !!e && e.kind === 'building' && e.player === 0 && e.type === 'barracks',
    )!;
    expectDenied(fx, 'age_2', barracks);
    expectAllowed(fx, 'age_2');
  });

  it('rejects insufficient resources and charges the exact table cost', () => {
    const fx = makeFixture();
    const { sim, player, keep } = fx;
    put(fx, 'barracks');
    put(fx, 'storehouse');

    player.food = 499;
    player.gold = 5000;
    expectDenied(fx, 'age_2');
    player.food = 5000;
    player.gold = 199;
    expectDenied(fx, 'age_2');

    player.food = 1000;
    player.gold = 1000;
    research(fx, 'age_2');
    sim.step();
    expect(keep.research).toMatchObject({
      upgradeId: 'age_2',
      food: AGES[2].cost.food,
      gold: AGES[2].cost.gold,
    });
    expect(player.food).toBe(1000 - 500);
    expect(player.gold).toBe(1000 - 200);
  });

  it('completes in exactly 800 ticks at normal faith and emits one ageReached', () => {
    const fx = makeFixture();
    const { sim, player } = fx;
    put(fx, 'barracks');
    put(fx, 'storehouse');
    sim.drainEvents();

    const done = runResearchToCompletion(fx, 'age_2', 2000);
    expect(player.lowFaith).toBe(false);
    expect(done).toBe(800);
    expect(player.age).toBe(2);
    expect(ageEvents(sim)).toEqual([{ player: 0, age: 2 }]);
    expect(player.food).toBe(5000 - 500);
    expect(player.gold).toBe(5000 - 200);

    // Completed exactly once and not repeatable.
    stepN(sim, 50);
    expect(ageEvents(sim)).toEqual([]);
    expectDenied(fx, 'age_2');
  });

  it('completes in exactly 1600 ticks under Low Faith', () => {
    const fx = makeFixture();
    const { sim, player } = fx;
    // 2 + 2 + 3 = 7 used vs 5 produced.
    put(fx, 'barracks');
    put(fx, 'archery_range');
    put(fx, 'stable');
    sim.drainEvents();

    const done = runResearchToCompletion(fx, 'age_2', 4000);
    expect(player.faithProduced).toBe(5);
    expect(player.faithUsed).toBe(7);
    expect(player.lowFaith).toBe(true);
    expect(done).toBe(1600);
    expect(player.age).toBe(2);
    expect(ageEvents(sim)).toEqual([{ player: 0, age: 2 }]);
  });

  it('slows only the remaining progress when Low Faith begins mid-research', () => {
    const fx = makeFixture();
    const { sim, player, keep } = fx;
    put(fx, 'barracks');
    put(fx, 'archery_range');
    research(fx, 'age_2');
    stepN(sim, 400);
    expect(player.lowFaith).toBe(false);
    expect(keep.research?.progress).toBeCloseTo(20, 6);

    put(fx, 'stable');
    for (let t = 401; t < 1200; t++) {
      sim.step();
      expect(keep.research).toBeDefined();
    }
    expect(player.lowFaith).toBe(true);
    sim.step();
    expect(keep.research).toBeUndefined();
    expect(player.age).toBe(2);
  });
});

describe('M6 Alpha acceptance: Age III research', () => {
  function ageTwoFixture(): Fixture {
    const fx = makeFixture();
    fx.player.age = 2;
    return fx;
  }

  it('requires a completed owned stable plus one distinct Age II category', () => {
    const fx = ageTwoFixture();
    const { sim, player } = fx;

    // Stable alone is short by one Age II category.
    const stable = put(fx, 'stable');
    const stableOnly = expectDenied(fx, 'age_3');
    expect(stableOnly).toMatch(/1 more/);
    expect(stableOnly).toContain(BARRACKS_NAME);

    // A second stable is a duplicate of the required category, not an Age II one.
    put(fx, 'stable');
    expectDenied(fx, 'age_3');

    // Unfinished and enemy Age II buildings do not count.
    const unfinished = put(fx, 'barracks', { built: false });
    expectDenied(fx, 'age_3');
    put(fx, 'archery_range', { owner: 1 });
    expectDenied(fx, 'age_3');

    // Completing one real Age II category unlocks it.
    sim.world.completeBuilding(unfinished);
    expectAllowed(fx, 'age_3');

    // Without the stable the same Age II building is not enough.
    const noStable = makeFixture();
    noStable.player.age = 2;
    put(noStable, 'barracks');
    put(noStable, 'storehouse');
    const reason = expectDenied(noStable, 'age_3');
    expect(reason).toContain(STABLE_NAME);

    // Age III cannot be skipped from Age I even with every building.
    expect(stable.built).toBe(true);
    player.age = 1;
    expect(expectDenied(fx, 'age_3')).toBeTruthy();
  });

  it('charges 800/600 and completes in exactly 1200 ticks at normal faith', () => {
    const fx = ageTwoFixture();
    const { sim, player } = fx;
    put(fx, 'stable'); // faith 3 <= 5
    put(fx, 'storehouse');
    sim.drainEvents();

    research(fx, 'age_3');
    sim.step();
    expect(player.food).toBe(5000 - 800);
    expect(player.gold).toBe(5000 - 600);
    expect(fx.keep.research?.time).toBe(AGES[3].researchTime);

    for (let t = 2; t < 1200; t++) {
      sim.step();
      expect(player.age).toBe(2);
    }
    expect(player.lowFaith).toBe(false);
    sim.step();
    expect(player.age).toBe(3);
    expect(fx.keep.research).toBeUndefined();
    expect(ageEvents(sim)).toEqual([{ player: 0, age: 3 }]);
  });

  it('completes in exactly 2400 ticks under Low Faith', () => {
    const fx = ageTwoFixture();
    const { sim, player } = fx;
    put(fx, 'stable');
    put(fx, 'barracks');
    put(fx, 'archery_range'); // 3 + 2 + 2 = 7 > 5
    sim.drainEvents();

    const done = runResearchToCompletion(fx, 'age_3', 5000);
    expect(player.lowFaith).toBe(true);
    expect(done).toBe(2400);
    expect(player.age).toBe(3);
    expect(ageEvents(sim)).toEqual([{ player: 0, age: 3 }]);
  });
});

describe('M6 Alpha acceptance: research cancellation, duplicates and exclusion', () => {
  it('cancels with a full refund, stops progress and allows a clean restart', () => {
    const fx = makeFixture();
    const { sim, player, keep } = fx;
    put(fx, 'barracks');
    put(fx, 'storehouse');
    const food = player.food;
    const gold = player.gold;

    // Cancelling with nothing active is a no-op.
    sim.issue({ kind: 'cancelResearch', player: 0, buildingId: keep.id });
    sim.step();
    expect(player.food).toBe(food);
    expect(player.gold).toBe(gold);

    research(fx, 'age_2');
    stepN(sim, 123);
    expect(keep.research).toBeDefined();
    expect(player.food).toBe(food - 500);
    expect(player.gold).toBe(gold - 200);

    sim.issue({ kind: 'cancelResearch', player: 0, buildingId: keep.id });
    sim.step();
    expect(keep.research).toBeUndefined();
    expect(player.food).toBe(food);
    expect(player.gold).toBe(gold);

    // A cancelled research never completes later.
    stepN(sim, 1000);
    expect(player.age).toBe(1);

    // And a restart takes the full time again.
    expect(runResearchToCompletion(fx, 'age_2', 2000)).toBe(800);
    expect(player.age).toBe(2);
  });

  it('refunds in full when a producer is deleted while researching', () => {
    const fx = makeFixture();
    const { sim, player } = fx;
    player.age = 2;
    const keep2 = sim.world.spawnBuilding(
      0,
      'keep',
      SECOND_KEEP_SITE[0],
      SECOND_KEEP_SITE[1],
      true,
    );
    const food = player.food;
    const gold = player.gold;
    research(fx, 'heavy_plough', keep2);
    stepN(sim, 40);
    expect(keep2.research).toBeDefined();
    expect(player.food).toBe(food - 100);

    sim.issue({ kind: 'delete', player: 0, ids: [keep2.id] });
    sim.step();
    expect(sim.world.entities[keep2.id]).toBeUndefined();
    expect(player.food).toBe(food);
    expect(player.gold).toBe(gold);
  });

  it('allows one active research per building, mutually exclusive with training', () => {
    const fx = makeFixture();
    const { sim, player, keep } = fx;
    put(fx, 'barracks');
    put(fx, 'storehouse');
    player.age = 1;

    // Training in progress blocks research and refunds restore availability.
    sim.issue({
      kind: 'train',
      player: 0,
      buildingId: keep.id,
      unitType: 'peasant',
    });
    sim.step();
    expect(keep.trainingQueue).toHaveLength(1);
    const afterTrain = { food: player.food, gold: player.gold };
    expectDenied(fx, 'age_2');
    expect(player.food).toBe(afterTrain.food);
    sim.issue({ kind: 'cancelTrain', player: 0, buildingId: keep.id });
    sim.step();
    expect(keep.trainingQueue).toHaveLength(0);
    expectAllowed(fx, 'age_2');

    // Active research blocks training (no queue entry, no spend) and a second
    // research on the same building.
    research(fx, 'age_2');
    sim.step();
    expect(keep.research).toBeDefined();
    const mid = { food: player.food, gold: player.gold };
    sim.issue({
      kind: 'train',
      player: 0,
      buildingId: keep.id,
      unitType: 'peasant',
    });
    sim.step();
    expect(keep.trainingQueue).toHaveLength(0);
    expect(player.food).toBe(mid.food);
    expect(player.gold).toBe(mid.gold);

    const researchRef = keep.research;
    player.age = 2; // so heavy_plough would otherwise be legal
    expectDenied(fx, 'heavy_plough');
    expect(keep.research).toBe(researchRef);
    player.age = 1;

    // Cancelling restores training.
    sim.issue({ kind: 'cancelResearch', player: 0, buildingId: keep.id });
    sim.step();
    sim.issue({
      kind: 'train',
      player: 0,
      buildingId: keep.id,
      unitType: 'peasant',
    });
    sim.step();
    expect(keep.trainingQueue).toHaveLength(1);
  });

  it('blocks duplicate and in-progress research across Town Centers', () => {
    const fx = makeFixture();
    const { sim, player, keep } = fx;
    put(fx, 'barracks');
    put(fx, 'storehouse');
    const keep2 = sim.world.spawnBuilding(
      0,
      'keep',
      SECOND_KEEP_SITE[0],
      SECOND_KEEP_SITE[1],
      true,
    );

    research(fx, 'age_2');
    sim.step();
    expect(keep.research).toBeDefined();
    const reason = expectDenied(fx, 'age_2', keep2);
    expect(keep2.research).toBeUndefined();
    expect(reason).toBeTruthy();

    // Finish the age, then the upgrade follows the same rules.
    stepN(sim, 800);
    expect(player.age).toBe(2);
    expect(keep.research).toBeUndefined();
    expectDenied(fx, 'age_2', keep2);

    research(fx, 'heavy_plough');
    sim.step();
    expect(keep.research?.upgradeId).toBe('heavy_plough');
    expectDenied(fx, 'heavy_plough', keep2);

    stepN(sim, 600);
    expect(player.upgrades.has('heavy_plough')).toBe(true);
    expectDenied(fx, 'heavy_plough', keep);
    expectDenied(fx, 'heavy_plough', keep2);
  });

  it('keeps every other Crown upgrade Beta-disabled', () => {
    const fx = makeFixture();
    const { player } = fx;
    player.age = 3;
    player.food = 100_000;
    player.gold = 100_000;
    const buildingFor = new Map<string, BuildingEntity>();
    for (const upgrade of Object.values(CROWN_UPGRADES)) {
      if (upgrade.id === 'heavy_plough') continue;
      let building = buildingFor.get(upgrade.building);
      if (!building) {
        building =
          upgrade.building === 'keep' ? fx.keep : put(fx, upgrade.building);
        buildingFor.set(upgrade.building, building);
      }
      expectDenied(fx, upgrade.id, building);
      expect(building.research).toBeUndefined();
    }
    expect(player.upgrades.size).toBe(0);
    expect(player.farmFoodRateMultiplier).toBe(1);
  });
});

describe('M6 Alpha acceptance: Heavy Plough end to end', () => {
  function farmingFixture() {
    const fx = makeFixture();
    const { sim } = fx;
    const farmSite = SITES[fx.next++];
    const farm = sim.world.spawnBuilding(
      0,
      'farm',
      farmSite[0],
      farmSite[1],
      true,
    );
    const farmer: UnitEntity = sim.world.spawnUnit(
      0,
      'peasant',
      farmSite[0] + 2.8,
      farmSite[1] + 0.5,
    );
    sim.issue({
      kind: 'farm',
      player: 0,
      ids: [farmer.id],
      targetId: farm.id,
    });
    // Reach the farm and settle into continuous work.
    stepN(sim, 300);
    expect(farmer.order?.kind).toBe('farm');
    expect(farmer.workAnimation).toBe('work');
    return { fx, farm, farmer };
  }

  function collectedOver(fx: Fixture, ticks: number) {
    const { sim, player } = fx;
    const collected0 = player.foodCollected;
    const food0 = player.food;
    stepN(sim, ticks);
    return {
      collected: player.foodCollected - collected0,
      stock: player.food - food0,
    };
  }

  it('is gated by age and Keep, costs 100/100 and completes in 600 ticks (1200 Low Faith)', () => {
    const fx = makeFixture();
    const { sim, player, keep } = fx;
    const barracks = put(fx, 'barracks');

    // Age I: denied.
    expectDenied(fx, 'heavy_plough');
    player.age = 2;
    expectAllowed(fx, 'heavy_plough');
    // Only the Keep researches it.
    expectDenied(fx, 'heavy_plough', barracks);

    const food = player.food;
    const gold = player.gold;
    research(fx, 'heavy_plough');
    sim.step();
    expect(keep.research).toMatchObject({
      upgradeId: 'heavy_plough',
      food: 100,
      gold: 100,
    });
    expect(player.food).toBe(food - 100);
    expect(player.gold).toBe(gold - 100);
    for (let t = 2; t < 600; t++) {
      sim.step();
      expect(player.upgrades.has('heavy_plough')).toBe(false);
    }
    sim.step();
    expect(player.upgrades.has('heavy_plough')).toBe(true);
    expect(keep.research).toBeUndefined();
    expect(player.age).toBe(2);

    // Low Faith doubles the time.
    const slow = makeFixture();
    slow.player.age = 2;
    put(slow, 'barracks');
    put(slow, 'archery_range');
    put(slow, 'stable');
    expect(runResearchToCompletion(slow, 'heavy_plough', 3000)).toBe(1200);
    expect(slow.player.lowFaith).toBe(true);
    expect(slow.player.upgrades.has('heavy_plough')).toBe(true);
  });

  it('raises observed farm output by exactly 20 percent, once', () => {
    const { fx } = farmingFixture();
    const { sim, player } = fx;

    expect(player.farmFoodRateMultiplier).toBe(1);
    const base = collectedOver(fx, 200);
    // 0.5 food/s * 10 s
    expect(base.collected).toBeCloseTo(5, 6);
    expect(base.stock).toBeCloseTo(5, 6);

    player.age = 2;
    research(fx, 'heavy_plough');
    stepN(sim, 610);
    expect(player.upgrades.has('heavy_plough')).toBe(true);
    expect(player.farmFoodRateMultiplier).toBeCloseTo(1.2, 10);

    const boosted = collectedOver(fx, 200);
    expect(boosted.collected).toBeCloseTo(6, 6);
    expect(boosted.stock).toBeCloseTo(6, 6);
    expect(boosted.collected / base.collected).toBeCloseTo(1.2, 8);

    // Output stays at +20 % indefinitely: no per-tick compounding.
    stepN(sim, 1000);
    const later = collectedOver(fx, 200);
    expect(later.collected).toBeCloseTo(6, 6);
    expect(player.farmFoodRateMultiplier).toBeCloseTo(1.2, 10);
  });

  it('stacks percentages additively and idempotently, never multiplicatively', () => {
    const fx = makeFixture();
    const { player } = fx;

    expect(completeUpgrade(player, 'heavy_plough')).toBe(true);
    expect(player.farmFoodRateMultiplier).toBeCloseTo(1.2, 10);
    // Completing again changes nothing, and recompute is a pure function.
    expect(completeUpgrade(player, 'heavy_plough')).toBe(false);
    recomputeUpgradeModifiers(player);
    recomputeUpgradeModifiers(player);
    expect(player.farmFoodRateMultiplier).toBeCloseTo(1.2, 10);
    expect(player.farmFoodRateMultiplier).not.toBeCloseTo(1.44, 6);

    // The Beta upgrade is not completable now.
    expect(completeUpgrade(player, 'crop_rotation')).toBe(false);
    expect(player.upgrades.has('crop_rotation')).toBe(false);

    // Table semantics: two +20 % entries sum to +40 %, not 1.2 * 1.2.
    player.upgrades.add('crop_rotation');
    recomputeUpgradeModifiers(player);
    expect(player.farmFoodRateMultiplier).toBeCloseTo(1.4, 10);
    expect(player.farmFoodRateMultiplier).not.toBeCloseTo(1.44, 6);
  });
});
