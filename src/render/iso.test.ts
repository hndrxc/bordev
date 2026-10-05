import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';
import { describe, expect, it } from 'vitest';
import {
  clampTarget,
  ISO_CAMERA_DIR,
  ISO_CAMERA_DISTANCE,
  ISO_RIGHT_BASIS,
  ISO_SIN30,
  ISO_UP_BASIS,
  type IsoView,
  MAP_MARGIN,
  PPU,
  screenToGround,
  worldToScreen,
  ZOOM_MAX,
  ZOOM_MIN,
} from './iso';
import { IsoCamera } from './IsoCamera';

type MockCanvas = HTMLCanvasElement & {
  clientWidth: number;
  clientHeight: number;
};

function createMockCanvas(width = 800, height = 600): MockCanvas {
  return {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      x: 0,
      y: 0,
      toJSON: () => {},
    }),
  } as unknown as MockCanvas;
}

describe('iso projection pure math', () => {
  const baseView: IsoView = {
    targetX: 0,
    targetZ: 0,
    width: 800,
    height: 600,
    zoom: 1.0,
  };

  it('projects world origin to viewport center', () => {
    const screen = worldToScreen(0, 0, baseView);
    expect(screen.x).toBe(400);
    expect(screen.y).toBe(300);
  });

  it('aligns world +X with screen (+48, +24) at zoom 1', () => {
    const s0 = worldToScreen(0, 0, baseView);
    const sX = worldToScreen(1, 0, baseView);
    expect(sX.x - s0.x).toBeCloseTo(48, 10);
    expect(sX.y - s0.y).toBeCloseTo(24, 10);
  });

  it('aligns world +Z with screen (-48, +24) at zoom 1', () => {
    const s0 = worldToScreen(0, 0, baseView);
    const sZ = worldToScreen(0, 1, baseView);
    expect(sZ.x - s0.x).toBeCloseTo(-48, 10);
    expect(sZ.y - s0.y).toBeCloseTo(24, 10);
  });

  it('exhibits exact 2:1 dimetric ratio for a 1x1 tile diamond', () => {
    const top = worldToScreen(0, 0, baseView);
    const right = worldToScreen(1, 0, baseView);
    const bottom = worldToScreen(1, 1, baseView);
    const left = worldToScreen(0, 1, baseView);

    const diamondWidth = right.x - left.x;
    const diamondHeight = bottom.y - top.y;

    expect(diamondWidth).toBeCloseTo(96, 10);
    expect(diamondHeight).toBeCloseTo(48, 10);
    expect(diamondWidth / diamondHeight).toBeCloseTo(2.0, 10);
  });

  it('scales screen displacements linearly with zoom', () => {
    const halfZoomView: IsoView = { ...baseView, zoom: 0.5 };
    const sXHalf = worldToScreen(1, 0, halfZoomView);
    expect(sXHalf.x - halfZoomView.width * 0.5).toBeCloseTo(24, 10);
    expect(sXHalf.y - halfZoomView.height * 0.5).toBeCloseTo(12, 10);

    const maxZoomView: IsoView = { ...baseView, zoom: 1.5 };
    const sXMax = worldToScreen(1, 0, maxZoomView);
    expect(sXMax.x - maxZoomView.width * 0.5).toBeCloseTo(72, 10);
    expect(sXMax.y - maxZoomView.height * 0.5).toBeCloseTo(36, 10);
  });

  it('inverts worldToScreen via screenToGround across diverse coordinates and zoom levels', () => {
    const testCases: IsoView[] = [
      { targetX: 0, targetZ: 0, width: 800, height: 600, zoom: 1.0 },
      { targetX: 64, targetZ: 64, width: 1920, height: 1080, zoom: 0.5 },
      { targetX: 128, targetZ: 128, width: 1280, height: 720, zoom: 1.5 },
      { targetX: -4, targetZ: 132, width: 1024, height: 768, zoom: 0.85 },
      {
        targetX: 37.125,
        targetZ: 89.625,
        width: 1440,
        height: 900,
        zoom: 1.25,
      },
    ];

    const testCoords = [
      { x: 0, z: 0 },
      { x: 64, z: 64 },
      { x: 128, z: 128 },
      { x: -3.5, z: 131.25 },
      { x: 10.123, z: 55.789 },
      { x: 100, z: 2 },
    ];

    for (const view of testCases) {
      for (const { x, z } of testCoords) {
        const screen = worldToScreen(x, z, view);
        const ground = screenToGround(screen.x, screen.y, view);
        expect(ground.x).toBeCloseTo(x, 9);
        expect(ground.z).toBeCloseTo(z, 9);

        const screenRoundtrip = worldToScreen(ground.x, ground.z, view);
        expect(screenRoundtrip.x).toBeCloseTo(screen.x, 9);
        expect(screenRoundtrip.y).toBeCloseTo(screen.y, 9);
      }
    }
  });

  it('clamps target within map bounds + margin (inverse iso world bounds)', () => {
    const mapSize = 128;
    const margin = MAP_MARGIN; // 4

    // Valid bounds are [-4, 132]
    expect(clampTarget(0, 0, mapSize, margin)).toEqual({ x: 0, z: 0 });
    expect(clampTarget(64, 64, mapSize, margin)).toEqual({ x: 64, z: 64 });
    expect(clampTarget(128, 128, mapSize, margin)).toEqual({ x: 128, z: 128 });

    // Boundary edge values
    expect(clampTarget(-4, -4, mapSize, margin)).toEqual({ x: -4, z: -4 });
    expect(clampTarget(132, 132, mapSize, margin)).toEqual({ x: 132, z: 132 });

    // Out-of-bounds negative
    expect(clampTarget(-10, -50, mapSize, margin)).toEqual({ x: -4, z: -4 });

    // Out-of-bounds positive
    expect(clampTarget(140, 200, mapSize, margin)).toEqual({ x: 132, z: 132 });

    // Mixed out-of-bounds
    expect(clampTarget(-20, 150, mapSize, margin)).toEqual({ x: -4, z: 132 });
  });

  it('has consistent basis vectors and camera direction constants', () => {
    // Orthonormal right and up vectors
    const rDotR =
      ISO_RIGHT_BASIS.x ** 2 + ISO_RIGHT_BASIS.y ** 2 + ISO_RIGHT_BASIS.z ** 2;
    const uDotU =
      ISO_UP_BASIS.x ** 2 + ISO_UP_BASIS.y ** 2 + ISO_UP_BASIS.z ** 2;
    const dirDotDir =
      ISO_CAMERA_DIR.x ** 2 + ISO_CAMERA_DIR.y ** 2 + ISO_CAMERA_DIR.z ** 2;

    expect(rDotR).toBeCloseTo(1.0, 10);
    expect(uDotU).toBeCloseTo(1.0, 10);
    expect(dirDotDir).toBeCloseTo(1.0, 10);

    // Mutual orthogonality
    const rDotU =
      ISO_RIGHT_BASIS.x * ISO_UP_BASIS.x +
      ISO_RIGHT_BASIS.y * ISO_UP_BASIS.y +
      ISO_RIGHT_BASIS.z * ISO_UP_BASIS.z;
    const rDotDir =
      ISO_RIGHT_BASIS.x * ISO_CAMERA_DIR.x +
      ISO_RIGHT_BASIS.y * ISO_CAMERA_DIR.y +
      ISO_RIGHT_BASIS.z * ISO_CAMERA_DIR.z;
    const uDotDir =
      ISO_UP_BASIS.x * ISO_CAMERA_DIR.x +
      ISO_UP_BASIS.y * ISO_CAMERA_DIR.y +
      ISO_UP_BASIS.z * ISO_CAMERA_DIR.z;

    expect(rDotU).toBeCloseTo(0.0, 10);
    expect(rDotDir).toBeCloseTo(0.0, 10);
    expect(uDotDir).toBeCloseTo(0.0, 10);

    // PPU value
    expect(PPU).toBeCloseTo(96 / Math.SQRT2, 10);
  });
});

describe('IsoCamera with Babylon.js engine', () => {
  it('aligns camera transformation matrix with +X(+48,+24) and +Z(-48,+24) at zoom 1', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const canvas = createMockCanvas(800, 600);

    const isoCam = new IsoCamera(scene, canvas, 128);
    isoCam.centerOn(0, 0);

    const vm = isoCam.camera.getViewMatrix(true);
    const pm = isoCam.camera.getProjectionMatrix(true);
    const vpm = vm.multiply(pm);

    const toScreen = (worldPos: Vector3) => {
      const clip = Vector3.TransformCoordinates(worldPos, vpm);
      return {
        x: (clip.x + 1) * 0.5 * 800,
        y: (1 - clip.y) * 0.5 * 600,
        z: clip.z,
      };
    };

    const s0 = toScreen(new Vector3(0, 0, 0));
    const sX = toScreen(new Vector3(1, 0, 0));
    const sZ = toScreen(new Vector3(0, 0, 1));

    expect(s0.x).toBeCloseTo(400, 2);
    expect(s0.y).toBeCloseTo(300, 2);

    expect(sX.x - s0.x).toBeCloseTo(48, 2);
    expect(sX.y - s0.y).toBeCloseTo(24, 2);

    expect(sZ.x - s0.x).toBeCloseTo(-48, 2);
    expect(sZ.y - s0.y).toBeCloseTo(24, 2);

    isoCam.dispose();
    scene.dispose();
    engine.dispose();
  });

  it('guarantees foreground (larger x+z) wins depth test', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const canvas = createMockCanvas(800, 600);

    const isoCam = new IsoCamera(scene, canvas, 128);
    isoCam.centerOn(64, 64);

    const vm = isoCam.camera.getViewMatrix(true);
    const pm = isoCam.camera.getProjectionMatrix(true);
    const vpm = vm.multiply(pm);

    const backgroundPoint = new Vector3(20, 0, 20); // x+z = 40
    const foregroundPoint = new Vector3(30, 0, 30); // x+z = 60

    const clipBack = Vector3.TransformCoordinates(backgroundPoint, vpm);
    const clipFore = Vector3.TransformCoordinates(foregroundPoint, vpm);

    // In Babylon / WebGL depth testing with default LESS/LEQUAL,
    // smaller clip.z is closer to the viewer and wins the depth test.
    expect(clipFore.z).toBeLessThan(clipBack.z);

    isoCam.dispose();
    scene.dispose();
    engine.dispose();
  });

  it('guarantees billboard offsets along right and up are depth-orthogonal', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const canvas = createMockCanvas(800, 600);

    const isoCam = new IsoCamera(scene, canvas, 128);
    isoCam.centerOn(64, 64);

    const vm = isoCam.camera.getViewMatrix(true);
    const pm = isoCam.camera.getProjectionMatrix(true);
    const vpm = vm.multiply(pm);

    const anchor = new Vector3(50, 0, 50);
    const rightOffset = anchor.add(
      new Vector3(
        ISO_RIGHT_BASIS.x,
        ISO_RIGHT_BASIS.y,
        ISO_RIGHT_BASIS.z,
      ).scale(10),
    );
    const upOffset = anchor.add(
      new Vector3(ISO_UP_BASIS.x, ISO_UP_BASIS.y, ISO_UP_BASIS.z).scale(10),
    );

    const clipAnchor = Vector3.TransformCoordinates(anchor, vpm);
    const clipRight = Vector3.TransformCoordinates(rightOffset, vpm);
    const clipUp = Vector3.TransformCoordinates(upOffset, vpm);

    expect(clipRight.z).toBeCloseTo(clipAnchor.z, 6);
    expect(clipUp.z).toBeCloseTo(clipAnchor.z, 6);

    isoCam.dispose();
    scene.dispose();
    engine.dispose();
  });

  it('has no perspective or elevation creep after repeated pan and zoom operations', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const canvas = createMockCanvas(800, 600);

    const isoCam = new IsoCamera(scene, canvas, 128);

    // Initial direction check
    const initialVm = isoCam.camera.getViewMatrix(true).clone();
    const pX0 = Vector3.TransformCoordinates(new Vector3(1, 0, 0), initialVm);
    const p00 = Vector3.TransformCoordinates(new Vector3(0, 0, 0), initialVm);
    const initialDeltaX = pX0.subtract(p00);

    // Execute 200 random pans and zooms
    for (let i = 0; i < 200; i++) {
      isoCam.pan((i % 7) - 3, (i % 5) - 2);
      isoCam.zoomAt(
        400 + (i % 10) * 10,
        300 + (i % 10) * 10,
        0.5 + ((i * 17) % 100) / 100,
      );
    }

    // Return to target (0, 0) and zoom 1.0
    isoCam.centerOn(0, 0);
    isoCam.zoomAt(400, 300, 1.0);

    const finalVm = isoCam.camera.getViewMatrix(true);
    const pXEnd = Vector3.TransformCoordinates(new Vector3(1, 0, 0), finalVm);
    const p0End = Vector3.TransformCoordinates(new Vector3(0, 0, 0), finalVm);
    const finalDeltaX = pXEnd.subtract(p0End);

    // Delta in view space must be strictly unchanged (zero drift)
    expect(finalDeltaX.x).toBeCloseTo(initialDeltaX.x, 6);
    expect(finalDeltaX.y).toBeCloseTo(initialDeltaX.y, 6);
    expect(finalDeltaX.z).toBeCloseTo(initialDeltaX.z, 6);

    // Elevation angle must be strictly preserved
    expect(isoCam.camera.position.y).toBeCloseTo(
      ISO_SIN30 * ISO_CAMERA_DISTANCE,
      6,
    );

    isoCam.dispose();
    scene.dispose();
    engine.dispose();
  });

  it('supports centerOn, pan, setMapSize, resize, and zoomAt with bounds clamping', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const canvas = createMockCanvas(1000, 800);

    const isoCam = new IsoCamera(scene, canvas, 128);

    // Initial center on mapSize / 2
    expect(isoCam.view.targetX).toBe(64);
    expect(isoCam.view.targetZ).toBe(64);
    expect(isoCam.view.zoom).toBe(1.0);
    expect(isoCam.view.width).toBe(1000);
    expect(isoCam.view.height).toBe(800);

    // CenterOn within bounds
    isoCam.centerOn(30, 40);
    expect(isoCam.view.targetX).toBe(30);
    expect(isoCam.view.targetZ).toBe(40);

    // Pan within bounds
    isoCam.pan(5, -10);
    expect(isoCam.view.targetX).toBe(35);
    expect(isoCam.view.targetZ).toBe(30);

    // Pan clamped to margin bounds [-4, 132]
    isoCam.pan(-100, 200);
    expect(isoCam.view.targetX).toBe(-4);
    expect(isoCam.view.targetZ).toBe(132);

    // setMapSize updates clamping bounds
    isoCam.setMapSize(64);
    // targetZ (132) is now reclamped to 64 + 4 = 68
    expect(isoCam.view.targetX).toBe(-4);
    expect(isoCam.view.targetZ).toBe(68);

    // Zoom clamping
    isoCam.zoomAt(500, 400, 0.1);
    expect(isoCam.view.zoom).toBe(ZOOM_MIN);

    isoCam.zoomAt(500, 400, 2.5);
    expect(isoCam.view.zoom).toBe(ZOOM_MAX);

    // Resize updates view dimensions and ortho bounds
    canvas.clientWidth = 1920;
    canvas.clientHeight = 1080;
    isoCam.resize();
    expect(isoCam.view.width).toBe(1920);
    expect(isoCam.view.height).toBe(1080);

    const expectedHalfW = (1920 * 0.5) / (PPU * ZOOM_MAX);
    const expectedHalfH = (1080 * 0.5) / (PPU * ZOOM_MAX);
    expect(isoCam.camera.orthoLeft).toBeCloseTo(-expectedHalfW, 6);
    expect(isoCam.camera.orthoRight).toBeCloseTo(expectedHalfW, 6);
    expect(isoCam.camera.orthoTop).toBeCloseTo(expectedHalfH, 6);
    expect(isoCam.camera.orthoBottom).toBeCloseTo(-expectedHalfH, 6);

    isoCam.dispose();
    scene.dispose();
    engine.dispose();
  });
  it('preserves off-center ground coordinate under cursor across IsoCamera.zoomAt and resize with actual Babylon projection', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const canvas = createMockCanvas(1280, 720);

    const isoCam = new IsoCamera(scene, canvas, 128);
    isoCam.centerOn(50, 50);

    const testCursors = [
      { x: 300, y: 200 },
      { x: 950, y: 550 },
      { x: 640, y: 360 },
      { x: 150, y: 600 },
    ];

    for (const cursor of testCursors) {
      const groundBefore = screenToGround(cursor.x, cursor.y, isoCam.view);

      for (const targetZoom of [1.25, 0.75, 1.5, 0.5]) {
        isoCam.zoomAt(cursor.x, cursor.y, targetZoom);

        // Pure math check
        const screenAfter = worldToScreen(
          groundBefore.x,
          groundBefore.z,
          isoCam.view,
        );
        expect(screenAfter.x).toBeCloseTo(cursor.x, 9);
        expect(screenAfter.y).toBeCloseTo(cursor.y, 9);

        // Actual Babylon projection check
        const vm = isoCam.camera.getViewMatrix(true);
        const pm = isoCam.camera.getProjectionMatrix(true);
        const vpm = vm.multiply(pm);

        const clip = Vector3.TransformCoordinates(
          new Vector3(groundBefore.x, 0, groundBefore.z),
          vpm,
        );
        const bScreenX = (clip.x + 1) * 0.5 * isoCam.view.width;
        const bScreenY = (1 - clip.y) * 0.5 * isoCam.view.height;

        expect(bScreenX).toBeCloseTo(cursor.x, 2);
        expect(bScreenY).toBeCloseTo(cursor.y, 2);
      }
    }

    // Verify after viewport resize
    canvas.clientWidth = 1920;
    canvas.clientHeight = 1080;
    isoCam.resize();

    const resizeCursor = { x: 1400, y: 800 };
    const groundBeforeResize = screenToGround(
      resizeCursor.x,
      resizeCursor.y,
      isoCam.view,
    );

    isoCam.zoomAt(resizeCursor.x, resizeCursor.y, 1.35);
    const screenAfterResize = worldToScreen(
      groundBeforeResize.x,
      groundBeforeResize.z,
      isoCam.view,
    );
    expect(screenAfterResize.x).toBeCloseTo(resizeCursor.x, 9);
    expect(screenAfterResize.y).toBeCloseTo(resizeCursor.y, 9);

    const vmr = isoCam.camera.getViewMatrix(true);
    const pmr = isoCam.camera.getProjectionMatrix(true);
    const vpmr = vmr.multiply(pmr);
    const clipR = Vector3.TransformCoordinates(
      new Vector3(groundBeforeResize.x, 0, groundBeforeResize.z),
      vpmr,
    );
    const bScreenXR = (clipR.x + 1) * 0.5 * isoCam.view.width;
    const bScreenYR = (1 - clipR.y) * 0.5 * isoCam.view.height;

    expect(bScreenXR).toBeCloseTo(resizeCursor.x, 2);
    expect(bScreenYR).toBeCloseTo(resizeCursor.y, 2);

    isoCam.dispose();
    scene.dispose();
    engine.dispose();
  });
});
