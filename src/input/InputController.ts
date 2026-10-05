import type { GameSession } from '../game/GameSession';
import { CameraController } from './CameraController';
import { SelectionController } from './SelectionController';
import { OrderController } from './OrderController';
import { screenToGround } from '../render/iso';
import { Hotkeys } from './Hotkeys';
import { isWorkerType } from '../data/roles';

export class InputController {
  public readonly canvas: HTMLCanvasElement;
  public readonly session: GameSession;

  public readonly camera: CameraController;
  public readonly selection: SelectionController;
  public readonly orders: OrderController;
  public readonly hotkeys: Hotkeys;

  private idleWorkerIndex = -1;
  private isDisposed = false;

  constructor(canvas: HTMLCanvasElement, session: GameSession) {
    this.canvas = canvas;
    this.session = session;

    this.camera = new CameraController(canvas, session);
    this.selection = new SelectionController(session, this.camera);
    this.orders = new OrderController(session, this.selection);
    this.hotkeys = new Hotkeys(session, this);

    this.attachEvents();
  }

  public update(dt: number, now: number): void {
    if (this.isDisposed) return;
    const nowSec = now / 1000;

    // 1. Update selection (prunes dead entities)
    this.selection.update();

    // 2. Update camera (handles edge scroll and key pan)
    this.camera.update(dt);

    // 3. Update orders (prunes expired markers)
    this.orders.update(nowSec);

    // 4. Update renderer interaction
    const renderer = this.session.renderer;
    if (renderer) {
      renderer.setInteraction(
        this.selection.ids,
        this.orders.markers,
        this.selection.currentBox,
      );
    }
  }

  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    this.detachEvents();
    this.hotkeys.dispose();
    this.camera.dispose();
    this.selection.dispose();
    this.orders.dispose();
  }

  // --- Canvas Pointer Events ---
  private readonly onPointerDown = (e: PointerEvent | MouseEvent): void => {
    // Prevent HUD bubbling: ensure event target is the canvas
    if (e.target !== this.canvas) return;

    const rect = this.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    if (e.button === 0) {
      if (
        'pointerId' in e &&
        typeof e.pointerId === 'number' &&
        typeof this.canvas.setPointerCapture === 'function'
      ) {
        try {
          this.canvas.setPointerCapture(e.pointerId);
        } catch {
          // Ignored
        }
      }
      // Left Click
      if (this.orders.mode !== null) {
        // Mode order click consumes this left-click
        this.orders.handleOrderClick(screenX, screenY);
      } else {
        this.selection.handlePointerDown(screenX, screenY);
      }
      e.preventDefault();
    } else if (e.button === 2) {
      // Right Click: Contextual order
      this.handleRightClick(screenX, screenY, e.shiftKey);
      e.preventDefault();
    }
  };

  private readonly onPointerMove = (e: PointerEvent | MouseEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    this.selection.handlePointerMove(screenX, screenY);
  };

  private readonly onPointerUp = (e: PointerEvent | MouseEvent): void => {
    if (e.button === 0) {
      if (
        'pointerId' in e &&
        typeof e.pointerId === 'number' &&
        typeof this.canvas.releasePointerCapture === 'function'
      ) {
        try {
          this.canvas.releasePointerCapture(e.pointerId);
        } catch {
          // Ignored
        }
      }
      this.selection.handlePointerUp(e.shiftKey);
    }
  };

  private readonly onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  private handleRightClick(
    screenX: number,
    screenY: number,
    shiftKey: boolean,
  ): void {
    const renderer = this.session.renderer;
    const cam = renderer?.camera;
    if (!cam) return;

    // Pick target entity if any
    const targetId = renderer?.pickEntity?.(screenX, screenY);

    // Ground position from screen
    const ground = screenToGround(screenX, screenY, cam.view);

    // Issue context order with worker/cart/rally precedence and shift queue
    this.orders.contextOrder(ground.x, ground.z, shiftKey, targetId);
  }

  public cycleIdleWorker(): void {
    const sim = this.session.sim;
    if (!sim) return;

    const idleWorkerIds: number[] = [];
    const entities = sim.world.entities;
    for (let i = 0; i < entities.length; i++) {
      const ent = entities[i];
      if (
        ent &&
        ent.kind === 'unit' &&
        ent.player === 0 &&
        isWorkerType(ent.type) &&
        (typeof ent.hp !== 'number' || ent.hp > 0)
      ) {
        if (!ent.order || ent.order.kind === 'idle') {
          idleWorkerIds.push(ent.id);
        }
      }
    }

    if (idleWorkerIds.length === 0) return;

    this.idleWorkerIndex = (this.idleWorkerIndex + 1) % idleWorkerIds.length;
    const chosenId = idleWorkerIds[this.idleWorkerIndex];
    this.selection.set([chosenId]);

    const chosenEnt = sim.world.getEntity(chosenId);
    if (chosenEnt) {
      this.camera.centerOn(chosenEnt.x, chosenEnt.z);
    }
  }

  private attachEvents(): void {
    if (typeof this.canvas.addEventListener === 'function') {
      this.canvas.addEventListener(
        'pointerdown',
        this.onPointerDown as EventListener,
      );
      this.canvas.addEventListener('contextmenu', this.onContextMenu);
    }

    const globalTarget = typeof window !== 'undefined' ? window : this.canvas;
    if (typeof globalTarget.addEventListener === 'function') {
      globalTarget.addEventListener(
        'pointermove',
        this.onPointerMove as EventListener,
      );
      globalTarget.addEventListener(
        'pointerup',
        this.onPointerUp as EventListener,
      );
    }
  }

  private detachEvents(): void {
    if (typeof this.canvas.removeEventListener === 'function') {
      this.canvas.removeEventListener(
        'pointerdown',
        this.onPointerDown as EventListener,
      );
      this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    }

    const globalTarget = typeof window !== 'undefined' ? window : this.canvas;
    if (typeof globalTarget.removeEventListener === 'function') {
      globalTarget.removeEventListener(
        'pointermove',
        this.onPointerMove as EventListener,
      );
      globalTarget.removeEventListener(
        'pointerup',
        this.onPointerUp as EventListener,
      );
    }
  }
}
