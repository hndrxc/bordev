import { expect, test } from '@playwright/test';

test('boots a full-window game canvas without browser errors', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');

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

  // Sample during animation frames, before the browser discards the WebGL
  // drawing buffer. An untouched canvas is transparent; M0 renders an opaque clear.
  await page.waitForFunction(
    () => {
      const gameCanvas = document.querySelector<HTMLCanvasElement>(
        'canvas[aria-label="Game view"]',
      );
      if (!gameCanvas || gameCanvas.width === 0 || gameCanvas.height === 0)
        return false;

      const sample = document.createElement('canvas');
      sample.width = 1;
      sample.height = 1;
      const context = sample.getContext('2d');
      if (!context)
        throw new Error('Could not create a canvas sampling context');
      context.drawImage(gameCanvas, 0, 0, 1, 1);
      return context.getImageData(0, 0, 1, 1).data[3] === 255;
    },
    undefined,
    { polling: 'raf' },
  );

  // Only query WebGL after observing a rendered frame, so the test cannot
  // initialize a context on an otherwise unused canvas and claim boot succeeded.
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
