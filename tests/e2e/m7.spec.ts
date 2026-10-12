import { expect, test, type Page } from '@playwright/test';
import {
  setupM4Session,
  worldToScreen,
  waitForTicks,
  playfield,
  pickablePoint,
} from './fixtures/m4';

/**
 * M7 browser acceptance on the real GameSession, input pipeline and renderer.
 *
 * Fixture ground: on alpha_test the region x 50..99, z 0..25 is plain grass with no
 * mines, doodads, start entities or buildings (player 0 Keep occupies 20..24, player 1
 * Keep sits near 104,104). Every scenario builds its own units and buildings there,
 * centred under the camera, after the legacy debug-scene walkers were removed through
 * their real ids. Orders always travel through real mouse/keyboard/card input; only the
 * staged entities are created through the World API.
 *
 * Visual claims are checked from real canvas screenshots compared pixel-wise.
 */

interface Clip {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PageRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface UnitSpec {
  player: number;
  type: string;
  x: number;
  z: number;
}

interface BuildingSpec {
  player: number;
  type: string;
  x: number;
  z: number;
}

interface M7Probe {
  buildingHp: number[];
  unitHp: number[];
  drawnStoneFrames: number;
  drawnArrowFrames: number;
  maxDrawnProjectiles: number;
  firstStoneOriginDistance: number | null;
}

declare global {
  interface Window {
    __m7Probe?: M7Probe;
  }
}

/** Minimum differing pixels (per-channel tolerance 12) that counts as a different rendered frame. */
const MIN_FRAME_DIFF_PIXELS = 40;

/**
 * Boots the session on the isolated fixture ground, centres the camera and removes the
 * legacy debug-scene walkers through the ids the debug scene recorded.
 */
async function bootFixture(page: Page, center: { x: number; z: number }) {
  const errors = await setupM4Session(page, { centerOn: center });

  const removal = await page.evaluate(() => {
    const world = window.__bordev?.sim?.world;
    const probes = window.__bordev?.renderer?.debugProbes;
    if (!world || !probes) throw new Error('Debug scene unavailable');
    let removed = 0;
    for (const id of probes.allDebugUnitIds) {
      if (world.getEntity(id)?.kind === 'unit') {
        world.removeEntity(id);
        removed++;
      }
    }
    return { listed: probes.allDebugUnitIds.length, removed };
  });
  expect(removal.listed).toBeGreaterThan(0);
  expect(removal.removed).toBe(removal.listed);
  await waitForTicks(page, 2);

  const view = await page.evaluate(() => {
    const v = window.__bordev?.session.renderer.camera?.view;
    if (!v) throw new Error('Camera unavailable');
    return { x: v.targetX, z: v.targetZ };
  });
  expect(view.x).toBeCloseTo(center.x, 3);
  expect(view.z).toBeCloseTo(center.z, 3);

  return errors;
}

/** Spawns units on tiles the grid reports as occupiable; returns their real ids. */
async function spawnUnits(page: Page, specs: UnitSpec[]): Promise<number[]> {
  return page.evaluate((list) => {
    const world = window.__bordev?.sim?.world;
    if (!world) throw new Error('Simulation not initialized');
    const spawned = list.map((s) => {
      const unit = world.spawnUnit(s.player, s.type, s.x, s.z, 'crown');
      if (!world.grid.canOccupy(unit.x, unit.z, unit.radius, unit.player)) {
        throw new Error(`${s.type} spawned on blocked ground at ${s.x},${s.z}`);
      }
      return unit;
    });
    for (let i = 0; i < spawned.length; i++) {
      for (let j = i + 1; j < spawned.length; j++) {
        const d = Math.hypot(
          spawned[i].x - spawned[j].x,
          spawned[i].z - spawned[j].z,
        );
        if (d < 1.1) throw new Error('Staged units overlap');
      }
    }
    return spawned.map((u) => u.id);
  }, specs);
}

/** Spawns a completed building (callers verify the footprint first with expectFootprintPassable). */
async function spawnBuilding(page: Page, spec: BuildingSpec): Promise<number> {
  return page.evaluate((s) => {
    const world = window.__bordev?.sim?.world;
    if (!world) throw new Error('Simulation not initialized');
    const building = world.spawnBuilding(s.player, s.type, s.x, s.z, true);
    return building.id;
  }, spec);
}

/** Fails fast if the footprint is not free grass before the building is created. */
async function expectFootprintPassable(
  page: Page,
  x: number,
  z: number,
  width: number,
  height: number,
): Promise<void> {
  const blocked = await page.evaluate(
    ({ x, z, width, height }) => {
      const world = window.__bordev?.sim?.world;
      if (!world) throw new Error('Simulation not initialized');
      let count = 0;
      for (let tz = z; tz < z + height; tz++) {
        for (let tx = x; tx < x + width; tx++) {
          if (!world.grid.isPassable(tx + 0.5, tz + 0.5, 0)) count++;
          if (!world.grid.isPassable(tx + 0.5, tz + 0.5, 1)) count++;
        }
      }
      return count;
    },
    { x, z, width, height },
  );
  expect(blocked).toBe(0);
}

/** Resolves once the renderer drew each entity this frame (valid screen rect). */
async function waitForRender(page: Page, ids: number[]): Promise<void> {
  for (const id of ids) {
    await page.waitForFunction((entityId) => {
      const r = window.__bordev?.renderer?.getEntityScreenRect(entityId);
      return r !== undefined && r.right > r.left && r.bottom > r.top;
    }, id);
  }
}

/** Waits for `count` real animation frames, so GameSession has rendered the latest snapshot. */
async function nextFrames(page: Page, count = 2): Promise<void> {
  await page.evaluate(
    (n) =>
      new Promise<void>((resolve) => {
        let left = n;
        const step = () => {
          left--;
          if (left <= 0) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    count,
  );
}

async function canvasOrigin(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas[aria-label="Game view"]');
    const r = canvas?.getBoundingClientRect();
    return { x: r?.left ?? 0, y: r?.top ?? 0 };
  });
}

/** Renderer screen rect of an entity in page CSS px. */
async function entityRect(page: Page, id: number): Promise<PageRect> {
  const origin = await canvasOrigin(page);
  const rect = await page.evaluate((entityId) => {
    const r = window.__bordev?.renderer?.getEntityScreenRect(entityId);
    return r
      ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
      : null;
  }, id);
  if (!rect) throw new Error(`No screen rect for entity ${id}`);
  return {
    left: rect.left + origin.x,
    top: rect.top + origin.y,
    right: rect.right + origin.x,
    bottom: rect.bottom + origin.y,
  };
}

/** Integer screenshot clip around a page rect, clamped into the visible playfield. */
async function clipAround(
  page: Page,
  rect: PageRect,
  pad: number,
): Promise<Clip> {
  const field = await playfield(page);
  const left = Math.max(field.left, Math.floor(rect.left - pad));
  const top = Math.max(field.top, Math.floor(rect.top - pad));
  const right = Math.min(field.right, Math.ceil(rect.right + pad));
  const bottom = Math.min(field.bottom, Math.ceil(rect.bottom + pad));
  expect(right).toBeGreaterThan(left);
  expect(bottom).toBeGreaterThan(top);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Clip around a ground point where a unit-sized sprite (and its corpse) is drawn. */
async function clipAtGround(page: Page, x: number, z: number): Promise<Clip> {
  const p = await worldToScreen(page, x, z);
  return clipAround(
    page,
    { left: p.x - 40, right: p.x + 40, top: p.y - 80, bottom: p.y + 16 },
    0,
  );
}

interface CapturePhaseFilter {
  unitId: number;
  phase: 'attack' | 'rest';
}

async function capture(
  page: Page,
  clip: Clip,
  phase?: CapturePhaseFilter,
): Promise<Buffer> {
  const b64 = await page.evaluate(
    async ({ c, phaseOpt }: { c: Clip; phaseOpt?: CapturePhaseFilter }) => {
      const canvas = document.querySelector(
        'canvas[aria-label="Game view"]',
      ) as HTMLCanvasElement | null;
      const scene = window.__bordev?.renderer?.scene;
      if (!canvas) throw new Error('Game view canvas not found');
      if (!scene || scene.isDisposed) {
        throw new Error('Scene unavailable or disposed');
      }
      return new Promise<string>((resolve, reject) => {
        let done = false;
        const timeoutMs = phaseOpt ? 10_000 : 2_000;
        const observer = scene.onAfterRenderObservable.add(() => {
          if (done) return;
          try {
            if (phaseOpt) {
              const sim = window.__bordev?.sim;
              const world = sim?.world;
              if (!sim || !world) {
                throw new Error('Simulation or world unavailable');
              }
              const unit = world.getEntity(phaseOpt.unitId);
              if (!unit || unit.kind !== 'unit') {
                throw new Error(
                  `Unit ${phaseOpt.unitId} vanished or not a unit`,
                );
              }
              const tick = world.tick;
              if (phaseOpt.phase === 'attack') {
                const start = unit.combat?.attackStartedTick;
                if (start === undefined) return;
                const elapsed = tick - start;
                if (elapsed < 8 || elapsed > 11) return;
              } else {
                if (unit.combat?.attackStartedTick !== undefined) return;
                const cd = unit.attackCooldownUntilTick;
                if (cd === undefined) return;
                const untilNext = cd - tick;
                if (untilNext < 8 || untilNext > 16) return;
              }
            }

            done = true;
            clearTimeout(timer);
            scene.onAfterRenderObservable.remove(observer);

            const r = canvas.getBoundingClientRect();
            const scaleX = canvas.width / r.width;
            const scaleY = canvas.height / r.height;
            const sx = Math.max(0, (c.x - r.left) * scaleX);
            const sy = Math.max(0, (c.y - r.top) * scaleY);
            const sw = Math.min(canvas.width - sx, c.width * scaleX);
            const sh = Math.min(canvas.height - sy, c.height * scaleY);
            const crop = document.createElement('canvas');
            crop.width = Math.max(1, Math.round(sw));
            crop.height = Math.max(1, Math.round(sh));
            const ctx = crop.getContext('2d');
            if (!ctx) {
              throw new Error('Failed to get 2d context for crop canvas');
            }
            ctx.drawImage(
              canvas,
              sx,
              sy,
              sw,
              sh,
              0,
              0,
              crop.width,
              crop.height,
            );
            resolve(crop.toDataURL('image/png'));
          } catch (error) {
            done = true;
            clearTimeout(timer);
            scene.onAfterRenderObservable.remove(observer);
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
        const timer = window.setTimeout(() => {
          if (done) return;
          done = true;
          scene.onAfterRenderObservable.remove(observer);
          reject(
            new Error(
              `Capture timed out after ${timeoutMs}ms${
                phaseOpt
                  ? ` waiting for ${phaseOpt.phase} phase (unit ${phaseOpt.unitId})`
                  : ''
              }`,
            ),
          );
        }, timeoutMs);
      });
    },
    { c: clip, phaseOpt: phase },
  );
  const base64Data = b64.replace(/^data:image\/\w+;base64,/, '');
  return Buffer.from(base64Data, 'base64');
}

/**
 * Number of pixels whose colour differs between two same-sized screenshots, excluding an
 * optional clip-local rectangle (used to mask a unit standing in front of a building).
 */
async function countDifferingPixels(
  page: Page,
  a: Buffer,
  b: Buffer,
  ignore: Clip | null = null,
): Promise<number> {
  return page.evaluate(
    async ({ aB64, bB64, ignoreRect }) => {
      const decode = async (b64: string): Promise<ImageData> => {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const bitmap = await createImageBitmap(
          new Blob([bytes], { type: 'image/png' }),
        );
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('2D context unavailable');
        ctx.drawImage(bitmap, 0, 0);
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const [imgA, imgB] = await Promise.all([decode(aB64), decode(bB64)]);
      if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
        throw new Error('Screenshots differ in size');
      }
      let count = 0;
      for (let y = 0; y < imgA.height; y++) {
        for (let x = 0; x < imgA.width; x++) {
          if (
            ignoreRect &&
            x >= ignoreRect.x &&
            x < ignoreRect.x + ignoreRect.width &&
            y >= ignoreRect.y &&
            y < ignoreRect.y + ignoreRect.height
          ) {
            continue;
          }
          const i = (y * imgA.width + x) * 4;
          if (
            Math.abs(imgA.data[i] - imgB.data[i]) > 12 ||
            Math.abs(imgA.data[i + 1] - imgB.data[i + 1]) > 12 ||
            Math.abs(imgA.data[i + 2] - imgB.data[i + 2]) > 12
          ) {
            count++;
          }
        }
      }
      return count;
    },
    {
      aB64: a.toString('base64'),
      bB64: b.toString('base64'),
      ignoreRect: ignore,
    },
  );
}

/** Real mouse click on a screen point of the entity that the renderer's hit test resolves to it. */
async function clickEntity(
  page: Page,
  id: number,
  button: 'left' | 'right',
): Promise<{ x: number; y: number }> {
  const field = await playfield(page);
  const pt = await pickablePoint(page, id);
  expect(pt.x).toBeGreaterThan(field.left + 16);
  expect(pt.x).toBeLessThan(field.right - 16);
  expect(pt.y).toBeGreaterThanOrEqual(field.top);
  expect(pt.y).toBeLessThanOrEqual(field.bottom);
  await page.mouse.click(pt.x, pt.y, { button });
  return pt;
}

async function selectOnly(page: Page, id: number): Promise<void> {
  await clickEntity(page, id, 'left');
  await page.waitForFunction((entityId) => {
    const sel = window.__bordev?.session.input.selection.ids;
    return sel !== undefined && sel.length === 1 && sel[0] === entityId;
  }, id);
}

/** Real mouse click on a ground point inside the playfield, away from its edges. */
async function clickGround(
  page: Page,
  x: number,
  z: number,
  button: 'left' | 'right',
): Promise<void> {
  const field = await playfield(page);
  const pt = await worldToScreen(page, x, z);
  expect(pt.x).toBeGreaterThan(field.left + 24);
  expect(pt.x).toBeLessThan(field.right - 24);
  expect(pt.y).toBeGreaterThan(field.top + 8);
  expect(pt.y).toBeLessThan(field.bottom - 8);
  await page.mouse.click(pt.x, pt.y, { button });
}

/** Waits until the unit's current order has finished (no order or idle). */
async function waitUnitIdle(
  page: Page,
  id: number,
  timeout = 40_000,
): Promise<void> {
  await page.waitForFunction(
    (unitId) => {
      const u = window.__bordev?.sim?.world.getEntity(unitId);
      return !!u && u.kind === 'unit' && (!u.order || u.order.kind === 'idle');
    },
    id,
    { timeout },
  );
}

/** Installs a requestAnimationFrame sampler (runs after each real render) for the scenario. */
async function startProbe(
  page: Page,
  watch: { buildingId?: number; unitId?: number },
): Promise<void> {
  await page.evaluate(({ buildingId, unitId }) => {
    const probe: M7Probe = {
      buildingHp: [],
      unitHp: [],
      drawnStoneFrames: 0,
      drawnArrowFrames: 0,
      maxDrawnProjectiles: 0,
      firstStoneOriginDistance: null,
    };
    window.__m7Probe = probe;

    const sample = () => {
      const bordev = window.__bordev;
      const world = bordev?.sim?.world;
      if (world) {
        const drawn = bordev?.renderer?.projectiles?.count ?? 0;
        probe.maxDrawnProjectiles = Math.max(probe.maxDrawnProjectiles, drawn);

        const building =
          buildingId === undefined ? undefined : world.getEntity(buildingId);
        if (building && building.kind === 'building') {
          if (probe.buildingHp[probe.buildingHp.length - 1] !== building.hp) {
            probe.buildingHp.push(building.hp);
          }
        }
        const unit = unitId === undefined ? undefined : world.getEntity(unitId);
        if (unit && unit.kind === 'unit') {
          if (probe.unitHp[probe.unitHp.length - 1] !== unit.hp) {
            probe.unitHp.push(unit.hp);
          }
        }

        let stone = false;
        let arrow = false;
        for (const e of world.entities) {
          if (!e || e.kind !== 'projectile') continue;
          if (e.visualKind === 'stone') {
            stone = true;
            if (
              probe.firstStoneOriginDistance === null &&
              building &&
              building.kind === 'building'
            ) {
              const dx = Math.max(
                building.x - e.originX,
                0,
                e.originX - (building.x + building.width),
              );
              const dz = Math.max(
                building.z - e.originZ,
                0,
                e.originZ - (building.z + building.height),
              );
              probe.firstStoneOriginDistance = Math.hypot(dx, dz);
            }
          } else {
            arrow = true;
          }
        }
        if (drawn > 0 && stone) probe.drawnStoneFrames++;
        if (drawn > 0 && arrow) probe.drawnArrowFrames++;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, watch);
}

async function readProbe(page: Page): Promise<M7Probe> {
  return page.evaluate(() => {
    const probe = window.__m7Probe;
    if (!probe) throw new Error('Probe not installed');
    return JSON.parse(JSON.stringify(probe)) as M7Probe;
  });
}

/** Holds immobility checks for a unit that must be under a real hold order. */
async function expectHoldImmobile(page: Page, id: number): Promise<void> {
  await page.waitForFunction((unitId) => {
    const u = window.__bordev?.sim?.world.getEntity(unitId);
    return !!u && u.kind === 'unit' && u.order?.kind === 'hold';
  }, id);
  const readPos = () =>
    page.evaluate((unitId) => {
      const u = window.__bordev?.sim?.world.getEntity(unitId);
      if (!u || u.kind !== 'unit') throw new Error('Unit missing');
      return { x: u.x, z: u.z, order: u.order?.kind };
    }, id);
  const before = await readPos();
  await waitForTicks(page, 60);
  const after = await readPos();
  expect(after.order).toBe('hold');
  expect(after.x).toBe(before.x);
  expect(after.z).toBe(before.z);
}

test('1. real right-click enemy attack kills the peasant; the corpse stays drawn, is unselectable and is culled', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const { consoleErrors, pageErrors } = await bootFixture(page, {
    x: 70.5,
    z: 12.5,
  });

  // Enemy is 9.9 tiles from the knight: beyond its LOS 7 and the peasant's LOS 6, so no idle acquisition.
  const [knightId, enemyId] = await spawnUnits(page, [
    { player: 0, type: 'knight', x: 67, z: 16 },
    { player: 1, type: 'peasant', x: 74, z: 9 },
  ]);
  await waitForRender(page, [knightId, enemyId]);

  await selectOnly(page, knightId);
  const idle = await page.evaluate((id) => {
    const u = window.__bordev?.sim?.world.getEntity(id);
    return u && u.kind === 'unit'
      ? { order: u.order?.kind ?? 'idle', target: u.combat?.targetRef?.id }
      : null;
  }, knightId);
  expect(idle).toEqual({ order: 'idle', target: undefined });

  await clickEntity(page, enemyId, 'right');
  await page.waitForFunction(
    ({ k, e }) => {
      const u = window.__bordev?.sim?.world.getEntity(k);
      return (
        !!u &&
        u.kind === 'unit' &&
        u.order?.kind === 'attack' &&
        u.order.targetId === e
      );
    },
    { k: knightId, e: enemyId },
  );

  // Real-time combat: wait for the enemy to be removed from live entities and kept as remains.
  await page.waitForFunction(
    (e) => {
      const world = window.__bordev?.sim?.world;
      return (
        !!world &&
        world.getEntity(e) === undefined &&
        world.remains.some((r) => r.id === e && r.deathTick !== undefined)
      );
    },
    enemyId,
    { timeout: 60_000 },
  );

  const corpse = await page.evaluate((e) => {
    const world = window.__bordev?.sim?.world;
    const r = world?.remains.find((c) => c.id === e);
    if (!world || !r || r.kind !== 'unit') throw new Error('Corpse missing');
    return { x: r.x, z: r.z, deathTick: r.deathTick as number, hp: r.hp };
  }, enemyId);
  expect(corpse.hp).toBeLessThanOrEqual(0);

  // Move the knight (still selected) off the corpse by a real right-click on empty ground.
  await clickGround(page, corpse.x - 2, corpse.z + 2, 'right');
  await page.waitForFunction(
    ({ k, cx, cz }) => {
      const u = window.__bordev?.sim?.world.getEntity(k);
      return (
        !!u &&
        u.kind === 'unit' &&
        (!u.order || u.order.kind === 'idle') &&
        Math.hypot(u.x - cx, u.z - cz) > 2.5
      );
    },
    { k: knightId, cx: corpse.x, cz: corpse.z },
    { timeout: 30_000 },
  );

  // The corpse must still be drawn: clip around its real position, captured while it is fresh.
  const clip = await clipAtGround(page, corpse.x, corpse.z);
  await nextFrames(page, 2);
  const ticksSinceDeath = () =>
    page.evaluate(
      (d) => (window.__bordev?.sim?.world.tick ?? 0) - d,
      corpse.deathTick,
    );
  const ageBefore = await ticksSinceDeath();
  const withCorpse = await capture(page, clip);
  const ageAfter = await ticksSinceDeath();
  expect(ageBefore).toBeGreaterThanOrEqual(0);
  expect(ageAfter).toBeLessThan(160); // before the 8 s fade begins

  // Corpse cannot be picked or selected at its actual location.
  const origin = await canvasOrigin(page);
  const corpseScreen = await worldToScreen(page, corpse.x, corpse.z);
  const probePoint = { x: corpseScreen.x, y: corpseScreen.y - 20 };
  const picked = await page.evaluate(
    ({ x, y, e }) => ({
      picked: window.__bordev?.renderer?.pickEntity(x, y),
      rect: window.__bordev?.renderer?.getEntityScreenRect(e),
    }),
    { x: probePoint.x - origin.x, y: probePoint.y - origin.y, e: enemyId },
  );
  expect(picked.picked).not.toBe(enemyId);
  expect(picked.rect).toBeUndefined();
  await page.mouse.click(probePoint.x, probePoint.y, { button: 'left' });
  await page.waitForFunction(
    () => window.__bordev?.session.input.selection.ids.length === 0,
  );
  const selected = await page.evaluate(() => [
    ...(window.__bordev?.session.input.selection.ids ?? []),
  ]);
  expect(selected).not.toContain(enemyId);

  // Corpse lifetime ends: remains are culled and the drawn sprite is gone.
  await page.waitForFunction(
    (e) => !window.__bordev?.sim?.world.remains.some((r) => r.id === e),
    enemyId,
    { timeout: 40_000 },
  );
  await nextFrames(page, 3);
  const withoutCorpse = await capture(page, clip);
  expect(
    await countDifferingPixels(page, withCorpse, withoutCorpse),
  ).toBeGreaterThan(MIN_FRAME_DIFF_PIXELS);

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('2. a melee swing renders a distinct attack frame from rest frames', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const { consoleErrors, pageErrors } = await bootFixture(page, {
    x: 71,
    z: 12.5,
  });

  // 8.5 tiles to the cottage footprint: beyond the knight's LOS 7, so only the click starts the fight.
  await expectFootprintPassable(page, 74, 8, 2, 2);
  const cottageId = await spawnBuilding(page, {
    player: 1,
    type: 'cottage',
    x: 74,
    z: 8,
  });
  const [knightId] = await spawnUnits(page, [
    { player: 0, type: 'knight', x: 67.5, z: 15.5 },
  ]);
  await waitForRender(page, [knightId, cottageId]);

  await selectOnly(page, knightId);
  await clickEntity(page, cottageId, 'right');
  await page.waitForFunction(
    ({ k, c }) => {
      const u = window.__bordev?.sim?.world.getEntity(k);
      return (
        !!u &&
        u.kind === 'unit' &&
        u.order?.kind === 'attack' &&
        u.order.targetId === c
      );
    },
    { k: knightId, c: cottageId },
  );

  // Wait for the first real swing so the knight stands in its contact position.
  await page.waitForFunction(
    (k) => {
      const u = window.__bordev?.sim?.world.getEntity(k);
      return (
        !!u && u.kind === 'unit' && u.combat?.attackStartedTick !== undefined
      );
    },
    knightId,
    { timeout: 60_000 },
  );
  const knightClip = await clipAround(
    page,
    await entityRect(page, knightId),
    40,
  );

  const attackShots: Buffer[] = [];
  const restShots: Buffer[] = [];

  for (let i = 0; i < 2; i++) {
    attackShots.push(
      await capture(page, knightClip, { unitId: knightId, phase: 'attack' }),
    );
    restShots.push(
      await capture(page, knightClip, { unitId: knightId, phase: 'rest' }),
    );
  }
  expect(attackShots.length).toBe(2);
  expect(restShots.length).toBe(2);

  const restSpread = await countDifferingPixels(
    page,
    restShots[0],
    restShots[1],
  );
  for (const attack of attackShots) {
    for (const rest of restShots) {
      const diff = await countDifferingPixels(page, attack, rest);
      expect(diff).toBeGreaterThan(MIN_FRAME_DIFF_PIXELS);
      expect(diff).toBeGreaterThan(restSpread);
    }
  }

  const cottageHp = await page.evaluate((c) => {
    const b = window.__bordev?.sim?.world.getEntity(c);
    return b && b.kind === 'building' ? { hp: b.hp, maxHp: b.maxHp } : null;
  }, cottageId);
  expect(cottageHp).not.toBeNull();
  expect(cottageHp!.hp).toBeLessThan(cottageHp!.maxHp);

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('3. command-card Attack-Move engages an enemy en route, resumes, then command-card Hold is immobile', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const { consoleErrors, pageErrors } = await bootFixture(page, {
    x: 70.5,
    z: 12.5,
  });

  // Enemy is 7.8 tiles from the knight: beyond LOS 7 until the attack-move walks it into range.
  const [knightId, enemyId] = await spawnUnits(page, [
    { player: 0, type: 'knight', x: 67.5, z: 15.5 },
    { player: 1, type: 'peasant', x: 73, z: 10 },
  ]);
  await waitForRender(page, [knightId, enemyId]);
  await selectOnly(page, knightId);

  const attackMoveCard = page.getByTestId('command-attack-move');
  await expect(attackMoveCard).toBeVisible();
  await expect(attackMoveCard).not.toHaveAttribute('aria-disabled', 'true');
  await attackMoveCard.click();
  await expect(attackMoveCard).toHaveClass(/active/);
  expect(
    await page.evaluate(() => window.__bordev?.session.input.orders.mode),
  ).toBe('attackMove');

  const dest = { x: 75.5, z: 7.5 };
  await clickGround(page, dest.x, dest.z, 'left');
  await page.waitForFunction(
    ({ k, dx, dz }) => {
      const u = window.__bordev?.sim?.world.getEntity(k);
      return (
        !!u &&
        u.kind === 'unit' &&
        u.order?.kind === 'attackMove' &&
        Math.hypot((u.order.x ?? 1e9) - dx, (u.order.z ?? 1e9) - dz) < 0.75
      );
    },
    { k: knightId, dx: dest.x, dz: dest.z },
  );
  expect(
    await page.evaluate(() => window.__bordev?.session.input.orders.mode),
  ).toBeNull();

  // Auto-acquires and kills the enemy on the way ...
  await page.waitForFunction(
    (e) => {
      const world = window.__bordev?.sim?.world;
      return (
        !!world &&
        world.getEntity(e) === undefined &&
        world.remains.some((r) => r.id === e && r.deathTick !== undefined)
      );
    },
    enemyId,
    { timeout: 60_000 },
  );
  // ... and then resumes the attack-move to its destination.
  await page.waitForFunction(
    ({ k, dx, dz }) => {
      const u = window.__bordev?.sim?.world.getEntity(k);
      return (
        !!u &&
        u.kind === 'unit' &&
        (!u.order || u.order.kind === 'idle') &&
        Math.hypot(u.x - dx, u.z - dz) < 1.5
      );
    },
    { k: knightId, dx: dest.x, dz: dest.z },
    { timeout: 60_000 },
  );

  const holdCard = page.getByTestId('command-hold');
  await expect(holdCard).toBeVisible();
  await expect(holdCard).not.toHaveAttribute('aria-disabled', 'true');
  await holdCard.click();
  await expectHoldImmobile(page, knightId);

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('4. hotkey R attack-move and hotkey E hold give exact immobility', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { consoleErrors, pageErrors } = await bootFixture(page, {
    x: 70.5,
    z: 12.5,
  });

  const [spearmanId] = await spawnUnits(page, [
    { player: 0, type: 'spearman', x: 67.5, z: 15.5 },
  ]);
  await waitForRender(page, [spearmanId]);
  await selectOnly(page, spearmanId);

  await page.keyboard.press('KeyR');
  await page.waitForFunction(
    () => window.__bordev?.session.input.orders.mode === 'attackMove',
  );

  const dest = { x: 75.5, z: 7.5 };
  await clickGround(page, dest.x, dest.z, 'left');
  await page.waitForFunction(
    ({ s, dx, dz }) => {
      const u = window.__bordev?.sim?.world.getEntity(s);
      return (
        !!u &&
        u.kind === 'unit' &&
        u.order?.kind === 'attackMove' &&
        Math.hypot((u.order.x ?? 1e9) - dx, (u.order.z ?? 1e9) - dz) < 0.75
      );
    },
    { s: spearmanId, dx: dest.x, dz: dest.z },
  );

  // Let it really travel before holding, so hold must stop actual motion.
  await page.waitForFunction((s) => {
    const u = window.__bordev?.sim?.world.getEntity(s);
    return !!u && u.kind === 'unit' && Math.hypot(u.x - 67.5, u.z - 15.5) > 1;
  }, spearmanId);
  await page.keyboard.press('KeyE');
  await expectHoldImmobile(page, spearmanId);

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('5. trebuchet from outside tower range: stone projectiles are drawn; tower 1000/550/100/dead with damaged and rubble frames', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const { consoleErrors, pageErrors } = await bootFixture(page, {
    x: 70.5,
    z: 12.5,
  });

  // Footprint distance 13.4: beyond trebuchet acquisition (12) so only the click starts the attack,
  // and it must close to <= 12 while staying outside the tower's range 7.
  await expectFootprintPassable(page, 75, 7, 1, 1);
  const towerId = await spawnBuilding(page, {
    player: 1,
    type: 'stone_tower',
    x: 75,
    z: 7,
  });
  const [trebId] = await spawnUnits(page, [
    { player: 0, type: 'trebuchet', x: 65.5, z: 17.5 },
  ]);
  await waitForRender(page, [trebId, towerId]);

  const blockedBefore = await page.evaluate(
    () => !window.__bordev?.sim?.world.grid.isPassable(75.5, 7.5, 0),
  );
  expect(blockedBefore).toBe(true);

  // Alive tower baseline (and a determinism guard for the clip).
  const towerClip = await clipAround(page, await entityRect(page, towerId), 6);
  await nextFrames(page, 2);
  const alive = await capture(page, towerClip);
  expect(
    await countDifferingPixels(page, alive, await capture(page, towerClip)),
  ).toBe(0);

  await startProbe(page, { buildingId: towerId });
  await selectOnly(page, trebId);
  await clickEntity(page, towerId, 'right');
  await page.waitForFunction(
    ({ t, tower }) => {
      const u = window.__bordev?.sim?.world.getEntity(t);
      return (
        !!u &&
        u.kind === 'unit' &&
        u.order?.kind === 'attack' &&
        u.order.targetId === tower
      );
    },
    { t: trebId, tower: towerId },
  );

  // Damaged frame at 100 HP (after two 450-damage hits, before the third).
  await page.waitForFunction(
    (tower) => {
      const b = window.__bordev?.sim?.world.getEntity(tower);
      return !!b && b.kind === 'building' && b.hp === 100;
    },
    towerId,
    { timeout: 120_000 },
  );
  await nextFrames(page, 3);
  const damaged = await capture(page, towerClip);
  const hpAfterDamagedShot = await page.evaluate((tower) => {
    const b = window.__bordev?.sim?.world.getEntity(tower);
    return b && b.kind === 'building' ? b.hp : null;
  }, towerId);
  expect(hpAfterDamagedShot).toBe(100);
  expect(await countDifferingPixels(page, alive, damaged)).toBeGreaterThan(
    MIN_FRAME_DIFF_PIXELS,
  );

  // Third hit destroys it: rubble in remains, footprint cleared, rubble frame drawn.
  await page.waitForFunction(
    (tower) => {
      const world = window.__bordev?.sim?.world;
      return (
        !!world &&
        world.getEntity(tower) === undefined &&
        world.remains.some(
          (r) =>
            r.id === tower &&
            r.kind === 'building' &&
            r.deathTick !== undefined,
        )
      );
    },
    towerId,
    { timeout: 120_000 },
  );
  const rubble = await page.evaluate((tower) => {
    const world = window.__bordev?.sim?.world;
    const r = world?.remains.find((c) => c.id === tower);
    if (!world || !r) throw new Error('Rubble missing');
    return {
      hp: r.hp,
      deathTick: r.deathTick as number,
      tick: world.tick,
      passable:
        world.grid.isPassable(75.5, 7.5, 0) &&
        world.grid.isPassable(75.5, 7.5, 1),
    };
  }, towerId);
  expect(rubble.hp).toBe(0);
  expect(rubble.passable).toBe(true);
  expect(rubble.tick - rubble.deathTick).toBeLessThan(300); // before the rubble fade

  await nextFrames(page, 3);
  const rubbleShot = await capture(page, towerClip);
  const rubbleAge = await page.evaluate(
    (d) => (window.__bordev?.sim?.world.tick ?? 0) - d,
    rubble.deathTick,
  );
  expect(rubbleAge).toBeLessThan(340);
  expect(await countDifferingPixels(page, alive, rubbleShot)).toBeGreaterThan(
    MIN_FRAME_DIFF_PIXELS,
  );
  expect(await countDifferingPixels(page, damaged, rubbleShot)).toBeGreaterThan(
    MIN_FRAME_DIFF_PIXELS,
  );

  // Rubble is culled after its lifetime: the rubble sprite disappears from the frame.
  await page.waitForFunction(
    (tower) => !window.__bordev?.sim?.world.remains.some((r) => r.id === tower),
    towerId,
    { timeout: 40_000 },
  );
  await nextFrames(page, 3);
  const cleared = await capture(page, towerClip);
  expect(await countDifferingPixels(page, rubbleShot, cleared)).toBeGreaterThan(
    MIN_FRAME_DIFF_PIXELS,
  );

  const probe = await readProbe(page);
  expect(probe.buildingHp).toEqual([1000, 550, 100]);
  expect(probe.drawnStoneFrames).toBeGreaterThan(0);
  expect(probe.maxDrawnProjectiles).toBeGreaterThan(0);
  expect(probe.firstStoneOriginDistance).not.toBeNull();
  expect(probe.firstStoneOriginDistance!).toBeGreaterThan(7);
  expect(probe.firstStoneOriginDistance!).toBeLessThanOrEqual(12.5);

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('6. an enemy tower fires visible arrows at a peasant sent into its range', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const { consoleErrors, pageErrors } = await bootFixture(page, {
    x: 70.5,
    z: 12.5,
  });

  await expectFootprintPassable(page, 75, 7, 1, 1);
  const towerId = await spawnBuilding(page, {
    player: 1,
    type: 'stone_tower',
    x: 75,
    z: 7,
  });
  const [peasantId] = await spawnUnits(page, [
    { player: 0, type: 'peasant', x: 65.5, z: 17.5 },
  ]);
  await waitForRender(page, [peasantId, towerId]);

  await startProbe(page, { unitId: peasantId });
  await selectOnly(page, peasantId);
  // Real move click 3.9 tiles from the tower footprint, inside its range 7.
  await clickGround(page, 72, 10.5, 'right');

  await page.waitForFunction(
    () => {
      const world = window.__bordev?.sim?.world;
      return (
        !!world &&
        world.entities.some(
          (e) => !!e && e.kind === 'projectile' && e.visualKind === 'arrow',
        )
      );
    },
    undefined,
    { timeout: 90_000 },
  );
  await page.waitForFunction(
    () => (window.__bordev?.renderer?.projectiles?.count ?? 0) > 0,
    undefined,
    { timeout: 30_000 },
  );

  await page.waitForFunction(
    (p) => {
      const u = window.__bordev?.sim?.world.getEntity(p);
      return u === undefined || (u.kind === 'unit' && u.hp < u.maxHp);
    },
    peasantId,
    { timeout: 60_000 },
  );

  const probe = await readProbe(page);
  expect(probe.drawnArrowFrames).toBeGreaterThan(0);
  expect(probe.maxDrawnProjectiles).toBeGreaterThan(0);

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('7. gate renders the open frame for a friendly unit within 1 tile and the closed frame once clear', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { consoleErrors, pageErrors } = await bootFixture(page, {
    x: 71.5,
    z: 14.5,
  });

  await expectFootprintPassable(page, 70, 12, 3, 1);
  const gateId = await spawnBuilding(page, {
    player: 0,
    type: 'stone_gate',
    x: 70,
    z: 12,
  });
  const [peasantId] = await spawnUnits(page, [
    { player: 0, type: 'peasant', x: 71.5, z: 18 },
  ]);
  await waitForRender(page, [gateId, peasantId]);

  const gateOpen = () =>
    page.evaluate((g) => {
      const b = window.__bordev?.sim?.world.getEntity(g);
      return !!b && b.kind === 'building' && b.gateOpen === true;
    }, gateId);
  expect(await gateOpen()).toBe(false);

  const gateClip = await clipAround(page, await entityRect(page, gateId), 24);
  await nextFrames(page, 2);
  const closedBefore = await capture(page, gateClip);
  expect(
    await countDifferingPixels(
      page,
      closedBefore,
      await capture(page, gateClip),
    ),
  ).toBe(0);

  // Real orders: walk the peasant to 0.6 tiles from the footprint.
  await selectOnly(page, peasantId);
  await clickGround(page, 71.5, 13.6, 'right');
  await page.waitForFunction(
    (g) => {
      const b = window.__bordev?.sim?.world.getEntity(g);
      return !!b && b.kind === 'building' && b.gateOpen === true;
    },
    gateId,
    { timeout: 30_000 },
  );
  await waitUnitIdle(page, peasantId);
  expect(await gateOpen()).toBe(true);

  // Deselect (no ring) through a real ground click, then capture the open frame.
  await clickGround(page, 63, 14.5, 'left');
  await page.waitForFunction(
    () => window.__bordev?.session.input.selection.ids.length === 0,
  );
  await nextFrames(page, 3);
  const openShot = await capture(page, gateClip);
  expect(await gateOpen()).toBe(true);
  const peasantRect = await entityRect(page, peasantId);
  const peasantMask: Clip = {
    x: Math.floor(peasantRect.left - 24 - gateClip.x),
    y: Math.floor(peasantRect.top - 24 - gateClip.y),
    width: Math.ceil(peasantRect.right - peasantRect.left + 48),
    height: Math.ceil(peasantRect.bottom - peasantRect.top + 48),
  };
  expect(
    await countDifferingPixels(page, closedBefore, openShot, peasantMask),
  ).toBeGreaterThan(MIN_FRAME_DIFF_PIXELS);

  // Walk the peasant away by real orders: the gate closes and the closed frame returns exactly.
  await selectOnly(page, peasantId);
  await clickGround(page, 71.5, 19, 'right');
  await page.waitForFunction(
    (g) => {
      const b = window.__bordev?.sim?.world.getEntity(g);
      return !!b && b.kind === 'building' && b.gateOpen === false;
    },
    gateId,
    { timeout: 30_000 },
  );
  await waitUnitIdle(page, peasantId);
  await clickGround(page, 63, 14.5, 'left');
  await page.waitForFunction(
    () => window.__bordev?.session.input.selection.ids.length === 0,
  );
  await nextFrames(page, 3);
  const closedAfter = await capture(page, gateClip);
  expect(await gateOpen()).toBe(false);
  const farRect = await entityRect(page, peasantId);
  expect(
    farRect.bottom < gateClip.y ||
      farRect.top > gateClip.y + gateClip.height ||
      farRect.right < gateClip.x ||
      farRect.left > gateClip.x + gateClip.width,
  ).toBe(true);
  expect(await countDifferingPixels(page, closedBefore, closedAfter)).toBe(0);

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
