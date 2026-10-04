import type { GameSession } from '../game/GameSession';
import { CameraController } from './CameraController';
import { SelectionController } from './SelectionController';
import { OrderController } from './OrderController';
import { screenToGround } from '../render/iso';
import { getCommandSlots } from '../ui/commandCard';
import { setHudStatus } from '../ui/hud';

const CARD_KEY_MAP: Record<string, true> = {
  q: true,
  w: true,
  e: true,
  r: true,
  t: true,
  a: true,
  s: true,
  d: true,
  f: true,
  g: true,
  z: true,
  x: true,
  c: true,
  v: true,
  b: true,
};

function isEditableElement(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName.toLowerCase();
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    el.isContentEditable ||
    el.getAttribute('contenteditable') === 'true'
  );
}

export class InputController {
  public readonly canvas: HTMLCanvasElement;
  public readonly session: GameSession;

  public readonly camera: CameraController;
  public readonly selection: SelectionController;
  public readonly orders: OrderController;

  private idlePeasantIndex = 0;
  private isDisposed = false;

  constructor(canvas: HTMLCanvasElement, session: GameSession) {
    this.canvas = canvas;
    this.session = session;

    this.camera = new CameraController(canvas, session);
    this.selection = new SelectionController(canvas, session, this.camera);
    this.orders = new OrderController(session, this.selection);

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

  // --- Keyboard Hotkeys ---
  private getLiveSelectedEntities(): {
    kind: string;
    type: string;
    player?: number;
  }[] {
    const sim = this.session.sim;
    if (!sim) return [];
    const ids = this.selection.ids;
    const result: { kind: string; type: string; player?: number }[] = [];
    for (let i = 0; i < ids.length; i++) {
      const ent = sim.world.getEntity(ids[i]);
      if (ent && (!('hp' in ent) || typeof ent.hp !== 'number' || ent.hp > 0)) {
        result.push({
          kind: ent.kind,
          type:
            'type' in ent && typeof ent.type === 'string' ? ent.type : ent.kind,
          player:
            'player' in ent && typeof ent.player === 'number'
              ? ent.player
              : undefined,
        });
      }
    }
    return result;
  }

  // --- Keyboard Hotkeys ---
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (isEditableElement(e.target)) return;

    // Hotkeys are only processed if no modifier keys (Ctrl/Alt/Meta) are active
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    let key = e.key.toLowerCase();
    if (key.startsWith('key') && key.length === 4) {
      key = key.charAt(3);
    }

    // 1. Special Delete key
    if (key === 'delete') {
      this.orders.execute('delete');
      e.preventDefault();
      return;
    }

    // 2. Escape back / cancel
    if (key === 'escape') {
      this.orders.execute('back');
      this.selection.cancelDrag();
      e.preventDefault();
      return;
    }

    // 3. Cycle idle peasants
    if (key === '.') {
      this.cycleIdlePeasant();
      e.preventDefault();
      return;
    }

    // 4. Command Card keys (QWERT / ASDFG / ZXCVB)
    if (CARD_KEY_MAP[key]) {
      const selectionMeta = this.getLiveSelectedEntities();
      const slots = getCommandSlots(selectionMeta, this.orders.submenu);
      const upperKey = key.toUpperCase();
      const slot = slots.find((s) => s.key === upperKey);

      if (slot) {
        if (slot.disabled) {
          if (slot.reason) {
            setHudStatus(slot.reason);
            e.preventDefault();
          }
          // Disabled without reason (empty slot) -> do nothing, never issue hidden stop/hold/move
          return;
        }

        if (slot.action) {
          this.orders.execute(slot.action);
          e.preventDefault();
          return;
        }
      }
    }
  };
  private cycleIdlePeasant(): void {
    const sim = this.session.sim;
    if (!sim) return;

    const idlePeasantIds: number[] = [];
    const entities = sim.world.entities;
    for (let i = 0; i < entities.length; i++) {
      const ent = entities[i];
      if (
        ent &&
        ent.kind === 'unit' &&
        ent.player === 0 &&
        (ent.type.includes('peasant') || ent.type.includes('thrall')) &&
        (typeof ent.hp !== 'number' || ent.hp > 0)
      ) {
        if (!ent.order || ent.order.kind === 'idle') {
          idlePeasantIds.push(ent.id);
        }
      }
    }

    if (idlePeasantIds.length === 0) return;

    this.idlePeasantIndex = (this.idlePeasantIndex + 1) % idlePeasantIds.length;
    const chosenId = idlePeasantIds[this.idlePeasantIndex];
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
      this.canvas.addEventListener(
        'mousedown',
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
        'mousemove',
        this.onPointerMove as EventListener,
      );
      globalTarget.addEventListener(
        'pointerup',
        this.onPointerUp as EventListener,
      );
      globalTarget.addEventListener(
        'mouseup',
        this.onPointerUp as EventListener,
      );
      globalTarget.addEventListener('keydown', this.onKeyDown as EventListener);
    }
  }

  private detachEvents(): void {
    if (typeof this.canvas.removeEventListener === 'function') {
      this.canvas.removeEventListener(
        'pointerdown',
        this.onPointerDown as EventListener,
      );
      this.canvas.removeEventListener(
        'mousedown',
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
        'mousemove',
        this.onPointerMove as EventListener,
      );
      globalTarget.removeEventListener(
        'pointerup',
        this.onPointerUp as EventListener,
      );
      globalTarget.removeEventListener(
        'mouseup',
        this.onPointerUp as EventListener,
      );
      globalTarget.removeEventListener(
        'keydown',
        this.onKeyDown as EventListener,
      );
    }
  }
}
