import { expect, test } from '@playwright/test';
import { waitForSessionLoaded } from './fixtures/m4';

test('boots a skirmish from the main menu without browser errors', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/?debug=1');

  await expect(
    page.getByRole('heading', { name: 'bordev', exact: true }),
  ).toBeVisible();
  const skirmish = page.getByRole('button', { name: 'Skirmish', exact: true });
  await expect(skirmish).toBeEnabled();
  await skirmish.click();

  await expect(
    page.getByRole('heading', { name: 'Skirmish', exact: true }),
  ).toBeVisible();
  const map = page.getByRole('combobox', { name: 'Map', exact: true });
  await expect(map).toBeDisabled();
  await expect(map).toHaveValue('alpha_test');
  await expect(map.locator('option')).toHaveText(['Alpha Test']);

  const human = page.getByTestId('slot-0');
  const opponent = page.getByTestId('slot-1');
  await expect(
    human.getByRole('heading', { name: 'You', exact: true }),
  ).toBeVisible();
  await expect(
    opponent.getByRole('heading', { name: 'Normal AI', exact: true }),
  ).toBeVisible();
  const difficulty = opponent.getByRole('combobox', {
    name: 'Difficulty',
    exact: true,
  });
  await expect(difficulty).toBeDisabled();
  await expect(difficulty).toHaveValue('normal');
  await expect(difficulty.locator('option')).toHaveText(['Normal']);

  const colour = human.getByRole('combobox', {
    name: 'Your colour',
    exact: true,
  });
  await expect(colour).toBeEnabled();
  await expect(colour).toHaveValue('blue');
  await expect(colour.locator('option')).toHaveText([
    'Blue',
    'Red',
    'Green',
    'Yellow',
  ]);
  await expect(
    opponent.getByText('Colour: Red', { exact: true }),
  ).toBeVisible();
  await colour.selectOption('green');
  await expect(
    opponent.getByText('Colour: Blue', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Back', exact: true }),
  ).toBeEnabled();
  const start = page.getByRole('button', { name: 'Start', exact: true });
  await expect(start).toBeEnabled();
  await start.click();

  const canvas = page.getByLabel('Game view', { exact: true });
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveJSProperty('tagName', 'CANVAS');
  await expect(canvas).toHaveCount(1);
  await waitForSessionLoaded(page);

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

  const hasWebGL = await canvas.evaluate((element: HTMLCanvasElement) => {
    const context = element.getContext('webgl2') ?? element.getContext('webgl');
    return context !== null && !context.isContextLost();
  });
  expect(hasWebGL).toBe(true);
  // Normal skirmishes do not spawn debug walkers/probes.
  const debugProbes = await page.evaluate(
    () => window.__bordev?.renderer?.debugProbes,
  );
  expect(debugProbes).toBeNull();
  expect(consoleErrors, 'console errors during boot and first render').toEqual(
    [],
  );
  expect(
    pageErrors,
    'uncaught page errors during boot and first render',
  ).toEqual([]);
});
