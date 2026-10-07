import { expect, test, type Page } from '@playwright/test';
import type { BuildingEntity } from '../../src/sim/entity';
import { screenToGround } from '../../src/render/iso';
import {
  pickablePoint,
  playfield,
  setupM4Session,
  waitForTicks,
  worldToScreen,
} from './fixtures/m4';

interface BaseBuilding {
  id: number;
  type: string;
  x: number;
  z: number;
  width: number;
  height: number;
}

interface ResearchRun {
  startTick: number;
  progressAtStart: number;
  time: number;
  elapsedTicks: number;
  ageEvents: { player: number; age: number }[];
}

const SIM_DT = 0.05;

const TRAIN_PLAN: readonly { building: string; units: readonly string[] }[] = [
  { building: 'keep', units: ['peasant', 'ox_cart'] },
  { building: 'barracks', units: ['spearman', 'man_at_arms', 'halberdier'] },
  { building: 'archery_range', units: ['longbowman', 'crossbowman'] },
  { building: 'stable', units: ['sergeant', 'knight'] },
  { building: 'siege_workshop', units: ['trebuchet'] },
];

const cardButton = (page: Page, id: string) =>
  page.getByTestId(`command-${id}`);

// ---------------------------------------------------------------------------
// World setup helpers (existing World create conventions, via the debug hook)
// ---------------------------------------------------------------------------

/** Removes debug walkers and stops autonomous starting carts so economy and pop cap are uncluttered. */
async function clearDebugWalkers(page: Page): Promise<void> {
  await page.evaluate(() => {
    const bordev = window.__bordev;
    const sim = bordev?.sim;
    const probes = bordev?.renderer?.debugProbes;
    if (!sim || !probes) throw new Error('Debug scene unavailable');
    for (const id of probes.allDebugUnitIds) {
      if (sim.world.getEntity(id)?.kind === 'unit') sim.world.removeEntity(id);
    }
    for (const ent of sim.world.entities) {
      if (
        ent &&
        ent.kind === 'unit' &&
        ent.player === 0 &&
        ent.type === 'ox_cart'
      ) {
        sim.issue({ kind: 'stop', player: 0, ids: [ent.id] });
      }
    }
  });
}

async function getKeep(page: Page): Promise<BaseBuilding> {
  return page.evaluate(() => {
    const sim = window.__bordev?.sim;
    if (!sim) throw new Error('Simulation not initialized');
    const keep = sim.world.entities.find(
      (e): e is BuildingEntity =>
        !!e && e.kind === 'building' && e.player === 0 && !!e.isTownCenter,
    );
    if (!keep) throw new Error('Player 0 Keep not found');
    return {
      id: keep.id,
      type: keep.type,
      x: keep.x,
      z: keep.z,
      width: keep.width,
      height: keep.height,
    };
  });
}

/**
 * Spawns completed player-0 buildings on free, passable, gapped ground near the
 * Keep (nearest first) and returns them in request order.
 */
async function createBuildings(
  page: Page,
  types: readonly string[],
): Promise<BaseBuilding[]> {
  return page.evaluate(
    (requested) => {
      const sim = window.__bordev?.sim;
      if (!sim) throw new Error('Simulation not initialized');
      const world = sim.world;
      const grid = world.grid;
      const size = world.map.size;
      const keep = world.entities.find(
        (e): e is BuildingEntity =>
          !!e && e.kind === 'building' && e.player === 0 && !!e.isTownCenter,
      );
      if (!keep) throw new Error('Player 0 Keep not found');
      const cx = keep.x + keep.width / 2;
      const cz = keep.z + keep.height / 2;

      const footprints: { x: number; z: number; w: number; h: number }[] = [];
      const units: { x: number; z: number }[] = [];
      for (const e of world.entities) {
        if (!e) continue;
        if (e.kind === 'building' || e.kind === 'mine') {
          footprints.push({ x: e.x, z: e.z, w: e.width, h: e.height });
        } else if (e.kind === 'unit') {
          units.push({ x: e.x, z: e.z });
        }
      }

      const candidates: { x: number; z: number; d: number }[] = [];
      for (let z = 2; z < size - 2; z++) {
        for (let x = 2; x < size - 2; x++) {
          const d = Math.hypot(x - cx, z - cz);
          if (d >= 6 && d <= 28) candidates.push({ x, z, d });
        }
      }
      candidates.sort((a, b) => a.d - b.d || a.z - b.z || a.x - b.x);

      const result: BaseBuilding[] = [];
      for (const type of requested) {
        const dims =
          type === 'cottage' ||
          type === 'chapel' ||
          type === 'farm' ||
          type === 'storehouse'
            ? 2
            : 3;
        let placed: BaseBuilding | undefined;
        for (const c of candidates) {
          let ok = true;
          for (let tz = c.z - 1; ok && tz <= c.z + dims; tz++) {
            for (let tx = c.x - 1; tx <= c.x + dims; tx++) {
              if (!grid.isPassable(tx + 0.5, tz + 0.5, 0)) {
                ok = false;
                break;
              }
            }
          }
          if (!ok) continue;
          for (const f of footprints) {
            if (
              c.x < f.x + f.w + 1 &&
              c.x + dims + 1 > f.x &&
              c.z < f.z + f.h + 1 &&
              c.z + dims + 1 > f.z
            ) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
          for (const u of units) {
            if (
              u.x > c.x - 1.5 &&
              u.x < c.x + dims + 1.5 &&
              u.z > c.z - 1.5 &&
              u.z < c.z + dims + 1.5
            ) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
          const b = world.spawnBuilding(0, type, c.x, c.z, true);
          footprints.push({ x: b.x, z: b.z, w: b.width, h: b.height });
          placed = {
            id: b.id,
            type: b.type,
            x: b.x,
            z: b.z,
            width: b.width,
            height: b.height,
          };
          break;
        }
        if (!placed) throw new Error(`No free site for ${type}`);
        result.push(placed);
      }
      return result;
    },
    [...types],
  );
}

/** Cottages needed so `extraPop` more units fit under the population cap. */
async function cottagesFor(page: Page, extraPop: number): Promise<number> {
  return page.evaluate((extra) => {
    const sim = window.__bordev?.sim;
    if (!sim) throw new Error('Simulation not initialized');
    const p = sim.world.players[0];
    return Math.max(0, Math.ceil((p.pop + extra - p.popCap) / 10));
  }, extraPop);
}

// ---------------------------------------------------------------------------
// Deterministic tick advancement (same Sim.step the session loop calls)
// ---------------------------------------------------------------------------

async function playerSnapshot(page: Page) {
  return page.evaluate(() => {
    const sim = window.__bordev?.sim;
    if (!sim) throw new Error('Simulation not initialized');
    const p = sim.world.players[0];
    return {
      age: p.age,
      food: p.food,
      gold: p.gold,
      foodCollected: p.foodCollected,
      goldCollected: p.goldCollected,
      lowFaith: p.lowFaith,
      upgrades: [...p.upgrades],
      farmFoodRateMultiplier: p.farmFoodRateMultiplier,
      tick: sim.world.tick,
    };
  });
}

async function advance(page: Page, ticks: number): Promise<void> {
  await page.evaluate((n) => {
    const sim = window.__bordev?.sim;
    if (!sim) throw new Error('Simulation not initialized');
    for (let i = 0; i < n; i++) sim.step();
  }, ticks);
}

/**
 * Steps the Sim and returns the food collected over exactly those ticks. Both
 * reads and the steps share one evaluate so the session loop cannot interleave.
 */
async function collectedOver(page: Page, ticks: number): Promise<number> {
  return page.evaluate((n) => {
    const sim = window.__bordev?.sim;
    if (!sim) throw new Error('Simulation not initialized');
    const player = sim.world.players[0];
    const before = player.foodCollected;
    for (let i = 0; i < n; i++) sim.step();
    return player.foodCollected - before;
  }, ticks);
}

/**
 * Waits for the keep's research to be active, then steps the Sim until it clears.
 * Returns the observed research progress/time and elapsed ticks so callers can
 * assert exact timing independent of how many ticks the session loop ran.
 */
async function finishActiveResearch(
  page: Page,
  buildingId: number,
  upgradeId: string,
): Promise<ResearchRun> {
  await page.waitForFunction(
    ([id, up]) => {
      const e = window.__bordev?.sim?.world.getEntity(id as number);
      return e?.kind === 'building' && e.research?.upgradeId === (up as string);
    },
    [buildingId, upgradeId] as const,
    { timeout: 5_000 },
  );
  return page.evaluate(
    ([id, up]) => {
      const sim = window.__bordev?.sim;
      if (!sim) throw new Error('Simulation not initialized');
      const b = sim.world.getEntity(id as number) as BuildingEntity;
      if (b.research?.upgradeId !== up) throw new Error('Research not active');
      const eventStart = sim.world.events.length;
      const startTick = sim.world.tick;
      const progressAtStart = b.research.progress;
      const time = b.research.time;
      let elapsed = 0;
      while (b.research && elapsed < 6000) {
        sim.step();
        elapsed++;
      }
      return {
        startTick,
        progressAtStart,
        time,
        elapsedTicks: elapsed,
        ageEvents: sim.world.events
          .slice(eventStart)
          .flatMap((ev) =>
            ev.kind === 'ageReached'
              ? [{ player: ev.player, age: ev.age }]
              : [],
          ),
      };
    },
    [buildingId, upgradeId] as const,
  );
}

function expectResearchTiming(run: ResearchRun, seconds: number): void {
  expect(run.time).toBe(seconds);
  // Progress is deterministic per tick: what was banked at observation plus the
  // ticks stepped must reach exactly the table time (no Low Faith here).
  expect(
    run.progressAtStart + run.elapsedTicks * SIM_DT,
  ).toBeGreaterThanOrEqual(seconds - 1e-6);
  expect(run.progressAtStart + (run.elapsedTicks - 1) * SIM_DT).toBeLessThan(
    seconds,
  );
}

/** Real command path for tests that only need the age, not the UI. */
async function researchByCommand(
  page: Page,
  buildingId: number,
  upgradeId: string,
): Promise<ResearchRun> {
  await page.evaluate(
    ([id, up]) => {
      window.__bordev?.issue({
        kind: 'research',
        player: 0,
        buildingId: id as number,
        upgradeId: up as string,
      });
    },
    [buildingId, upgradeId] as const,
  );
  return finishActiveResearch(page, buildingId, upgradeId);
}

// ---------------------------------------------------------------------------
// Viewport-safe camera / selection / rally helpers
// ---------------------------------------------------------------------------

async function centerOnEntity(page: Page, id: number): Promise<void> {
  await page.evaluate((target) => {
    const bordev = window.__bordev;
    const ent = bordev?.sim?.world.getEntity(target);
    if (!bordev || !ent) {
      throw new Error(`Cannot centre on entity ${target}`);
    }
    let x: number;
    let z: number;
    if (ent.kind === 'unit') {
      x = ent.x;
      z = ent.z;
    } else if (ent.kind === 'building' || ent.kind === 'mine') {
      x = ent.x + ent.width / 2;
      z = ent.z + ent.height / 2;
    } else {
      throw new Error(`Cannot centre on ${ent.kind} entity ${target}`);
    }
    bordev.session.input.camera.centerOn(x, z);
  }, id);
}

/** Waits until the entity's screen rect is non-empty and inside the playfield band. */
async function waitForVisibleInPlayfield(
  page: Page,
  id: number,
): Promise<void> {
  await page.waitForFunction(
    (target) => {
      const renderer = window.__bordev?.renderer;
      const rect = renderer?.getEntityScreenRect(target);
      if (!renderer || !rect) return false;
      const canvas = document.querySelector('canvas[aria-label="Game view"]');
      const topBar = document.querySelector('[data-testid="hud-topbar"]');
      const bottomBar = document.querySelector(
        '[data-testid="hud-bottom-bar"]',
      );
      if (!canvas || !topBar || !bottomBar) return false;
      const c = canvas.getBoundingClientRect();
      const top = topBar.getBoundingClientRect().bottom;
      const bottom = bottomBar.getBoundingClientRect().top;
      const cx = c.left + (rect.left + rect.right) / 2;
      const cy = c.top + (rect.top + rect.bottom) / 2;
      return (
        rect.right - rect.left > 4 &&
        rect.bottom - rect.top > 4 &&
        cx > c.left &&
        cx < c.right &&
        cy > top &&
        cy < bottom
      );
    },
    id,
    { timeout: 10_000 },
  );
}

/** Centres, picks and left-clicks a real building; asserts the click point is in the playfield. */
async function selectBuilding(page: Page, id: number): Promise<void> {
  await centerOnEntity(page, id);
  await waitForVisibleInPlayfield(page, id);
  const field = await playfield(page);
  const pt = await pickablePoint(page, id);
  expect(pt.y).toBeGreaterThanOrEqual(field.top);
  expect(pt.y).toBeLessThanOrEqual(field.bottom);
  expect(pt.x).toBeGreaterThanOrEqual(field.left);
  expect(pt.x).toBeLessThanOrEqual(field.right);
  await page.mouse.click(pt.x, pt.y, { button: 'left' });
  await page.waitForFunction(
    (target) => {
      const sel = window.__bordev?.session.input.selection.ids;
      return sel !== undefined && sel.length === 1 && sel[0] === target;
    },
    id,
    { timeout: 5_000 },
  );
}

/**
 * Searches the current viewport's unobscured playfield for a passable, occupiable
 * ground point that is reachable from the producer building and sufficiently distant
 * from the building's ring-1 perimeter (to prove real movement).
 */
async function searchViewportGround(
  page: Page,
  buildingId: number,
): Promise<{ sx: number; sy: number; wx: number; wz: number } | null> {
  return page.evaluate(
    ({ id, fnSrc }) => {
      const screenToGround = new Function(
        'x',
        'y',
        'view',
        `return (${fnSrc})(x, y, view);`,
      );
      const bordev = window.__bordev;
      const renderer = bordev?.renderer;
      const sim = bordev?.sim;
      const cam = renderer?.camera;
      if (!bordev || !renderer || !sim || !cam) throw new Error('Not ready');
      const building = sim.world.getEntity(id);
      if (!building || building.kind !== 'building') {
        throw new Error(`Building ${id} missing`);
      }

      const canvas = document.querySelector('canvas[aria-label="Game view"]');
      const topBar = document.querySelector('[data-testid="hud-topbar"]');
      const bottomBar = document.querySelector(
        '[data-testid="hud-bottom-bar"]',
      );
      if (!canvas || !topBar || !bottomBar) throw new Error('HUD missing');

      const c = canvas.getBoundingClientRect();
      const margin = 24;
      const minPx = c.left + margin;
      const maxPx = c.right - margin;
      const minPy = topBar.getBoundingClientRect().bottom + margin;
      const maxPy = bottomBar.getBoundingClientRect().top - margin;
      if (minPx >= maxPx || minPy >= maxPy) return null;

      const view = cam.view;
      const world = sim.world;
      const grid = world.grid;
      const mapSize = world.map.size;

      const bCenterX = building.x + building.width / 2;
      const bCenterZ = building.z + building.height / 2;
      const bMinX = building.x;
      const bMaxX = building.x + building.width;
      const bMinZ = building.z;
      const bMaxZ = building.z + building.height;

      // BFS outward from building perimeter to identify all reachable passable tiles
      const totalTiles = mapSize * mapSize;
      const reachable = new Uint8Array(totalTiles);
      const queue = new Int32Array(totalTiles);
      let head = 0;
      let tail = 0;

      for (
        let tz = Math.max(0, bMinZ - 1);
        tz <= Math.min(mapSize - 1, bMaxZ);
        tz++
      ) {
        for (
          let tx = Math.max(0, bMinX - 1);
          tx <= Math.min(mapSize - 1, bMaxX);
          tx++
        ) {
          const isPerimeter =
            tx < bMinX || tx >= bMaxX || tz < bMinZ || tz >= bMaxZ;
          if (!isPerimeter) continue;
          if (grid.isPassable(tx, tz, 0)) {
            const idx = tz * mapSize + tx;
            if (reachable[idx] === 0) {
              reachable[idx] = 1;
              queue[tail++] = idx;
            }
          }
        }
      }

      const DIRS_4: readonly [number, number][] = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      while (head < tail) {
        const curr = queue[head++];
        const cx = curr % mapSize;
        const cz = (curr / mapSize) | 0;
        for (let i = 0; i < 4; i++) {
          const nx = cx + DIRS_4[i][0];
          const nz = cz + DIRS_4[i][1];
          if (nx >= 0 && nx < mapSize && nz >= 0 && nz < mapSize) {
            const nIdx = nz * mapSize + nx;
            if (reachable[nIdx] === 0 && grid.isPassable(nx, nz, 0)) {
              reachable[nIdx] = 1;
              queue[tail++] = nIdx;
            }
          }
        }
      }

      interface Candidate {
        sx: number;
        sy: number;
        wx: number;
        wz: number;
        distFromPerimeter: number;
        distCenterSq: number;
      }
      const candidates: Candidate[] = [];

      const clearanceOffsets: readonly [number, number][] = [
        [0, 0],
        [10, 0],
        [-10, 0],
        [0, 10],
        [0, -10],
        [7, 7],
        [-7, -7],
        [7, -7],
        [-7, 7],
      ];

      const step = 16;
      for (let py = minPy; py <= maxPy; py += step) {
        for (let px = minPx; px <= maxPx; px += step) {
          const lx = px - c.left;
          const ly = py - c.top;

          // 1. Unpicked: must clear every entity with clearance margin
          let clearOfEntities = true;
          for (let i = 0; i < clearanceOffsets.length; i++) {
            const ox = clearanceOffsets[i][0];
            const oy = clearanceOffsets[i][1];
            if (renderer.pickEntity(lx + ox, ly + oy) !== undefined) {
              clearOfEntities = false;
              break;
            }
          }
          if (!clearOfEntities) continue;

          // 2. Camera conversion helper: screenToGround
          const ground = screenToGround(lx, ly, view);
          const wx = ground.x;
          const wz = ground.z;

          // 3. Map bounds
          if (wx < 1 || wx >= mapSize - 1 || wz < 1 || wz >= mapSize - 1) {
            continue;
          }

          // 4. Passable & occupiable
          const tx = Math.floor(wx);
          const tz = Math.floor(wz);
          if (!grid.isPassable(tx, tz, 0)) continue;
          if (grid.canOccupy && !grid.canOccupy(wx, wz, 0.4, 0)) continue;

          // 5. Reachable via BFS from producer perimeter
          const tileIdx = tz * mapSize + tx;
          if (reachable[tileIdx] === 0) continue;

          // 6. Distance from producer perimeter:
          // Must be >= 3.8 so every ring-1 spawn tile is > 2.0 tiles away,
          // proving real movement from spawn to rally point.
          const dxFootprint = Math.max(0, bMinX - wx, wx - bMaxX);
          const dzFootprint = Math.max(0, bMinZ - wz, wz - bMaxZ);
          const distFromPerimeter = Math.hypot(dxFootprint, dzFootprint);

          const distCenterSq = (wx - bCenterX) ** 2 + (wz - bCenterZ) ** 2;
          candidates.push({
            sx: px,
            sy: py,
            wx,
            wz,
            distFromPerimeter,
            distCenterSq,
          });
        }
      }

      if (candidates.length === 0) return null;

      // Filter to candidates with distFromPerimeter >= 3.8 (guarantees > 2.0 from any ring-1 spawn tile)
      // and within reasonable reach (<= 14 tiles)
      const validForProof = candidates.filter(
        (c) => c.distFromPerimeter >= 3.8 && c.distFromPerimeter <= 14.0,
      );

      const pool = validForProof.length > 0 ? validForProof : candidates;

      // Deterministically sort by distance to producer center (nearest first)
      pool.sort(
        (a, b) => a.distCenterSq - b.distCenterSq || a.sy - b.sy || a.sx - b.sx,
      );

      const best = pool[0];
      return { sx: best.sx, sy: best.sy, wx: best.wx, wz: best.wz };
    },
    { id: buildingId, fnSrc: screenToGround.toString() },
  );
}

/**
 * Picks an unobstructed, passable ground point on screen near the selected
 * building (inside the playfield band, clear of every picked entity and of
 * impassable tiles) and returns page coordinates plus the expected world point.
 * If the current viewport has no clear point, pans to adjacent regions while
 * preserving building selection.
 */
async function findGroundScreenPoint(
  page: Page,
  buildingId: number,
): Promise<{ sx: number; sy: number; wx: number; wz: number }> {
  const current = await searchViewportGround(page, buildingId);
  if (current) return current;

  // Pan while preserving selection to adjacent clear regions
  const panOffsets: readonly [number, number][] = [
    [0, -8],
    [0, 8],
    [-8, 0],
    [8, 0],
    [8, 8],
    [-8, -8],
    [8, -8],
    [-8, 8],
  ];

  for (const [dx, dz] of panOffsets) {
    await page.evaluate(
      ([pdx, pdz]) => {
        const camera = window.__bordev?.renderer?.camera;
        if (!camera) throw new Error('Renderer camera unavailable');
        camera.pan(pdx, pdz);
      },
      [dx, dz],
    );
    await waitForTicks(page, 2);

    const selection = await page.evaluate(
      () => window.__bordev?.session.input.selection.ids,
    );
    expect(selection, 'selection preserved during pan').toEqual([buildingId]);

    const found = await searchViewportGround(page, buildingId);
    if (found) return found;
  }

  throw new Error(
    `No clear passable reachable ground point near building ${buildingId}`,
  );
}

/** Real right-click on ground with the building selected; asserts the stored ground rally. */
async function setGroundRally(
  page: Page,
  buildingId: number,
): Promise<{ x: number; z: number }> {
  const target = await findGroundScreenPoint(page, buildingId);
  await page.mouse.click(target.sx, target.sy, { button: 'right' });
  await waitForTicks(page, 2);
  const rally = await page.evaluate((id) => {
    const b = window.__bordev?.sim?.world.getEntity(id);
    if (!b || b.kind !== 'building') return null;
    return b.rallyPoint ?? null;
  }, buildingId);
  expect(rally, 'ground right-click stores a rally point').not.toBeNull();
  expect(Math.abs(rally!.x - target.wx)).toBeLessThan(1.0);
  expect(Math.abs(rally!.z - target.wz)).toBeLessThan(1.0);
  expect(rally!.targetId).toBeUndefined();

  // Validate conversion consistency via worldToScreen fixture helper
  const screenProj = await worldToScreen(page, target.wx, target.wz);
  expect(Math.abs(screenProj.x - target.sx)).toBeLessThan(2.0);
  expect(Math.abs(screenProj.y - target.sy)).toBeLessThan(2.0);

  return { x: rally!.x, z: rally!.z };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('1. command card requirements, age research, cancellation and Heavy Plough end to end', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { consoleErrors, pageErrors } = await setupM4Session(page, {
    centerOn: { x: 22, z: 22 },
  });
  await page.evaluate(() => window.__bordev?.cheats.resources(20_000));
  await clearDebugWalkers(page);

  const keep = await getKeep(page);
  await selectBuilding(page, keep.id);

  const age2 = cardButton(page, 'research-age-2');
  const age3 = cardButton(page, 'research-age-3');
  const plough = cardButton(page, 'research-heavy-plough');
  const cropRotation = cardButton(page, 'research-crop-rotation');
  const cancel = cardButton(page, 'cancel-research');

  // Age I: Keep unit cards open, every progression card greyed with its reasons.
  await expect(cardButton(page, 'train-peasant')).not.toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await expect(age2).toHaveAttribute('aria-disabled', 'true');
  for (const name of ['Barracks', 'Archery Range', 'Storehouse', 'Chapel']) {
    await expect(age2).toHaveAttribute('title', new RegExp(name));
  }
  await expect(age2).toHaveAttribute('title', /Requires 2 more/);
  await expect(age3).toHaveAttribute('aria-disabled', 'true');
  await expect(age3).toHaveAttribute('title', /Borough/);
  await expect(plough).toHaveAttribute('aria-disabled', 'true');
  await expect(plough).toHaveAttribute('title', /Heavy Plough/);
  await expect(plough).toHaveAttribute('title', /Farms \+20/);
  await expect(plough).toHaveAttribute('title', /Borough/);
  await expect(cropRotation).toHaveAttribute('aria-disabled', 'true');
  await expect(cancel).toHaveCount(0);

  // Clicking a greyed card shows the reason instead of issuing research.
  const age2Box = await age2.boundingBox();
  expect(age2Box, 'age2 card bounding box is present').not.toBeNull();
  await page.mouse.click(
    age2Box!.x + age2Box!.width / 2,
    age2Box!.y + age2Box!.height / 2,
  );
  await expect(page.getByTestId('hud-status')).toContainText('Requires');
  expect((await playerSnapshot(page)).age).toBe(1);
  // One distinct category completed: the tooltip now lists what is still missing.
  await createBuildings(page, ['barracks']);
  await expect(age2).toHaveAttribute('title', /Requires 1 more/);
  await expect(age2).toHaveAttribute('title', /Archery Range/);
  await expect(age2).not.toHaveAttribute('title', /Barracks/);
  await expect(age2).toHaveAttribute('aria-disabled', 'true');

  // Second distinct category (+ Chapel faith so research stays at full speed).
  await createBuildings(page, ['archery_range', 'chapel']);
  await expect(age2).not.toHaveAttribute('aria-disabled', 'true');

  // Start, observe in HUD, verify exclusion with training, then cancel with a full refund.
  const before = await playerSnapshot(page);
  await age2.click();
  await page.waitForFunction(
    (id) => {
      const e = window.__bordev?.sim?.world.getEntity(id);
      return e?.kind === 'building' && e.research?.upgradeId === 'age_2';
    },
    keep.id,
    { timeout: 5_000 },
  );
  const started = await playerSnapshot(page);
  const foodSpent =
    before.food - started.food + (started.foodCollected - before.foodCollected);
  const goldSpent =
    before.gold - started.gold + (started.goldCollected - before.goldCollected);
  expect(foodSpent).toBe(500);
  expect(goldSpent).toBe(200);
  await expect(page.getByTestId('selection-research')).toBeVisible();
  await expect(cancel).toBeVisible();
  await expect(cardButton(page, 'train-peasant')).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await expect(cardButton(page, 'train-peasant')).toHaveAttribute(
    'title',
    /Researching/,
  );

  await cancel.click();
  await page.waitForFunction(
    (id) => {
      const e = window.__bordev?.sim?.world.getEntity(id);
      return e?.kind === 'building' && e.research === undefined;
    },
    keep.id,
    { timeout: 5_000 },
  );
  const refunded = await playerSnapshot(page);
  expect(refunded.food - (refunded.foodCollected - before.foodCollected)).toBe(
    before.food,
  );
  expect(refunded.gold - (refunded.goldCollected - before.goldCollected)).toBe(
    before.gold,
  );
  expect(refunded.age).toBe(1);
  await expect(page.getByTestId('selection-research')).toHaveCount(0);
  await expect(cardButton(page, 'train-peasant')).not.toHaveAttribute(
    'aria-disabled',
    'true',
  );

  // Restart and complete: exactly the 40 s table time, one ageReached event.
  await expect(age2).not.toHaveAttribute('aria-disabled', 'true');
  await age2.click();
  const run2 = await finishActiveResearch(page, keep.id, 'age_2');
  expectResearchTiming(run2, 40);
  expect(run2.ageEvents).toEqual([{ player: 0, age: 2 }]);
  expect((await playerSnapshot(page)).age).toBe(2);
  expect((await playerSnapshot(page)).lowFaith).toBe(false);
  await expect(age2).toHaveAttribute('aria-disabled', 'true');
  await expect(age2).toHaveAttribute('title', /already reached/);

  // Age III needs a stable; Heavy Plough is now unlocked.
  await expect(age3).toHaveAttribute('aria-disabled', 'true');
  await expect(age3).toHaveAttribute('title', /Stable/);
  await expect(plough).not.toHaveAttribute('aria-disabled', 'true');
  await expect(cropRotation).toHaveAttribute('aria-disabled', 'true');
  await expect(cropRotation).toHaveAttribute('title', /Beta/);

  // Heavy Plough: observed farm output +20 % through the real action.
  const [farm] = await createBuildings(page, ['farm']);
  const farmerIds = await page.evaluate(
    ([fx, fz]) => {
      const cheats = window.__bordev?.cheats;
      if (!cheats) throw new Error('Cheats unavailable');
      return cheats.spawnPeasants(1, fx + 3, fz + 1);
    },
    [farm.x, farm.z] as const,
  );
  expect(farmerIds).toHaveLength(1);
  await page.evaluate(
    ([farmerId, farmId]) => {
      window.__bordev?.issue({
        kind: 'farm',
        player: 0,
        ids: [farmerId],
        targetId: farmId,
      });
    },
    [farmerIds[0], farm.id] as const,
  );
  await advance(page, 300);
  const baseCollected = await collectedOver(page, 200);
  expect(baseCollected).toBeCloseTo(5, 6);
  expect((await playerSnapshot(page)).farmFoodRateMultiplier).toBe(1);

  await selectBuilding(page, keep.id);
  await expect(plough).not.toHaveAttribute('aria-disabled', 'true');
  const ploughBefore = await playerSnapshot(page);
  await plough.click();
  const ploughRun = await finishActiveResearch(page, keep.id, 'heavy_plough');
  expectResearchTiming(ploughRun, 30);
  expect(ploughRun.ageEvents).toEqual([]);
  const ploughAfter = await playerSnapshot(page);
  expect(ploughAfter.upgrades).toContain('heavy_plough');
  expect(ploughAfter.farmFoodRateMultiplier).toBeCloseTo(1.2, 10);
  expect(ploughBefore.food - ploughAfter.food).toBeCloseTo(
    100 - (ploughAfter.foodCollected - ploughBefore.foodCollected),
    6,
  );
  await expect(plough).toHaveAttribute('aria-disabled', 'true');
  await expect(plough).toHaveAttribute('title', /Already researched/);

  await advance(page, 5);
  const boostedCollected = await collectedOver(page, 200);
  expect(boostedCollected).toBeCloseTo(6, 6);
  expect(boostedCollected / baseCollected).toBeCloseTo(1.2, 8);

  // Age III: stable + an Age II category unlock it; 60 s table time.
  await createBuildings(page, ['stable']);
  await expect(age3).not.toHaveAttribute('aria-disabled', 'true');
  await age3.click();
  const run3 = await finishActiveResearch(page, keep.id, 'age_3');
  expectResearchTiming(run3, 60);
  expect(run3.ageEvents).toEqual([{ player: 0, age: 3 }]);
  expect((await playerSnapshot(page)).age).toBe(3);
  await expect(age3).toHaveAttribute('aria-disabled', 'true');
  // Heavy Plough multiplier must not have been touched by the age change.
  expect((await playerSnapshot(page)).farmFoodRateMultiplier).toBeCloseTo(
    1.2,
    10,
  );

  expect(consoleErrors, 'console errors during M6 progression test').toEqual(
    [],
  );
  expect(pageErrors, 'uncaught page errors during M6 progression test').toEqual(
    [],
  );
});

test('2. trains each of the ten Crown units from real buildings via the command card and rallies them on the ground', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const { consoleErrors, pageErrors } = await setupM4Session(page, {
    centerOn: { x: 22, z: 22 },
  });
  await page.evaluate(() => window.__bordev?.cheats.resources(20_000));
  await clearDebugWalkers(page);

  const keep = await getKeep(page);

  // Prerequisite buildings: a chapel keeps Faith positive (no Low Faith), cottages
  // make room under the population cap for the twelve queued population points.
  const cottages = await cottagesFor(page, 12);
  const created = await createBuildings(page, [
    'chapel',
    'barracks',
    'archery_range',
    'stable',
    'siege_workshop',
    ...Array.from({ length: cottages }, () => 'cottage'),
  ]);
  const byType: Record<string, BaseBuilding> = { keep };
  for (const b of created) {
    if (b.type !== 'cottage' && b.type !== 'chapel') byType[b.type] = b;
  }

  // Ages via real research commands, accelerated through Sim.step.
  const age2 = await researchByCommand(page, keep.id, 'age_2');
  expect(age2.ageEvents).toEqual([{ player: 0, age: 2 }]);
  const age3 = await researchByCommand(page, keep.id, 'age_3');
  expect(age3.ageEvents).toEqual([{ player: 0, age: 3 }]);
  const afterAges = await playerSnapshot(page);
  expect(afterAges.age).toBe(3);
  expect(afterAges.lowFaith).toBe(false);
  await page.evaluate(() => window.__bordev?.cheats.resources(20_000));

  // Queue every unit through the real command card with a real ground rally.
  const eventStart = await page.evaluate(
    () => window.__bordev?.sim?.world.events.length ?? 0,
  );
  const rallies: Record<string, { x: number; z: number }> = {};
  for (const step of TRAIN_PLAN) {
    const building = byType[step.building];
    expect(building, `${step.building} exists`).toBeDefined();
    await selectBuilding(page, building.id);
    rallies[step.building] = await setGroundRally(page, building.id);

    for (const unit of step.units) {
      const button = cardButton(page, `train-${unit.replace(/_/g, '-')}`);
      await expect(button).toBeVisible();
      await expect(button).not.toHaveAttribute('aria-disabled', 'true');
      await button.click();
    }
    await page.waitForFunction(
      ([id, count]) => {
        const e = window.__bordev?.sim?.world.getEntity(id as number);
        return (
          e?.kind === 'building' && e.trainingQueue.length === (count as number)
        );
      },
      [building.id, step.units.length] as const,
      { timeout: 5_000 },
    );
  }

  // Train to completion: exactly one unitCreated per Crown type, no extras.
  const trained = await page.evaluate(
    ([start, expected]) => {
      const sim = window.__bordev?.sim;
      if (!sim) throw new Error('Simulation not initialized');
      const collect = () =>
        sim.world.events.slice(start as number).flatMap((ev) =>
          ev.kind === 'unitCreated' && ev.player === 0
            ? [
                {
                  id: ev.entityId,
                  unitType: ev.unitType,
                  spawnX: ev.x,
                  spawnZ: ev.z,
                },
              ]
            : [],
        );
      let ticks = 0;
      while (collect().length < (expected as number) && ticks < 8000) {
        sim.step();
        ticks++;
      }
      return { units: collect(), ticks };
    },
    [eventStart, 10] as const,
  );
  expect(trained.units).toHaveLength(10);
  expect(trained.units.map((u) => u.unitType).sort()).toEqual(
    TRAIN_PLAN.flatMap((s) => [...s.units]).sort(),
  );

  // Each unit walks to its building's ground rally (within 2 tiles).
  const destinations = trained.units.map((u) => {
    const step = TRAIN_PLAN.find((s) => s.units.includes(u.unitType))!;
    return { ...u, building: step.building, rally: rallies[step.building] };
  });

  // Verify that every unit spawned at distance > 2 from its rally point, proving real movement:
  for (const d of destinations) {
    const spawnDist = Math.hypot(d.spawnX - d.rally.x, d.spawnZ - d.rally.z);
    expect(
      spawnDist,
      `${d.unitType} initial spawn distance from rally (${spawnDist.toFixed(2)}) must be > 2.0 to prove movement`,
    ).toBeGreaterThan(2.0);
  }

  const arrival = await page.evaluate((dests) => {
    const sim = window.__bordev?.sim;
    if (!sim) throw new Error('Simulation not initialized');
    const dist = (d: { id: number; rally: { x: number; z: number } }) => {
      const u = sim.world.getEntity(d.id);
      if (!u || u.kind !== 'unit') return Infinity;
      return Math.hypot(u.x - d.rally.x, u.z - d.rally.z);
    };
    let ticks = 0;
    while (dests.some((d) => dist(d) > 2) && ticks < 4000) {
      sim.step();
      ticks++;
    }
    return { ticks, distances: dests.map(dist) };
  }, destinations);
  for (const d of arrival.distances) {
    expect(d).toBeLessThanOrEqual(2);
  }
  expect(
    arrival.ticks,
    'units must advance ticks to travel to their rally points',
  ).toBeGreaterThan(0);
  // Every unit is drawn from its own atlas and has a visible on-screen surface.
  for (const d of destinations) {
    await centerOnEntity(page, d.id);
    await waitForVisibleInPlayfield(page, d.id);

    const surface = await page.evaluate(
      ([id, type]) => {
        const renderer = window.__bordev?.renderer;
        if (!renderer) throw new Error('Renderer missing');
        const rect = renderer.getEntityScreenRect(id as number);
        const portrait = renderer.getPortrait({
          kind: 'unit',
          type: type as string,
        });
        return {
          rect: rect ? { ...rect } : null,
          portrait: portrait ? { ...portrait } : null,
          visibleSprites: renderer.stats().visibleSpriteCount,
        };
      },
      [d.id, d.unitType] as const,
    );
    expect(surface.rect, `${d.unitType} screen rect`).not.toBeNull();
    expect(surface.rect!.right - surface.rect!.left).toBeGreaterThan(4);
    expect(surface.rect!.bottom - surface.rect!.top).toBeGreaterThan(4);
    expect(surface.visibleSprites).toBeGreaterThan(0);
    // The portrait resolves through the unit's own atlas asset, never the
    // peasant fallback used for unmapped types.
    expect(surface.portrait, `${d.unitType} atlas portrait`).not.toBeNull();
    expect(surface.portrait!.url).toContain(`crown_${d.unitType}`);
    expect(surface.portrait!.w).toBeGreaterThan(0);
    expect(surface.portrait!.h).toBeGreaterThan(0);

    // Pickable on its own pixels (or, if stacked, hidden only behind another unit).
    const pickedId = await page.evaluate((id) => {
      const renderer = window.__bordev?.renderer;
      const rect = renderer?.getEntityScreenRect(id);
      if (!renderer || !rect) return null;
      const w = rect.right - rect.left;
      const h = rect.bottom - rect.top;
      for (let iy = 0; iy < 7; iy++) {
        for (let ix = 0; ix < 7; ix++) {
          const x = rect.left + w * (0.1 + 0.8 * (ix / 6));
          const y = rect.top + h * (0.1 + 0.8 * (iy / 6));
          if (renderer.pickEntity(x, y) === id) return id;
        }
      }
      return renderer.pickEntity(
        (rect.left + rect.right) / 2,
        (rect.top + rect.bottom) / 2,
      );
    }, d.id);
    expect(pickedId, `${d.unitType} visible/pickable`).not.toBeNull();
    expect(pickedId).not.toBeUndefined();
  }

  expect(consoleErrors, 'console errors during M6 training test').toEqual([]);
  expect(pageErrors, 'uncaught page errors during M6 training test').toEqual(
    [],
  );
});
