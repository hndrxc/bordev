import { expect, test } from '@playwright/test';
import type { GameSession, SessionStats } from '../../src/game/GameSession';

test('boots a full-window game canvas without browser errors', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/?debug=1');

  const canvas = page.getByLabel('Game view', { exact: true });
  await expect(canvas).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'bordev', exact: true }),
  ).toBeVisible();
  await expect(canvas).toHaveJSProperty('tagName', 'CANVAS');
  await expect(canvas).toHaveCount(1);

  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  await expect
    .poll(() => canvas.boundingBox())
    .toEqual({
      x: 0,
      y: 0,
      width: viewport!.width,
      height: viewport!.height,
    });

  await page.waitForFunction(() => {
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
      stats.renderer?.isReady === true
    );
  });

  const hasWebGL = await canvas.evaluate((element: HTMLCanvasElement) => {
    const context = element.getContext('webgl2') ?? element.getContext('webgl');
    return context !== null && !context.isContextLost();
  });
  expect(hasWebGL).toBe(true);
  expect(consoleErrors, 'console errors during boot and first render').toEqual(
    [],
  );
  expect(
    pageErrors,
    'uncaught page errors during boot and first render',
  ).toEqual([]);
});
