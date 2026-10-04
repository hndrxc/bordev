import type { GameSession } from '../game/GameSession';
import type { IsoCamera } from '../render/IsoCamera';

const EDGE_SCROLL_MARGIN_PX = 8;
const KEY_SCROLL_SPEED_PX = 960; // Pixels per second at 1x zoom

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

export class CameraController {
  private readonly canvas: HTMLCanvasElement;
  private readonly session: GameSession;

  private isDragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private activePointerId: number | null = null;

  // Edge scroll tracking
  private isPointerOverCanvas = false;
  private canvasPointerX = -1;
  private canvasPointerY = -1;

  // Arrow key tracking
  private arrowUp = false;
  private arrowDown = false;
  private arrowLeft = false;
  private arrowRight = false;

  private isDisposed = false;

  constructor(canvas: HTMLCanvasElement, session: GameSession) {
    this.canvas = canvas;
    this.session = session;

    this.attachEvents();
  }

  get camera(): IsoCamera | null {
    return this.session.renderer?.camera ?? null;
  }

  public centerOn(x: number, z: number): void {
    const cam = this.camera;
    if (cam) {
      cam.centerOn(x, z);
    }
  }

  public centerOnTownCenter(): void {
    const sim = this.session.sim;
    if (!sim) return;

    const entities = sim.world.entities;
    for (let i = 0; i < entities.length; i++) {
      const ent = entities[i];
      if (!ent) continue;
      if (
        ent.kind === 'building' &&
        ent.player === 0 &&
        (ent.isTownCenter ||
          ent.type === 'crown_keep' ||
          ent.type === 'keep' ||
          ent.type.includes('town_center') ||
          ent.type.includes('great_hall'))
      ) {
        this.centerOn(ent.x + ent.width / 2, ent.z + ent.height / 2);
        return;
      }
    }
  }

  public update(dt: number): void {
    if (this.isDisposed || dt <= 0) return;
    const cam = this.camera;
    if (!cam) return;

    let dirX = 0;
    let dirY = 0;

    // 1. Arrow keys
    if (this.arrowLeft) dirX -= 1;
    if (this.arrowRight) dirX += 1;
    if (this.arrowUp) dirY -= 1;
    if (this.arrowDown) dirY += 1;

    // 2. Edge scroll (8px margin) when pointer is inside canvas
    if (this.isPointerOverCanvas && !this.isDragging) {
      const width = this.canvas.clientWidth || this.canvas.width || 800;
      const height = this.canvas.clientHeight || this.canvas.height || 600;

      if (
        this.canvasPointerX >= 0 &&
        this.canvasPointerX <= EDGE_SCROLL_MARGIN_PX
      ) {
        dirX -= 1;
      } else if (
        this.canvasPointerX >= width - EDGE_SCROLL_MARGIN_PX &&
        this.canvasPointerX <= width
      ) {
        dirX += 1;
      }

      if (
        this.canvasPointerY >= 0 &&
        this.canvasPointerY <= EDGE_SCROLL_MARGIN_PX
      ) {
        dirY -= 1;
      } else if (
        this.canvasPointerY >= height - EDGE_SCROLL_MARGIN_PX &&
        this.canvasPointerY <= height
      ) {
        dirY += 1;
      }
    }

    if (dirX === 0 && dirY === 0) {
      return;
    }

    // Clamp diagonal magnitude to not exceed 1
    const len = Math.hypot(dirX, dirY);
    if (len > 1) {
      dirX /= len;
      dirY /= len;
    }

    const screenSpeed = KEY_SCROLL_SPEED_PX * dt;
    const screenDx = dirX * screenSpeed;
    const screenDy = dirY * screenSpeed;

    const zoom = cam.view.zoom;
    const sx = screenDx / zoom;
    const sy = screenDy / zoom;
    const worldDx = sx / 96 + sy / 48;
    const worldDz = sy / 48 - sx / 96;

    cam.pan(worldDx, worldDz);
  }

  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    this.detachEvents();
  }

  // --- Wheel Zoom ---
  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (e.deltaY === 0) return;

    const cam = this.camera;
    if (!cam) return;

    let screenX = cam.view.width * 0.5;
    let screenY = cam.view.height * 0.5;

    if (typeof e.clientX === 'number') {
      const rect =
        typeof this.canvas.getBoundingClientRect === 'function'
          ? this.canvas.getBoundingClientRect()
          : null;
      screenX = e.clientX - (rect ? rect.left : 0);
      screenY = e.clientY - (rect ? rect.top : 0);
    }

    const zoomFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    cam.zoomAt(screenX, screenY, cam.view.zoom * zoomFactor);
  };

  // --- Middle-Mouse Drag Pan ---
  private readonly onPointerDown = (e: PointerEvent | MouseEvent): void => {
    if (e.button === 1) {
      this.isDragging = true;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;

      if (
        'pointerId' in e &&
        typeof e.pointerId === 'number' &&
        typeof this.canvas.setPointerCapture === 'function'
      ) {
        this.activePointerId = e.pointerId;
        try {
          this.canvas.setPointerCapture(this.activePointerId);
        } catch {
          // Ignored
        }
      }
      e.preventDefault();
    }
  };

  private readonly onPointerMove = (e: PointerEvent | MouseEvent): void => {
    // Track pointer position on canvas for edge scroll
    const rect =
      typeof this.canvas.getBoundingClientRect === 'function'
        ? this.canvas.getBoundingClientRect()
        : null;

    if (rect) {
      this.canvasPointerX = e.clientX - rect.left;
      this.canvasPointerY = e.clientY - rect.top;
      this.isPointerOverCanvas =
        this.canvasPointerX >= 0 &&
        this.canvasPointerX <= rect.width &&
        this.canvasPointerY >= 0 &&
        this.canvasPointerY <= rect.height;
    }

    if (!this.isDragging) return;

    if (typeof e.buttons === 'number' && (e.buttons & 4) === 0) {
      this.isDragging = false;
      return;
    }

    const screenDx = e.clientX - this.lastPointerX;
    const screenDy = e.clientY - this.lastPointerY;
    if (screenDx === 0 && screenDy === 0) return;

    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;

    const cam = this.camera;
    if (!cam) return;

    const sx = screenDx / cam.view.zoom;
    const sy = screenDy / cam.view.zoom;
    const worldDx = sx / 96 + sy / 48;
    const worldDz = sy / 48 - sx / 96;

    cam.pan(-worldDx, -worldDz);
  };

  private readonly onPointerUp = (e: PointerEvent | MouseEvent): void => {
    if (e.button === 1 || this.isDragging) {
      this.isDragging = false;
      if (
        this.activePointerId !== null &&
        typeof this.canvas.releasePointerCapture === 'function'
      ) {
        try {
          this.canvas.releasePointerCapture(this.activePointerId);
        } catch {
          // Ignored
        }
        this.activePointerId = null;
      }
    }
  };

  private readonly onAuxClick = (e: MouseEvent): void => {
    if (e.button === 1) {
      e.preventDefault();
    }
  };

  private readonly onPointerEnter = (): void => {
    this.isPointerOverCanvas = true;
  };

  private readonly onPointerLeave = (): void => {
    this.isPointerOverCanvas = false;
    this.canvasPointerX = -1;
    this.canvasPointerY = -1;
  };

  // --- Keyboard (Arrows and H) ---
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (isEditableElement(e.target)) return;

    switch (e.key) {
      case 'ArrowUp':
        this.arrowUp = true;
        e.preventDefault();
        break;
      case 'ArrowDown':
        this.arrowDown = true;
        e.preventDefault();
        break;
      case 'ArrowLeft':
        this.arrowLeft = true;
        e.preventDefault();
        break;
      case 'ArrowRight':
        this.arrowRight = true;
        e.preventDefault();
        break;
      case 'h':
      case 'H':
        if (!e.ctrlKey && !e.altKey && !e.metaKey) {
          this.centerOnTownCenter();
          e.preventDefault();
        }
        break;
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    switch (e.key) {
      case 'ArrowUp':
        this.arrowUp = false;
        break;
      case 'ArrowDown':
        this.arrowDown = false;
        break;
      case 'ArrowLeft':
        this.arrowLeft = false;
        break;
      case 'ArrowRight':
        this.arrowRight = false;
        break;
    }
  };

  private readonly onBlur = (): void => {
    this.arrowUp = false;
    this.arrowDown = false;
    this.arrowLeft = false;
    this.arrowRight = false;
  };

  private attachEvents(): void {
    if (typeof this.canvas.addEventListener === 'function') {
      this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
      this.canvas.addEventListener(
        'pointerdown',
        this.onPointerDown as EventListener,
      );
      this.canvas.addEventListener(
        'mousedown',
        this.onPointerDown as EventListener,
      );
      this.canvas.addEventListener('auxclick', this.onAuxClick);
      this.canvas.addEventListener('pointerenter', this.onPointerEnter);
      this.canvas.addEventListener('pointerleave', this.onPointerLeave);
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
      globalTarget.addEventListener('keyup', this.onKeyUp as EventListener);
      globalTarget.addEventListener('blur', this.onBlur);
    }
  }

  private detachEvents(): void {
    if (typeof this.canvas.removeEventListener === 'function') {
      this.canvas.removeEventListener('wheel', this.onWheel);
      this.canvas.removeEventListener(
        'pointerdown',
        this.onPointerDown as EventListener,
      );
      this.canvas.removeEventListener(
        'mousedown',
        this.onPointerDown as EventListener,
      );
      this.canvas.removeEventListener('auxclick', this.onAuxClick);
      this.canvas.removeEventListener('pointerenter', this.onPointerEnter);
      this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
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
      globalTarget.removeEventListener('keyup', this.onKeyUp as EventListener);
      globalTarget.removeEventListener('blur', this.onBlur);
    }
  }
}
