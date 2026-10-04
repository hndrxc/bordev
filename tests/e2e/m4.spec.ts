import { expect, test, type Page } from '@playwright/test';
import type { GameSession, SessionStats } from '../../src/game/GameSession';

interface SetupResult {
  consoleErrors: string[];
  pageErrors: string[];
}

/**
 * Concise boot and readiness helper for M4 browser fixtures.
 */
async function setupM4Session(
  page: Page,
  options: { centerOn?: { x: number; z: number } } = {},
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

  const center = options.centerOn ?? { x: 60, z: 60 };
  await page.evaluate(
    ({ cx, cz }) => {
      const cam = window.__bordev?.session.renderer.camera;
      if (!cam) throw new Error('Renderer camera is not available');
      cam.centerOn(cx, cz);
    },
    { cx: center.x, cz: center.z },
  );

  return { consoleErrors, pageErrors };
}

/**
 * Project world tile coordinate to current renderer screen position.
 */
async function worldToScreen(
  page: Page,
  targetX: number,
  targetZ: number,
): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ({ tx, tz }) => {
      const cam = window.__bordev?.session.renderer.camera;
      if (!cam) throw new Error('Renderer camera is not available');
      const dx = tx - cam.view.targetX;
      const dz = tz - cam.view.targetZ;
      return {
        x: cam.view.width * 0.5 + (dx - dz) * 48 * cam.view.zoom,
        y: cam.view.height * 0.5 + (dx + dz) * 24 * cam.view.zoom,
      };
    },
    { tx: targetX, tz: targetZ },
  );
}

test('1. required goalposts: 5 peasants box select, arrival within 20s sim time, control groups, W stop, and resource cheats', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const { consoleErrors, pageErrors } = await setupM4Session(page);

  await expect(
    page.getByRole('heading', { name: 'bordev', exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('hud-topbar')).toBeVisible();
  await expect(page.getByTestId('minimap')).toBeVisible();

  // Spawn five isolated own peasants in passable grassland around (60, 60)
  const spawnedIds = await page.evaluate(() => {
    const bordev = window.__bordev;
    if (!bordev || !bordev.cheats)
      throw new Error('Debug cheats not available');
    return bordev.cheats.spawnPeasants(5, 60, 60);
  });
  expect(spawnedIds).toHaveLength(5);

  // Assert actual simulation state: 5 own peasants for player 0
  await page.waitForFunction(
    (ids) => {
      const sim = window.__bordev?.sim;
      if (!sim) return false;
      return ids.every((id) => {
        const ent = sim.world.entities[id];
        return (
          ent !== undefined &&
          ent.kind === 'unit' &&
          ent.type === 'peasant' &&
          ent.player === 0 &&
          ent.hp !== undefined &&
          ent.hp > 0
        );
      });
    },
    spawnedIds,
    { timeout: 10_000 },
  );

  // Wait for renderer to produce screen bounding rects for all 5 peasants
  await page.waitForFunction(
    (ids) => {
      const renderer = window.__bordev?.renderer;
      if (!renderer) return false;
      return ids.every((id) => {
        const rect = renderer.getEntityScreenRect(id);
        return (
          rect !== undefined &&
          rect.right > rect.left &&
          rect.bottom > rect.top &&
          rect.left >= 0 &&
          rect.top >= 0
        );
      });
    },
    spawnedIds,
    { timeout: 10_000 },
  );

  const rects = await page.evaluate((ids) => {
    const renderer = window.__bordev?.renderer;
    if (!renderer) throw new Error('Renderer is not available');
    return ids.map((id) => {
      const rect = renderer.getEntityScreenRect(id);
      if (!rect) throw new Error(`Screen rect missing for entity ${id}`);
      return rect;
    });
  }, spawnedIds);

  // Verify all picked rects are within interactive world viewport (not blocked by TopBar or HUD bottom)
  for (const rect of rects) {
    expect(rect.top).toBeGreaterThanOrEqual(40);
    expect(rect.bottom).toBeLessThanOrEqual(530);
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(1280);
  }

  // Real mouse drag box-selection enclosing all 5 peasants
  const boxMinX = Math.min(...rects.map((r) => r.left)) - 25;
  const boxMinY = Math.min(...rects.map((r) => r.top)) - 25;
  const boxMaxX = Math.max(...rects.map((r) => r.right)) + 25;
  const boxMaxY = Math.max(...rects.map((r) => r.bottom)) + 25;

  await page.mouse.move(boxMinX, boxMinY);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(boxMaxX, boxMaxY, { steps: 8 });
  await page.mouse.up({ button: 'left' });

  // Assert session input selection has all 5 spawned peasants
  await page.waitForFunction(
    (ids) => {
      const sel = window.__bordev?.session.input.selection.ids;
      if (!sel || sel.length !== ids.length) return false;
      return ids.every((id) => sel.includes(id));
    },
    spawnedIds,
    { timeout: 10_000 },
  );

  // Right-click passable ground at (64, 60) and observe arrival within 2 tiles in 20s sim time
  const targetX = 64;
  const targetZ = 60;
  const targetScreen = await worldToScreen(page, targetX, targetZ);
  expect(targetScreen.y).toBeGreaterThanOrEqual(40);
  expect(targetScreen.y).toBeLessThanOrEqual(530);

  const startSimTime = await page.evaluate(() => {
    const sim = window.__bordev?.sim;
    if (!sim) throw new Error('Simulation not initialized');
    return sim.world.tick * 0.05;
  });

  await page.mouse.click(targetScreen.x, targetScreen.y, { button: 'right' });

  // Poll actual simulation state until all 5 units are within 2 tiles
  await page.waitForFunction(
    ({ ids, tx, tz }) => {
      const sim = window.__bordev?.sim;
      if (!sim) return false;
      return ids.every((id) => {
        const u = sim.world.entities[id];
        if (!u || u.kind !== 'unit') return false;
        return Math.hypot(u.x - tx, u.z - tz) <= 2.0;
      });
    },
    { ids: spawnedIds, tx: targetX, tz: targetZ },
    { timeout: 25_000 },
  );

  const arrivalSimTime = await page.evaluate(() => {
    const sim = window.__bordev?.sim;
    if (!sim) throw new Error('Simulation not initialized');
    return sim.world.tick * 0.05;
  });
  expect(arrivalSimTime - startSimTime).toBeLessThanOrEqual(20.0);

  // Control group: Ctrl+1 assigns group 1, ground click clears, '1' recalls group 1
  await page.keyboard.press('Control+1');

  // Click on empty passable ground away from units to clear selection (56, 56 projects to y: 168)
  const clearScreen = await worldToScreen(page, 56, 56);
  await page.mouse.click(clearScreen.x, clearScreen.y, { button: 'left' });

  await page.waitForFunction(
    () => {
      const sel = window.__bordev?.session.input.selection.ids;
      return sel !== undefined && sel.length === 0;
    },
    undefined,
    { timeout: 10_000 },
  );

  // Reselect group 1 with key '1'
  await page.keyboard.press('1');

  await page.waitForFunction(
    (ids) => {
      const sel = window.__bordev?.session.input.selection.ids;
      if (!sel || sel.length !== ids.length) return false;
      return ids.every((id) => sel.includes(id));
    },
    spawnedIds,
    { timeout: 10_000 },
  );

  // Move command and hotkey W next-tick stop
  // Order units to passable destination (54, 64) within interactive canvas
  const moveDestScreen = await worldToScreen(page, 54, 64);
  expect(moveDestScreen.y).toBeGreaterThanOrEqual(40);
  expect(moveDestScreen.y).toBeLessThanOrEqual(530);

  await page.mouse.click(moveDestScreen.x, moveDestScreen.y, {
    button: 'right',
  });

  // Verify units start moving in sim
  await page.waitForFunction(
    (ids) => {
      const sim = window.__bordev?.sim;
      if (!sim) return false;
      return ids.some((id) => {
        const u = sim.world.entities[id];
        return u && u.kind === 'unit' && u.order?.kind === 'move';
      });
    },
    spawnedIds,
    { timeout: 10_000 },
  );

  // Hotkey W executes stop
  await page.keyboard.press('KeyW');

  // Next-tick: units transition to stop/idle in sim
  await page.waitForFunction(
    (ids) => {
      const sim = window.__bordev?.sim;
      if (!sim) return false;
      return ids.every((id) => {
        const u = sim.world.entities[id];
        return (
          u &&
          u.kind === 'unit' &&
          (u.order?.kind === 'idle' || u.order?.kind === 'stop')
        );
      });
    },
    spawnedIds,
    { timeout: 10_000 },
  );

  // Confirm positions remain halted
  const stoppedPositions = await page.evaluate((ids) => {
    const sim = window.__bordev?.sim;
    if (!sim) throw new Error('Simulation not initialized');
    return ids.map((id) => {
      const ent = sim.world.entities[id];
      if (!ent) throw new Error(`Entity ${id} missing`);
      return { x: ent.x, z: ent.z };
    });
  }, spawnedIds);

  await page.waitForTimeout(200);

  const checkPositions = await page.evaluate((ids) => {
    const sim = window.__bordev?.sim;
    if (!sim) throw new Error('Simulation not initialized');
    return ids.map((id) => {
      const ent = sim.world.entities[id];
      if (!ent) throw new Error(`Entity ${id} missing`);
      return { x: ent.x, z: ent.z };
    });
  }, spawnedIds);

  for (let i = 0; i < stoppedPositions.length; i++) {
    expect(
      Math.hypot(
        checkPositions[i].x - stoppedPositions[i].x,
        checkPositions[i].z - stoppedPositions[i].z,
      ),
    ).toBeLessThan(0.05);
  }

  // Resource cheat resources(1000) and TopBar HUD match
  await page.evaluate(() => {
    const bordev = window.__bordev;
    if (!bordev || !bordev.cheats) throw new Error('Cheats not available');
    bordev.cheats.resources(1000);
  });

  // Verify actual sim state
  const simResources = await page.evaluate(() => {
    const sim = window.__bordev?.sim;
    if (!sim) throw new Error('Simulation not initialized');
    const p = sim.world.players[0];
    if (!p) throw new Error('Player 0 missing');
    return { food: p.food, gold: p.gold };
  });
  expect(simResources.food).toBe(1000);
  expect(simResources.gold).toBe(1000);

  // Verify TopBar shows 1000
  await expect(page.getByTestId('resource-food')).toContainText('1000');
  await expect(page.getByTestId('resource-gold')).toContainText('1000');

  expect(consoleErrors, 'console errors during goalpost test').toEqual([]);
  expect(pageErrors, 'uncaught page errors during goalpost test').toEqual([]);
});

test('2. isolated click, Shift multi-select and toggle, and double-click type selection', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const { consoleErrors, pageErrors } = await setupM4Session(page);

  // Spawn 3 peasants with distinct spatial separation so screen rects do not overlap
  const id0 = (
    await page.evaluate(() => {
      const bordev = window.__bordev;
      if (!bordev?.cheats) throw new Error('Cheats not available');
      return bordev.cheats.spawnPeasants(1, 56, 58);
    })
  )[0];

  const id1 = (
    await page.evaluate(() => {
      const bordev = window.__bordev;
      if (!bordev?.cheats) throw new Error('Cheats not available');
      return bordev.cheats.spawnPeasants(1, 64, 58);
    })
  )[0];

  const id2 = (
    await page.evaluate(() => {
      const bordev = window.__bordev;
      if (!bordev?.cheats) throw new Error('Cheats not available');
      return bordev.cheats.spawnPeasants(1, 58, 62);
    })
  )[0];

  const unitIds = [id0, id1, id2];

  // Assert all 3 units are live in sim
  await page.waitForFunction(
    (ids) => {
      const sim = window.__bordev?.sim;
      if (!sim) return false;
      return ids.every((id) => {
        const u = sim.world.entities[id];
        return u && u.kind === 'unit' && u.player === 0 && u.hp > 0;
      });
    },
    unitIds,
    { timeout: 10_000 },
  );

  // Wait for renderer to have non-empty screen rects
  await page.waitForFunction(
    (ids) => {
      const renderer = window.__bordev?.renderer;
      if (!renderer) return false;
      return ids.every((id) => {
        const r = renderer.getEntityScreenRect(id);
        return r && r.right > r.left && r.bottom > r.top;
      });
    },
    unitIds,
    { timeout: 10_000 },
  );

  // Query screen rects and frontmost pick verification for id0 and id1
  const [p0, p1] = await page.evaluate(
    ([firstId, secondId]) => {
      const renderer = window.__bordev?.renderer;
      if (!renderer) throw new Error('Renderer not available');
      return [firstId, secondId].map((targetId) => {
        const rect = renderer.getEntityScreenRect(targetId);
        if (!rect) throw new Error(`Missing screen rect for ${targetId}`);
        const cx = (rect.left + rect.right) * 0.5;
        const cy = (rect.top + rect.bottom) * 0.5;
        const picked = renderer.pickEntity(cx, cy);
        return { x: cx, y: cy, rect, picked };
      });
    },
    [id0, id1],
  );

  // Ensure pick points are safely in interactive viewport and unambiguously hit the target units
  expect(p0.y).toBeGreaterThanOrEqual(40);
  expect(p0.y).toBeLessThanOrEqual(530);
  expect(p1.y).toBeGreaterThanOrEqual(40);
  expect(p1.y).toBeLessThanOrEqual(530);
  expect(p0.picked).toBe(id0);
  expect(p1.picked).toBe(id1);

  // 1. Click peasant 0 alone
  await page.mouse.click(p0.x, p0.y, { button: 'left' });

  await page.waitForFunction(
    (id) => {
      const sel = window.__bordev?.session.input.selection.ids;
      return sel && sel.length === 1 && sel[0] === id;
    },
    id0,
    { timeout: 5_000 },
  );

  // 2. Shift-click peasant 1 to add
  await page.keyboard.down('Shift');
  await page.mouse.click(p1.x, p1.y, { button: 'left' });
  await page.keyboard.up('Shift');

  await page.waitForFunction(
    ({ a, b }) => {
      const sel = window.__bordev?.session.input.selection.ids;
      return (
        sel !== undefined &&
        sel.length === 2 &&
        sel.includes(a) &&
        sel.includes(b)
      );
    },
    { a: id0, b: id1 },
    { timeout: 5_000 },
  );

  // A deliberate second single click, not a Shift-double-click type selection.
  await page.waitForTimeout(500);

  // 3. Shift-click peasant 1 again to remove (toggle off)
  await page.keyboard.down('Shift');
  await page.mouse.click(p1.x, p1.y, { button: 'left' });
  await page.keyboard.up('Shift');

  await page.waitForFunction(
    (id) => {
      const sel = window.__bordev?.session.input.selection.ids;
      return sel && sel.length === 1 && sel[0] === id;
    },
    id0,
    { timeout: 5_000 },
  );

  // 4. Double-click own-type selection (peasant 0 double-clicked selects all own peasants on screen)
  await page.mouse.dblclick(p0.x, p0.y, { button: 'left' });

  await page.waitForFunction(
    (ids) => {
      const sel = window.__bordev?.session.input.selection.ids;
      if (!sel || sel.length !== ids.length) return false;
      return ids.every((id) => sel.includes(id));
    },
    unitIds,
    { timeout: 5_000 },
  );

  expect(consoleErrors, 'console errors during selection test').toEqual([]);
  expect(pageErrors, 'uncaught page errors during selection test').toEqual([]);
});

test('3. camera, minimap, and HUD: pan, group double-tap centering, HUD isolation, minimap jump/move, zoom, command card move', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const { consoleErrors, pageErrors } = await setupM4Session(page);

  // Spawn 2 own peasants in passable grassland around (60, 60)
  const spawnedIds = await page.evaluate(() => {
    const bordev = window.__bordev;
    if (!bordev || !bordev.cheats)
      throw new Error('Debug cheats not available');
    return bordev.cheats.spawnPeasants(2, 60, 60);
  });
  expect(spawnedIds).toHaveLength(2);

  await page.waitForFunction(
    (ids) => {
      const sim = window.__bordev?.sim;
      if (!sim) return false;
      return ids.every((id) => {
        const ent = sim.world.entities[id];
        return ent && ent.kind === 'unit' && ent.player === 0 && ent.hp > 0;
      });
    },
    spawnedIds,
    { timeout: 10_000 },
  );

  // Assign group 1 via session input
  await page.evaluate((ids) => {
    window.__bordev?.session.input.selection.set(ids);
  }, spawnedIds);
  await page.keyboard.press('Control+1');

  // Verify HUD shell elements are mounted
  const topbar = page.getByTestId('hud-topbar');
  await expect(topbar).toBeVisible();
  const minimap = page.getByTestId('minimap');
  await expect(minimap).toBeVisible();

  // Frame-based arrow camera requires keydown, observe movement then keyup, not instantaneous press loop
  const camBeforePan = await page.evaluate(() => {
    const cam = window.__bordev?.session.renderer.camera;
    if (!cam) throw new Error('Renderer camera is not available');
    return { x: cam.view.targetX, z: cam.view.targetZ };
  });

  await page.keyboard.down('ArrowRight');
  await page.waitForFunction(
    (prev) => {
      const cam = window.__bordev?.session.renderer.camera;
      return (
        cam && (cam.view.targetX !== prev.x || cam.view.targetZ !== prev.z)
      );
    },
    camBeforePan,
    { timeout: 10_000 },
  );
  await page.keyboard.up('ArrowRight');

  // Double-tap '1' to center camera on group 1
  await page.keyboard.press('1');
  await page.waitForTimeout(60);
  await page.keyboard.press('1');

  await page.waitForFunction(
    (ids) => {
      const sim = window.__bordev?.sim;
      const cam = window.__bordev?.session.renderer.camera;
      if (!sim || !cam) return false;
      let sumX = 0;
      let sumZ = 0;
      let count = 0;
      for (const id of ids) {
        const u = sim.world.entities[id];
        if (u) {
          sumX += u.x;
          sumZ += u.z;
          count++;
        }
      }
      if (count === 0) return false;
      const avgX = sumX / count;
      const avgZ = sumZ / count;
      return (
        Math.abs(cam.view.targetX - avgX) < 1.0 &&
        Math.abs(cam.view.targetZ - avgZ) < 1.0
      );
    },
    spawnedIds,
    { timeout: 10_000 },
  );

  // HUD click isolation: clicking TopBar does not clear world selection
  await page.keyboard.press('1');
  await topbar.click();

  const selAfterHudClick = await page.evaluate((ids) => {
    const sel = window.__bordev?.session.input.selection.ids;
    return (
      sel && ids.every((id) => sel.includes(id)) && sel.length === ids.length
    );
  }, spawnedIds);
  expect(selAfterHudClick).toBe(true);

  // Minimap left-click jump & right-click move order
  const mmBox = await minimap.boundingBox();
  expect(mmBox).not.toBeNull();

  const camBeforeJump = await page.evaluate(() => {
    const cam = window.__bordev?.session.renderer.camera;
    if (!cam) throw new Error('Renderer camera is not available');
    return { x: cam.view.targetX, z: cam.view.targetZ };
  });

  await page.mouse.click(mmBox!.x + 30, mmBox!.y + 30, { button: 'left' });

  await page.waitForFunction(
    (prev) => {
      const cam = window.__bordev?.session.renderer.camera;
      return (
        cam && (cam.view.targetX !== prev.x || cam.view.targetZ !== prev.z)
      );
    },
    camBeforeJump,
    { timeout: 10_000 },
  );

  // Re-center on peasants with double-tap 1
  await page.keyboard.press('1');
  await page.waitForTimeout(60);
  await page.keyboard.press('1');

  // Right-click on minimap orders contextual move for selected group (at 90, 90 mapping to passable 64, 64)
  await page.mouse.click(mmBox!.x + 90, mmBox!.y + 90, { button: 'right' });

  await page.waitForFunction(
    (ids) => {
      const sim = window.__bordev?.sim;
      if (!sim) return false;
      return ids.some((id) => {
        const u = sim.world.entities[id];
        return u && u.kind === 'unit' && u.order?.kind === 'move';
      });
    },
    spawnedIds,
    { timeout: 10_000 },
  );

  // Camera cursor zoom (wheel in and out)
  const initialZoom = await page.evaluate(() => {
    const cam = window.__bordev?.session.renderer.camera;
    if (!cam) throw new Error('Renderer camera is not available');
    return cam.view.zoom;
  });

  await page.mouse.move(640, 300);
  await page.mouse.wheel(0, -120);

  await page.waitForFunction(
    (prev) => {
      const cam = window.__bordev?.session.renderer.camera;
      return cam && cam.view.zoom > prev;
    },
    initialZoom,
    { timeout: 10_000 },
  );

  const zoomedIn = await page.evaluate(() => {
    const cam = window.__bordev?.session.renderer.camera;
    if (!cam) throw new Error('Renderer camera is not available');
    return cam.view.zoom;
  });

  await page.mouse.wheel(0, 240);

  await page.waitForFunction(
    (prev) => {
      const cam = window.__bordev?.session.renderer.camera;
      return cam && cam.view.zoom < prev;
    },
    zoomedIn,
    { timeout: 10_000 },
  );

  // CommandCard Move button target mode and canvas click execution
  await page.keyboard.press('1');
  await page.keyboard.press('KeyW');

  const moveBtn = page.getByTestId('command-move');
  await expect(moveBtn).toBeVisible();
  await moveBtn.click();

  expect(
    await page.evaluate(() => {
      const input = window.__bordev?.session.input;
      if (!input) throw new Error('InputController not initialized');
      return input.orders.mode;
    }),
  ).toBe('move');

  const moveTargetPt = await worldToScreen(page, 62, 60);
  expect(moveTargetPt.y).toBeGreaterThanOrEqual(40);
  expect(moveTargetPt.y).toBeLessThanOrEqual(530);

  await page.mouse.click(moveTargetPt.x, moveTargetPt.y, { button: 'left' });

  await page.waitForFunction(
    () => {
      return window.__bordev?.session.input.orders.mode === null;
    },
    undefined,
    { timeout: 5_000 },
  );

  await page.waitForFunction(
    (ids) => {
      const sim = window.__bordev?.sim;
      if (!sim) return false;
      return ids.some((id) => {
        const u = sim.world.entities[id];
        return u && u.kind === 'unit' && u.order?.kind === 'move';
      });
    },
    spawnedIds,
    { timeout: 10_000 },
  );

  // Stop them again cleanly
  await page.keyboard.press('KeyW');

  expect(
    consoleErrors,
    'console errors during camera/minimap/HUD test',
  ).toEqual([]);
  expect(
    pageErrors,
    'uncaught page errors during camera/minimap/HUD test',
  ).toEqual([]);
});

test('4. hotkey submenus, queued orders, delete slot, and enemy ownership isolation', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const { consoleErrors, pageErrors } = await setupM4Session(page);

  // Spawn 1 primary own peasant at (60, 60)
  const spawnedIds = await page.evaluate(() => {
    const bordev = window.__bordev;
    if (!bordev?.cheats) throw new Error('Debug cheats not available');
    return bordev.cheats.spawnPeasants(1, 60, 60);
  });
  expect(spawnedIds).toHaveLength(1);
  const peasantId = spawnedIds[0];

  await page.waitForFunction(
    (id) => {
      const sim = window.__bordev?.sim;
      const u = sim?.world.entities[id];
      return u && u.kind === 'unit' && u.player === 0 && u.hp > 0;
    },
    peasantId,
    { timeout: 10_000 },
  );

  // Select peasant
  await page.evaluate((id) => {
    window.__bordev?.session.input.selection.set([id]);
  }, peasantId);

  await page.waitForFunction(
    (id) => {
      const sel = window.__bordev?.session.input.selection.ids;
      return sel && sel.length === 1 && sel[0] === id;
    },
    peasantId,
    { timeout: 5_000 },
  );

  // 1. Shift-right-click queued waypoints
  const queuePt1 = await worldToScreen(page, 62, 60);
  expect(queuePt1.y).toBeGreaterThanOrEqual(40);
  expect(queuePt1.y).toBeLessThanOrEqual(530);

  await page.mouse.click(queuePt1.x, queuePt1.y, { button: 'right' });

  await page.waitForFunction(
    (id) => {
      const sim = window.__bordev?.sim;
      const u = sim?.world.entities[id];
      return u && u.kind === 'unit' && u.order?.kind === 'move';
    },
    peasantId,
    { timeout: 10_000 },
  );

  const queuePt2 = await worldToScreen(page, 58, 62);
  expect(queuePt2.y).toBeGreaterThanOrEqual(40);
  expect(queuePt2.y).toBeLessThanOrEqual(530);

  await page.keyboard.down('Shift');
  await page.mouse.click(queuePt2.x, queuePt2.y, { button: 'right' });
  await page.keyboard.up('Shift');

  await page.waitForFunction(
    (id) => {
      const sim = window.__bordev?.sim;
      const u = sim?.world.entities[id];
      return (
        u &&
        u.kind === 'unit' &&
        u.order?.kind === 'move' &&
        Array.isArray(u.orders) &&
        u.orders.length > 0 &&
        u.orders[0].kind === 'move'
      );
    },
    peasantId,
    { timeout: 10_000 },
  );

  // Stop cleanly
  await page.keyboard.press('KeyW');

  await page.waitForFunction(
    (id) => {
      const sim = window.__bordev?.sim;
      const u = sim?.world.entities[id];
      return (
        u &&
        u.kind === 'unit' &&
        (u.order?.kind === 'idle' || u.order?.kind === 'stop') &&
        (!u.orders || u.orders.length === 0)
      );
    },
    peasantId,
    { timeout: 10_000 },
  );

  // 2. Hotkey R attack-move mode and execution
  await page.keyboard.press('KeyR');

  await page.waitForFunction(
    () => {
      return window.__bordev?.session.input.orders.mode === 'attackMove';
    },
    undefined,
    { timeout: 5_000 },
  );

  const attackMoveBtn = page.getByTestId('command-attack-move');
  await expect(attackMoveBtn).toBeVisible();
  await expect(attackMoveBtn).toHaveClass(/active/);

  const atkTargetPt = await worldToScreen(page, 60, 62);
  expect(atkTargetPt.y).toBeGreaterThanOrEqual(40);
  expect(atkTargetPt.y).toBeLessThanOrEqual(530);

  await page.mouse.click(atkTargetPt.x, atkTargetPt.y, { button: 'left' });

  await page.waitForFunction(
    () => {
      return window.__bordev?.session.input.orders.mode === null;
    },
    undefined,
    { timeout: 5_000 },
  );

  await page.waitForFunction(
    (id) => {
      const sim = window.__bordev?.sim;
      const u = sim?.world.entities[id];
      return u && u.kind === 'unit' && u.order?.kind === 'attackMove';
    },
    peasantId,
    { timeout: 10_000 },
  );

  // Stop cleanly
  await page.keyboard.press('KeyW');

  // 3. Open own peasant Economic submenu by A; W disabled Farm slot must NOT stop/mutate existing move order; Esc or B returns
  const econMovePt = await worldToScreen(page, 56, 64);
  expect(econMovePt.y).toBeGreaterThanOrEqual(40);
  expect(econMovePt.y).toBeLessThanOrEqual(530);

  await page.mouse.click(econMovePt.x, econMovePt.y, { button: 'right' });

  await page.waitForFunction(
    (id) => {
      const sim = window.__bordev?.sim;
      const u = sim?.world.entities[id];
      return u && u.kind === 'unit' && u.order?.kind === 'move';
    },
    peasantId,
    { timeout: 10_000 },
  );

  const moveBeforeSubmenu = await page.evaluate((id) => {
    const u = window.__bordev?.sim?.world.entities[id];
    if (!u || u.kind !== 'unit' || !u.order) return null;
    return { kind: u.order.kind, x: u.order.x, z: u.order.z };
  }, peasantId);
  expect(moveBeforeSubmenu?.kind).toBe('move');

  // Open Economic submenu with hotkey 'A'
  await page.keyboard.press('KeyA');

  await page.waitForFunction(
    () => {
      return window.__bordev?.session.input.orders.submenu === 'economic';
    },
    undefined,
    { timeout: 5_000 },
  );

  // Verify Economic submenu card DOM slots
  const farmBtn = page.getByTestId('command-farm');
  await expect(farmBtn).toBeVisible();
  await expect(farmBtn).toBeDisabled();
  await expect(farmBtn).toContainText('Farm');

  const cottageBtn = page.getByTestId('command-cottage');
  await expect(cottageBtn).toBeVisible();
  await expect(cottageBtn).toBeDisabled();
  await expect(cottageBtn).toContainText('Cottage');

  const backBtn = page.getByTestId('command-back');
  await expect(backBtn).toBeVisible();
  await expect(backBtn).toBeEnabled();
  await expect(backBtn).toContainText('Back');

  // Press W while in Economic submenu (targeting disabled Farm slot)
  await page.keyboard.press('KeyW');

  // W disabled Farm slot must NOT stop or mutate existing move order
  const moveAfterW = await page.evaluate((id) => {
    const u = window.__bordev?.sim?.world.entities[id];
    if (!u || u.kind !== 'unit' || !u.order) return null;
    return { kind: u.order.kind, x: u.order.x, z: u.order.z };
  }, peasantId);
  expect(moveAfterW?.kind).toBe('move');
  expect(moveAfterW?.x).toBe(moveBeforeSubmenu?.x);
  expect(moveAfterW?.z).toBe(moveBeforeSubmenu?.z);

  // Status ticker truthfully reflects disabled slot reason
  await expect(page.getByTestId('hud-status')).toContainText('Milestone 5');

  // B returns to main command card
  await page.keyboard.press('KeyB');
  await page.waitForFunction(
    () => {
      return window.__bordev?.session.input.orders.submenu === null;
    },
    undefined,
    { timeout: 5_000 },
  );
  await expect(farmBtn).toBeHidden();
  await expect(page.getByTestId('command-move')).toBeVisible();

  // Re-open Economic submenu via hotkey 'A' and test Esc return
  await page.keyboard.press('KeyA');
  await page.waitForFunction(
    () => {
      return window.__bordev?.session.input.orders.submenu === 'economic';
    },
    undefined,
    { timeout: 5_000 },
  );
  await expect(farmBtn).toBeVisible();

  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () => {
      return window.__bordev?.session.input.orders.submenu === null;
    },
    undefined,
    { timeout: 5_000 },
  );
  await expect(farmBtn).toBeHidden();
  await expect(page.getByTestId('command-move')).toBeVisible();

  // Stop the moving peasant cleanly once back in main card
  await page.keyboard.press('KeyW');
  await page.waitForFunction(
    (id) => {
      const u = window.__bordev?.sim?.world.entities[id];
      return (
        u &&
        u.kind === 'unit' &&
        (u.order?.kind === 'idle' || u.order?.kind === 'stop')
      );
    },
    peasantId,
    { timeout: 10_000 },
  );

  // 4. Z Delete slot dispatches actual next-tick deletion on a spare debug-spawned own peasant
  const spareSpawnedIds = await page.evaluate(() => {
    const bordev = window.__bordev;
    if (!bordev || !bordev.cheats)
      throw new Error('Debug cheats not available');
    return bordev.cheats.spawnPeasants(1, 62, 58);
  });
  expect(spareSpawnedIds).toHaveLength(1);
  const sparePeasantId = spareSpawnedIds[0];

  await page.waitForFunction(
    (id) => {
      const sim = window.__bordev?.sim;
      const u = sim?.world.entities[id];
      return u && u.kind === 'unit' && u.player === 0 && u.hp > 0;
    },
    sparePeasantId,
    { timeout: 10_000 },
  );

  // Select only the spare peasant
  await page.evaluate((id) => {
    window.__bordev?.session.input.selection.set([id]);
  }, sparePeasantId);

  await page.waitForFunction(
    (id) => {
      const sel = window.__bordev?.session.input.selection.ids;
      return sel && sel.length === 1 && sel[0] === id;
    },
    sparePeasantId,
    { timeout: 5_000 },
  );

  const deleteBtn = page.getByTestId('command-delete');
  await expect(deleteBtn).toBeVisible();
  await expect(deleteBtn).toBeEnabled();
  await expect(deleteBtn).toContainText('Delete');

  // Hotkey Z dispatches delete
  await page.keyboard.press('KeyZ');

  // Verify actual next-tick deletion in simulation
  await page.waitForFunction(
    (id) => {
      const sim = window.__bordev?.sim;
      if (!sim) return false;
      const u = sim.world.entities[id];
      return (
        u === undefined ||
        (u.kind === 'unit' && typeof u.hp === 'number' && u.hp <= 0)
      );
    },
    sparePeasantId,
    { timeout: 10_000 },
  );

  // Selection pruned
  await page.waitForFunction(
    () => {
      const sel = window.__bordev?.session.input.selection.ids;
      return !sel || sel.length === 0;
    },
    undefined,
    { timeout: 5_000 },
  );

  // Primary peasant strictly preserved and intact
  const mainPeasantIntact = await page.evaluate((id) => {
    const sim = window.__bordev?.sim;
    if (!sim) return false;
    const u = sim.world.entities[id];
    return u !== undefined && u.kind === 'unit' && u.player === 0 && u.hp > 0;
  }, peasantId);
  expect(mainPeasantIntact, 'Primary peasant remains intact').toBe(true);

  // 5. Enemy selection cannot expose enabled order slots
  const enemyUnitId = await page.evaluate(() => {
    const sim = window.__bordev?.sim;
    if (!sim) return null;
    const enemy = sim.world.entities.find(
      (e) =>
        e &&
        e.kind === 'unit' &&
        e.player !== 0 &&
        typeof e.hp === 'number' &&
        e.hp > 0,
    );
    return enemy ? enemy.id : null;
  });
  expect(enemyUnitId).not.toBeNull();

  await page.evaluate((id) => {
    window.__bordev?.session.input.selection.set([id]);
  }, enemyUnitId!);

  await page.waitForFunction(
    (id) => {
      const sel = window.__bordev?.session.input.selection.ids;
      return sel && sel.length === 1 && sel[0] === id;
    },
    enemyUnitId!,
    { timeout: 5_000 },
  );

  // CommandCard must NOT expose any enabled order slots for enemy units
  const enabledButtons = page.locator('.hud-command-card button.enabled');
  await expect(enabledButtons).toHaveCount(0);

  const anyCommandButtons = page.locator('.hud-command-card button');
  await expect(anyCommandButtons).toHaveCount(0);

  // All 15 command slots rendered as empty slots with dim hotkeys
  const emptySlots = page.locator('.hud-command-card .command-slot.empty');
  await expect(emptySlots).toHaveCount(15);

  expect(consoleErrors, 'console errors during hotkeys/enemy test').toEqual([]);
  expect(pageErrors, 'uncaught page errors during hotkeys/enemy test').toEqual(
    [],
  );
});
