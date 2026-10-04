import { expect, test, type Page } from '@playwright/test';
import type { GameSession, SessionStats } from '../../src/game/GameSession';

interface SetupResult {
  consoleErrors: string[];
  pageErrors: string[];
}

/**
 * Concise boot and readiness helper for M4 boundary tests.
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

  if (options.centerOn) {
    await page.evaluate(
      ({ cx, cz }) => {
        const cam = window.__bordev?.session.renderer.camera;
        if (!cam) throw new Error('Renderer camera is not available');
        cam.centerOn(cx, cz);
      },
      { cx: options.centerOn.x, cz: options.centerOn.z },
    );
  }

  return { consoleErrors, pageErrors };
}
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

  // 1. Verify 'H' hotkey centres at actual footprint midpoint (midX, midZ), not origin (keep.x, keep.z)
  const initialCam = await page.evaluate(() => {
    const cam = window.__bordev?.session.renderer.camera;
    return { x: cam?.view.targetX, z: cam?.view.targetZ };
  });
  expect(initialCam.x).toBeCloseTo(60, 1);
  expect(initialCam.z).toBeCloseTo(60, 1);

  await page.keyboard.press('KeyH');

  await page.waitForFunction(
    ({ expectedX, expectedZ }) => {
      const cam = window.__bordev?.session.renderer.camera;
      if (!cam) return false;
      return (
        Math.abs(cam.view.targetX - expectedX) < 0.01 &&
        Math.abs(cam.view.targetZ - expectedZ) < 0.01
      );
    },
    { expectedX: keep.midX, expectedZ: keep.midZ },
    { timeout: 10_000 },
  );

  const hCam = await page.evaluate(() => {
    const cam = window.__bordev?.session.renderer.camera;
    if (!cam) throw new Error('Camera unavailable');
    return { x: cam.view.targetX, z: cam.view.targetZ };
  });
  expect(hCam.x).toBeCloseTo(keep.midX, 2);
  expect(hCam.z).toBeCloseTo(keep.midZ, 2);
  // Confirm it is not centred on the raw origin tile corner
  expect(Math.abs(hCam.x - keep.x)).toBeGreaterThan(1.0);
  expect(Math.abs(hCam.z - keep.z)).toBeGreaterThan(1.0);

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
  const awayCam = await page.evaluate(() => {
    const cam = window.__bordev?.session.renderer.camera;
    return { x: cam?.view.targetX, z: cam?.view.targetZ };
  });
  expect(awayCam.x).toBeCloseTo(75, 1);
  expect(awayCam.z).toBeCloseTo(75, 1);

  // 3. Double-tap '1' to recall and centre camera on control group
  await page.keyboard.press('Digit1');
  await page.waitForTimeout(60);
  await page.keyboard.press('Digit1');

  // Verify camera centres on footprint midpoint (keep.midX, keep.midZ), not origin tile
  await page.waitForFunction(
    ({ expectedX, expectedZ }) => {
      const cam = window.__bordev?.session.renderer.camera;
      if (!cam) return false;
      return (
        Math.abs(cam.view.targetX - expectedX) < 0.01 &&
        Math.abs(cam.view.targetZ - expectedZ) < 0.01
      );
    },
    { expectedX: keep.midX, expectedZ: keep.midZ },
    { timeout: 10_000 },
  );

  const groupCam = await page.evaluate(() => {
    const cam = window.__bordev?.session.renderer.camera;
    if (!cam) throw new Error('Camera unavailable');
    return { x: cam.view.targetX, z: cam.view.targetZ };
  });
  expect(groupCam.x).toBeCloseTo(keep.midX, 2);
  expect(groupCam.z).toBeCloseTo(keep.midZ, 2);
  expect(Math.abs(groupCam.x - keep.x)).toBeGreaterThan(1.0);
  expect(Math.abs(groupCam.z - keep.z)).toBeGreaterThan(1.0);

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
  // Spawn 1 peasant in passable grassland at (50, 50)
  const [unitAId] = await page.evaluate(() => {
    const bordev = window.__bordev;
    if (!bordev?.cheats) throw new Error('Cheats not available');
    return bordev.cheats.spawnPeasants(1, 50, 50);
  });
  expect(unitAId).toBeDefined();

  // Select the peasant and verify in DOM and input state
  await page.evaluate((id) => {
    window.__bordev?.session.input.selection.set([id]);
  }, unitAId);

  await page.waitForFunction(
    (id) => {
      const sel = window.__bordev?.session.input.selection.ids;
      return sel && sel.length === 1 && sel[0] === id;
    },
    unitAId,
    { timeout: 5_000 },
  );

  const selectionName = page.getByTestId('selection-name');
  await expect(selectionName).toBeVisible();
  await expect(selectionName).toContainText('Peasant');

  // Assign to control group 2 via Ctrl+2
  await page.keyboard.press('Control+Digit2');

  // Verify group assignment in sim/input state
  const isGroup2Assigned = await page.evaluate((id) => {
    const selCtrl = window.__bordev?.session.input.selection;
    if (!selCtrl) return false;
    selCtrl.selectGroup(2);
    return selCtrl.ids.includes(id);
  }, unitAId);
  expect(isGroup2Assigned).toBe(true);

  // Press real Delete key to issue delete order
  await page.keyboard.press('Delete');

  // Observe simulation: entity is removed on the next tick
  await page.waitForFunction(
    (id) => {
      const sim = window.__bordev?.sim;
      return sim && sim.world.getEntity(id) === undefined;
    },
    unitAId,
    { timeout: 10_000 },
  );

  // Observe DOM: selection panel transitions to empty ("No selection")
  await expect(page.getByTestId('selection-panel')).toHaveClass(/empty/);
  await expect(page.getByText('No selection')).toBeVisible();

  // Wait a frame so SelectionController.update() runs and prunes missing entity
  await page.waitForTimeout(50);

  // Debug-spawn replacement peasant. World.allocateId pops from freeIds, deterministic ID recycling
  const [reusedAId] = await page.evaluate(() => {
    const bordev = window.__bordev;
    if (!bordev?.cheats) throw new Error('Cheats not available');
    return bordev.cheats.spawnPeasants(1, 52, 52);
  });

  // Verify that the new unit actually reused unitAId
  expect(reusedAId).toBe(unitAId);

  // Verify new entity is alive in sim
  const isReplacementAlive = await page.evaluate((id) => {
    const ent = window.__bordev?.sim?.world.getEntity(id);
    return ent?.kind === 'unit' && ent.hp > 0;
  }, reusedAId);
  expect(isReplacementAlive).toBe(true);

  // Recall group 2 using keyboard '2'
  await page.keyboard.press('Digit2');

  // Wait for state to settle and verify group recall MUST NOT select replacement
  await page.waitForTimeout(100);
  const selectedAfterRecallA = await page.evaluate(() => {
    return window.__bordev?.session.input.selection.ids ?? [];
  });
  expect(selectedAfterRecallA).not.toContain(unitAId);
  expect(selectedAfterRecallA).toHaveLength(0);

  // Verify DOM remains empty
  await expect(page.getByTestId('selection-panel')).toHaveClass(/empty/);

  // --- Scenario B: Same-frame debug removal and replacement to prove identity ref check ---
  // Spawn unit B at (54, 54)
  const [unitBId] = await page.evaluate(() => {
    const bordev = window.__bordev;
    if (!bordev?.cheats) throw new Error('Cheats not available');
    return bordev.cheats.spawnPeasants(1, 54, 54);
  });
  expect(unitBId).toBeDefined();

  // Select and assign unit B to control group 3
  await page.evaluate((id) => {
    window.__bordev?.session.input.selection.set([id]);
  }, unitBId);
  await page.keyboard.press('Control+Digit3');

  // Clear active selection to prove group identity check works independently of active selection
  await page.evaluate(() => {
    window.__bordev?.session.input.selection.clear();
  });

  // In a single evaluation (same JS execution, 0 intermediate frames), remove unit B and spawn replacement
  const sameFrameResult = await page.evaluate((id) => {
    const sim = window.__bordev?.sim;
    const cheats = window.__bordev?.cheats;
    if (!sim || !cheats) throw new Error('Sim/cheats missing');
    sim.world.removeEntity(id);
    const [reused] = cheats.spawnPeasants(1, 56, 56);
    return { original: id, reused };
  }, unitBId);
  expect(sameFrameResult.reused).toBe(sameFrameResult.original);

  // Recall group 3 using keyboard '3'
  await page.keyboard.press('Digit3');

  // Verify group recall MUST NOT select replacement even when removal and reuse happened in same frame
  await page.waitForTimeout(100);
  const selectedAfterRecallB = await page.evaluate(() => {
    return window.__bordev?.session.input.selection.ids ?? [];
  });
  expect(selectedAfterRecallB).not.toContain(unitBId);
  expect(selectedAfterRecallB).toHaveLength(0);

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

  // 2. Trigger window blur event while key is held down
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
  });

  // Release the key outside / after blur
  await page.keyboard.up('ArrowRight');

  // Ensure mouse stays in canvas centre (away from edges)
  await page.mouse.move(canvasCenterX, canvasCenterY);

  // Record camera position immediately after blur
  const posAfterBlur = await page.evaluate(() => {
    const cam = window.__bordev?.session.renderer.camera;
    if (!cam) throw new Error('Renderer camera missing');
    return { x: cam.view.targetX, z: cam.view.targetZ };
  });

  // Wait 300ms across multiple live animation frames
  await page.waitForTimeout(300);

  // Assert camera did NOT continue moving
  const posAfterWait = await page.evaluate(() => {
    const cam = window.__bordev?.session.renderer.camera;
    if (!cam) throw new Error('Renderer camera missing');
    return { x: cam.view.targetX, z: cam.view.targetZ };
  });

  expect(Math.abs(posAfterWait.x - posAfterBlur.x)).toBeLessThan(0.01);
  expect(Math.abs(posAfterWait.z - posAfterBlur.z)).toBeLessThan(0.01);

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

  await page.keyboard.up('ArrowDown');
  await page.mouse.move(canvasCenterX, canvasCenterY);

  const posAfterBlurDown = await page.evaluate(() => {
    const cam = window.__bordev?.session.renderer.camera;
    if (!cam) throw new Error('Renderer camera missing');
    return { x: cam.view.targetX, z: cam.view.targetZ };
  });

  await page.waitForTimeout(300);

  const posAfterWaitDown = await page.evaluate(() => {
    const cam = window.__bordev?.session.renderer.camera;
    if (!cam) throw new Error('Renderer camera missing');
    return { x: cam.view.targetX, z: cam.view.targetZ };
  });

  expect(Math.abs(posAfterWaitDown.x - posAfterBlurDown.x)).toBeLessThan(0.01);
  expect(Math.abs(posAfterWaitDown.z - posAfterBlurDown.z)).toBeLessThan(0.01);

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

interface MarkerLifecycleProof {
  kind: 'move' | 'attackMove';
  worldTarget: { x: number; z: number };
  expiresAt: number;
  initialRemainingLifetime: number;
  freshFramesCount: number;
  absentAfterExpiry: boolean;
  expired: boolean;
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

    const tryCapture = (nowSec: number) => {
      if (captured !== null) return;
      const markers = orders.markers;
      for (let i = markers.length - 1; i >= 0; i--) {
        const m = markers[i];
        if (m.kind === kind && !existingSet.has(m.expiresAt)) {
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

        if (captured !== null) {
          const markers = orders.markers;
          const isPresent = markers.some(
            (m) =>
              m.kind === captured!.kind && m.expiresAt === captured!.expiresAt,
          );

          if (isPresent) {
            freshFramesCount++;
          } else {
            if (frameSec < captured.expiresAt) {
              cleanup();
              reject(
                new Error(
                  `Premature marker expiry: absent at ${frameSec}s but expires at ${captured.expiresAt}s`,
                ),
              );
              return;
            }
            cleanup();
            resolve({
              kind: captured.kind,
              worldTarget: { x: captured.x, z: captured.z },
              expiresAt: captured.expiresAt,
              initialRemainingLifetime: captured.initialRemainingLifetime,
              freshFramesCount,
              absentAfterExpiry: true,
              expired: true,
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

  // Verify page is running in real browser pre-100s window (no fake clocks)
  const pageTime = await page.evaluate(() => performance.now());
  expect(pageTime).toBeLessThan(100_000);

  // Spawn 1 peasant at (50, 50) and select it
  const [peasantId] = await page.evaluate(() => {
    const bordev = window.__bordev;
    if (!bordev?.cheats) throw new Error('Cheats not available');
    return bordev.cheats.spawnPeasants(1, 50, 50);
  });

  await page.evaluate((id) => {
    window.__bordev?.session.input.selection.set([id]);
  }, peasantId);

  // Screen coordinates for destination tile (54, 50)
  const targetScreen = await page.evaluate(
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
    { tx: 54, tz: 50 },
  );

  // --- Part 1: Move order marker ---
  // Right-click target tile to issue move order and spawn move marker
  const moveProof = await observeMarkerLifecycle(page, 'move', async () => {
    await page.mouse.click(targetScreen.x, targetScreen.y, { button: 'right' });
  });

  expect(moveProof.kind).toBe('move');
  expect(moveProof.worldTarget.x).toBeCloseTo(54, 0);
  expect(moveProof.worldTarget.z).toBeCloseTo(50, 0);
  expect(moveProof.initialRemainingLifetime).toBeGreaterThan(0.7);
  expect(moveProof.initialRemainingLifetime).toBeLessThanOrEqual(1.05);
  expect(moveProof.absentAfterExpiry).toBe(true);
  expect(moveProof.expired).toBe(true);

  // --- Part 2: Attack-move order marker ---
  // Press R to enter the visible Attack-move command-card slot.
  await page.keyboard.press('KeyR');

  // Verify attack-move mode is active in orders controller
  const isAttackMoveMode = await page.evaluate(() => {
    return window.__bordev?.session.input.orders.mode === 'attackMove';
  });
  expect(isAttackMoveMode).toBe(true);

  // Left-click ground to place attack-move order and marker at (46, 50)
  const attackTargetScreen = await page.evaluate(
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
    { tx: 46, tz: 50 },
  );

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
  expect(attackProof.initialRemainingLifetime).toBeGreaterThan(0.7);
  expect(attackProof.initialRemainingLifetime).toBeLessThanOrEqual(1.05);
  expect(attackProof.absentAfterExpiry).toBe(true);
  expect(attackProof.expired).toBe(true);

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
