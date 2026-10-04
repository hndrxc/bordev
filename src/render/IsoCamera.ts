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

  private isDisposed = false;

  constructor(scene: Scene, canvas: HTMLCanvasElement, mapSize: number) {
    scene.useRightHandedSystem = true;
    this.canvas = canvas;
    this.mapSize = mapSize;

    const width =
      (canvas.clientWidth && canvas.clientWidth > 0
        ? canvas.clientWidth
        : null) ??
      (canvas.width && canvas.width > 0 ? canvas.width : null) ??
      800;
    const height =
      (canvas.clientHeight && canvas.clientHeight > 0
        ? canvas.clientHeight
        : null) ??
      (canvas.height && canvas.height > 0 ? canvas.height : null) ??
      600;

    const initialClamped = clampTarget(
      mapSize * 0.5,
      mapSize * 0.5,
      mapSize,
      MAP_MARGIN,
    );

    this.view = {
      targetX: initialClamped.x,
      targetZ: initialClamped.z,
      width,
      height,
      zoom: 1.0,
    };

    this.camera = new TargetCamera('isoCamera', Vector3.Zero(), scene);
    this.camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.upVector = new Vector3(
      -ISO_SIN30 / ISO_SQRT2,
      ISO_COS30,
      -ISO_SIN30 / ISO_SQRT2,
    );
    this.camera.minZ = 0.1;
    this.camera.maxZ = 2000;

    this.updateOrthoBounds();
    this.updateCameraTransform();
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
    this.view.width =
      (this.canvas.clientWidth && this.canvas.clientWidth > 0
        ? this.canvas.clientWidth
        : null) ??
      (this.canvas.width && this.canvas.width > 0 ? this.canvas.width : null) ??
      800;
    this.view.height =
      (this.canvas.clientHeight && this.canvas.clientHeight > 0
        ? this.canvas.clientHeight
        : null) ??
      (this.canvas.height && this.canvas.height > 0
        ? this.canvas.height
        : null) ??
      600;
    this.updateOrthoBounds();
  }

  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

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
}
