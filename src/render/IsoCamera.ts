import { Camera } from '@babylonjs/core/Cameras/camera';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';
import {
  clampTarget,
  ISO_CAMERA_DISTANCE,
  ISO_COS30,
  ISO_SIN30,
  ISO_SQRT2,
  type IsoView,
  MAP_MARGIN,
  PPU,
  ZOOM_MAX,
  ZOOM_MIN,
} from './iso';

export class IsoCamera {
  public readonly camera: TargetCamera;
  public readonly view: IsoView;

  private mapSize: number;
  private readonly canvas: HTMLCanvasElement;
  private readonly targetVec = new Vector3(0, 0, 0);

  private isDragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private activePointerId: number | null = null;
  private isDisposed = false;

  constructor(scene: Scene, canvas: HTMLCanvasElement, mapSize: number) {
    scene.useRightHandedSystem = true;
    this.canvas = canvas;
    this.mapSize = mapSize;

    const width = (canvas.clientWidth && canvas.clientWidth > 0 ? canvas.clientWidth : null) ??
      (canvas.width && canvas.width > 0 ? canvas.width : null) ??
      800;
    const height = (canvas.clientHeight && canvas.clientHeight > 0 ? canvas.clientHeight : null) ??
      (canvas.height && canvas.height > 0 ? canvas.height : null) ??
      600;

    const initialClamped = clampTarget(mapSize * 0.5, mapSize * 0.5, mapSize, MAP_MARGIN);

    this.view = {
      targetX: initialClamped.x,
      targetZ: initialClamped.z,
      width,
      height,
      zoom: 1.0,
    };

    this.camera = new TargetCamera('isoCamera', Vector3.Zero(), scene);
    this.camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.upVector = new Vector3(-ISO_SIN30 / ISO_SQRT2, ISO_COS30, -ISO_SIN30 / ISO_SQRT2);
    this.camera.minZ = 0.1;
    this.camera.maxZ = 2000;

    this.updateOrthoBounds();
    this.updateCameraTransform();

    this.attachEvents();
  }

  public setMapSize(size: number): void {
    this.mapSize = size;
    this.centerOn(this.view.targetX, this.view.targetZ);
  }

  public centerOn(x: number, z: number): void {
    const clamped = clampTarget(x, z, this.mapSize, MAP_MARGIN);
    this.view.targetX = clamped.x;
    this.view.targetZ = clamped.z;
    this.updateCameraTransform();
  }

  public pan(dx: number, dz: number): void {
    this.centerOn(this.view.targetX + dx, this.view.targetZ + dz);
  }

  public zoomAt(screenX: number, screenY: number, zoom: number): void {
    const clampedZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
    const oldZoom = this.view.zoom;
    if (Math.abs(clampedZoom - oldZoom) < 1e-6) {
      return;
    }

    const factor = 1 / oldZoom - 1 / clampedZoom;
    const dsx = (screenX - this.view.width * 0.5) * factor;
    const dsy = (screenY - this.view.height * 0.5) * factor;

    const newTargetX = this.view.targetX + dsx / 96 + dsy / 48;
    const newTargetZ = this.view.targetZ + dsy / 48 - dsx / 96;

    this.view.zoom = clampedZoom;
    this.updateOrthoBounds();
    this.centerOn(newTargetX, newTargetZ);
  }

  public resize(): void {
    this.view.width = (this.canvas.clientWidth && this.canvas.clientWidth > 0 ? this.canvas.clientWidth : null) ??
      (this.canvas.width && this.canvas.width > 0 ? this.canvas.width : null) ??
      800;
    this.view.height = (this.canvas.clientHeight && this.canvas.clientHeight > 0 ? this.canvas.clientHeight : null) ??
      (this.canvas.height && this.canvas.height > 0 ? this.canvas.height : null) ??
      600;
    this.updateOrthoBounds();
  }

  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    this.detachEvents();
    this.camera.dispose();
  }

  private updateOrthoBounds(): void {
    const halfW = (this.view.width * 0.5) / (PPU * this.view.zoom);
    const halfH = (this.view.height * 0.5) / (PPU * this.view.zoom);
    this.camera.orthoLeft = -halfW;
    this.camera.orthoRight = halfW;
    this.camera.orthoTop = halfH;
    this.camera.orthoBottom = -halfH;
  }

  private updateCameraTransform(): void {
    const tx = this.view.targetX;
    const tz = this.view.targetZ;
    this.camera.position.set(
      tx + (ISO_COS30 / ISO_SQRT2) * ISO_CAMERA_DISTANCE,
      ISO_SIN30 * ISO_CAMERA_DISTANCE,
      tz + (ISO_COS30 / ISO_SQRT2) * ISO_CAMERA_DISTANCE,
    );
    this.targetVec.set(tx, 0, tz);
    this.camera.setTarget(this.targetVec);
  }

  private readonly onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (e.deltaY === 0) {
      return;
    }
    let screenX = this.view.width * 0.5;
    let screenY = this.view.height * 0.5;
    if (typeof e.clientX === 'number') {
      const rect = typeof this.canvas.getBoundingClientRect === 'function' ? this.canvas.getBoundingClientRect() : null;
      screenX = e.clientX - (rect ? rect.left : 0);
      screenY = e.clientY - (rect ? rect.top : 0);
    } else if ('offsetX' in e && typeof e.offsetX === 'number' && 'offsetY' in e && typeof e.offsetY === 'number') {
      screenX = e.offsetX;
      screenY = e.offsetY;
    }

    const zoomFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    this.zoomAt(screenX, screenY, this.view.zoom * zoomFactor);
  };

  private readonly onPointerDown = (e: PointerEvent | MouseEvent) => {
    if (e.button === 1) {
      this.isDragging = true;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      if ('pointerId' in e && typeof e.pointerId === 'number' && typeof this.canvas.setPointerCapture === 'function') {
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

  private readonly onPointerMove = (e: PointerEvent | MouseEvent) => {
    if (!this.isDragging) return;
    if (typeof e.buttons === 'number' && (e.buttons & 4) === 0) {
      this.isDragging = false;
      return;
    }
    const screenDx = e.clientX - this.lastPointerX;
    const screenDy = e.clientY - this.lastPointerY;
    if (screenDx === 0 && screenDy === 0) {
      return;
    }
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;

    const sx = screenDx / this.view.zoom;
    const sy = screenDy / this.view.zoom;
    const worldDx = sx / 96 + sy / 48;
    const worldDz = sy / 48 - sx / 96;

    this.pan(-worldDx, -worldDz);
  };

  private readonly onPointerUp = (e: PointerEvent | MouseEvent) => {
    if (e.button === 1 || this.isDragging) {
      this.isDragging = false;
      if (this.activePointerId !== null && typeof this.canvas.releasePointerCapture === 'function') {
        try {
          this.canvas.releasePointerCapture(this.activePointerId);
        } catch {
          // Ignored
        }
        this.activePointerId = null;
      }
    }
  };

  private readonly onAuxClick = (e: MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
    }
  };

  private attachEvents(): void {
    if (typeof this.canvas.addEventListener === 'function') {
      this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
      this.canvas.addEventListener('pointerdown', this.onPointerDown as EventListener);
      this.canvas.addEventListener('mousedown', this.onPointerDown as EventListener);
      this.canvas.addEventListener('auxclick', this.onAuxClick);
    }
    const globalTarget = typeof window !== 'undefined' ? window : this.canvas;
    if (typeof globalTarget.addEventListener === 'function') {
      globalTarget.addEventListener('pointermove', this.onPointerMove as EventListener);
      globalTarget.addEventListener('mousemove', this.onPointerMove as EventListener);
      globalTarget.addEventListener('pointerup', this.onPointerUp as EventListener);
      globalTarget.addEventListener('mouseup', this.onPointerUp as EventListener);
    }
  }

  private detachEvents(): void {
    if (typeof this.canvas.removeEventListener === 'function') {
      this.canvas.removeEventListener('wheel', this.onWheel);
      this.canvas.removeEventListener('pointerdown', this.onPointerDown as EventListener);
      this.canvas.removeEventListener('mousedown', this.onPointerDown as EventListener);
      this.canvas.removeEventListener('auxclick', this.onAuxClick);
    }
    const globalTarget = typeof window !== 'undefined' ? window : this.canvas;
    if (typeof globalTarget.removeEventListener === 'function') {
      globalTarget.removeEventListener('pointermove', this.onPointerMove as EventListener);
      globalTarget.removeEventListener('mousemove', this.onPointerMove as EventListener);
      globalTarget.removeEventListener('pointerup', this.onPointerUp as EventListener);
      globalTarget.removeEventListener('mouseup', this.onPointerUp as EventListener);
    }
  }
}
