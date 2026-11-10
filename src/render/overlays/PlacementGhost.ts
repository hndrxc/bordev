import { Engine } from '@babylonjs/core/Engines/engine';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import {
  ensureOverlayShaders,
  PLACEMENT_GHOST_SHADER_KEY,
} from './overlayShaders';
import {
  ThinInstancePool,
  type ThinInstanceAttributeSpec,
} from '../ThinInstancePool';
import {
  computePlacementColor,
  computePlacementMatrix,
  type PlacementGhostItem,
} from './geometryBuilder';

export type { PlacementGhostItem } from './geometryBuilder';

/**
 * Creates a unit ground quad in the horizontal X-Z plane (Y = 0)
 * anchored at top-left corner (0, 0, 0) spanning to (1, 0, 1).
 */
function createPlacementGroundQuad(mesh: Mesh): void {
  const vertexData = new VertexData();
  vertexData.positions = [
    0,
    0,
    0, // top-left (0, 0)
    1,
    0,
    0, // top-right (1, 0)
    1,
    0,
    1, // bottom-right (1, 1)
    0,
    0,
    1, // bottom-left (0, 1)
  ];
  vertexData.uvs = [0, 0, 1, 0, 1, 1, 0, 1];
  vertexData.indices = [0, 1, 2, 0, 2, 3];
  vertexData.applyToMesh(mesh);
}

/**
 * Overlays-owned placement ghost for previewing building placement
 * and drag tile lists (e.g. wall dragging).
 *
 * Reuses shader and pre-sized ThinInstancePool buffers without per-frame
 * mesh allocation or deallocation.
 */
export class PlacementGhost {
  private readonly scene: Scene;
  private readonly ghostMesh: Mesh;
  private readonly ghostMaterial: ShaderMaterial;
  private readonly ghostPool: ThinInstancePool;

  private bufferCapacity = 256;
  private matrices = new Float32Array(256 * 16);
  private colors = new Float32Array(256 * 4);
  private params = new Float32Array(256 * 4);
  private activeCount = 0;

  constructor(scene: Scene) {
    this.scene = scene;
    ensureOverlayShaders();

    this.ghostMaterial = new ShaderMaterial(
      'PlacementGhostMaterial',
      scene,
      {
        vertex: PLACEMENT_GHOST_SHADER_KEY,
        fragment: PLACEMENT_GHOST_SHADER_KEY,
      },
      {
        attributes: [
          'position',
          'uv',
          'world0',
          'world1',
          'world2',
          'world3',
          'iColor',
          'iParams',
        ],
        uniforms: ['viewProjection'],
      },
    );
    this.ghostMaterial.disableDepthWrite = true;
    this.ghostMaterial.forceDepthWrite = false;
    this.ghostMaterial.alphaMode = Engine.ALPHA_COMBINE;
    this.ghostMaterial.needAlphaBlending = () => true;
    this.ghostMaterial.backFaceCulling = false;

    this.ghostMesh = new Mesh('OverlayPlacementGhostMesh', scene);
    this.ghostMesh.renderingGroupId = 3;
    this.ghostMesh.alwaysSelectAsActiveMesh = true;
    this.ghostMesh.doNotSyncBoundingInfo = true;
    this.ghostMesh.isPickable = false;
    this.ghostMesh.isVisible = false;
    createPlacementGroundQuad(this.ghostMesh);
    this.ghostMesh.material = this.ghostMaterial;

    const attributes: ThinInstanceAttributeSpec[] = [
      { name: 'matrix', stride: 16 },
      { name: 'iColor', stride: 4 },
      { name: 'iParams', stride: 4 },
    ];
    this.ghostPool = new ThinInstancePool({
      meshes: this.ghostMesh,
      attributes,
      initialCapacity: 256,
    });
  }

  get count(): number {
    return this.activeCount;
  }

  get isVisible(): boolean {
    return this.ghostMesh.isVisible && this.activeCount > 0;
  }

  get mesh(): Mesh {
    return this.ghostMesh;
  }

  get material(): ShaderMaterial {
    return this.ghostMaterial;
  }

  get pool(): ThinInstancePool {
    return this.ghostPool;
  }

  /**
   * Updates the placement ghost with the current placement preview items.
   * If preview items are absent or empty, hides the mesh immediately.
   */
  update(items?: readonly PlacementGhostItem[]): void {
    if (this.scene.isDisposed) return;

    if (!items || items.length === 0) {
      this.clear();
      return;
    }

    const count = items.length;
    if (count > this.bufferCapacity) {
      this.growBuffers(count);
    }

    const m = this.matrices;
    const c = this.colors;
    const p = this.params;

    for (let i = 0; i < count; i++) {
      const item = items[i];
      const mIdx = i * 16;
      const cIdx = i * 4;
      const pIdx = i * 4;

      const w = Math.max(1, item.width || 1);
      const h = Math.max(1, item.height || 1);
      const valid = Boolean(item.valid);

      // Top-left anchor item.x, item.z with height/width scaling and ground elevation Y = 0.015
      computePlacementMatrix(m, mIdx, item.x, item.z, w, h, 0.015);
      computePlacementColor(c, cIdx, valid);

      p[pIdx + 0] = w;
      p[pIdx + 1] = h;
      p[pIdx + 2] = valid ? 1.0 : 0.0;
      p[pIdx + 3] = 0.0;
    }

    this.ghostPool.copyData('matrix', m, count);
    this.ghostPool.copyData('iColor', c, count);
    this.ghostPool.copyData('iParams', p, count);
    this.ghostPool.endFrame(count);
    this.activeCount = count;
  }

  /**
   * Hides the ghost mesh and clears active instances.
   */
  clear(): void {
    if (this.activeCount > 0) {
      this.activeCount = 0;
      this.ghostPool.endFrame(0);
    }
    this.ghostMesh.isVisible = false;
  }

  private growBuffers(minCapacity: number): void {
    let newCap = this.bufferCapacity * 2;
    while (newCap < minCapacity) {
      newCap *= 2;
    }
    this.bufferCapacity = newCap;

    const nextM = new Float32Array(newCap * 16);
    nextM.set(this.matrices);
    this.matrices = nextM;

    const nextC = new Float32Array(newCap * 4);
    nextC.set(this.colors);
    this.colors = nextC;

    const nextP = new Float32Array(newCap * 4);
    nextP.set(this.params);
    this.params = nextP;
  }

  dispose(): void {
    this.activeCount = 0;
    this.ghostMesh.dispose();
    this.ghostMaterial.dispose();
  }
}
