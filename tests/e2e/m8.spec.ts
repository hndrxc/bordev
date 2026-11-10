import { expect, test, type Page } from '@playwright/test';
import {
  capture,
  clickEntity,
  clipAtGround,
  countDifferingPixels,
  nextFrames,
  selectOnly,
  setupM4Session,
  waitForRender,
  waitForTicks,
  worldToScreen,
} from './fixtures/m4.js';

/** Computes the mean RGB brightness [0..255] of a screenshot clip. */
async function meanBrightness(page: Page, buf: Buffer): Promise<number> {
  return page.evaluate(async (b64: string) => {
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
    const img = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    let sum = 0;
    const totalPixels = img.width * img.height;
    for (let i = 0; i < img.data.length; i += 4) {
      sum += (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3;
    }
    return totalPixels > 0 ? sum / totalPixels : 0;
  }, buf.toString('base64'));
}

test.describe('Alpha M8: Fog of War and Shroud', () => {
  test('1. match start only Keep vicinity visible and remote terrain black', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const { consoleErrors, pageErrors } = await setupM4Session(page, {
      centerOn: { x: 22, z: 22 },
      debugScene: false,
    });

    // 1. Authoritative sim state at match start:
    // Starting Keep vicinity around (22, 22) is explored and visible (fog=255).
    // Remote terrain at (90, 90) is completely unexplored (fog=0, explored=0, visible=0).
    const fogState = await page.evaluate(() => {
      const world = window.__bordev?.sim?.world;
      if (!world) throw new Error('Sim world unavailable');
      const p0 = world.players[0];
      const size = world.map.size;
      const keepIdx = 22 * size + 22;
      const remoteIdx = 90 * size + 90;
      return {
        keepVisible: p0.visible[keepIdx],
        keepExplored: p0.explored[keepIdx],
        keepFog: p0.fog[keepIdx],
        remoteVisible: p0.visible[remoteIdx],
        remoteExplored: p0.explored[remoteIdx],
        remoteFog: p0.fog[remoteIdx],
      };
    });

    expect(fogState.keepVisible).toBe(1);
    expect(fogState.keepExplored).toBe(1);
    expect(fogState.keepFog).toBe(255);
    expect(fogState.remoteVisible).toBe(0);
    expect(fogState.remoteExplored).toBe(0);
    expect(fogState.remoteFog).toBe(0);

    // 2. Browser rendering evidence:
    // Visible terrain around Keep is brightly rendered in full color.
    await nextFrames(page, 2);
    const keepClip = await clipAtGround(page, 22, 22);
    const keepShot = await capture(page, keepClip);
    const keepBrightness = await meanBrightness(page, keepShot);
    expect(keepBrightness).toBeGreaterThan(25);

    // 3. Move camera to remote unexplored terrain at (90, 90).
    // Terrain shader samples unexplored tiles as pure black (fog=0 -> vec3(0.0)).
    await page.evaluate(() => {
      const cam = window.__bordev?.session.renderer.camera;
      if (!cam) throw new Error('Camera unavailable');
      cam.centerOn(90, 90);
    });
    await nextFrames(page, 3);

    const remoteClip = await clipAtGround(page, 90, 90);
    const remoteShot = await capture(page, remoteClip);
    const remoteBrightness = await meanBrightness(page, remoteShot);
    // Remote unexplored terrain renders black
    expect(remoteBrightness).toBeLessThan(5);

    // Visible terrain and remote black terrain differ drastically
    const diff = await countDifferingPixels(page, keepShot, remoteShot);
    expect(diff).toBeGreaterThan(500);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('2. scouting enemy building then leaving freezes ghost HP/state', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const { consoleErrors, pageErrors } = await setupM4Session(page, {
      centerOn: { x: 28, z: 22 },
      debugScene: false,
    });

    // 1. Stage an enemy building outside Keep LOS at (36, 22) through sim debug hooks
    const enemyBuildingId = await page.evaluate(() => {
      const world = window.__bordev?.sim?.world;
      if (!world) throw new Error('Sim world unavailable');
      const b = world.spawnBuilding(1, 'cottage', 36, 22, true);
      return b.id;
    });

    // Initially at (36, 22), player 0 has no ghost memory of the unseen building
    const initialGhost = await page.evaluate(() => {
      const p0 = window.__bordev?.sim?.world.players[0];
      return p0?.ghosts.has('building:36,22');
    });
    expect(initialGhost).toBe(false);

    // 2. Spawn an owned peasant scout near Keep and move it to scout the enemy building
    const scoutId = await page.evaluate(() => {
      const world = window.__bordev?.sim?.world;
      if (!world) throw new Error('Sim world unavailable');
      const unit = world.spawnUnit(0, 'peasant', 24, 22, 'crown');
      return unit.id;
    });

    // Order scout to walk toward the cottage
    await page.evaluate(
      ({ sId }) => {
        const session = window.__bordev?.session;
        session?.issue({
          kind: 'move',
          player: 0,
          ids: [sId],
          x: 34,
          z: 22,
          queued: false,
        });
      },
      { sId: scoutId },
    );

    // Wait until scout arrives within LOS and the cottage is observed
    await page.waitForFunction(
      ({ bId }) => {
        const world = window.__bordev?.sim?.world;
        const b = world?.getEntity(bId);
        if (!world || !b) return false;
        const p0 = world.players[0];
        const key = 'building:36,22';
        return p0.ghosts.has(key) && p0.visible[22 * world.map.size + 36] === 1;
      },
      { bId: enemyBuildingId },
      { timeout: 30_000 },
    );

    // 3. While observed, damage the building to 380 HP so player 0 observes damaged state
    await page.evaluate(
      ({ bId }) => {
        const world = window.__bordev?.sim?.world;
        const b = world?.getEntity(bId);
        if (b && b.kind === 'building') {
          b.hp = 380;
        }
      },
      { bId: enemyBuildingId },
    );
    await waitForTicks(page, 2);

    const observedGhostHp = await page.evaluate(() => {
      const p0 = window.__bordev?.sim?.world.players[0];
      return p0?.ghosts.get('building:36,22')?.hp;
    });
    expect(observedGhostHp).toBe(380);

    // 4. Order scout to retreat back to Keep (22, 22) out of vision of the cottage
    await page.evaluate(
      ({ sId }) => {
        const session = window.__bordev?.session;
        session?.issue({
          kind: 'move',
          player: 0,
          ids: [sId],
          x: 22,
          z: 22,
          queued: false,
        });
      },
      { sId: scoutId },
    );

    // Wait until scout retreats and tile (36, 22) enters explored shroud (visible=0, explored=1)
    await page.waitForFunction(
      () => {
        const world = window.__bordev?.sim?.world;
        if (!world) return false;
        const p0 = world.players[0];
        const idx = 22 * world.map.size + 36;
        return p0.visible[idx] === 0 && p0.explored[idx] === 1;
      },
      undefined,
      { timeout: 30_000 },
    );

    // 5. Behind the fog while unseen, mutate live enemy building HP further to 120
    await page.evaluate(
      ({ bId }) => {
        const world = window.__bordev?.sim?.world;
        const b = world?.getEntity(bId);
        if (b && b.kind === 'building') {
          b.hp = 120;
        }
      },
      { bId: enemyBuildingId },
    );
    await waitForTicks(page, 10);

    // 6. Verify ghost HP remains FROZEN at 380, not the live 120
    const snapshotGhost = await page.evaluate(() => {
      const session = window.__bordev?.session;
      const p0 = window.__bordev?.sim?.world.players[0];
      const ghostRecord = p0?.ghosts.get('building:36,22');
      const snapEnt = session?.snapshot?.entities.find(
        (e) => e.x === 36 && e.z === 22,
      );
      return {
        ghostRecordHp: ghostRecord?.hp,
        snapHp: snapEnt?.hp,
        snapGhost: snapEnt?.ghost,
      };
    });

    expect(snapshotGhost.ghostRecordHp).toBe(380);
    expect(snapshotGhost.snapHp).toBe(380);
    expect(snapshotGhost.snapGhost).toBe(true);

    // 7. Verify browser interaction: ghosts are non-pickable and show no HP overlay
    const pickTest = await page.evaluate(async () => {
      const cam = window.__bordev?.session.renderer.camera;
      const renderer = window.__bordev?.session.renderer;
      if (!cam || !renderer) throw new Error('Renderer unavailable');
      cam.centerOn(37, 23);
      return true;
    });
    expect(pickTest).toBe(true);
    await nextFrames(page, 3);

    const ghostScreen = await worldToScreen(page, 37, 23);
    const probePoint = { x: ghostScreen.x, y: ghostScreen.y - 15 };
    await page.mouse.click(probePoint.x, probePoint.y, { button: 'left' });
    await nextFrames(page, 2);

    const selectedIds = await page.evaluate(() => {
      return window.__bordev?.session.input.selection.ids ?? [];
    });
    // Ghosts cannot be selected
    expect(selectedIds).toEqual([]);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('3. destroy while unseen, ghost persists, revisiting clears', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const { consoleErrors, pageErrors } = await setupM4Session(page, {
      centerOn: { x: 28, z: 22 },
      debugScene: false,
    });

    // 1. Stage enemy cottage at (36, 22)
    const enemyBuildingId = await page.evaluate(() => {
      const world = window.__bordev?.sim?.world;
      if (!world) throw new Error('Sim world unavailable');
      const b = world.spawnBuilding(1, 'cottage', 36, 22, true);
      return b.id;
    });

    // 2. Discover it with scout
    const scoutId = await page.evaluate(() => {
      const world = window.__bordev?.sim?.world;
      if (!world) throw new Error('Sim world unavailable');
      const unit = world.spawnUnit(0, 'peasant', 24, 22, 'crown');
      return unit.id;
    });

    await page.evaluate(
      ({ sId }) => {
        window.__bordev?.session.issue({
          kind: 'move',
          player: 0,
          ids: [sId],
          x: 34,
          z: 22,
          queued: false,
        });
      },
      { sId: scoutId },
    );

    await page.waitForFunction(
      () => {
        const p0 = window.__bordev?.sim?.world.players[0];
        return p0?.ghosts.has('building:36,22');
      },
      undefined,
      { timeout: 30_000 },
    );

    // 3. Move scout back to Keep
    await page.evaluate(
      ({ sId }) => {
        window.__bordev?.session.issue({
          kind: 'move',
          player: 0,
          ids: [sId],
          x: 22,
          z: 22,
          queued: false,
        });
      },
      { sId: scoutId },
    );

    await page.waitForFunction(
      () => {
        const world = window.__bordev?.sim?.world;
        if (!world) return false;
        const p0 = world.players[0];
        return p0.visible[22 * world.map.size + 36] === 0;
      },
      undefined,
      { timeout: 30_000 },
    );

    // 4. Destroy the building while unseen
    await page.evaluate(
      ({ bId }) => {
        const world = window.__bordev?.sim?.world;
        if (!world) throw new Error('World unavailable');
        world.removeEntity(bId);
      },
      { bId: enemyBuildingId },
    );
    await waitForTicks(page, 15);

    // 5. The building is gone from live entities, but ghost persists in memory and snapshot
    const ghostPersists = await page.evaluate(() => {
      const world = window.__bordev?.sim?.world;
      const session = window.__bordev?.session;
      const p0 = world?.players[0];
      const liveExists = world?.entities.some(
        (e) => e && e.x === 36 && e.z === 22,
      );
      const ghostRemembered = p0?.ghosts.has('building:36,22');
      const snapshotGhost = session?.snapshot?.entities.some(
        (e) => e.x === 36 && e.z === 22 && e.ghost === true,
      );
      return { liveExists, ghostRemembered, snapshotGhost };
    });

    expect(ghostPersists.liveExists).toBe(false);
    expect(ghostPersists.ghostRemembered).toBe(true);
    expect(ghostPersists.snapshotGhost).toBe(true);

    // Capture visual frame of the persistent ghost in fog
    await page.evaluate(() => {
      const cam = window.__bordev?.session.renderer.camera;
      cam?.centerOn(37, 23);
    });
    await nextFrames(page, 3);
    const ghostClip = await clipAtGround(page, 37, 23);
    const ghostShot = await capture(page, ghostClip);

    // 6. Scout revisits (34, 22) — as soon as the footprint is visible, the stale ghost is cleared
    await page.evaluate(
      ({ sId }) => {
        window.__bordev?.session.issue({
          kind: 'move',
          player: 0,
          ids: [sId],
          x: 34,
          z: 22,
          queued: false,
        });
      },
      { sId: scoutId },
    );

    // Wait until scout arrives and ghost is deleted upon observing empty footprint
    await page.waitForFunction(
      () => {
        const p0 = window.__bordev?.sim?.world.players[0];
        const session = window.__bordev?.session;
        const remembered = p0?.ghosts.has('building:36,22');
        const inSnapshot = session?.snapshot?.entities.some(
          (e) => e.x === 36 && e.z === 22,
        );
        return remembered === false && inSnapshot === false;
      },
      undefined,
      { timeout: 30_000 },
    );

    // Move scout back to Keep to capture ground under the same explored fog lighting
    await page.evaluate(
      ({ sId }) => {
        window.__bordev?.session.issue({
          kind: 'move',
          player: 0,
          ids: [sId],
          x: 22,
          z: 22,
          queued: false,
        });
      },
      { sId: scoutId },
    );

    await page.waitForFunction(
      () => {
        const world = window.__bordev?.sim?.world;
        if (!world) return false;
        const p0 = world.players[0];
        return p0.visible[22 * world.map.size + 36] === 0;
      },
      undefined,
      { timeout: 30_000 },
    );

    await nextFrames(page, 3);
    const clearedShot = await capture(page, ghostClip);
    const diff = await countDifferingPixels(page, ghostShot, clearedShot);
    expect(diff).toBeGreaterThan(40);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('4. invisible enemy unpickable/HP absent and minimap respects shroud', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const { consoleErrors, pageErrors } = await setupM4Session(page, {
      centerOn: { x: 30, z: 22 },
      debugScene: false,
    });

    // 1. Stage a non-combat enemy ox cart at (42, 22) in the shroud (outside Keep LOS 8)
    const enemyCartId = await page.evaluate(() => {
      const world = window.__bordev?.sim?.world;
      if (!world) throw new Error('Sim world unavailable');
      const unit = world.spawnUnit(1, 'ox_cart', 42, 22, 'crown');
      window.__bordev?.session.issue({
        kind: 'hold',
        player: 1,
        ids: [unit.id],
        queued: false,
      });
      return unit.id;
    });

    // Verify enemy unit is filtered from snapshot
    const inSnapshotInitial = await page.evaluate(
      ({ eId }) => {
        const session = window.__bordev?.session;
        return session?.snapshot?.entities.some((e) => e.id === eId) ?? false;
      },
      { eId: enemyCartId },
    );
    expect(inSnapshotInitial).toBe(false);

    // Center camera near the enemy's coordinates
    await page.evaluate(() => {
      const cam = window.__bordev?.session.renderer.camera;
      cam?.centerOn(42, 22);
    });
    await nextFrames(page, 2);

    // Attempt to pick entity at enemy screen coordinates
    const enemyScreen = await worldToScreen(page, 42, 22);
    const pickedInitial = await page.evaluate(
      ({ sx, sy }) => {
        const r = window.__bordev?.renderer;
        return r?.pickEntity(sx, sy);
      },
      { sx: enemyScreen.x, sy: enemyScreen.y },
    );
    expect(pickedInitial).toBeUndefined();

    // Clicking does not select the invisible enemy
    await page.mouse.click(enemyScreen.x, enemyScreen.y, { button: 'left' });
    await nextFrames(page, 2);
    const selectedInitial = await page.evaluate(() => {
      return window.__bordev?.session.input.selection.ids ?? [];
    });
    expect(selectedInitial).toEqual([]);

    // Keep the camera-outline overlay away from the shrouded pixel under test.
    await page.evaluate(() => {
      window.__bordev?.session.input.camera.centerOn(90, 90);
    });
    await waitForTicks(page, 2);
    await nextFrames(page, 2);

    // 2. Minimap respects shroud: tile is unexplored in snapshot fog and rendered black on minimap canvas
    const minimapEvidence = await page.evaluate(
      ({ wx, wz }) => {
        const session = window.__bordev?.session;
        const snapshot = session?.snapshot;
        const mapSize = window.__bordev?.sim?.world.map.size ?? 128;
        const idx = wz * mapSize + wx;
        const snapshotFog = snapshot?.fog ? snapshot.fog[idx] : undefined;

        const canvas = document.querySelector(
          'canvas[data-testid="minimap"]',
        ) as HTMLCanvasElement | null;
        let canvasPixel: {
          r: number;
          g: number;
          b: number;
          a: number;
        } | null = null;
        if (canvas) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            const rect = canvas.getBoundingClientRect();
            const cssW = rect.width || 180;
            const cssH = rect.height || 180;
            const nu = (wx - wz) / mapSize;
            const nv = (wx + wz) / mapSize;
            const mx = (nu + 1) * 0.5 * cssW;
            const my = nv * 0.5 * cssH;
            const scaleX = canvas.width / cssW;
            const scaleY = canvas.height / cssH;
            const px = Math.floor(mx * scaleX);
            const py = Math.floor(my * scaleY);
            const pixel = ctx.getImageData(px, py, 1, 1).data;
            canvasPixel = {
              r: pixel[0],
              g: pixel[1],
              b: pixel[2],
              a: pixel[3],
            };
          }
        }

        const world = session?.sim?.world;
        const p0 = world?.players[0];
        const simFog = p0?.fog[idx];
        const simVisible = p0?.visible[idx];

        return {
          snapshotFog,
          canvasPixel,
          simFog,
          simVisible,
        };
      },
      { wx: 42, wz: 22 },
    );

    expect(minimapEvidence.snapshotFog).toBe(0);
    expect(minimapEvidence.simFog).toBe(0);
    expect(minimapEvidence.simVisible).toBe(0);
    expect(minimapEvidence.canvasPixel).not.toBeNull();
    expect(minimapEvidence.canvasPixel?.r).toBe(0);
    expect(minimapEvidence.canvasPixel?.g).toBe(0);
    expect(minimapEvidence.canvasPixel?.b).toBe(0);

    await page.evaluate(() => {
      window.__bordev?.session.input.camera.centerOn(42, 22);
    });
    await nextFrames(page, 2);

    // 3. Reveal enemy with an owned scout
    const scoutId = await page.evaluate(() => {
      const world = window.__bordev?.sim?.world;
      if (!world) throw new Error('Sim world unavailable');
      const unit = world.spawnUnit(0, 'peasant', 30, 22, 'crown');
      return unit.id;
    });

    await page.evaluate(
      ({ sId }) => {
        window.__bordev?.session.issue({
          kind: 'move',
          player: 0,
          ids: [sId],
          x: 40,
          z: 22,
          queued: false,
        });
      },
      { sId: scoutId },
    );

    // Wait until enemy is visible in snapshot
    await page.waitForFunction(
      ({ eId }) => {
        const session = window.__bordev?.session;
        return session?.snapshot?.entities.some((e) => e.id === eId) ?? false;
      },
      { eId: enemyCartId },
      { timeout: 30_000 },
    );

    // Now enemy is visible and selectable via actual sprite hit-test
    await nextFrames(page, 2);
    await waitForRender(page, [enemyCartId]);
    await clickEntity(page, enemyCartId, 'left');
    await nextFrames(page, 2);

    const selectedWhenSeen = await page.evaluate(() => {
      return window.__bordev?.session.input.selection.ids ?? [];
    });
    expect(selectedWhenSeen).toContain(enemyCartId);

    // 4. Scout retreats: when visibility is lost, enemy is pruned from selection
    // and units do NOT become ghosts
    await page.evaluate(
      ({ sId }) => {
        window.__bordev?.session.issue({
          kind: 'move',
          player: 0,
          ids: [sId],
          x: 22,
          z: 22,
          queued: false,
        });
      },
      { sId: scoutId },
    );

    // Wait until scout retreats and visibility is lost
    await page.waitForFunction(
      ({ eId }) => {
        const session = window.__bordev?.session;
        return !session?.snapshot?.entities.some((e) => e.id === eId);
      },
      { eId: enemyCartId },
      { timeout: 30_000 },
    );

    // Selection automatically prunes the invisible enemy
    const selectedAfterLost = await page.evaluate(() => {
      return window.__bordev?.session.input.selection.ids ?? [];
    });
    expect(selectedAfterLost).not.toContain(enemyCartId);

    // Units do NOT become ghosts
    const hasGhost = await page.evaluate(
      ({ eId }) => {
        const session = window.__bordev?.session;
        const world = window.__bordev?.sim?.world;
        const inSnapshotGhosts =
          session?.snapshot?.entities.some(
            (e) => e.id === eId && 'ghost' in e && e.ghost,
          ) ?? false;
        const inWorldGhosts = world
          ? Array.from(world.players[0].ghosts.values()).some(
              (g) => g.id === eId,
            )
          : false;
        return inSnapshotGhosts || inWorldGhosts;
      },
      { eId: enemyCartId },
    );
    expect(hasGhost).toBe(false);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('5. unexplored placement rejection and explored placement acceptance', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const { consoleErrors, pageErrors } = await setupM4Session(page, {
      centerOn: { x: 22, z: 22 },
      debugScene: false,
    });

    // 1. Give player 0 ample resources for placement
    await page.evaluate(() => {
      window.__bordev?.cheats?.resources(1000);
    });

    // 2. Discover an owned worker or spawn one on passable ground near Keep and select it via real input
    const workerId = await page.evaluate(() => {
      const world = window.__bordev?.sim?.world;
      if (!world) throw new Error('Sim world unavailable');
      const existing = world.entities.find(
        (e) =>
          e &&
          e.kind === 'unit' &&
          e.player === 0 &&
          e.type === 'peasant' &&
          e.hp > 0,
      );
      if (existing) return existing.id;

      const keep = world.entities.find(
        (e) =>
          e && e.kind === 'building' && e.player === 0 && e.type === 'keep',
      );
      const kx = keep ? Math.floor(keep.x) : 22;
      const kz = keep ? Math.floor(keep.z) : 22;
      const size = world.map.size;
      const flags = world.grid.flags;
      const blockedMask = 1 | 2 | 4;

      let spawnX = kx;
      let spawnZ = kz;
      let foundPassable = false;
      for (let r = 1; r <= 6 && !foundPassable; r++) {
        for (let dz = -r; dz <= r && !foundPassable; dz++) {
          for (let dx = -r; dx <= r && !foundPassable; dx++) {
            const candX = kx + dx;
            const candZ = kz + dz;
            if (candX >= 0 && candX < size && candZ >= 0 && candZ < size) {
              const idx = candZ * size + candX;
              if ((flags[idx] & blockedMask) === 0) {
                spawnX = candX + 0.5;
                spawnZ = candZ + 0.5;
                foundPassable = true;
              }
            }
          }
        }
      }

      const unit = world.spawnUnit(0, 'peasant', spawnX, spawnZ, 'crown');
      return unit.id;
    });

    // Center on worker, wait for render, select worker via real mouse click
    await page.evaluate(
      ({ wId }) => {
        const ent = window.__bordev?.sim?.world.getEntity(wId);
        if (ent) {
          window.__bordev?.session.renderer.camera?.centerOn(ent.x, ent.z);
        }
      },
      { wId: workerId },
    );
    await nextFrames(page, 2);
    await waitForRender(page, [workerId]);
    await selectOnly(page, workerId);

    // 3. Start placement of cottage via real command card button clicks
    const economicBtn = page.locator('button[data-testid="command-economic"]');
    await expect(economicBtn).toBeVisible();
    await economicBtn.click();

    const cottageBtn = page.locator('button[data-testid="command-cottage"]');
    await expect(cottageBtn).toBeVisible();
    await cottageBtn.click();

    // Move camera to unexplored remote ground (80, 80)
    await page.evaluate(() => {
      window.__bordev?.session.renderer.camera?.centerOn(80, 80);
    });
    await nextFrames(page, 2);

    const remoteScreen = await worldToScreen(page, 80.5, 80.5);
    await page.mouse.move(remoteScreen.x, remoteScreen.y);
    await nextFrames(page, 2);

    // 4. Validate footprint rejection on unexplored ground (80, 80) via public placement input preview
    const remoteValidation = await page.evaluate(() => {
      const placement = window.__bordev?.session.input.placement;
      if (!placement) throw new Error('Placement controller unavailable');
      const preview = placement.preview[0];
      return {
        valid: preview?.valid ?? false,
        reason: placement.lastInvalidReason,
        x: preview?.x,
        z: preview?.z,
      };
    });

    expect(remoteValidation.valid).toBe(false);
    expect(remoteValidation.reason).toBe('Unexplored territory');
    expect(remoteValidation.x).toBe(80);
    expect(remoteValidation.z).toBe(80);

    // 5. Attempt placement mouse click and direct sim.issue on unexplored coordinates
    const buildingsBefore = await page.evaluate(() => {
      return (
        window.__bordev?.sim?.world?.entities.filter(
          (e) => e && e.kind === 'building',
        ).length ?? 0
      );
    });

    // Real mouse click attempting placement on unexplored ground
    await page.mouse.click(remoteScreen.x, remoteScreen.y, { button: 'left' });

    // Direct simulation build command with actual worker ID at unexplored coordinates
    await page.evaluate(
      ({ wId }) => {
        window.__bordev?.session.issue({
          kind: 'build',
          player: 0,
          ids: [wId],
          buildingType: 'cottage',
          x: 80,
          z: 80,
          orientation: 'horizontal',
        });
      },
      { wId: workerId },
    );

    await waitForTicks(page, 2);

    const buildingsAfterRemote = await page.evaluate(() => {
      return (
        window.__bordev?.sim?.world?.entities.filter(
          (e) => e && e.kind === 'building',
        ).length ?? 0
      );
    });

    // Both UI interaction and direct sim.issue were rejected; no building was created
    expect(buildingsAfterRemote).toBe(buildingsBefore);

    // 6. Discover actual 2x2 explored passable footprint near Keep by iterating real grid
    const validFootprint = await page.evaluate(() => {
      const world = window.__bordev?.sim?.world;
      if (!world) throw new Error('World unavailable');
      const p0 = world.players[0];
      const size = world.map.size;
      const flags = world.grid.flags;
      // FLAG_TERRAIN = 1, FLAG_BUILDING = 2, FLAG_GATE = 4
      const blockedMask = 1 | 2 | 4;

      const keep = world.entities.find(
        (e) =>
          e && e.kind === 'building' && e.player === 0 && e.type === 'keep',
      );
      const kx = keep ? Math.floor(keep.x) : 22;
      const kz = keep ? Math.floor(keep.z) : 22;

      for (let r = 3; r <= 14; r++) {
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            const candX = kx + dx;
            const candZ = kz + dz;
            if (
              candX < 1 ||
              candX + 2 >= size ||
              candZ < 1 ||
              candZ + 2 >= size
            ) {
              continue;
            }

            let ok = true;
            for (let fz = 0; fz < 2; fz++) {
              for (let fx = 0; fx < 2; fx++) {
                const idx = (candZ + fz) * size + (candX + fx);
                if (p0.explored[idx] !== 1) {
                  ok = false;
                  break;
                }
                if ((flags[idx] & blockedMask) !== 0) {
                  ok = false;
                  break;
                }
              }
              if (!ok) break;
            }

            if (ok) {
              return { x: candX, z: candZ };
            }
          }
        }
      }
      throw new Error('No explored passable 2x2 footprint found near Keep');
    });

    // Verify footprint check on the discovered coordinates
    const footprintCheck = await page.evaluate(
      ({ fx, fz }) => {
        const world = window.__bordev?.sim?.world;
        if (!world) throw new Error('World unavailable');
        const p0 = world.players[0];
        const size = world.map.size;
        const flags = world.grid.flags;
        const blockedMask = 1 | 2 | 4;
        let allExplored = true;
        let allPassable = true;
        for (let dz = 0; dz < 2; dz++) {
          for (let dx = 0; dx < 2; dx++) {
            const idx = (fz + dz) * size + (fx + dx);
            if (p0.explored[idx] !== 1) allExplored = false;
            if ((flags[idx] & blockedMask) !== 0) allPassable = false;
          }
        }
        return { allExplored, allPassable };
      },
      { fx: validFootprint.x, fz: validFootprint.z },
    );

    expect(footprintCheck.allExplored).toBe(true);
    expect(footprintCheck.allPassable).toBe(true);

    // 7. In contrast, placement on explored, visible, clear ground near Keep is valid
    await page.evaluate(
      ({ cx, cz }) => {
        window.__bordev?.session.input.orders.clearModeAndSubmenu();
        window.__bordev?.session.renderer.camera?.centerOn(cx, cz);
      },
      { cx: validFootprint.x, cz: validFootprint.z },
    );
    await nextFrames(page, 2);

    const isWorkerSelected = await page.evaluate(
      ({ wId }) => {
        const sel = window.__bordev?.session.input.selection.ids ?? [];
        return sel.length === 1 && sel[0] === wId;
      },
      { wId: workerId },
    );

    if (!isWorkerSelected) {
      await page.evaluate(
        ({ wId }) => {
          const ent = window.__bordev?.sim?.world.getEntity(wId);
          if (ent) {
            window.__bordev?.session.renderer.camera?.centerOn(ent.x, ent.z);
          }
        },
        { wId: workerId },
      );
      await nextFrames(page, 2);
      await waitForRender(page, [workerId]);
      await selectOnly(page, workerId);

      await page.evaluate(
        ({ cx, cz }) => {
          window.__bordev?.session.renderer.camera?.centerOn(cx, cz);
        },
        { cx: validFootprint.x, cz: validFootprint.z },
      );
      await nextFrames(page, 2);
    }

    const cottageBtnNear = page.locator(
      'button[data-testid="command-cottage"]',
    );
    if (!(await cottageBtnNear.isVisible())) {
      const economicBtnNear = page.locator(
        'button[data-testid="command-economic"]',
      );
      await expect(economicBtnNear).toBeVisible();
      await economicBtnNear.click();
    }
    await expect(cottageBtnNear).toBeVisible();
    await cottageBtnNear.click();

    const nearScreen = await worldToScreen(
      page,
      validFootprint.x + 0.5,
      validFootprint.z + 0.5,
    );
    await page.mouse.move(nearScreen.x, nearScreen.y);
    await nextFrames(page, 2);

    const nearValidation = await page.evaluate(() => {
      const placement = window.__bordev?.session.input.placement;
      if (!placement) throw new Error('Placement controller unavailable');
      const preview = placement.preview[0];
      return {
        valid: preview?.valid ?? false,
        x: preview?.x,
        z: preview?.z,
      };
    });

    expect(nearValidation.valid).toBe(true);
    expect(nearValidation.x).toBe(validFootprint.x);
    expect(nearValidation.z).toBe(validFootprint.z);

    // 8. Committing placement on explored ground succeeds and spawns building foundation
    await page.mouse.click(nearScreen.x, nearScreen.y, { button: 'left' });
    await waitForTicks(page, 2);

    const nearPlaced = await page.evaluate(
      ({ fx, fz }) => {
        const world = window.__bordev?.sim?.world;
        return (
          world?.entities.some(
            (e) =>
              e &&
              e.kind === 'building' &&
              e.type === 'cottage' &&
              e.x === fx &&
              e.z === fz &&
              !e.built,
          ) ?? false
        );
      },
      { fx: validFootprint.x, fz: validFootprint.z },
    );

    expect(nearPlaced).toBe(true);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
