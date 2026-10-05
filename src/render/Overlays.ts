import { Engine } from '@babylonjs/core/Engines/engine';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector2, Vector3, Vector4 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { SessionSnapshot } from '../game/GameSession';
import { ISO_RIGHT_BASIS, ISO_UP_BASIS, type IsoView } from './iso';
import { DebugGrid, type KeepFootprint } from './overlays/DebugGrid';
import {
  OverlayGeometryBuilder,
  type OrderMarker,
} from './overlays/geometryBuilder';
import {
  ensureOverlayShaders,
  ELLIPSE_SHADER_KEY,
  HEALTH_SHADER_KEY,
  MARQUEE_SHADER_KEY,
} from './overlays/overlayShaders';
import {
  ThinInstancePool,
  initIdentityMatrices,
  type ThinInstanceAttributeSpec,
} from './ThinInstancePool';

export type { KeepFootprint } from './overlays/DebugGrid';
export type { OrderMarker } from './overlays/geometryBuilder';

export interface SelectionBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface OverlayFrameInput {
  snapshot: SessionSnapshot | undefined;
  view: IsoView;
  selectedIds: readonly number[];
  markers: readonly OrderMarker[];
  box: SelectionBox | null;
  timeSeconds: number;
  /** Stable height of the entity's sprite top above its anchor, atlas px at zoom 1; undefined if unknown. */
  getSpriteTopPx: (id: number) => number | undefined;
}

const RIGHT_BASIS = new Vector3(
  ISO_RIGHT_BASIS.x,
  ISO_RIGHT_BASIS.y,
  ISO_RIGHT_BASIS.z,
);
const UP_BASIS = new Vector3(ISO_UP_BASIS.x, ISO_UP_BASIS.y, ISO_UP_BASIS.z);

function createGroundQuad(mesh: Mesh): void {
  const vertexData = new VertexData();
  vertexData.positions = [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1];
  vertexData.uvs = [0, 0, 1, 0, 1, 1, 0, 1];
  vertexData.indices = [0, 1, 2, 0, 2, 3];
  vertexData.applyToMesh(mesh);
}

function createUnitQuad(mesh: Mesh): void {
  const vertexData = new VertexData();
  vertexData.positions = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];
  vertexData.uvs = [0, 0, 1, 0, 1, 1, 0, 1];
  vertexData.indices = [0, 1, 2, 0, 2, 3];
  vertexData.applyToMesh(mesh);
}

export class Overlays {
  private readonly scene: Scene;
  private readonly debugGrid: DebugGrid;
  private readonly geometryBuilder = new OverlayGeometryBuilder();

  // Selection ellipses (group 1, beneath sprites)
  private readonly ellipsesMesh: Mesh;
  private readonly ellipsesMaterial: ShaderMaterial;
  private readonly ellipsePool: ThinInstancePool;

  // Health bars (group 3, on top, billboarded)
  private readonly healthBarsMesh: Mesh;
  private readonly healthBarsMaterial: ShaderMaterial;
  private readonly healthBarPool: ThinInstancePool;

  // Marquee box (group 3, screen quad)
  private readonly marqueeMesh: Mesh;
  private readonly marqueeMaterial: ShaderMaterial;
  private readonly marqueeScreenSize = new Vector2(0, 0);
  private readonly marqueeBox = new Vector4(0, 0, 0, 0);

  // Dynamic lines pooled mesh (group 3, on top)
  private dynamicLinesMesh: LinesMesh | null = null;
  private dynamicLinesMaterial: ShaderMaterial | null = null;
  private dynamicLinesCapacity = 2048;

  constructor(scene: Scene, mapSize = 128, initialKeeps: KeepFootprint[] = []) {
    this.scene = scene;
    ensureOverlayShaders();

    // 1. Grid & footprint line meshes (no DOM listeners)
    this.debugGrid = new DebugGrid(scene, mapSize, initialKeeps);

    // 2. Selection Ellipses Mesh (rendering group 1: under sprites)
    this.ellipsesMaterial = new ShaderMaterial(
      'SelectionEllipsesMaterial',
      scene,
      {
        vertex: ELLIPSE_SHADER_KEY,
        fragment: ELLIPSE_SHADER_KEY,
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
        ],
        uniforms: ['viewProjection'],
      },
    );
    this.ellipsesMaterial.disableDepthWrite = true;
    this.ellipsesMaterial.forceDepthWrite = false;
    this.ellipsesMaterial.alphaMode = Engine.ALPHA_COMBINE;
    this.ellipsesMaterial.needAlphaBlending = () => true;
    this.ellipsesMaterial.backFaceCulling = false;

    this.ellipsesMesh = new Mesh('OverlaySelectionEllipsesMesh', scene);
    this.ellipsesMesh.renderingGroupId = 1;
    this.ellipsesMesh.alwaysSelectAsActiveMesh = true;
    this.ellipsesMesh.doNotSyncBoundingInfo = true;
    this.ellipsesMesh.isVisible = false;
    createGroundQuad(this.ellipsesMesh);
    this.ellipsesMesh.material = this.ellipsesMaterial;

    const ellipseAttributes: ThinInstanceAttributeSpec[] = [
      { name: 'matrix', stride: 16 },
      { name: 'iColor', stride: 4 },
    ];
    this.ellipsePool = new ThinInstancePool({
      meshes: this.ellipsesMesh,
      attributes: ellipseAttributes,
      initialCapacity: 256,
    });

    // 3. Health Bars Mesh (rendering group 3: on top, billboarded)
    this.healthBarsMaterial = new ShaderMaterial(
      'HealthBarsMaterial',
      scene,
      {
        vertex: HEALTH_SHADER_KEY,
        fragment: HEALTH_SHADER_KEY,
      },
      {
        attributes: [
          'position',
          'uv',
          'world0',
          'world1',
          'world2',
          'world3',
          'iPos',
          'iBar',
        ],
        uniforms: ['viewProjection', 'uRightBasis', 'uUpBasis'],
      },
    );
    this.healthBarsMaterial.setVector3('uRightBasis', RIGHT_BASIS);
    this.healthBarsMaterial.setVector3('uUpBasis', UP_BASIS);
    this.healthBarsMaterial.disableDepthWrite = true;
    this.healthBarsMaterial.forceDepthWrite = false;
    this.healthBarsMaterial.alphaMode = Engine.ALPHA_COMBINE;
    this.healthBarsMaterial.needAlphaBlending = () => true;
    this.healthBarsMaterial.backFaceCulling = false;

    this.healthBarsMesh = new Mesh('OverlayHealthBarsMesh', scene);
    this.healthBarsMesh.renderingGroupId = 3;
    this.healthBarsMesh.alwaysSelectAsActiveMesh = true;
    this.healthBarsMesh.doNotSyncBoundingInfo = true;
    this.healthBarsMesh.isVisible = false;
    createUnitQuad(this.healthBarsMesh);
    this.healthBarsMesh.material = this.healthBarsMaterial;

    const healthAttributes: ThinInstanceAttributeSpec[] = [
      { name: 'matrix', stride: 16, static: true, init: initIdentityMatrices },
      { name: 'iPos', stride: 3 },
      { name: 'iBar', stride: 4 },
    ];
    this.healthBarPool = new ThinInstancePool({
      meshes: this.healthBarsMesh,
      attributes: healthAttributes,
      initialCapacity: 256,
    });

    // 4. Marquee Screen Quad Mesh (rendering group 3: on top)
    this.marqueeMaterial = new ShaderMaterial(
      'MarqueeMaterial',
      scene,
      {
        vertex: MARQUEE_SHADER_KEY,
        fragment: MARQUEE_SHADER_KEY,
      },
      {
        attributes: ['position', 'uv'],
        uniforms: ['uScreenSize', 'uBox'],
      },
    );
    this.marqueeMaterial.disableDepthWrite = true;
    this.marqueeMaterial.forceDepthWrite = false;
    this.marqueeMaterial.alphaMode = Engine.ALPHA_COMBINE;
    this.marqueeMaterial.needAlphaBlending = () => true;
    this.marqueeMaterial.backFaceCulling = false;

    this.marqueeMesh = new Mesh('OverlayMarqueeMesh', scene);
    this.marqueeMesh.renderingGroupId = 3;
    this.marqueeMesh.alwaysSelectAsActiveMesh = true;
    this.marqueeMesh.doNotSyncBoundingInfo = true;
    this.marqueeMesh.isVisible = false;
    createUnitQuad(this.marqueeMesh);
    this.marqueeMesh.material = this.marqueeMaterial;

    // 5. Dynamic lines pooled mesh (rendering group 3: on top, pre-sized to 2048)
    this.createDynamicLinesMesh();
  }

  get isGridVisible(): boolean {
    return this.debugGrid.isVisible;
  }

  setGridVisible(visible: boolean): void {
    this.debugGrid.setVisible(visible);
  }

  toggleGrid(): boolean {
    return this.debugGrid.toggleVisible();
  }

  setKeepFootprints(keeps: KeepFootprint[]): void {
    this.debugGrid.setKeepFootprints(keeps);
  }

  update(input: OverlayFrameInput): void {
    if (this.scene.isDisposed) return;

    // 1. Marquee box
    const box = input.box;
    const view = input.view;
    if (
      box &&
      view &&
      Math.abs(box.right - box.left) >= 1 &&
      Math.abs(box.bottom - box.top) >= 1
    ) {
      this.marqueeMesh.isVisible = true;
      this.marqueeScreenSize.set(view.width, view.height);
      this.marqueeBox.set(box.left, box.top, box.right, box.bottom);
      this.marqueeMaterial.setVector2('uScreenSize', this.marqueeScreenSize);
      this.marqueeMaterial.setVector4('uBox', this.marqueeBox);
    } else {
      this.marqueeMesh.isVisible = false;
    }

    // 2. Pure geometry builder
    this.geometryBuilder.build({
      snapshot: input.snapshot,
      selectedIds: input.selectedIds,
      markers: input.markers,
      timeSeconds: input.timeSeconds,
      getSpriteTopPx: input.getSpriteTopPx,
    });

    // 3. Selection ellipses
    const geom = this.geometryBuilder;
    if (geom.ellipseCount > 0) {
      this.ellipsePool.copyData(
        'matrix',
        geom.ellipseMatrices,
        geom.ellipseCount,
      );
      this.ellipsePool.copyData(
        'iColor',
        geom.ellipseColors,
        geom.ellipseCount,
      );
    }
    this.ellipsePool.endFrame(geom.ellipseCount);

    // 4. Health bars
    if (geom.healthBarCount > 0) {
      this.healthBarPool.copyData(
        'iPos',
        geom.healthBarPositions,
        geom.healthBarCount,
      );
      this.healthBarPool.copyData(
        'iBar',
        geom.healthBarParams,
        geom.healthBarCount,
      );
    }
    this.healthBarPool.endFrame(geom.healthBarCount);

    // 5. Dynamic lines
    this.flushDynamicLines(geom.lineSegmentCount);
  }

  private flushDynamicLines(count: number): void {
    if (count === 0) {
      if (this.dynamicLinesMesh) {
        this.dynamicLinesMesh.isVisible = false;
        if (this.dynamicLinesMesh.subMeshes.length > 0) {
          this.dynamicLinesMesh.subMeshes[0].indexCount = 0;
          this.dynamicLinesMesh.subMeshes[0].verticesCount = 0;
          this.dynamicLinesMesh.subMeshes[0].setBoundingInfo(
            this.dynamicLinesMesh.getBoundingInfo(),
          );
        }
      }
      return;
    }

    if (count > this.dynamicLinesCapacity) {
      this.growDynamicLines(count);
    }

    if (this.dynamicLinesMesh) {
      this.dynamicLinesMesh.isVisible = true;
      this.dynamicLinesMesh.updateVerticesData(
        VertexBuffer.PositionKind,
        this.geometryBuilder.linePositions,
        false,
      );
      this.dynamicLinesMesh.updateVerticesData(
        VertexBuffer.ColorKind,
        this.geometryBuilder.lineColors,
        false,
      );
      if (this.dynamicLinesMesh.subMeshes.length > 0) {
        this.dynamicLinesMesh.subMeshes[0].indexCount = count * 2;
        this.dynamicLinesMesh.subMeshes[0].verticesCount = count * 2;
        this.dynamicLinesMesh.subMeshes[0].setBoundingInfo(
          this.dynamicLinesMesh.getBoundingInfo(),
        );
      }
    }
  }

  private createDynamicLinesMesh(): void {
    if (this.scene.isDisposed) return;

    const dummyLines: Vector3[][] = new Array(this.dynamicLinesCapacity);
    const dummyColors: Color4[][] = new Array(this.dynamicLinesCapacity);
    const zeroVec = new Vector3(0, 0, 0);
    const zeroCol = new Color4(0, 0, 0, 0);
    for (let i = 0; i < this.dynamicLinesCapacity; i++) {
      dummyLines[i] = [zeroVec, zeroVec];
      dummyColors[i] = [zeroCol, zeroCol];
    }

    this.dynamicLinesMesh = MeshBuilder.CreateLineSystem(
      'overlay_dynamic_lines',
      {
        lines: dummyLines,
        colors: dummyColors,
        useVertexAlpha: true,
        material: this.dynamicLinesMaterial ?? undefined,
        updatable: true,
      },
      this.scene,
    );
    this.dynamicLinesMesh.renderingGroupId = 3;
    this.dynamicLinesMesh.isPickable = false;
    this.dynamicLinesMesh.alwaysSelectAsActiveMesh = true;
    this.dynamicLinesMesh.doNotSyncBoundingInfo = true;
    this.dynamicLinesMesh.isVisible = false;

    if (!this.dynamicLinesMaterial) {
      this.dynamicLinesMaterial = this.dynamicLinesMesh
        .material as ShaderMaterial;
    }
  }

  private growDynamicLines(minCapacity: number): void {
    let newCap = this.dynamicLinesCapacity * 2;
    while (newCap < minCapacity) {
      newCap *= 2;
    }
    this.dynamicLinesCapacity = newCap;

    // Reallocate vertex buffers on the existing LinesMesh without rebuilding the mesh (ReviewRender#2)
    if (this.dynamicLinesMesh) {
      this.dynamicLinesMesh.setVerticesData(
        VertexBuffer.PositionKind,
        this.geometryBuilder.linePositions,
        true,
      );
      this.dynamicLinesMesh.setVerticesData(
        VertexBuffer.ColorKind,
        this.geometryBuilder.lineColors,
        true,
      );
    }
  }

  dispose(): void {
    this.debugGrid.dispose();
    if (this.dynamicLinesMesh) {
      this.dynamicLinesMesh.dispose(false, true);
      this.dynamicLinesMesh = null;
    } else if (this.dynamicLinesMaterial) {
      this.dynamicLinesMaterial.dispose();
    }
    this.dynamicLinesMaterial = null;

    this.ellipsesMesh.dispose();
    this.ellipsesMaterial.dispose();
    this.healthBarsMesh.dispose();
    this.healthBarsMaterial.dispose();
    this.marqueeMesh.dispose();
    this.marqueeMaterial.dispose();
  }
}
