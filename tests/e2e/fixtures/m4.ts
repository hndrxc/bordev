import { expect, type Page } from '@playwright/test';
import type { GameSession, SessionStats } from '../../../src/game/GameSession';

export interface SetupResult {
  consoleErrors: string[];
  pageErrors: string[];
}

export interface Clip {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface CapturePhaseFilter {
  unitId: number;
  phase: 'attack' | 'rest';
}

/**
 * Concise boot and readiness helper for M4 browser fixtures.
 * Navigates to /?debug=1 and waits for loaded world + HUD.
 */
export async function setupM4Session(
  page: Page,
  options?: { centerOn?: { x: number; z: number } },
): Promise<SetupResult> {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  await page.goto('/?debug=1');

  const canvas = page.getByLabel('Game view', { exact: true });
  await expect(canvas).toBeVisible();

  await page.waitForFunction(
    () => {
      const bordev = window.__bordev;
      if (!bordev) return false;

      const session: GameSession = bordev.session;
      if (session.loadError) {
        throw new Error(`Game session failed to load: ${session.loadError}`);
      }

      const stats: SessionStats = bordev.stats();
      if (stats.loadError) {
        throw new Error(`Game session failed to load: ${stats.loadError}`);
      }

      return (
        session.isLoaded &&
        stats.isLoaded &&
        stats.renderer?.isReady === true &&
        session.sim !== null &&
        session.input !== undefined &&
        bordev.cheats !== undefined
      );
    },
    undefined,
    { timeout: 30_000 },
  );

  const center = options?.centerOn ?? { x: 60, z: 60 };
  await page.evaluate(
    ({ cx, cz }) => {
      const cam = window.__bordev?.session.renderer.camera;
      if (!cam) throw new Error('Renderer camera is not available');
      cam.centerOn(cx, cz);
    },
    { cx: center.x, cz: center.z },
  );

  await expect(page.getByTestId('hud-topbar')).toBeVisible();

  return { consoleErrors, pageErrors };
}

/**
 * Project world tile coordinate to current renderer screen position (CSS px relative to page).
 */
export async function worldToScreen(
  page: Page,
  x: number,
  z: number,
): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ({ tx, tz }) => {
      const cam = window.__bordev?.session.renderer.camera;
      if (!cam) throw new Error('Renderer camera is not available');
      const canvas = document.querySelector('canvas[aria-label="Game view"]');
      const rect = canvas?.getBoundingClientRect();
      const offsetX = rect?.left ?? 0;
      const offsetY = rect?.top ?? 0;
      const dx = tx - cam.view.targetX;
      const dz = tz - cam.view.targetZ;
      return {
        x: offsetX + cam.view.width * 0.5 + (dx - dz) * 48 * cam.view.zoom,
        y: offsetY + cam.view.height * 0.5 + (dx + dz) * 24 * cam.view.zoom,
      };
    },
    { tx: x, tz: z },
  );
}

/**
 * Wait until __bordev.sim.world.tick advances by the specified number of ticks from call time.
 */
export async function waitForTicks(page: Page, ticks: number): Promise<void> {
  const startTick = await page.evaluate(() => {
    const sim = window.__bordev?.sim;
    if (!sim) throw new Error('Simulation not initialized');
    return sim.world.tick;
  });
  await page.waitForFunction((target) => {
    const sim = window.__bordev?.sim;
    if (!sim) return false;
    return sim.world.tick >= target;
  }, startTick + ticks, { timeout: 10_000 });
}

/**
 * Return unobscured playfield band in page CSS px from hud-topbar bottom and hud-bottom-bar top.
 */
export async function playfield(
  page: Page,
): Promise<{ top: number; bottom: number; left: number; right: number }> {
  return page.evaluate(() => {
    const topBar =
      document.querySelector('[data-testid="hud-topbar"]') ??
      document.querySelector('.hud-topbar');
    const bottomBar =
      document.querySelector('[data-testid="hud-bottom-bar"]') ??
      document.querySelector('.hud-bottom-bar');
    const canvas = document.querySelector('canvas[aria-label="Game view"]');

    if (!topBar) throw new Error('HUD topbar not found');
    if (!bottomBar) throw new Error('HUD bottom bar not found');

    const topRect = topBar.getBoundingClientRect();
    const bottomRect = bottomBar.getBoundingClientRect();
    const canvasRect = canvas?.getBoundingClientRect();

    return {
      top: topRect.bottom,
      bottom: bottomRect.top,
      left: canvasRect ? canvasRect.left : 0,
      right: canvasRect ? canvasRect.right : window.innerWidth,
    };
  });
}

/**
 * Find a screen point within an entity's bounding rect where pickEntity unambiguously resolves to `id`.
 * Samples a 7x7 grid across the inner 80% of the screen rect to avoid walker overlap and edge clipping.
 */
export async function pickablePoint(
  page: Page,
  id: number,
): Promise<{ x: number; y: number }> {
  return page.evaluate((targetId) => {
    const renderer = window.__bordev?.renderer;
    if (!renderer) throw new Error('Renderer missing');
    const rect = renderer.getEntityScreenRect(targetId);
    if (!rect) throw new Error(`Screen rect missing for entity ${targetId}`);

    const canvas = document.querySelector('canvas[aria-label="Game view"]');
    const canvasRect = canvas?.getBoundingClientRect();
    const offsetX = canvasRect?.left ?? 0;
    const offsetY = canvasRect?.top ?? 0;

    const w = rect.right - rect.left;
    const h = rect.bottom - rect.top;
    const minX = rect.left + w * 0.1;
    const maxX = rect.right - w * 0.1;
    const minY = rect.top + h * 0.1;
    const maxY = rect.bottom - h * 0.1;

    const steps = 7;
    for (let iy = 0; iy < steps; iy++) {
      const y = minY + (maxY - minY) * (iy / (steps - 1));
      for (let ix = 0; ix < steps; ix++) {
        const x = minX + (maxX - minX) * (ix / (steps - 1));
        const picked = renderer.pickEntity(x, y);
        if (picked === targetId) {
          return { x: offsetX + x, y: offsetY + y };
        }
      }
    }

    throw new Error(
      `No unobstructed pick point found on entity ${targetId} (${w}x${h} px rect)`,
    );
  }, id);
}

/**
 * Delivers a physical Digit1 double tap through the browser input pipeline (CDP
 * Input.dispatchKeyEvent). Each event carries an explicit epoch timestamp, so its
 * DOM `event.timeStamp` models the physical creation time and stays 50 ms apart
 * no matter how long the page's render/event queue delays handling under load.
 */
export async function trustedDigit1DoubleTap(
  page: Page,
  digit: number = 1,
): Promise<void> {
  const session = await page.context().newCDPSession(page);
  try {
    const startSeconds = Date.now() / 1000;
    const char = String(digit);
    const code = `Digit${digit}`;
    const keyCode = 48 + digit;
    const events = [
      { type: 'keyDown', text: char, unmodifiedText: char },
      { type: 'keyUp' },
      { type: 'keyDown', text: char, unmodifiedText: char },
      { type: 'keyUp' },
    ] as const;
    for (const [index, event] of events.entries()) {
      await session.send('Input.dispatchKeyEvent', {
        ...event,
        key: char,
        code,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode,
        timestamp: startSeconds + index * 0.05,
      });
    }
  } finally {
    await session.detach();
  }
}

/**
 * Removes debug walkers through the ids recorded by the debug scene,
 * asserting they are present and fully removed, and stops autonomous
 * starting carts so economy and pop cap are uncluttered.
 */
export async function clearDebugWalkers(page: Page): Promise<void> {
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
    for (const ent of world.entities) {
      if (
        ent &&
        ent.kind === 'unit' &&
        ent.player === 0 &&
        ent.type === 'ox_cart'
      ) {
        window.__bordev?.sim?.issue({ kind: 'stop', player: 0, ids: [ent.id] });
      }
    }
    return { listed: probes.allDebugUnitIds.length, removed };
  });
  expect(removal.listed).toBeGreaterThan(0);
  expect(removal.removed).toBe(removal.listed);
  await waitForTicks(page, 2);
}

/** Resolves once the renderer drew each entity this frame (valid screen rect). */
export async function waitForRender(
  page: Page,
  ids: number[],
  timeout = 10_000,
): Promise<void> {
  for (const id of ids) {
    await page.waitForFunction(
      (entityId) => {
        const r = window.__bordev?.renderer?.getEntityScreenRect(entityId);
        return r !== undefined && r.right > r.left && r.bottom > r.top;
      },
      id,
      { timeout },
    );
  }
}

/** Waits for `count` real animation frames, so GameSession has rendered the latest snapshot. */
export async function nextFrames(page: Page, count = 2): Promise<void> {
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

export async function canvasOrigin(
  page: Page,
): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas[aria-label="Game view"]');
    const r = canvas?.getBoundingClientRect();
    return { x: r?.left ?? 0, y: r?.top ?? 0 };
  });
}

/** Renderer screen rect of an entity in page CSS px. */
export async function entityRect(page: Page, id: number): Promise<PageRect> {
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
export async function clipAround(
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
export async function clipAtGround(
  page: Page,
  x: number,
  z: number,
): Promise<Clip> {
  const p = await worldToScreen(page, x, z);
  return clipAround(
    page,
    { left: p.x - 40, right: p.x + 40, top: p.y - 80, bottom: p.y + 16 },
    0,
  );
}

export async function capture(
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
        const timeoutMs = phaseOpt ? 30_000 : 5_000;
        const observer = scene.onAfterRenderObservable.add(() => {
          if (done) return;
          try {
            if (phaseOpt) {
              const world = window.__bordev?.sim?.world;
              if (!world) throw new Error('Simulation or world unavailable');
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
export async function countDifferingPixels(
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
export async function clickEntity(
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

export async function selectOnly(
  page: Page,
  id: number,
  timeout = 10_000,
): Promise<void> {
  await clickEntity(page, id, 'left');
  await page.waitForFunction(
    (entityId) => {
      const sel = window.__bordev?.session.input.selection.ids;
      return sel !== undefined && sel.length === 1 && sel[0] === entityId;
    },
    id,
    { timeout },
  );
}

/** Real mouse click on a ground point inside the playfield, away from its edges. */
export async function clickGround(
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

export interface DynamicCaptureResult {
  image: Buffer;
  clip: Clip;
}

/**
 * Captures an in-flight projectile by computing its screen projection from its
 * actual rendered/world position in the post-render callback, returning the screenshot
 * and the exact Clip used so the same clip can be captured later for baseline diffing.
 */
export async function captureInFlightProjectile(
  page: Page,
  projectileKind: 'stone' | 'arrow',
  pad = 36,
): Promise<DynamicCaptureResult> {
  const result = await page.evaluate(
    async ({ kind, padPx }) => {
      const canvas = document.querySelector(
        'canvas[aria-label="Game view"]',
      ) as HTMLCanvasElement | null;
      const scene = window.__bordev?.renderer?.scene;
      if (!canvas) throw new Error('Game view canvas not found');
      if (!scene || scene.isDisposed) {
        throw new Error('Scene unavailable or disposed');
      }

      return new Promise<{ b64: string; clip: Clip }>((resolve, reject) => {
        let done = false;
        const timeoutMs = 30_000;
        const observer = scene.onAfterRenderObservable.add(() => {
          if (done) return;
          try {
            const bordev = window.__bordev;
            const sim = bordev?.sim;
            const world = sim?.world;
            const cam = bordev?.session.renderer.camera;
            if (!world || !cam) return;

            // Gate on an in-flight projectile of the requested kind in the middle of its flight
            const inWindow = world.entities.some(
              (e) =>
                !!e &&
                e.kind === 'projectile' &&
                e.visualKind === kind &&
                e.flightProgress >= 0.3 &&
                e.flightProgress <= 0.7,
            );
            if (!inWindow) return;

            // The drawn instance translation (matrix entries 12-14) of the first instance in the kind's pool
            const projRenderer = bordev?.session.renderer
              ?.projectiles as unknown as
              | {
                  arrowPool: { getBuffer(name: string): Float32Array };
                  stonePool: { getBuffer(name: string): Float32Array };
                  activeArrows: number;
                  activeStones: number;
                }
              | undefined;
            if (!projRenderer) return;
            const isStone = kind === 'stone';
            const active = isStone
              ? projRenderer.activeStones
              : projRenderer.activeArrows;
            if (active < 1) return;
            const matrix = (
              isStone ? projRenderer.stonePool : projRenderer.arrowPool
            ).getBuffer('matrix');
            const wx = matrix[12];
            const wy = matrix[13];
            const wz = matrix[14];

            const view = cam.view;
            const dx = wx - view.targetX;
            const dz = wz - view.targetZ;
            const screenX = view.width * 0.5 + (dx - dz) * 48 * view.zoom;
            const screenY =
              view.height * 0.5 +
              (dx + dz) * 24 * view.zoom -
              wy * 48 * Math.sqrt(1.5) * view.zoom;

            const r = canvas.getBoundingClientRect();
            const pageX = r.left + screenX;
            const pageY = r.top + screenY;

            // Accept the frame only when the whole clip lies inside the unobscured playfield
            const topBar =
              document.querySelector('[data-testid="hud-topbar"]') ??
              document.querySelector('.hud-topbar');
            const bottomBar =
              document.querySelector('[data-testid="hud-bottom-bar"]') ??
              document.querySelector('.hud-bottom-bar');
            if (!topBar || !bottomBar) {
              throw new Error('HUD bars not found');
            }
            const fieldTop = topBar.getBoundingClientRect().bottom;
            const fieldBottom = bottomBar.getBoundingClientRect().top;
            const clip: Clip = {
              x: Math.floor(pageX - padPx),
              y: Math.floor(pageY - padPx),
              width: padPx * 2,
              height: padPx * 2,
            };
            if (
              clip.x < r.left ||
              clip.x + clip.width > r.right ||
              clip.y < fieldTop ||
              clip.y + clip.height > fieldBottom
            ) {
              return;
            }

            done = true;
            clearTimeout(timer);
            scene.onAfterRenderObservable.remove(observer);

            const scaleX = canvas.width / r.width;
            const scaleY = canvas.height / r.height;
            const sx = Math.max(0, (clip.x - r.left) * scaleX);
            const sy = Math.max(0, (clip.y - r.top) * scaleY);
            const sw = Math.min(canvas.width - sx, clip.width * scaleX);
            const sh = Math.min(canvas.height - sy, clip.height * scaleY);
            const crop = document.createElement('canvas');
            crop.width = Math.max(1, Math.round(sw));
            crop.height = Math.max(1, Math.round(sh));
            const ctx = crop.getContext('2d');
            if (!ctx) throw new Error('2D context unavailable');
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
            resolve({ b64: crop.toDataURL('image/png'), clip });
          } catch (err) {
            done = true;
            clearTimeout(timer);
            scene.onAfterRenderObservable.remove(observer);
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
        const timer = window.setTimeout(() => {
          if (done) return;
          done = true;
          scene.onAfterRenderObservable.remove(observer);
          reject(
            new Error(
              `Dynamic projectile capture timed out waiting for in-flight ${kind}`,
            ),
          );
        }, timeoutMs);
      });
    },
    { kind: projectileKind, padPx: pad },
  );

  const base64Data = result.b64.replace(/^data:image\/\w+;base64,/, '');
  return { image: Buffer.from(base64Data, 'base64'), clip: result.clip };
}
