import { expect, test } from '@playwright/test';
import { startSkirmish } from './fixtures/m4';

test('starts a Clans skirmish with the Clans base, age name and atlas art', async ({
  page,
}) => {
  const { consoleErrors, pageErrors } = await startSkirmish(page, {
    humanFaction: 'clans',
  });

  const factions = await page.evaluate(() => {
    const sim = window.__bordev?.sim;
    if (!sim) throw new Error('Simulation not initialized');
    return sim.world.players.map((p) => p.faction);
  });
  expect(factions[0]).toBe('clans');
  expect(factions[1]).toBe('crown');

  // Every player 0 unit and building, with the portrait the renderer resolves
  // for that exact entity.
  const owned = await page.evaluate(() => {
    const bordev = window.__bordev;
    if (!bordev?.sim) throw new Error('Simulation not initialized');
    const renderer = bordev.renderer;
    if (!renderer) throw new Error('Renderer missing');
    const result: { kind: string; type: string; url: string | null }[] = [];
    for (const entity of bordev.sim.world.entities) {
      if (
        entity === undefined ||
        (entity.kind !== 'unit' && entity.kind !== 'building') ||
        entity.player !== 0
      ) {
        continue;
      }
      result.push({
        kind: entity.kind,
        type: entity.type,
        url: renderer.getPortrait(entity)?.url ?? null,
      });
    }
    return result;
  });

  // Player 0 starts with exactly one Great Hall, four Thralls and one Haul Wagon.
  const counts: Record<string, number> = {};
  for (const { kind, type } of owned) {
    counts[`${kind}:${type}`] = (counts[`${kind}:${type}`] ?? 0) + 1;
  }
  expect(counts).toEqual({
    'building:great_hall': 1,
    'unit:thrall': 4,
    'unit:haul_wagon': 1,
  });

  // Each entity resolves its portrait through its own Clans atlas, never the
  // Crown peasant/keep fallback used for unmapped types.
  for (const { type, url } of owned) {
    expect(url, `${type} atlas portrait`).not.toBeNull();
    expect(url).toContain(`clans_${type}`);
  }

  // The top bar names the Clans age rather than a number.
  await expect(page.getByTestId('hud-topbar')).toContainText(/camp/i);

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
