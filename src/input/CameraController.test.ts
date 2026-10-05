import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GameSession } from '../game/GameSession';
import { screenToGround, worldToScreen } from '../render/iso';
import { IsoCamera } from '../render/IsoCamera';
import { CameraController } from './CameraController';

type MockCanvas = HTMLCanvasElement & {
  clientWidth: number;
  clientHeight: number;
  capturedPointerId: number | null;
};

function createMockCanvas(width = 800, height = 600): MockCanvas {
  const listeners: Record<string, EventListener[]> = {};

  return {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    capturedPointerId: null,
    addEventListener: (type: string, listener: EventListener) => {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(listener);
    },
    removeEventListener: (type: string, listener: EventListener) => {
      if (listeners[type]) {
        listeners[type] = listeners[type].filter((fn) => fn !== listener);
      }
    },
    dispatchEvent: (event: Event): boolean => {
      const list = listeners[event.type];
      if (list) {
        for (const fn of list) {
          fn(event);
        }
      }
      return true;
    },
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
    setPointerCapture(pointerId: number) {
      (this as MockCanvas).capturedPointerId = pointerId;
    },
    releasePointerCapture(pointerId: number) {
      if ((this as MockCanvas).capturedPointerId === pointerId) {
        (this as MockCanvas).capturedPointerId = null;
      }
    },
  } as unknown as MockCanvas;
}

function createWheelEvent(
  deltaY: number,
  clientX: number,
  clientY: number,
  deltaX = 0,
): WheelEvent {
  return Object.assign(new Event('wheel'), {
    deltaX,
    deltaY,
    clientX,
    clientY,
    preventDefault: () => {},
  }) as unknown as WheelEvent;
}

function createPointerEvent(
  type: string,
  options: {
    button?: number;
    buttons?: number;
    clientX?: number;
    clientY?: number;
    pointerId?: number;
    relatedTarget?: EventTarget | null;
  } = {},
): PointerEvent {
  return Object.assign(new Event(type), {
    button: options.button ?? 0,
    buttons: options.buttons ?? 0,
    clientX: options.clientX ?? 0,
    clientY: options.clientY ?? 0,
    pointerId: options.pointerId ?? 1,
    relatedTarget:
      options.relatedTarget !== undefined ? options.relatedTarget : null,
    preventDefault: () => {},
  }) as unknown as PointerEvent;
}

describe('CameraController', () => {
  let originalWindow: unknown;
  let originalDocument: unknown;
  let mockWindow: EventTarget;
  let mockDocument: EventTarget;
  let engine: NullEngine;
  let scene: Scene;
  let canvas: MockCanvas;
  let isoCam: IsoCamera;
  let session: GameSession;

  beforeEach(() => {
    originalWindow = (globalThis as Record<string, unknown>).window;
    originalDocument = (globalThis as Record<string, unknown>).document;

    mockWindow = new EventTarget();
    mockDocument = new EventTarget();

    (globalThis as Record<string, unknown>).window = mockWindow;
    (globalThis as Record<string, unknown>).document = mockDocument;

    engine = new NullEngine();
    scene = new Scene(engine);
    canvas = createMockCanvas(800, 600);
    isoCam = new IsoCamera(scene, canvas, 128);
    isoCam.centerOn(50, 50);

    session = {
      renderer: {
        camera: isoCam,
      },
    } as unknown as GameSession;
  });

  afterEach(() => {
    isoCam.dispose();
    scene.dispose();
    engine.dispose();

    if (originalWindow !== undefined) {
      (globalThis as Record<string, unknown>).window = originalWindow;
    } else {
      delete (globalThis as Record<string, unknown>).window;
    }

    if (originalDocument !== undefined) {
      (globalThis as Record<string, unknown>).document = originalDocument;
    } else {
      delete (globalThis as Record<string, unknown>).document;
    }
  });

  it('handles middle mouse drag pan and stops after pointerup', () => {
    const controller = new CameraController(canvas, session);

    // Initial target
    expect(isoCam.view.targetX).toBe(50);
    expect(isoCam.view.targetZ).toBe(50);
    expect(isoCam.view.zoom).toBe(1.0);

    // 1. Pointerdown with middle mouse button (button: 1) on canvas
    canvas.dispatchEvent(
      createPointerEvent('pointerdown', {
        button: 1,
        clientX: 400,
        clientY: 300,
        pointerId: 7,
      }),
    );
    expect(canvas.capturedPointerId).toBe(7);

    // 2. Drag (+48, +24) px
    // (+48, +24) corresponds to screen displacement along world +X (+1 / zoom, 0)
    // To grab-pan, target shifts opposite: -1 / zoom
    mockWindow.dispatchEvent(
      createPointerEvent('pointermove', {
        button: 1,
        buttons: 4,
        clientX: 448,
        clientY: 324,
      }),
    );

    expect(isoCam.view.targetX).toBeCloseTo(49, 6);
    expect(isoCam.view.targetZ).toBeCloseTo(50, 6);

    // 3. Pointerup releases capture and stops dragging
    mockWindow.dispatchEvent(
      createPointerEvent('pointerup', {
        button: 1,
        clientX: 448,
        clientY: 324,
      }),
    );
    expect(canvas.capturedPointerId).toBeNull();

    // 4. Subsequent move after pointerup must not pan
    mockWindow.dispatchEvent(
      createPointerEvent('pointermove', {
        button: 1,
        buttons: 4,
        clientX: 500,
        clientY: 400,
      }),
    );
    expect(isoCam.view.targetX).toBeCloseTo(49, 6);
    expect(isoCam.view.targetZ).toBeCloseTo(50, 6);

    controller.dispose();
  });

  it('clamps wheel zoom to 0.5-1.5 and keeps ground point under cursor', () => {
    const controller = new CameraController(canvas, session);

    const cursor = { x: 300, y: 200 };
    const initialGround = screenToGround(cursor.x, cursor.y, isoCam.view);

    // 1. Single zoom in
    canvas.dispatchEvent(createWheelEvent(-100, cursor.x, cursor.y));
    expect(isoCam.view.zoom).toBeCloseTo(1.1, 6);

    const groundAfterZoomIn = screenToGround(cursor.x, cursor.y, isoCam.view);
    expect(groundAfterZoomIn.x).toBeCloseTo(initialGround.x, 6);
    expect(groundAfterZoomIn.z).toBeCloseTo(initialGround.z, 6);

    // 2. Repeated zoom in up to clamp ceiling (1.5)
    for (let i = 0; i < 20; i++) {
      canvas.dispatchEvent(createWheelEvent(-100, cursor.x, cursor.y));
    }
    expect(isoCam.view.zoom).toBeCloseTo(1.5, 6);

    const groundAtMaxZoom = screenToGround(cursor.x, cursor.y, isoCam.view);
    expect(groundAtMaxZoom.x).toBeCloseTo(initialGround.x, 6);
    expect(groundAtMaxZoom.z).toBeCloseTo(initialGround.z, 6);

    // 3. Repeated zoom out down to clamp floor (0.5)
    for (let i = 0; i < 30; i++) {
      canvas.dispatchEvent(createWheelEvent(100, cursor.x, cursor.y));
    }
    expect(isoCam.view.zoom).toBeCloseTo(0.5, 6);

    const groundAtMinZoom = screenToGround(cursor.x, cursor.y, isoCam.view);
    expect(groundAtMinZoom.x).toBeCloseTo(initialGround.x, 6);
    expect(groundAtMinZoom.z).toBeCloseTo(initialGround.z, 6);

    controller.dispose();
  });

  it('ignores wheel events with deltaY === 0', () => {
    const controller = new CameraController(canvas, session);

    const zoomBefore = isoCam.view.zoom;
    const targetBeforeX = isoCam.view.targetX;
    const targetBeforeZ = isoCam.view.targetZ;

    // Horizontal wheel / deltaY 0
    canvas.dispatchEvent(createWheelEvent(0, 400, 300, 120));

    expect(isoCam.view.zoom).toBe(zoomBefore);
    expect(isoCam.view.targetX).toBe(targetBeforeX);
    expect(isoCam.view.targetZ).toBe(targetBeforeZ);

    controller.dispose();
  });

  it('pans on edge scroll and stops when pointer leaves window or on blur', () => {
    const controller = new CameraController(canvas, session);

    // 1. Move pointer into left edge margin (4 px from left edge)
    mockWindow.dispatchEvent(
      createPointerEvent('pointermove', { clientX: 4, clientY: 300 }),
    );

    const targetBeforeScrollX = isoCam.view.targetX;
    controller.update(0.1);
    expect(isoCam.view.targetX).not.toBe(targetBeforeScrollX);

    // 2. Pointer leaves browser window via pointerout with relatedTarget === null
    mockWindow.dispatchEvent(
      createPointerEvent('pointerout', { relatedTarget: null }),
    );

    const targetAfterExitX = isoCam.view.targetX;
    controller.update(0.1);
    // Edge scroll must have stopped
    expect(isoCam.view.targetX).toBe(targetAfterExitX);

    // 3. Move pointer into top edge margin over HUD bar (y = 4 px)
    mockWindow.dispatchEvent(
      createPointerEvent('pointermove', { clientX: 400, clientY: 4 }),
    );
    const targetBeforeTopScrollZ = isoCam.view.targetZ;
    controller.update(0.1);
    expect(isoCam.view.targetZ).not.toBe(targetBeforeTopScrollZ);

    // 4. Exit browser window through document-level pointerout
    mockDocument.dispatchEvent(
      createPointerEvent('pointerout', { relatedTarget: null }),
    );
    const targetAfterDocExitZ = isoCam.view.targetZ;
    controller.update(0.1);
    expect(isoCam.view.targetZ).toBe(targetAfterDocExitZ);

    // 5. Move pointer to edge again and verify window blur stops edge scroll
    mockWindow.dispatchEvent(
      createPointerEvent('pointermove', { clientX: 400, clientY: 4 }),
    );
    controller.update(0.1);
    expect(isoCam.view.targetZ).not.toBe(targetAfterDocExitZ);

    const targetBeforeBlurZ = isoCam.view.targetZ;
    mockWindow.dispatchEvent(new Event('blur'));

    controller.update(0.1);
    expect(isoCam.view.targetZ).toBe(targetBeforeBlurZ);

    // 6. Verify document-level pointerleave also stops edge scroll
    mockWindow.dispatchEvent(
      createPointerEvent('pointermove', { clientX: 400, clientY: 4 }),
    );
    controller.update(0.1);
    expect(isoCam.view.targetZ).not.toBe(targetBeforeBlurZ);

    const targetBeforeLeaveZ = isoCam.view.targetZ;
    mockDocument.dispatchEvent(new Event('pointerleave'));

    controller.update(0.1);
    expect(isoCam.view.targetZ).toBe(targetBeforeLeaveZ);

    controller.dispose();
  });

  it('pans via setPanKey, stops on release, and clears on blur', () => {
    const controller = new CameraController(canvas, session);

    // 1. Arrow pan right
    controller.setPanKey('right', true);
    const initialTargetX = isoCam.view.targetX;
    controller.update(0.1);
    expect(isoCam.view.targetX).not.toBe(initialTargetX);

    // 2. Stop pan on release
    controller.setPanKey('right', false);
    const stoppedTargetX = isoCam.view.targetX;
    controller.update(0.1);
    expect(isoCam.view.targetX).toBe(stoppedTargetX);

    // 3. Pan up, then dispatch blur -> must stop pan
    controller.setPanKey('up', true);
    controller.update(0.1);
    const beforeBlurZ = isoCam.view.targetZ;
    mockWindow.dispatchEvent(new Event('blur'));

    controller.update(0.1);
    expect(isoCam.view.targetZ).toBe(beforeBlurZ);

    controller.dispose();
  });

  it('centers world point at unobscured band centre with viewport insets across zoom levels', () => {
    const controller = new CameraController(canvas, session);

    // Canvas 800x600, top inset 40, bottom inset 186
    // Unobscured band: y from 40 to (600 - 186) = 414. Height = 374.
    // Unobscured band vertical centre: 40 + 374 * 0.5 = 227.
    controller.setViewportInsets(40, 186);
    expect(controller.viewportInsets).toEqual({ top: 40, bottom: 186 });

    // Test at zoom 1.0
    controller.centerOn(50, 50);
    const screen1 = worldToScreen(50, 50, isoCam.view);
    expect(screen1.x).toBeCloseTo(400, 6);
    expect(screen1.y).toBeCloseTo(227, 6);

    // Test at zoom 0.5
    isoCam.view.zoom = 0.5;
    controller.centerOn(50, 50);
    const screenHalf = worldToScreen(50, 50, isoCam.view);
    expect(screenHalf.x).toBeCloseTo(400, 6);
    expect(screenHalf.y).toBeCloseTo(227, 6);

    // Test at zoom 1.5
    isoCam.view.zoom = 1.5;
    controller.centerOn(50, 50);
    const screenMax = worldToScreen(50, 50, isoCam.view);
    expect(screenMax.x).toBeCloseTo(400, 6);
    expect(screenMax.y).toBeCloseTo(227, 6);

    // Test with default / zero insets
    controller.setViewportInsets(0, 0);
    isoCam.view.zoom = 1.0;
    controller.centerOn(50, 50);
    const screenZero = worldToScreen(50, 50, isoCam.view);
    expect(screenZero.x).toBeCloseTo(400, 6);
    expect(screenZero.y).toBeCloseTo(300, 6);

    // Map bounds clamping is still respected
    controller.centerOn(-100, -100);
    expect(isoCam.view.targetX).toBeGreaterThanOrEqual(-4);
    expect(isoCam.view.targetZ).toBeGreaterThanOrEqual(-4);

    controller.dispose();
  });

  it('centers on town center using isTownCenter flag at footprint midpoint', () => {
    const mockEntities = [
      {
        id: 1,
        kind: 'unit',
        player: 0,
        x: 10,
        z: 10,
      },
      {
        id: 2,
        kind: 'building',
        player: 1, // Enemy town center
        isTownCenter: true,
        type: 'keep',
        x: 80,
        z: 80,
        width: 4,
        height: 4,
      },
      {
        id: 3,
        kind: 'building',
        player: 0, // Own building, but not town center
        isTownCenter: false,
        type: 'barracks',
        x: 30,
        z: 30,
        width: 3,
        height: 3,
      },
      {
        id: 4,
        kind: 'building',
        player: 0, // Own town center
        isTownCenter: true,
        type: 'keep',
        x: 20,
        z: 24,
        width: 4,
        height: 4,
      },
    ];

    const sessionWithSim = {
      renderer: {
        camera: isoCam,
      },
      sim: {
        world: {
          entities: mockEntities,
        },
      },
    } as unknown as GameSession;

    const controller = new CameraController(canvas, sessionWithSim);
    controller.setViewportInsets(40, 186);

    // Footprint center is x + width/2, z + height/2 = (22, 26)
    controller.centerOnTownCenter();

    const screen = worldToScreen(22, 26, isoCam.view);
    expect(screen.x).toBeCloseTo(400, 6);
    expect(screen.y).toBeCloseTo(227, 6);

    controller.dispose();
  });

  it('registers no keydown/keyup listeners and no mouse* listeners', () => {
    let keydownDispatched = false;
    mockWindow.addEventListener('keydown', () => {
      keydownDispatched = true;
    });

    const controller = new CameraController(canvas, session);

    // Dispatch keydown with ArrowRight
    const targetBeforeKey = isoCam.view.targetX;
    mockWindow.dispatchEvent(
      Object.assign(new Event('keydown'), {
        key: 'ArrowRight',
        code: 'ArrowRight',
      }),
    );
    expect(keydownDispatched).toBe(true);

    controller.update(0.1);
    // Camera must NOT have moved from keydown event
    expect(isoCam.view.targetX).toBe(targetBeforeKey);

    // Dispatch mousedown (button: 1) on canvas
    canvas.dispatchEvent(
      Object.assign(new Event('mousedown'), {
        button: 1,
        clientX: 400,
        clientY: 300,
      }),
    );
    // Middle drag must NOT have started from mousedown
    mockWindow.dispatchEvent(
      createPointerEvent('pointermove', {
        button: 1,
        buttons: 4,
        clientX: 448,
        clientY: 324,
      }),
    );
    expect(isoCam.view.targetX).toBe(targetBeforeKey);

    // auxclick for middle button prevents default
    let auxClickPrevented = false;
    const auxClickEvent = Object.assign(new Event('auxclick'), {
      button: 1,
      preventDefault: () => {
        auxClickPrevented = true;
      },
    });
    canvas.dispatchEvent(auxClickEvent);
    expect(auxClickPrevented).toBe(true);

    controller.dispose();
  });
});
