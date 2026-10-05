import { expect, test, type Page } from '@playwright/test';
import {
  setupM4Session,
  worldToScreen,
  waitForTicks,
  playfield,
} from './fixtures/m4';

test('H hotkey and Keep control-group doubletap centre camera at actual footprint midpoint', async ({
  page,
}) => {
  test.setTimeout(45_000);
  const { consoleErrors, pageErrors } = await setupM4Session(page, {
    centerOn: { x: 60, z: 60 },
  });

  // Verify HUD shell is visible in DOM
  await expect(page.getByTestId('hud-topbar')).toBeVisible();

  // Find player 0 Keep in sim state
  const keep = await page.evaluate(() => {
    const sim = window.__bordev?.sim;
    if (!sim) throw new Error('Simulation not initialized');
    const b = sim.world.entities.find(
      (e) =>
        e !== undefined &&
        e.kind === 'building' &&
        e.player === 0 &&
        (e.isTownCenter || e.type === 'keep' || e.type === 'crown_keep'),
    );
    if (!b || b.kind !== 'building') throw new Error('Keep building not found');
    return {
      id: b.id,
      x: b.x,
      z: b.z,
      width: b.width,
      height: b.height,
      midX: b.x + b.width / 2,
      midZ: b.z + b.height / 2,
    };
  });

  // Keep footprint is 4x4, raw corner is (20, 20), midpoint is (22, 22)
  expect(keep.width).toBe(4);
  expect(keep.height).toBe(4);
  expect(keep.midX).toBe(keep.x + 2);
  expect(keep.midZ).toBe(keep.z + 2);

  const pf = await playfield(page);
  const expectedCenterX = (pf.left + pf.right) / 2;
  const expectedCenterY = (pf.top + pf.bottom) / 2;

  // 1. Verify 'H' hotkey centres Keep footprint midpoint at the centre of playfield (via worldToScreen)
  await page.keyboard.press('KeyH');

  await page.waitForFunction(
    async ({ midX, midZ, expX, expY }) => {
      const cam = window.__bordev?.session.renderer.camera;
      const canvas = window.__bordev?.session.renderer.canvas;
      if (!cam || !canvas) return false;
      const rect = canvas.getBoundingClientRect();
      const dx = midX - cam.view.targetX;
      const dz = midZ - cam.view.targetZ;
      const sx =
        rect.left + cam.view.width * 0.5 + (dx - dz) * 48 * cam.view.zoom;
      const sy =
        rect.top + cam.view.height * 0.5 + (dx + dz) * 24 * cam.view.zoom;
      return Math.abs(sx - expX) <= 2.0 && Math.abs(sy - expY) <= 2.0;
    },
    {
      midX: keep.midX,
      midZ: keep.midZ,
      expX: expectedCenterX,
      expY: expectedCenterY,
    },
    { timeout: 10_000 },
  );

  const hKeepScreen = await worldToScreen(page, keep.midX, keep.midZ);
  expect(Math.abs(hKeepScreen.x - expectedCenterX)).toBeLessThanOrEqual(2);
  expect(Math.abs(hKeepScreen.y - expectedCenterY)).toBeLessThanOrEqual(2);

  // Confirm Keep origin tile corner (keep.x, keep.z) does NOT project to playfield centre
  const hOriginScreen = await worldToScreen(page, keep.x, keep.z);
  expect(
    Math.abs(hOriginScreen.x - expectedCenterX) > 5 ||
      Math.abs(hOriginScreen.y - expectedCenterY) > 5,
  ).toBe(true);

  // 2. Select Keep, observe sim/input state and DOM
  await page.evaluate((keepId) => {
    window.__bordev?.session.input.selection.set([keepId]);
  }, keep.id);

  await page.waitForFunction(
    (keepId) => {
      const sel = window.__bordev?.session.input.selection.ids;
      return sel && sel.length === 1 && sel[0] === keepId;
    },
    keep.id,
    { timeout: 5_000 },
  );

  const selectionName = page.getByTestId('selection-name');
  await expect(selectionName).toBeVisible();
  await expect(selectionName).toContainText('Keep');

  // Assign Keep to control group 1 (Ctrl+1)
  await page.keyboard.press('Control+Digit1');

  // Pan camera away to (75, 75)
  await page.evaluate(() => {
    const cam = window.__bordev?.session.renderer.camera;
    if (!cam) throw new Error('Camera unavailable');
    cam.centerOn(75, 75);
  });

  await page.waitForFunction(() => {
    const cam = window.__bordev?.session.renderer.camera;
    return (
      cam &&
      Math.abs(cam.view.targetX - 75) < 2 &&
      Math.abs(cam.view.targetZ - 75) < 2
    );
  });

  // 3. Double-tap '1' to recall and centre camera on control group
  await page.keyboard.press('Digit1');
  await page.waitForTimeout(60);
  await page.keyboard.press('Digit1');

  // Verify camera centres Keep midpoint at playfield centre
  await page.waitForFunction(
    async ({ midX, midZ, expX, expY }) => {
      const cam = window.__bordev?.session.renderer.camera;
      const canvas = window.__bordev?.session.renderer.canvas;
      if (!cam || !canvas) return false;
      const rect = canvas.getBoundingClientRect();
      const dx = midX - cam.view.targetX;
      const dz = midZ - cam.view.targetZ;
      const sx =
        rect.left + cam.view.width * 0.5 + (dx - dz) * 48 * cam.view.zoom;
      const sy =
        rect.top + cam.view.height * 0.5 + (dx + dz) * 24 * cam.view.zoom;
      return Math.abs(sx - expX) <= 2.0 && Math.abs(sy - expY) <= 2.0;
    },
    {
      midX: keep.midX,
      midZ: keep.midZ,
      expX: expectedCenterX,
      expY: expectedCenterY,
    },
    { timeout: 10_000 },
  );

  const groupKeepScreen = await worldToScreen(page, keep.midX, keep.midZ);
  expect(Math.abs(groupKeepScreen.x - expectedCenterX)).toBeLessThanOrEqual(2);
  expect(Math.abs(groupKeepScreen.y - expectedCenterY)).toBeLessThanOrEqual(2);

  const groupOriginScreen = await worldToScreen(page, keep.x, keep.z);
  expect(
    Math.abs(groupOriginScreen.x - expectedCenterX) > 5 ||
      Math.abs(groupOriginScreen.y - expectedCenterY) > 5,
  ).toBe(true);

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('control group rejects recycled entity IDs after real Delete next tick and same-frame replacement', async ({
  page,
}) => {
  test.setTimeout(45_000);
  const { consoleErrors, pageErrors } = await setupM4Session(page, {
    centerOn: { x: 50, z: 50 },
  });

  // --- Scenario A: Real Delete next tick, debug spawn replacement that reuses ID ---
  // Spawn 2 peasants: unitA1 at (50, 50), unitA2 at (51, 50)
  const [unitA1] = await page.evaluate(() => {
    return window.__bordev?.cheats?.spawnPeasants(1, 50, 50) ?? [];
  });
  const [unitA2] = await page.evaluate(() => {
    return window.__bordev?.cheats?.spawnPeasants(1, 51, 50) ?? [];
  });
  expect(unitA1).toBeDefined();
  expect(unitA2).toBeDefined();
  expect(unitA1).not.toBe(unitA2);

  // Select both peasants and assign to control group 2 via Ctrl+2
  await page.evaluate(
    ({ a1, a2 }) => {
      window.__bordev?.session.input.selection.set([a1, a2]);
    },
    { a1: unitA1, a2: unitA2 },
  );

  await page.waitForFunction(
    ({ a1, a2 }) => {
      const ids = window.__bordev?.session.input.selection.ids;
      return ids && ids.includes(a1) && ids.includes(a2);
    },
    { a1: unitA1, a2: unitA2 },
    { timeout: 5_000 },
  );

  await page.keyboard.press('Control+Digit2');

  // Select only unitA1 to delete it
  await page.evaluate((id) => {
    window.__bordev?.session.input.selection.set([id]);
  }, unitA1);

  await page.waitForFunction(
    (id) => {
      const ids = window.__bordev?.session.input.selection.ids;
      return ids && ids.length === 1 && ids[0] === id;
    },
    unitA1,
    { timeout: 5_000 },
  );

  // Press real Delete key to delete unitA1
  await page.keyboard.press('Delete');

  // Wait until entity unitA1 is removed from sim
  await page.waitForFunction(
    (id) => {
      const sim = window.__bordev?.sim;
      return sim && sim.world.getEntity(id) === undefined;
    },
    unitA1,
    { timeout: 10_000 },
  );

  // Wait a couple ticks for SelectionController update to prune deleted entity
  await waitForTicks(page, 2);

  // Debug-spawn replacement peasant. World.allocateId reuses unitA1
  const [reusedAId] = await page.evaluate(() => {
    return window.__bordev?.cheats?.spawnPeasants(1, 52, 52) ?? [];
  });
  expect(reusedAId).toBe(unitA1);

  // Recall group 2 using keyboard '2'
  await page.keyboard.press('Digit2');
  await waitForTicks(page, 2);

  // Positive control: group 2 recalls unitA2, but NOT the recycled unitA1
  const selectedAfterRecallA = await page.evaluate(() => {
    return window.__bordev?.session.input.selection.ids ?? [];
  });
  expect(selectedAfterRecallA).toEqual([unitA2]);
  expect(selectedAfterRecallA).not.toContain(unitA1);

  // --- Scenario B: Same-frame debug removal and replacement to prove identity ref check ---
  const [unitB1] = await page.evaluate(() => {
    return window.__bordev?.cheats?.spawnPeasants(1, 54, 54) ?? [];
  });
  const [unitB2] = await page.evaluate(() => {
    return window.__bordev?.cheats?.spawnPeasants(1, 55, 54) ?? [];
  });
  expect(unitB1).toBeDefined();
  expect(unitB2).toBeDefined();

  // Select both and assign to control group 3 via Ctrl+3
  await page.evaluate(
    ({ b1, b2 }) => {
      window.__bordev?.session.input.selection.set([b1, b2]);
    },
    { b1: unitB1, b2: unitB2 },
  );
  await page.keyboard.press('Control+Digit3');

  // Clear active selection to prove group identity check works independently of active selection
  await page.evaluate(() => {
    window.__bordev?.session.input.selection.clear();
  });

  // In a single evaluation (same JS frame), remove unit B1 and spawn replacement
  const sameFrameResult = await page.evaluate((id) => {
    const sim = window.__bordev?.sim;
    const cheats = window.__bordev?.cheats;
    if (!sim || !cheats) throw new Error('Sim/cheats missing');
    sim.world.removeEntity(id);
    const [reused] = cheats.spawnPeasants(1, 56, 56);
    return { original: id, reused };
  }, unitB1);
  expect(sameFrameResult.reused).toBe(sameFrameResult.original);

  // Recall group 3 using keyboard '3'
  await page.keyboard.press('Digit3');
  await waitForTicks(page, 2);

  // Positive control: group 3 recalls unitB2, but NOT the recycled unitB1
  const selectedAfterRecallB = await page.evaluate(() => {
    return window.__bordev?.session.input.selection.ids ?? [];
  });
  expect(selectedAfterRecallB).toEqual([unitB2]);
  expect(selectedAfterRecallB).not.toContain(unitB1);

  // --- Scenario C: Active-selection entity identity pruning (ReviewInput#2) ---
  // Select a peasant, remove it and spawn a doodad and a new peasant reusing IDs in the same frame via __bordev.sim.world,
  // then assert the active selection no longer contains the recycled ID.
  const [unitC] = await page.evaluate(() => {
    return window.__bordev?.cheats?.spawnPeasants(1, 58, 58) ?? [];
  });
  expect(unitC).toBeDefined();

  await page.evaluate((id) => {
    window.__bordev?.session.input.selection.set([id]);
  }, unitC);

  await page.waitForFunction(
    (id) => {
      const sel = window.__bordev?.session.input.selection.ids;
      return sel && sel.length === 1 && sel[0] === id;
    },
    unitC,
    { timeout: 5_000 },
  );

  // In a single evaluation, remove unitC, spawn a doodad (reusing unitC's ID), then spawn a new peasant
  const scenarioCResult = await page.evaluate((id) => {
    const world = window.__bordev?.sim?.world;
    if (!world) throw new Error('World missing');
    world.removeEntity(id);
    const doodad = world.spawnDoodad(41, 41, 'tree_1');
    const newPeasant = world.spawnUnit(0, 'peasant', 58, 58);
    return {
      originalId: id,
      doodadId: doodad.id,
      newPeasantId: newPeasant.id,
      doodadKind: doodad.kind,
    };
  }, unitC);

  // Verify ID was recycled
  expect(scenarioCResult.doodadId).toBe(scenarioCResult.originalId);
  expect(scenarioCResult.doodadKind).toBe('doodad');

  // Wait a couple ticks for SelectionController.update() to prune
  await waitForTicks(page, 2);

  // Selection must no longer contain the recycled ID
  const selectedAfterScenarioC = await page.evaluate(() => {
    return window.__bordev?.session.input.selection.ids ?? [];
  });
  expect(selectedAfterScenarioC).not.toContain(unitC);
  expect(selectedAfterScenarioC).toHaveLength(0);

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('arrow key hold produces camera movement, window blur resets held state without continued movement', async ({
  page,
}) => {
  test.setTimeout(45_000);
  const { consoleErrors, pageErrors } = await setupM4Session(page, {
    centerOn: { x: 50, z: 50 },
  });

  const canvas = page.getByLabel('Game view', { exact: true });
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();

  // Position mouse safely at the centre of the canvas (far from the 8px edge scroll margins)
  const canvasCenterX = canvasBox!.x + canvasBox!.width * 0.5;
  const canvasCenterY = canvasBox!.y + canvasBox!.height * 0.5;
  await page.mouse.move(canvasCenterX, canvasCenterY);

  // 1. ArrowRight hold produces camera movement
  const posBeforeRight = await page.evaluate(() => {
    const cam = window.__bordev?.session.renderer.camera;
    if (!cam) throw new Error('Renderer camera missing');
    return { x: cam.view.targetX, z: cam.view.targetZ };
  });

  await page.keyboard.down('ArrowRight');

  // Wait for camera to move in the live render loop
  await page.waitForFunction(
    (prev) => {
      const cam = window.__bordev?.session.renderer.camera;
      return (
        cam && (cam.view.targetX !== prev.x || cam.view.targetZ !== prev.z)
      );
    },
    posBeforeRight,
    { timeout: 10_000 },
  );

  // 2. Trigger window blur event while key is STILL held down
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
  });

  // Wait several sim ticks while key is STILL held
  await waitForTicks(page, 5);

  // Record camera position after blur settled
  const posAfterBlur = await page.evaluate(() => {
    const cam = window.__bordev?.session.renderer.camera;
    if (!cam) throw new Error('Renderer camera missing');
    return { x: cam.view.targetX, z: cam.view.targetZ };
  });

  // Wait several more sim ticks with key still held
  await waitForTicks(page, 5);

  // Assert camera stopped moving despite key still being held
  const posAfterWait = await page.evaluate(() => {
    const cam = window.__bordev?.session.renderer.camera;
    if (!cam) throw new Error('Renderer camera missing');
    return { x: cam.view.targetX, z: cam.view.targetZ };
  });

  expect(Math.abs(posAfterWait.x - posAfterBlur.x)).toBeLessThan(0.01);
  expect(Math.abs(posAfterWait.z - posAfterBlur.z)).toBeLessThan(0.01);

  // Only release key AFTER the assertion
  await page.keyboard.up('ArrowRight');
  await page.mouse.move(canvasCenterX, canvasCenterY);

  // 3. Repeat with ArrowDown to verify vertical arrow flag reset on blur
  const posBeforeDown = await page.evaluate(() => {
    const cam = window.__bordev?.session.renderer.camera;
    if (!cam) throw new Error('Renderer camera missing');
    return { x: cam.view.targetX, z: cam.view.targetZ };
  });

  await page.keyboard.down('ArrowDown');

  await page.waitForFunction(
    (prev) => {
      const cam = window.__bordev?.session.renderer.camera;
      return (
        cam && (cam.view.targetX !== prev.x || cam.view.targetZ !== prev.z)
      );
    },
    posBeforeDown,
    { timeout: 10_000 },
  );

  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
  });

  // Wait several sim ticks with ArrowDown still held
  await waitForTicks(page, 5);

  const posAfterBlurDown = await page.evaluate(() => {
    const cam = window.__bordev?.session.renderer.camera;
    if (!cam) throw new Error('Renderer camera missing');
    return { x: cam.view.targetX, z: cam.view.targetZ };
  });

  await waitForTicks(page, 5);

  const posAfterWaitDown = await page.evaluate(() => {
    const cam = window.__bordev?.session.renderer.camera;
    if (!cam) throw new Error('Renderer camera missing');
    return { x: cam.view.targetX, z: cam.view.targetZ };
  });

  expect(Math.abs(posAfterWaitDown.x - posAfterBlurDown.x)).toBeLessThan(0.01);
  expect(Math.abs(posAfterWaitDown.z - posAfterBlurDown.z)).toBeLessThan(0.01);

  // Release key only afterwards
  await page.keyboard.up('ArrowDown');
  await page.mouse.move(canvasCenterX, canvasCenterY);

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

interface MarkerLifecycleProof {
  kind: 'move' | 'attackMove';
  worldTarget: { x: number; z: number };
  expiresAt: number;
  initialRemainingLifetime: number;
  freshFramesCount: number;
  elapsedSec: number;
}

declare global {
  interface Window {
    __markerLifecyclePromise?: Promise<MarkerLifecycleProof>;
  }
}

async function observeMarkerLifecycle(
  page: Page,
  expectedKind: 'move' | 'attackMove',
  triggerAction: () => Promise<void>,
): Promise<MarkerLifecycleProof> {
  // 1. Install observer in browser before native input action
  await page.evaluate((kind) => {
    const bordev = window.__bordev;
    if (!bordev) throw new Error('window.__bordev unavailable');
    const orders = bordev.session.input.orders;

    // Snapshot existing markers to ignore any past markers
    const existingSet = new Set(orders.markers.map((m) => m.expiresAt));

    type CapturedMarker = {
      kind: 'move' | 'attackMove';
      x: number;
      z: number;
      expiresAt: number;
      initialRemainingLifetime: number;
    };

    let captured: CapturedMarker | null = null;
    let freshFramesCount = 0;
    let rafId = 0;
    let timeoutId = 0;
    let completed = false;
    let captureStartSec = 0;

    const tryCapture = (nowSec: number) => {
      if (captured !== null) return;
      const markers = orders.markers;
      for (let i = markers.length - 1; i >= 0; i--) {
        const m = markers[i];
        if (m.kind === kind && !existingSet.has(m.expiresAt)) {
          captureStartSec = nowSec;
          captured = {
            kind: m.kind,
            x: m.x,
            z: m.z,
            expiresAt: m.expiresAt,
            initialRemainingLifetime: m.expiresAt - nowSec,
          };
          break;
        }
      }
    };

    const canvas = bordev.session.renderer.canvas;

    const promise = new Promise<MarkerLifecycleProof>((resolve, reject) => {
      const cleanup = () => {
        completed = true;
        window.clearTimeout(timeoutId);
        canvas.removeEventListener('pointerdown', onPointerDown);
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
      };

      // Sufficient wall deadline under SwiftShader (15s)
      timeoutId = window.setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `Marker lifecycle observer for '${kind}' timed out after 15s (captured: ${captured !== null}, freshFrames: ${freshFramesCount})`,
          ),
        );
      }, 15_000);

      // Bubbling phase on canvas fires synchronously AFTER InputController handler
      const onPointerDown = () => {
        tryCapture(performance.now() / 1000);
        canvas.removeEventListener('pointerdown', onPointerDown);
      };

      canvas.addEventListener('pointerdown', onPointerDown);

      const checkRaf = (nowMs: number) => {
        if (completed) return;
        const frameSec = nowMs / 1000;

        if (captured === null) {
          tryCapture(frameSec);
        }

        if (captured !== null) {
          const markers = orders.markers;
          const isPresent = markers.some(
            (m) =>
              m.kind === captured!.kind && m.expiresAt === captured!.expiresAt,
          );

          if (isPresent) {
            freshFramesCount++;
          } else {
            // Marker is no longer present!
            const elapsedSec = frameSec - captureStartSec;
            cleanup();
            resolve({
              kind: captured.kind,
              worldTarget: { x: captured.x, z: captured.z },
              expiresAt: captured.expiresAt,
              initialRemainingLifetime: captured.initialRemainingLifetime,
              freshFramesCount,
              elapsedSec,
            });
            return;
          }
        }

        rafId = requestAnimationFrame(checkRaf);
      };

      rafId = requestAnimationFrame(checkRaf);
    });

    window.__markerLifecyclePromise = promise;
  }, expectedKind);

  // 2. Perform actual native mouse/keyboard action
  await triggerAction();

  // 3. Await observer completion (returns immutable proof after expiry)
  const proof = await page.evaluate(async () => {
    const p = window.__markerLifecyclePromise;
    if (!p)
      throw new Error('window.__markerLifecyclePromise was not registered');
    try {
      return await p;
    } finally {
      delete window.__markerLifecyclePromise;
    }
  });

  return proof;
}

test('fresh move and attack-move markers exist and expire after ~1s in real-time pre-100s frames', async ({
  page,
}) => {
  test.setTimeout(45_000);
  const { consoleErrors, pageErrors } = await setupM4Session(page, {
    centerOn: { x: 50, z: 50 },
  });

  // Spawn 1 peasant at (50, 50) and select it
  const [peasantId] = await page.evaluate(() => {
    const bordev = window.__bordev;
    if (!bordev?.cheats) throw new Error('Cheats not available');
    return bordev.cheats.spawnPeasants(1, 50, 50);
  });

  await page.evaluate((id) => {
    window.__bordev?.session.input.selection.set([id]);
  }, peasantId);

  // Destination tile (54, 50) via worldToScreen fixture helper
  const targetScreen = await worldToScreen(page, 54, 50);

  // --- Part 1: Move order marker ---
  // Right-click target tile to issue move order and spawn move marker
  const moveProof = await observeMarkerLifecycle(page, 'move', async () => {
    await page.mouse.click(targetScreen.x, targetScreen.y, { button: 'right' });
  });

  expect(moveProof.kind).toBe('move');
  expect(moveProof.worldTarget.x).toBeCloseTo(54, 0);
  expect(moveProof.worldTarget.z).toBeCloseTo(50, 0);
  expect(moveProof.freshFramesCount).toBeGreaterThan(0);
  expect(moveProof.initialRemainingLifetime).toBeGreaterThan(0);
  expect(moveProof.elapsedSec).toBeLessThanOrEqual(2.5);

  const markersAfterMove = await page.evaluate(() => {
    return window.__bordev?.session.input.orders.markers ?? [];
  });
  expect(markersAfterMove.some((m) => m.kind === 'move')).toBe(false);

  // --- Part 2: Attack-move order marker ---
  // Press R to enter the visible Attack-move command-card slot.
  await page.keyboard.press('KeyR');

  // Verify attack-move mode is active in orders controller
  const isAttackMoveMode = await page.evaluate(() => {
    return window.__bordev?.session.input.orders.mode === 'attackMove';
  });
  expect(isAttackMoveMode).toBe(true);

  // Destination tile (46, 50) via worldToScreen fixture helper
  const attackTargetScreen = await worldToScreen(page, 46, 50);

  const attackProof = await observeMarkerLifecycle(
    page,
    'attackMove',
    async () => {
      await page.mouse.click(attackTargetScreen.x, attackTargetScreen.y, {
        button: 'left',
      });
    },
  );

  expect(attackProof.kind).toBe('attackMove');
  expect(attackProof.worldTarget.x).toBeCloseTo(46, 0);
  expect(attackProof.worldTarget.z).toBeCloseTo(50, 0);
  expect(attackProof.freshFramesCount).toBeGreaterThan(0);
  expect(attackProof.initialRemainingLifetime).toBeGreaterThan(0);
  expect(attackProof.elapsedSec).toBeLessThanOrEqual(2.5);

  const markersAfterAttack = await page.evaluate(() => {
    return window.__bordev?.session.input.orders.markers ?? [];
  });
  expect(markersAfterAttack.some((m) => m.kind === 'attackMove')).toBe(false);

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('edge scroll stops when pointer leaves the window or on window blur (ReviewInput#0)', async ({
  page,
}) => {
  test.setTimeout(45_000);
  const { consoleErrors, pageErrors } = await setupM4Session(page, {
    centerOn: { x: 50, z: 50 },
  });

  // Verify topbar is mounted
  await expect(page.getByTestId('hud-topbar')).toBeVisible();

  // Case 1: Pointer at (640, 3) over top bar starts edge scroll, moving to (640, -20) outside window stops it
  const posBeforeTopEdge = await page.evaluate(() => {
    const cam = window.__bordev?.session.renderer.camera;
    if (!cam) throw new Error('Camera missing');
    return { x: cam.view.targetX, z: cam.view.targetZ };
  });

  await page.mouse.move(640, 3);

  // Wait for camera to start moving from edge scroll
  await page.waitForFunction(
    (prev) => {
      const cam = window.__bordev?.session.renderer.camera;
      return (
        cam && (cam.view.targetX !== prev.x || cam.view.targetZ !== prev.z)
      );
    },
    posBeforeTopEdge,
    { timeout: 10_000 },
  );

  // Move pointer outside browser window
  await page.mouse.move(640, -20);
  await waitForTicks(page, 2);

  const posAfterExit = await page.evaluate(() => {
    const cam = window.__bordev?.session.renderer.camera;
    if (!cam) throw new Error('Camera missing');
    return { x: cam.view.targetX, z: cam.view.targetZ };
  });

  // Wait across >= 10 sim ticks
  await waitForTicks(page, 10);

  const posAfter10Ticks = await page.evaluate(() => {
    const cam = window.__bordev?.session.renderer.camera;
    if (!cam) throw new Error('Camera missing');
    return { x: cam.view.targetX, z: cam.view.targetZ };
  });

  expect(Math.abs(posAfter10Ticks.x - posAfterExit.x)).toBeLessThan(0.01);
  expect(Math.abs(posAfter10Ticks.z - posAfterExit.z)).toBeLessThan(0.01);

  // Case 2: Pointer at x=3 (left edge scroll margin) starts scroll, dispatch window blur stops it
  const posBeforeLeftEdge = await page.evaluate(() => {
    const cam = window.__bordev?.session.renderer.camera;
    if (!cam) throw new Error('Camera missing');
    return { x: cam.view.targetX, z: cam.view.targetZ };
  });

  await page.mouse.move(3, 300);

  await page.waitForFunction(
    (prev) => {
      const cam = window.__bordev?.session.renderer.camera;
      return (
        cam && (cam.view.targetX !== prev.x || cam.view.targetZ !== prev.z)
      );
    },
    posBeforeLeftEdge,
    { timeout: 10_000 },
  );

  // Dispatch blur while mouse is still at x=3
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
  });
  await waitForTicks(page, 2);

  const posAfterBlur = await page.evaluate(() => {
    const cam = window.__bordev?.session.renderer.camera;
    if (!cam) throw new Error('Camera missing');
    return { x: cam.view.targetX, z: cam.view.targetZ };
  });

  await waitForTicks(page, 10);

  const posAfterBlur10Ticks = await page.evaluate(() => {
    const cam = window.__bordev?.session.renderer.camera;
    if (!cam) throw new Error('Camera missing');
    return { x: cam.view.targetX, z: cam.view.targetZ };
  });

  expect(Math.abs(posAfterBlur10Ticks.x - posAfterBlur.x)).toBeLessThan(0.01);
  expect(Math.abs(posAfterBlur10Ticks.z - posAfterBlur.z)).toBeLessThan(0.01);

  // Return mouse safely to center
  await page.mouse.move(640, 360);

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('key autorepeat is ignored for group recall and command execution (ReviewInput#1)', async ({
  page,
}) => {
  test.setTimeout(45_000);
  const { consoleErrors, pageErrors } = await setupM4Session(page, {
    centerOn: { x: 50, z: 50 },
  });

  const pf = await playfield(page);
  const pfCenterX = (pf.left + pf.right) / 2;
  const pfCenterY = (pf.top + pf.bottom) / 2;

  // 1. Spawn distant peasant at (85, 85), select and assign to group 1
  const [distantId] = await page.evaluate(() => {
    return window.__bordev?.cheats?.spawnPeasants(1, 85, 85) ?? [];
  });
  expect(distantId).toBeDefined();

  const distantUnit = await page.evaluate((id) => {
    const ent = window.__bordev?.sim?.world.getEntity(id);
    if (!ent || ent.kind !== 'unit') throw new Error('Unit missing');
    return { id: ent.id, x: ent.x, z: ent.z };
  }, distantId);

  await page.evaluate((id) => {
    window.__bordev?.session.input.selection.set([id]);
  }, distantId);

  await page.waitForFunction(
    (id) => {
      const ids = window.__bordev?.session.input.selection.ids;
      return ids && ids.length === 1 && ids[0] === id;
    },
    distantId,
    { timeout: 5_000 },
  );

  await page.keyboard.press('Control+Digit1');

  // Move camera far away to (25, 25)
  await page.evaluate(() => {
    const cam = window.__bordev?.session.renderer.camera;
    if (!cam) throw new Error('Camera missing');
    cam.centerOn(25, 25);
  });

  await page.waitForFunction(() => {
    const cam = window.__bordev?.session.renderer.camera;
    return (
      cam &&
      Math.abs(cam.view.targetX - 25) < 2 &&
      Math.abs(cam.view.targetZ - 25) < 2
    );
  });

  // Hold Digit1 with repeats: first down, then further down calls (marked repeat)
  await page.keyboard.down('Digit1');
  await waitForTicks(page, 1);
  await page.keyboard.down('Digit1');
  await waitForTicks(page, 1);
  await page.keyboard.down('Digit1');
  await page.keyboard.up('Digit1');

  // Wait several sim ticks to ensure camera did not jump
  await waitForTicks(page, 5);

  const camAfterRepeat = await page.evaluate(() => {
    const cam = window.__bordev?.session.renderer.camera;
    return { x: cam?.view.targetX, z: cam?.view.targetZ };
  });
  // Camera target should remain near (25, 25), NOT jumped to distant unit's actual position
  expect(Math.abs(camAfterRepeat.x! - 25)).toBeLessThan(2);
  expect(Math.abs(camAfterRepeat.z! - 25)).toBeLessThan(2);
  expect(Math.abs(camAfterRepeat.x! - distantUnit.x)).toBeGreaterThan(10);
  expect(Math.abs(camAfterRepeat.z! - distantUnit.z)).toBeGreaterThan(10);

  // Positive control: two separate press/release taps within 300 ms DO centre camera
  await page.keyboard.press('Digit1');
  await page.waitForTimeout(60);
  await page.keyboard.press('Digit1');

  // Wait for camera to centre on distant peasant at (distantUnit.x, distantUnit.z)
  await page.waitForFunction(
    async ({ targetX, targetZ, expX, expY }) => {
      const cam = window.__bordev?.session.renderer.camera;
      const canvas = window.__bordev?.session.renderer.canvas;
      if (!cam || !canvas) return false;
      const rect = canvas.getBoundingClientRect();
      const dx = targetX - cam.view.targetX;
      const dz = targetZ - cam.view.targetZ;
      const sx =
        rect.left + cam.view.width * 0.5 + (dx - dz) * 48 * cam.view.zoom;
      const sy =
        rect.top + cam.view.height * 0.5 + (dx + dz) * 24 * cam.view.zoom;
      return Math.abs(sx - expX) <= 2.0 && Math.abs(sy - expY) <= 2.0;
    },
    {
      targetX: distantUnit.x,
      targetZ: distantUnit.z,
      expX: pfCenterX,
      expY: pfCenterY,
    },
    { timeout: 10_000 },
  );

  const unitScreen = await worldToScreen(page, distantUnit.x, distantUnit.z);
  expect(Math.abs(unitScreen.x - pfCenterX)).toBeLessThanOrEqual(2);
  expect(Math.abs(unitScreen.y - pfCenterY)).toBeLessThanOrEqual(2);

  // 2. Holding KeyW with repeats increments selected unit's orderGeneration exactly once
  // Issue a move order so peasant is active
  await page.evaluate((id) => {
    const session = window.__bordev?.session;
    if (!session) throw new Error('Session missing');
    session.input.selection.set([id]);
    session.input.orders.contextOrder(70, 70, false);
  }, distantId);

  await waitForTicks(page, 2);

  const initialGen = await page.evaluate((id) => {
    const ent = window.__bordev?.sim?.world.getEntity(id);
    return ent && ent.kind === 'unit' ? ent.orderGeneration : -1;
  }, distantId);
  expect(initialGen).toBeGreaterThan(0);

  // Hold KeyW with repeats: down, wait, repeat down, repeat down, then up
  await page.keyboard.down('KeyW');
  await waitForTicks(page, 1);
  await page.keyboard.down('KeyW');
  await waitForTicks(page, 1);
  await page.keyboard.down('KeyW');
  await page.keyboard.up('KeyW');

  await waitForTicks(page, 3);

  const finalGen = await page.evaluate((id) => {
    const ent = window.__bordev?.sim?.world.getEntity(id);
    return ent && ent.kind === 'unit' ? ent.orderGeneration : -1;
  }, distantId);

  // Must have incremented exactly once despite multiple repeated down events
  expect(finalGen).toBe(initialGen + 1);

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('first Period press selects the first idle peasant in entity order (ReviewInput#3)', async ({
  page,
}) => {
  test.setTimeout(45_000);
  const { consoleErrors, pageErrors } = await setupM4Session(page, {
    centerOn: { x: 50, z: 50 },
  });

  // Find the first idle worker (peasant or thrall) owned by player 0 in sim entity order
  const firstIdleId = await page.evaluate(() => {
    const sim = window.__bordev?.sim;
    if (!sim) throw new Error('Sim missing');
    for (const ent of sim.world.entities) {
      if (
        ent &&
        ent.kind === 'unit' &&
        ent.player === 0 &&
        ent.order?.kind === 'idle' &&
        (ent.type.includes('peasant') || ent.type.includes('thrall'))
      ) {
        return ent.id;
      }
    }
    return null;
  });
  expect(firstIdleId).not.toBeNull();

  // Clear any existing selection
  await page.evaluate(() => {
    window.__bordev?.session.input.selection.clear();
  });

  // First press of Period (.)
  await page.keyboard.press('Period');

  // Wait for selection to update
  await page.waitForFunction(
    (expectedId) => {
      const sel = window.__bordev?.session.input.selection.ids;
      return sel && sel.length === 1 && sel[0] === expectedId;
    },
    firstIdleId,
    { timeout: 5_000 },
  );

  const selectedIds = await page.evaluate(() => {
    return window.__bordev?.session.input.selection.ids ?? [];
  });
  expect(selectedIds).toEqual([firstIdleId]);

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
