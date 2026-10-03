import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
import type { Scene } from '@babylonjs/core/scene';

export interface KeepFootprint {
  x: number;
  z: number;
  width?: number;
  height?: number;
}

export class Overlays {
  private readonly scene: Scene;
  private readonly mapSize: number;
  private gridMesh: LinesMesh | null = null;
  private footprintMesh: LinesMesh | null = null;
  private visible = true;
  private keeps: KeepFootprint[] = [];

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'g' || event.key === 'G') {
      this.toggleGrid();
    }
  };

  constructor(scene: Scene, mapSize = 128, initialKeeps: KeepFootprint[] = []) {
    this.scene = scene;
    this.mapSize = mapSize;
    this.keeps = [...initialKeeps];

    this.createGridMesh();
    this.createFootprintMesh();

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKeyDown);
    }
  }

  get isGridVisible(): boolean {
    return this.visible;
  }

  setGridVisible(visible: boolean): void {
    this.visible = visible;
    if (this.gridMesh) {
      this.gridMesh.isVisible = visible;
    }
    if (this.footprintMesh) {
      this.footprintMesh.isVisible = visible;
    }
  }

  toggleGrid(): boolean {
    this.setGridVisible(!this.visible);
    return this.visible;
  }

  setKeepFootprints(keeps: KeepFootprint[]): void {
    this.keeps = [...keeps];
    if (this.footprintMesh) {
      this.footprintMesh.dispose();
      this.footprintMesh = null;
    }
    this.createFootprintMesh();
  }

  private createGridMesh(): void {
    if (this.scene.isDisposed) return;

    const lines: Vector3[][] = [];
    const size = this.mapSize;
    const y = 0.005;

    for (let x = 0; x <= size; x++) {
      lines.push([new Vector3(x, y, 0), new Vector3(x, y, size)]);
    }
    for (let z = 0; z <= size; z++) {
      lines.push([new Vector3(0, y, z), new Vector3(size, y, z)]);
    }

    const mesh = MeshBuilder.CreateLineSystem(
      'overlay_grid',
      { lines, updatable: false },
      this.scene,
    );
    mesh.color = new Color3(0.75, 0.75, 0.75);
    mesh.alpha = 0.35;
    mesh.renderingGroupId = 3;
    mesh.isPickable = false;
    mesh.isVisible = this.visible;
    this.gridMesh = mesh;
  }

  private createFootprintMesh(): void {
    if (this.scene.isDisposed || this.keeps.length === 0) return;

    const lines: Vector3[][] = [];
    const y = 0.01;

    for (const keep of this.keeps) {
      const kx = keep.x;
      const kz = keep.z;
      const w = keep.width ?? 4;
      const h = keep.height ?? 4;

      // Outer 4x4 diamond boundary
      lines.push([
        new Vector3(kx, y, kz),
        new Vector3(kx + w, y, kz),
        new Vector3(kx + w, y, kz + h),
        new Vector3(kx, y, kz + h),
        new Vector3(kx, y, kz),
      ]);

      // Internal 1x1 tile divisions inside the footprint
      for (let ix = 1; ix < w; ix++) {
        lines.push([
          new Vector3(kx + ix, y, kz),
          new Vector3(kx + ix, y, kz + h),
        ]);
      }
      for (let iz = 1; iz < h; iz++) {
        lines.push([
          new Vector3(kx, y, kz + iz),
          new Vector3(kx + w, y, kz + iz),
        ]);
      }

      // Anchor marker cross at [kx + w/2, kz + h/2]
      const ax = kx + w / 2;
      const az = kz + h / 2;
      const arm = 0.3;
      lines.push([
        new Vector3(ax - arm, y, az),
        new Vector3(ax + arm, y, az),
      ]);
      lines.push([
        new Vector3(ax, y, az - arm),
        new Vector3(ax, y, az + arm),
      ]);
    }

    const mesh = MeshBuilder.CreateLineSystem(
      'overlay_footprints',
      { lines, updatable: false },
      this.scene,
    );
    mesh.color = new Color3(0.2, 0.9, 1.0);
    mesh.alpha = 0.9;
    mesh.renderingGroupId = 3;
    mesh.isPickable = false;
    mesh.isVisible = this.visible;
    this.footprintMesh = mesh;
  }

  dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDown);
    }
    if (this.gridMesh) {
      this.gridMesh.dispose();
      this.gridMesh = null;
    }
    if (this.footprintMesh) {
      this.footprintMesh.dispose();
      this.footprintMesh = null;
    }
  }
}
