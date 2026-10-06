import { expect, test } from '@playwright/test';
import {
  setupM4Session,
  worldToScreen,
  waitForTicks,
  playfield,
  pickablePoint,
} from './fixtures/m4';

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
  const field = await playfield(page);
  for (const rect of rects) {
    expect(rect.top).toBeGreaterThanOrEqual(field.top);
    expect(rect.bottom).toBeLessThanOrEqual(field.bottom);
    expect(rect.left).toBeGreaterThanOrEqual(field.left);
    expect(rect.right).toBeLessThanOrEqual(field.right);
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
  expect(targetScreen.y).toBeGreaterThanOrEqual(field.top);
  expect(targetScreen.y).toBeLessThanOrEqual(field.bottom);

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
  await page.keyboard.press('Control+Digit1');

  // Click on empty passable ground away from units to clear selection (56, 56)
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

  // Reselect group 1 with key 'Digit1'
  await page.keyboard.press('Digit1');

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
  expect(moveDestScreen.y).toBeGreaterThanOrEqual(field.top);
  expect(moveDestScreen.y).toBeLessThanOrEqual(field.bottom);

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

  // Next-tick: units transition to stop in sim (ReviewSimTestsDocs#2 requires order.kind === 'stop',
  // not 'idle', and a minimum remaining distance from destination)
  await page.waitForFunction(
    ({ ids, destX, destZ }) => {
      const sim = window.__bordev?.sim;
      if (!sim) return false;
      return ids.every((id) => {
        const u = sim.world.entities[id];
        if (!u || u.kind !== 'unit') return false;
        if (u.order?.kind !== 'stop') return false;
        const remainingDist = Math.hypot(u.x - destX, u.z - destZ);
        return remainingDist >= 3.0;
      });
    },
    { ids: spawnedIds, destX: 54, destZ: 64 },
    { timeout: 10_000 },
  );

  // Confirm positions remain halted across sim ticks (ReviewSimTestsDocs#2 replaces waitForTimeout with waitForTicks)
  const stoppedPositions = await page.evaluate((ids) => {
    const sim = window.__bordev?.sim;
    if (!sim) throw new Error('Simulation not initialized');
    return ids.map((id) => {
      const ent = sim.world.entities[id];
      if (!ent) throw new Error(`Entity ${id} missing`);
      return { x: ent.x, z: ent.z };
    });
  }, spawnedIds);

  await waitForTicks(page, 5);

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

  // Resource cheat resources(1000) and TopBar HUD match (ReviewSimTestsDocs#12)
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

  // Verify TopBar shows exact 1000 via getByTestId('hud-food') and hud-gold (ReviewSimTestsDocs#12)
  await expect(page.getByTestId('hud-food')).toHaveText('1000');
  await expect(page.getByTestId('hud-gold')).toHaveText('1000');

  // Directly mutate sim state without cheat to verify periodic 10 Hz publish (ReviewSimTestsDocs#12)
  await page.evaluate(() => {
    const sim = window.__bordev?.sim;
    if (!sim) throw new Error('Simulation not initialized');
    sim.world.players[0].food = 1250;
  });

  await expect(page.getByTestId('hud-food')).toHaveText('1250');

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
  const field = await playfield(page);
  expect(p0.y).toBeGreaterThanOrEqual(field.top);
  expect(p0.y).toBeLessThanOrEqual(field.bottom);
  expect(p1.y).toBeGreaterThanOrEqual(field.top);
  expect(p1.y).toBeLessThanOrEqual(field.bottom);
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

test('3. camera, minimap, and HUD: group double-tap centering, HUD isolation, minimap jump/move, zoom, command card move', async ({
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
  await page.keyboard.press('Control+Digit1');

  // Verify HUD shell elements are mounted
  const topbar = page.getByTestId('hud-topbar');
  await expect(topbar).toBeVisible();
  const minimap = page.getByTestId('minimap');
  await expect(minimap).toBeVisible();

  const doubleTapField = await playfield(page);
  const doubleTapCenterX = (doubleTapField.left + doubleTapField.right) * 0.5;
  const doubleTapCenterY = (doubleTapField.top + doubleTapField.bottom) * 0.5;

  // Centre camera away to (45, 45) so double-tap centering has observable displacement
  // (both (45, 45) and group 1 at (60, 60) are far from map edges [128x128] so clamping does not interfere)
  await page.evaluate(() => {
    const input = window.__bordev?.session.input;
    if (!input) throw new Error('InputController not available');
    input.camera.centerOn(45, 45);
  });

  // Double-tap 'Digit1' to center camera on group 1
  await page.keyboard.press('Digit1');
  await page.waitForTimeout(60);
  await page.keyboard.press('Digit1');

  // Assert group average projects via worldToScreen to the centre of playfield(page) within ~2 px (contract §3)
  await page.waitForFunction(
    ({ ids, expX, expY }) => {
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

      const canvas = document.querySelector('canvas[aria-label="Game view"]');
      const rect = canvas?.getBoundingClientRect();
      const offX = rect?.left ?? 0;
      const offY = rect?.top ?? 0;
      const dx = avgX - cam.view.targetX;
      const dz = avgZ - cam.view.targetZ;
      const sx = offX + cam.view.width * 0.5 + (dx - dz) * 48 * cam.view.zoom;
      const sy = offY + cam.view.height * 0.5 + (dx + dz) * 24 * cam.view.zoom;

      return Math.abs(sx - expX) < 2.0 && Math.abs(sy - expY) < 2.0;
    },
    { ids: spawnedIds, expX: doubleTapCenterX, expY: doubleTapCenterY },
    { timeout: 10_000 },
  );

  const groupAvg = await page.evaluate((ids) => {
    const sim = window.__bordev?.sim;
    if (!sim) throw new Error('Simulation not available');
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
    return { x: sumX / count, z: sumZ / count };
  }, spawnedIds);

  const groupProjected = await worldToScreen(page, groupAvg.x, groupAvg.z);
  expect(Math.abs(groupProjected.x - doubleTapCenterX)).toBeLessThan(2.0);
  expect(Math.abs(groupProjected.y - doubleTapCenterY)).toBeLessThan(2.0);

  // HUD click isolation: clicking TopBar does not clear world selection
  await page.keyboard.press('Digit1');
  await topbar.click();

  const selAfterHudClick = await page.evaluate((ids) => {
    const sel = window.__bordev?.session.input.selection.ids;
    return (
      sel && ids.every((id) => sel.includes(id)) && sel.length === ids.length
    );
  }, spawnedIds);
  expect(selAfterHudClick).toBe(true);

  // Minimap left-click jump & right-click move order (ReviewSimTestsDocs#3 / ReviewHud#13)
  const mmBox = await minimap.boundingBox();
  expect(mmBox).not.toBeNull();

  // Click an off-centre point inside the map diamond (mx = 120, my = 80) on the 180x180 minimap
  // Diamond vertices: (90, 0), (180, 90), (90, 180), (0, 90)
  // Normalized: u = (120/180)*2 - 1 = 1/3, v = (80/180)*2 = 8/9
  // Inside diamond: |u| + |v - 1| = 1/3 + 1/9 = 4/9 <= 1
  // World mapping (mapSize = 128):
  // x = (u + v) * 128 * 0.5 = (11/9) * 64 = 704/9 ≈ 78.222
  // z = (v - u) * 128 * 0.5 = (5/9) * 64 = 320/9 ≈ 35.556
  const mmClickX = 120;
  const mmClickY = 80;
  const mmU = (mmClickX / 180) * 2 - 1;
  const mmV = (mmClickY / 180) * 2;
  const expWorldX = (mmU + mmV) * 128 * 0.5;
  const expWorldZ = (mmV - mmU) * 128 * 0.5;

  // (a) Left-click: jump camera to expected world point, which ends up at the centre of playfield(page)
  await page.mouse.click(mmBox!.x + mmClickX, mmBox!.y + mmClickY, {
    button: 'left',
  });

  const field = await playfield(page);
  const expScreenCenterX = (field.left + field.right) * 0.5;
  const expScreenCenterY = (field.top + field.bottom) * 0.5;

  await page.waitForFunction(
    ({ wx, wz, expX, expY }) => {
      const cam = window.__bordev?.session.renderer.camera;
      if (!cam) return false;
      const canvas = document.querySelector('canvas[aria-label="Game view"]');
      const rect = canvas?.getBoundingClientRect();
      const offX = rect?.left ?? 0;
      const offY = rect?.top ?? 0;
      const dx = wx - cam.view.targetX;
      const dz = wz - cam.view.targetZ;
      const sx = offX + cam.view.width * 0.5 + (dx - dz) * 48 * cam.view.zoom;
      const sy = offY + cam.view.height * 0.5 + (dx + dz) * 24 * cam.view.zoom;
      return Math.abs(sx - expX) < 2.0 && Math.abs(sy - expY) < 2.0;
    },
    {
      wx: expWorldX,
      wz: expWorldZ,
      expX: expScreenCenterX,
      expY: expScreenCenterY,
    },
    { timeout: 10_000 },
  );

  const jumpedScreen = await worldToScreen(page, expWorldX, expWorldZ);
  expect(Math.abs(jumpedScreen.x - expScreenCenterX)).toBeLessThan(2.0);
  expect(Math.abs(jumpedScreen.y - expScreenCenterY)).toBeLessThan(2.0);

  // (b) Right-click: the selected units' order.x/z are near that world point
  await page.mouse.click(mmBox!.x + mmClickX, mmBox!.y + mmClickY, {
    button: 'right',
  });

  await page.waitForFunction(
    ({ ids, expX, expZ }) => {
      const sim = window.__bordev?.sim;
      if (!sim) return false;
      return ids.some((id) => {
        const u = sim.world.entities[id];
        if (!u || u.kind !== 'unit') return false;
        const order = u.order;
        if (
          !order ||
          order.kind !== 'move' ||
          order.x === undefined ||
          order.z === undefined
        ) {
          return false;
        }
        return Math.abs(order.x - expX) < 1.0 && Math.abs(order.z - expZ) < 1.0;
      });
    },
    { ids: spawnedIds, expX: expWorldX, expZ: expWorldZ },
    { timeout: 10_000 },
  );

  // Re-center on peasants with double-tap Digit1
  await page.keyboard.press('Digit1');
  await page.waitForTimeout(60);
  await page.keyboard.press('Digit1');

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
  await page.keyboard.press('Digit1');
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
  expect(moveTargetPt.y).toBeGreaterThanOrEqual(field.top);
  expect(moveTargetPt.y).toBeLessThanOrEqual(field.bottom);

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
    bordev.cheats.resources(1000);
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

  const field = await playfield(page);

  // 1. Shift-right-click queued waypoints
  const queuePt1 = await worldToScreen(page, 62, 60);
  expect(queuePt1.y).toBeGreaterThanOrEqual(field.top);
  expect(queuePt1.y).toBeLessThanOrEqual(field.bottom);

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
  expect(queuePt2.y).toBeGreaterThanOrEqual(field.top);
  expect(queuePt2.y).toBeLessThanOrEqual(field.bottom);

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
  expect(atkTargetPt.y).toBeGreaterThanOrEqual(field.top);
  expect(atkTargetPt.y).toBeLessThanOrEqual(field.bottom);

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

  // 3. Economic hotkeys enter placement without interrupting movement until a build is committed
  const econMovePt = await worldToScreen(page, 56, 64);
  expect(econMovePt.y).toBeGreaterThanOrEqual(field.top);
  expect(econMovePt.y).toBeLessThanOrEqual(field.bottom);

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

  // Open Economic submenu with hotkey 'A'
  await page.keyboard.press('KeyA');

  await page.waitForFunction(
    () => {
      return window.__bordev?.session.input.orders.submenu === 'economic';
    },
    undefined,
    { timeout: 5_000 },
  );

  // Own peasant economic slots are actionable.
  const farmBtn = page.getByTestId('command-farm');
  await expect(farmBtn).toBeVisible();
  await expect(farmBtn).toBeEnabled();

  const cottageBtn = page.getByTestId('command-cottage');
  await expect(cottageBtn).toBeVisible();
  await expect(cottageBtn).toBeEnabled();

  const backBtn = page.getByTestId('command-back');
  await expect(backBtn).toBeVisible();
  await expect(backBtn).toBeEnabled();
  await expect(backBtn).toContainText('Back');

  // Record unit order state and orderGeneration immediately before KeyW
  const moveBeforeW = await page.evaluate((id) => {
    const u = window.__bordev?.sim?.world.entities[id];
    if (!u || u.kind !== 'unit' || !u.order) return null;
    return {
      kind: u.order.kind,
      x: u.order.x,
      z: u.order.z,
      orderGeneration: u.orderGeneration,
      ordersCount: u.orders ? u.orders.length : 0,
    };
  }, peasantId);
  expect(moveBeforeW?.kind).toBe('move');

  // W enters Farm placement rather than dispatching the main-card Stop command.
  await page.keyboard.press('KeyW');

  // ReviewSimTestsDocs#0: wait ≥ 2 sim ticks after key press before asserting
  await waitForTicks(page, 2);

  // Entering placement leaves the current move order intact until the ground click.
  const moveAfterW = await page.evaluate((id) => {
    const u = window.__bordev?.sim?.world.entities[id];
    if (!u || u.kind !== 'unit' || !u.order) return null;
    return {
      kind: u.order.kind,
      x: u.order.x,
      z: u.order.z,
      orderGeneration: u.orderGeneration,
      ordersCount: u.orders ? u.orders.length : 0,
    };
  }, peasantId);
  expect(moveAfterW?.kind).toBe('move');
  expect(moveAfterW?.x).toBe(moveBeforeW?.x);
  expect(moveAfterW?.z).toBe(moveBeforeW?.z);
  expect(moveAfterW?.orderGeneration).toBe(moveBeforeW?.orderGeneration);
  expect(moveAfterW?.ordersCount).toBe(moveBeforeW?.ordersCount);

  const farmBuildPt = await worldToScreen(page, 58.5, 58.5);
  expect(farmBuildPt.y).toBeGreaterThanOrEqual(field.top);
  expect(farmBuildPt.y).toBeLessThanOrEqual(field.bottom);
  await page.mouse.click(farmBuildPt.x, farmBuildPt.y, { button: 'left' });
  await page.waitForFunction(
    (id) => {
      const world = window.__bordev?.sim?.world;
      const unit = world?.entities[id];
      if (!world || !unit || unit.kind !== 'unit') return false;
      const order = unit.order;
      if (!order) return false;
      const target = world.entities[order.targetId ?? -1];
      return (
        order.kind === 'build' &&
        target?.kind === 'building' &&
        target.type === 'farm' &&
        target.player === 0 &&
        target.x === 58 &&
        target.z === 58 &&
        !target.built
      );
    },
    peasantId,
    { timeout: 10_000 },
  );
  await page.waitForFunction(
    () => {
      const world = window.__bordev?.sim?.world;
      return world?.entities.some(
        (entity) =>
          entity?.kind === 'building' &&
          entity.type === 'farm' &&
          entity.x === 58 &&
          entity.z === 58 &&
          entity.buildProgress > 0,
      );
    },
    undefined,
    { timeout: 10_000 },
  );

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

  // Clicking Cottage uses the same live placement path as the Farm hotkey.
  await cottageBtn.click();
  const cottageBuildPt = await worldToScreen(page, 62.5, 58.5);
  expect(cottageBuildPt.y).toBeGreaterThanOrEqual(field.top);
  expect(cottageBuildPt.y).toBeLessThanOrEqual(field.bottom);
  await page.mouse.click(cottageBuildPt.x, cottageBuildPt.y, {
    button: 'left',
  });
  await page.waitForFunction(
    (id) => {
      const world = window.__bordev?.sim?.world;
      const unit = world?.entities[id];
      if (!world || !unit || unit.kind !== 'unit') return false;
      const order = unit.order;
      if (!order) return false;
      const target = world.entities[order.targetId ?? -1];
      return (
        order.kind === 'build' &&
        target?.kind === 'building' &&
        target.type === 'cottage' &&
        target.player === 0 &&
        target.x === 62 &&
        target.z === 58 &&
        !target.built
      );
    },
    peasantId,
    { timeout: 10_000 },
  );
  await page.waitForFunction(
    () => {
      const world = window.__bordev?.sim?.world;
      return world?.entities.some(
        (entity) =>
          entity?.kind === 'building' &&
          entity.type === 'cottage' &&
          entity.x === 62 &&
          entity.z === 58 &&
          entity.buildProgress > 0,
      );
    },
    undefined,
    { timeout: 10_000 },
  );
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

  // Stop the builder cleanly once back in the main card.
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

  // 5. Enemy selection cannot expose enabled order slots (ReviewSimTestsDocs#13)
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

  // CommandCard must NOT expose any enabled order buttons for enemy units (ReviewSimTestsDocs#13)
  const commandCard = page.getByTestId('command-card');
  const enabledButtons = commandCard.locator(
    'button:not([disabled]):not([aria-disabled="true"])',
  );
  await expect(enabledButtons).toHaveCount(0);

  const cardButtons = commandCard.getByRole('button');
  const totalButtons = await cardButtons.count();
  for (let i = 0; i < totalButtons; i++) {
    const btn = cardButtons.nth(i);
    const ariaDisabled = await btn.getAttribute('aria-disabled');
    const nativeDisabled = await btn.isDisabled();
    expect(nativeDisabled || ariaDisabled === 'true').toBe(true);
  }

  expect(consoleErrors, 'console errors during hotkeys/enemy test').toEqual([]);
  expect(pageErrors, 'uncaught page errors during hotkeys/enemy test').toEqual(
    [],
  );
});

test('5. contextual orders: enemy combat, gold mining, farm economy, repair, rally point, and status auto-clear', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const { consoleErrors, pageErrors } = await setupM4Session(page, {
    centerOn: { x: 22, z: 22 },
  });

  const field = await playfield(page);
  const statusEl = page.getByTestId('hud-status');

  // Find player 0 Keep
  const keep = await page.evaluate(() => {
    const sim = window.__bordev?.sim;
    if (!sim) throw new Error('Simulation not initialized');
    const b = sim.world.entities.find(
      (e) =>
        e &&
        e.kind === 'building' &&
        e.player === 0 &&
        (e.isTownCenter || e.type === 'keep' || e.type === 'crown_keep'),
    );
    if (!b || b.kind !== 'building') throw new Error('Player 0 Keep not found');
    return { id: b.id, x: b.x, z: b.z, maxHp: b.maxHp };
  });

  // 1. Rally via real input: click the Keep, right-click ground, wait ticks, Keep rallyPoint ≈ clicked ground point
  await page.waitForFunction(
    (id) => {
      const renderer = window.__bordev?.renderer;
      if (!renderer) return false;
      const r = renderer.getEntityScreenRect(id);
      return r !== undefined && r.right > r.left && r.bottom > r.top;
    },
    keep.id,
    { timeout: 10_000 },
  );
  const keepPt = await pickablePoint(page, keep.id);
  expect(keepPt.y).toBeGreaterThanOrEqual(field.top);
  expect(keepPt.y).toBeLessThanOrEqual(field.bottom);

  // Left-click to select the Keep
  await page.mouse.click(keepPt.x, keepPt.y, { button: 'left' });

  await page.waitForFunction(
    (id) => {
      const sel = window.__bordev?.session.input.selection.ids;
      return sel !== undefined && sel.length === 1 && sel[0] === id;
    },
    keep.id,
    { timeout: 5_000 },
  );

  // Right-click ground inside the playfield to set rally point
  // keepCx, keepCy is near playfield centre (y ~287); offset by (+240, 0) is well inside [field.left, field.right] and [field.top, field.bottom]
  const rallyScreenX = keepPt.x + 240;
  const rallyScreenY = keepPt.y;
  expect(rallyScreenY).toBeGreaterThanOrEqual(field.top);
  expect(rallyScreenY).toBeLessThanOrEqual(field.bottom);
  expect(rallyScreenX).toBeGreaterThanOrEqual(field.left);
  expect(rallyScreenX).toBeLessThanOrEqual(field.right);

  // Compute the expected ground world point using screenToGround projection from current camera view
  const expRallyWorld = await page.evaluate(
    ({ sx, sy }) => {
      const cam = window.__bordev?.session.renderer.camera;
      if (!cam) throw new Error('Renderer camera not available');
      const view = cam.view;
      const canvas = document.querySelector('canvas[aria-label="Game view"]');
      const rect = canvas?.getBoundingClientRect();
      const offX = rect?.left ?? 0;
      const offY = rect?.top ?? 0;
      const localX = sx - offX;
      const localY = sy - offY;
      const normX = (localX - view.width * 0.5) / view.zoom;
      const normY = (localY - view.height * 0.5) / view.zoom;
      const dx = normX / 96 + normY / 48;
      const dz = normY / 48 - normX / 96;
      return {
        x: view.targetX + dx,
        z: view.targetZ + dz,
      };
    },
    { sx: rallyScreenX, sy: rallyScreenY },
  );

  await page.mouse.click(rallyScreenX, rallyScreenY, { button: 'right' });
  await waitForTicks(page, 2);

  const rallyPoint = await page.evaluate((id) => {
    const b = window.__bordev?.sim?.world.entities[id];
    if (!b || b.kind !== 'building') return null;
    return b.rallyPoint ?? null;
  }, keep.id);
  expect(rallyPoint).not.toBeNull();
  expect(Math.abs(rallyPoint!.x - expRallyWorld.x)).toBeLessThan(1.0);
  expect(Math.abs(rallyPoint!.z - expRallyWorld.z)).toBeLessThan(1.0);
  // 2. Spawn a peasant for contextual actions
  const peasantId = (
    await page.evaluate(() => {
      const bordev = window.__bordev;
      if (!bordev?.cheats) throw new Error('Cheats not available');
      return bordev.cheats.spawnPeasants(1, 18, 22);
    })
  )[0];

  await page.waitForFunction(
    (id) => {
      const renderer = window.__bordev?.renderer;
      if (!renderer) return false;
      const r = renderer.getEntityScreenRect(id);
      return r !== undefined && r.right > r.left && r.bottom > r.top;
    },
    peasantId,
    { timeout: 10_000 },
  );

  const peasantPt = await pickablePoint(page, peasantId);
  expect(peasantPt.y).toBeGreaterThanOrEqual(field.top);
  expect(peasantPt.y).toBeLessThanOrEqual(field.bottom);

  // Select peasant
  await page.mouse.click(peasantPt.x, peasantPt.y, { button: 'left' });
  await page.waitForFunction(
    (id) => {
      const sel = window.__bordev?.session.input.selection.ids;
      return sel !== undefined && sel.length === 1 && sel[0] === id;
    },
    peasantId,
    { timeout: 5_000 },
  );

  // 3. Right-clicking a damaged own Keep issues repair and restores hit points.
  await page.evaluate((id) => {
    const b = window.__bordev?.sim?.world.entities[id];
    if (!b || b.kind !== 'building') throw new Error('Keep missing');
    b.hp = b.maxHp - 100;
  }, keep.id);

  // Right-click Keep for repair
  const keepRepairPt = await pickablePoint(page, keep.id);
  await page.mouse.click(keepRepairPt.x, keepRepairPt.y, { button: 'right' });
  await page.waitForFunction(
    ({ unitId, targetId }) => {
      const unit = window.__bordev?.sim?.world.getEntity(unitId);
      if (!unit || unit.kind !== 'unit') return false;
      const order = unit.order;
      if (!order) return false;
      return order.kind === 'repair' && order.targetId === targetId;
    },
    { unitId: peasantId, targetId: keep.id },
    { timeout: 10_000 },
  );
  await page.waitForFunction(
    ({ id, damagedHp }) => {
      const building = window.__bordev?.sim?.world.getEntity(id);
      return building?.kind === 'building' && building.hp > damagedHp;
    },
    { id: keep.id, damagedHp: keep.maxHp - 100 },
    { timeout: 10_000 },
  );

  // 4. Right-clicking a completed farm assigns a farmer and collects food.
  // Spawn farm at (25, 20) east of Keep (20..24, 20..24) in clear ground not overlapped by Keep sprite
  const farmId = await page.evaluate(() => {
    const sim = window.__bordev?.sim;
    if (!sim) throw new Error('Sim missing');
    const f = sim.world.spawnBuilding(
      0,
      'farm',
      25,
      20,
      true,
      undefined,
      'crown',
    );
    return f.id;
  });

  await waitForTicks(page, 2);
  await page.waitForFunction(
    (id) => {
      const renderer = window.__bordev?.renderer;
      if (!renderer) return false;
      const r = renderer.getEntityScreenRect(id);
      return r !== undefined && r.right > r.left && r.bottom > r.top;
    },
    farmId,
    { timeout: 10_000 },
  );

  const farmPt = await pickablePoint(page, farmId);
  expect(farmPt.y).toBeGreaterThanOrEqual(field.top);
  expect(farmPt.y).toBeLessThanOrEqual(field.bottom);

  const foodBeforeFarm = await page.evaluate(() => {
    const player = window.__bordev?.sim?.world.players[0];
    if (!player) throw new Error('Player 0 missing');
    return player.foodCollected;
  });
  await page.mouse.click(farmPt.x, farmPt.y, { button: 'right' });
  await page.waitForFunction(
    ({ unitId, targetId }) => {
      const unit = window.__bordev?.sim?.world.getEntity(unitId);
      if (!unit || unit.kind !== 'unit') return false;
      const order = unit.order;
      if (!order) return false;
      return order.kind === 'farm' && order.targetId === targetId;
    },
    { unitId: peasantId, targetId: farmId },
    { timeout: 10_000 },
  );
  await page.waitForFunction(
    ({ unitId, collected }) => {
      const world = window.__bordev?.sim?.world;
      const unit = world?.getEntity(unitId);
      return (
        unit?.kind === 'unit' &&
        unit.workAnimation === 'work' &&
        world !== undefined &&
        world.players[0].foodCollected > collected
      );
    },
    { unitId: peasantId, collected: foodBeforeFarm },
    { timeout: 10_000 },
  );

  // 5. Right-clicking a gold mine pins the selected cart and begins loading.
  // Spawn gold mine at (20, 25) south of Keep and cart at (21, 28) in clear ground
  const mineId = await page.evaluate(() => {
    const sim = window.__bordev?.sim;
    if (!sim) throw new Error('Sim missing');
    const m = sim.world.spawnMine(20, 25);
    return m.id;
  });

  const cartId = await page.evaluate(() => {
    const sim = window.__bordev?.sim;
    if (!sim) throw new Error('Sim missing');
    const c = sim.world.spawnUnit(0, 'ox_cart', 21, 28, 'crown');
    return c.id;
  });
  await waitForTicks(page, 2);
  await page.waitForFunction(
    (id) => {
      const renderer = window.__bordev?.renderer;
      if (!renderer) return false;
      const r = renderer.getEntityScreenRect(id);
      return r !== undefined && r.right > r.left && r.bottom > r.top;
    },
    cartId,
    { timeout: 10_000 },
  );
  await page.waitForFunction(
    (id) => {
      const renderer = window.__bordev?.renderer;
      if (!renderer) return false;
      const r = renderer.getEntityScreenRect(id);
      return r !== undefined && r.right > r.left && r.bottom > r.top;
    },
    mineId,
    { timeout: 10_000 },
  );

  const cartPt = await pickablePoint(page, cartId);
  expect(cartPt.y).toBeGreaterThanOrEqual(field.top);
  expect(cartPt.y).toBeLessThanOrEqual(field.bottom);

  // Select cart
  await page.mouse.click(cartPt.x, cartPt.y, { button: 'left' });

  await page.waitForFunction(
    (id) => {
      const sel = window.__bordev?.session.input.selection.ids;
      return sel !== undefined && sel.length === 1 && sel[0] === id;
    },
    cartId,
    { timeout: 5_000 },
  );

  const minePt = await pickablePoint(page, mineId);
  expect(minePt.y).toBeGreaterThanOrEqual(field.top);
  expect(minePt.y).toBeLessThanOrEqual(field.bottom);

  // Right-click gold mine
  await page.mouse.click(minePt.x, minePt.y, { button: 'right' });
  await page.waitForFunction(
    ({ unitId, targetId }) => {
      const unit = window.__bordev?.sim?.world.getEntity(unitId);
      if (!unit || unit.kind !== 'unit') return false;
      const order = unit.order;
      if (!order) return false;
      return (
        order.kind === 'pinMine' &&
        order.targetId === targetId &&
        unit.cart?.pinnedMineId === targetId
      );
    },
    { unitId: cartId, targetId: mineId },
    { timeout: 10_000 },
  );
  await page.waitForFunction(
    ({ unitId, targetId }) => {
      const unit = window.__bordev?.sim?.world.getEntity(unitId);
      return (
        unit?.kind === 'unit' &&
        unit.cart?.pinnedMineId === targetId &&
        unit.cart.mineId === targetId &&
        ((unit.cart.phase === 'loading' && unit.cart.ticks > 0) ||
          unit.cart.carriedGold > 0)
      );
    },
    { unitId: cartId, targetId: mineId },
    { timeout: 10_000 },
  );

  // 6. Right-click enemy unit with own unit selected -> combat message
  // Spawn enemy at (27, 24) south-east of Keep in clear ground
  const enemyId = await page.evaluate(() => {
    const sim = window.__bordev?.sim;
    if (!sim) throw new Error('Sim missing');
    const e = sim.world.spawnUnit(1, 'spearman', 27, 24, 'crown');
    return e.id;
  });

  await waitForTicks(page, 2);
  await page.waitForFunction(
    (id) => {
      const renderer = window.__bordev?.renderer;
      if (!renderer) return false;
      const r = renderer.getEntityScreenRect(id);
      return r !== undefined && r.right > r.left && r.bottom > r.top;
    },
    enemyId,
    { timeout: 10_000 },
  );

  const enemyPt = await pickablePoint(page, enemyId);
  expect(enemyPt.y).toBeGreaterThanOrEqual(field.top);
  expect(enemyPt.y).toBeLessThanOrEqual(field.bottom);

  // Right-click enemy unit (cart is still selected)
  await page.mouse.click(enemyPt.x, enemyPt.y, { button: 'right' });
  await expect(statusEl).toHaveText('Combat system requires Milestone 7');

  // 7. Status line auto-clears ~4 s after appearing (positive: visible first; then hidden, bounded wait)
  await expect(statusEl).toBeHidden({ timeout: 6_000 });

  expect(consoleErrors, 'console errors during contextual orders test').toEqual(
    [],
  );
  expect(
    pageErrors,
    'uncaught page errors during contextual orders test',
  ).toEqual([]);
});
