import { expect, test, type Page } from '@playwright/test';
import type { SimEvent } from '../../src/sim/commands';
import type { BuildingEntity, UnitEntity } from '../../src/sim/entity';
import {
  nextFrames,
  pickablePoint,
  playfield,
  startSkirmish,
  waitForRender,
  waitForSessionLoaded,
} from './fixtures/m4';
import {
  cardButton,
  cottagesFor,
  createBuildings,
  getKeep,
  selectBuilding,
} from './fixtures/production';

const TRAIN_PLAN = [
  { building: 'keep', units: ['peasant', 'ox_cart'] },
  { building: 'barracks', units: ['spearman', 'man_at_arms', 'halberdier'] },
  { building: 'archery_range', units: ['longbowman', 'crossbowman'] },
  { building: 'stable', units: ['sergeant', 'knight'] },
  { building: 'siege_workshop', units: ['trebuchet'] },
] as const;

const CROWN_UNITS = TRAIN_PLAN.flatMap(({ units }) => [...units]);

declare global {
  interface Window {
    __alphaTrainEvents?: SimEvent[];
  }
}

test.setTimeout(300_000);

/** Finds clear firing positions on the Keep's map-centre-facing offset perimeter. */
async function spawnSiegeNearEnemyKeep(page: Page) {
  return page.evaluate(() => {
    const bordev = window.__bordev;
    const sim = bordev?.sim;
    if (!bordev || !sim) throw new Error('Simulation not initialized');
    const world = sim.world;
    const keep = world.entities.find(
      (entity): entity is BuildingEntity =>
        !!entity &&
        entity.kind === 'building' &&
        entity.player === 1 &&
        !!entity.isTownCenter &&
        entity.built,
    );
    const trainedTrebuchet = world.entities.find(
      (entity): entity is UnitEntity =>
        !!entity &&
        entity.kind === 'unit' &&
        entity.player === 0 &&
        entity.type === 'trebuchet',
    );
    if (!keep || !trainedTrebuchet) {
      throw new Error('Enemy Keep or trained trebuchet missing');
    }

    const cx = keep.x + keep.width / 2;
    const cz = keep.z + keep.height / 2;
    const mapCentre = world.map.size / 2;
    const facingX = mapCentre < cx ? -1 : 1;
    const facingZ = mapCentre < cz ? -1 : 1;
    const edgeX = facingX < 0 ? keep.x : keep.x + keep.width;
    const edgeZ = facingZ < 0 ? keep.z : keep.z + keep.height;
    const distance = 5;
    const candidates: { x: number; z: number }[] = [];

    // The rounded corner and adjacent straight edges are exactly five tiles
    // from the footprint, including when AI construction blocks some sites.
    for (let step = 0; step <= 32; step++) {
      const angle = ((step / 32) * Math.PI) / 2;
      candidates.push({
        x: edgeX + facingX * distance * Math.cos(angle),
        z: edgeZ + facingZ * distance * Math.sin(angle),
      });
    }
    for (let offset = 0.5; offset < keep.height; offset += 0.5) {
      candidates.push({
        x: edgeX + facingX * distance,
        z: keep.z + offset,
      });
    }
    for (let offset = 0.5; offset < keep.width; offset += 0.5) {
      candidates.push({
        x: keep.x + offset,
        z: edgeZ + facingZ * distance,
      });
    }
    candidates.sort(
      (a, b) =>
        Math.hypot(a.x - mapCentre, a.z - mapCentre) -
        Math.hypot(b.x - mapCentre, b.z - mapCentre),
    );

    const units: {
      id: number;
      distance: number;
      minRange: number;
      lineOfSight: number;
    }[] = [];
    for (const point of candidates) {
      if (!world.grid.canOccupy(point.x, point.z, trainedTrebuchet.radius, 0)) {
        continue;
      }
      if (
        world.entities.some(
          (entity) =>
            entity?.kind === 'unit' &&
            Math.hypot(entity.x - point.x, entity.z - point.z) <
              entity.radius + trainedTrebuchet.radius + 0.6,
        )
      ) {
        continue;
      }
      const unit = world.spawnUnit(0, 'trebuchet', point.x, point.z);
      units.push({
        id: unit.id,
        distance: Math.hypot(
          Math.max(keep.x - unit.x, 0, unit.x - keep.x - keep.width),
          Math.max(keep.z - unit.z, 0, unit.z - keep.z - keep.height),
        ),
        minRange: unit.minRange ?? 0,
        lineOfSight: unit.lineOfSight,
      });
      if (units.length === 3) break;
    }
    if (units.length !== 3) {
      throw new Error(
        'No three clear firing positions five tiles from the enemy Keep',
      );
    }

    sim.step();
    sim.step();
    const camera = bordev.session.renderer.camera;
    if (!camera) throw new Error('Renderer camera is not available');
    // Keep-centred zoom leaves the north-west siege sprites below the top bar.
    camera.zoomAt(camera.view.width / 2, camera.view.height / 2, 0.65);
    camera.centerOn(cx, cz);
    return {
      keepId: keep.id,
      units,
      unitsTrained: world.players[0].unitsTrained,
    };
  });
}

test('trains all ten Crown units through the command card and wins a skirmish through siege input', async ({
  page,
}) => {
  const { consoleErrors, pageErrors } = await startSkirmish(page);
  await waitForSessionLoaded(page);
  await page.evaluate(() => {
    const bordev = window.__bordev;
    if (!bordev) throw new Error('Debug hook unavailable');
    bordev.cheats.resources(20_000);
    bordev.cheats.age(3);
  });

  const keep = await getKeep(page);
  const cottages = await cottagesFor(page, 20);
  const buildings = await createBuildings(page, [
    'barracks',
    'archery_range',
    'stable',
    'siege_workshop',
    'chapel',
    ...Array.from({ length: cottages }, () => 'cottage'),
  ]);
  const producers = [keep, ...buildings];
  await page.evaluate(() => {
    const bordev = window.__bordev;
    if (!bordev) throw new Error('Debug hook unavailable');
    window.__alphaTrainEvents = bordev.recordEvents();
  });

  for (const step of TRAIN_PLAN) {
    const producer = producers.find(
      (building) => building.type === step.building,
    );
    if (!producer) throw new Error(`Missing ${step.building} producer`);
    await selectBuilding(page, producer.id);
    for (const type of step.units) {
      const button = cardButton(page, `train-${type.replace(/_/g, '-')}`);
      await expect(button).toBeVisible();
      await expect(button).not.toHaveAttribute('aria-disabled', 'true');
      await button.click();
    }
  }

  const trained = await page.evaluate((expected) => {
    const sim = window.__bordev?.sim;
    const recorded = window.__alphaTrainEvents;
    if (!sim || !recorded)
      throw new Error('Simulation or event recorder missing');
    const types: string[] = [];
    const collect = (events: readonly SimEvent[]) => {
      for (const event of events) {
        if (event.kind === 'unitCreated' && event.player === 0) {
          types.push(event.unitType);
        }
      }
    };
    collect(recorded);
    const drained: SimEvent[] = [];
    const flush = () => {
      sim.drainEvents(drained);
      for (const event of drained) recorded.push(event);
      collect(drained);
    };
    flush();
    let ticks = 0;
    while (types.length < expected && ticks < 6000 && !sim.world.outcome) {
      sim.step();
      flush();
      ticks++;
    }
    return { types, ticks, unitsTrained: sim.world.players[0].unitsTrained };
  }, CROWN_UNITS.length);

  expect(trained.ticks).toBeLessThanOrEqual(6000);
  expect(trained.types).toHaveLength(10);
  expect([...new Set(trained.types)].sort()).toEqual([...CROWN_UNITS].sort());
  expect(trained.unitsTrained).toBe(10);

  const siege = await spawnSiegeNearEnemyKeep(page);
  expect(siege.unitsTrained, 'debug spawns do not count as trained units').toBe(
    10,
  );
  for (const unit of siege.units) {
    expect(unit.distance).toBeCloseTo(5, 6);
    expect(unit.distance).toBeGreaterThan(unit.minRange);
    expect(unit.distance).toBeLessThanOrEqual(unit.lineOfSight);
  }
  const siegeIds = siege.units.map(({ id }) => id);
  await nextFrames(page, 2);
  await waitForRender(page, [...siegeIds, siege.keepId]);
  const field = await playfield(page);
  for (const [index, id] of siegeIds.entries()) {
    const point = await pickablePoint(page, id);
    expect(point.x).toBeGreaterThan(field.left + 16);
    expect(point.x).toBeLessThan(field.right - 16);
    expect(point.y).toBeGreaterThanOrEqual(field.top);
    expect(point.y).toBeLessThanOrEqual(field.bottom);
    if (index > 0) await page.keyboard.down('Shift');
    try {
      await page.mouse.click(point.x, point.y, { button: 'left' });
    } finally {
      if (index > 0) await page.keyboard.up('Shift');
    }
    await page.waitForFunction(
      (ids) => {
        const selected = window.__bordev?.session.input.selection.ids;
        return (
          selected?.length === ids.length &&
          ids.every((id) => selected.includes(id))
        );
      },
      siegeIds.slice(0, index + 1),
      { timeout: 10_000 },
    );
  }

  const target = await pickablePoint(page, siege.keepId);
  expect(target.x).toBeGreaterThan(field.left + 16);
  expect(target.x).toBeLessThan(field.right - 16);
  expect(target.y).toBeGreaterThanOrEqual(field.top);
  expect(target.y).toBeLessThanOrEqual(field.bottom);
  await page.mouse.click(target.x, target.y, { button: 'right' });
  await page.waitForFunction(
    ({ ids, targetId }) => {
      const world = window.__bordev?.sim?.world;
      return (
        !!world &&
        ids.every((id) => {
          const unit = world.getEntity(id);
          return (
            unit?.kind === 'unit' &&
            unit.order?.kind === 'attack' &&
            unit.order.targetId === targetId
          );
        })
      );
    },
    { ids: siegeIds, targetId: siege.keepId },
    { timeout: 10_000 },
  );

  const destruction = await page.evaluate((targetId) => {
    const sim = window.__bordev?.sim;
    if (!sim) throw new Error('Simulation not initialized');
    let ticks = 0;
    while (
      sim.world.getEntity(targetId) &&
      ticks < 3000 &&
      !sim.world.outcome
    ) {
      sim.step();
      ticks++;
    }
    // The session's next frame must drain matchEnded and navigate to Results.
    return { ticks, removed: sim.world.getEntity(targetId) === undefined };
  }, siege.keepId);
  expect(destruction.ticks).toBeLessThanOrEqual(3000);
  expect(destruction.removed).toBe(true);
  await nextFrames(page, 2);
  await expect(
    page.getByRole('heading', { name: 'Victory', exact: true }),
  ).toBeVisible();
  const humanResult = page.getByTestId('results-row-0');
  await expect(humanResult).toBeVisible();
  expect(
    Number(await humanResult.locator('td').nth(1).innerText()),
  ).toBeGreaterThanOrEqual(10);
  expect(
    consoleErrors,
    'console errors during the Alpha victory smoke',
  ).toEqual([]);
  expect(
    pageErrors,
    'uncaught page errors during the Alpha victory smoke',
  ).toEqual([]);
});

test('Escape pauses the skirmish, Resume advances it, and Surrender shows Defeat', async ({
  page,
}) => {
  const { consoleErrors, pageErrors } = await startSkirmish(page);
  await waitForSessionLoaded(page);
  await page.keyboard.press('Escape');
  const menu = page.getByRole('dialog', { name: 'Game menu', exact: true });
  await expect(menu).toBeVisible();
  const pausedTick = await page.evaluate(() => {
    const sim = window.__bordev?.sim;
    if (!sim) throw new Error('Simulation not initialized');
    return sim.world.tick;
  });
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.__bordev?.sim?.world.tick)).toBe(
    pausedTick,
  );

  await menu.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(menu).toBeHidden();
  await page.waitForFunction(
    (tick) => (window.__bordev?.sim?.world.tick ?? tick) > tick,
    pausedTick,
    { timeout: 10_000 },
  );
  await page.keyboard.press('Escape');
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: 'Surrender', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Defeat', exact: true }),
  ).toBeVisible();
  expect(
    consoleErrors,
    'console errors during the Alpha surrender smoke',
  ).toEqual([]);
  expect(
    pageErrors,
    'uncaught page errors during the Alpha surrender smoke',
  ).toEqual([]);
});
