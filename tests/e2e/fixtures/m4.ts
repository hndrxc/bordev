import { expect, type Page } from '@playwright/test';
import type { GameSession, SessionStats } from '../../../src/game/GameSession';

export interface SetupResult {
  consoleErrors: string[];
  pageErrors: string[];
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
  }, startTick + ticks);
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
