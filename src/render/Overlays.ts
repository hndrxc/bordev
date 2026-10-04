import { Engine } from '@babylonjs/core/Engines/engine';
import { Effect } from '@babylonjs/core/Materials/effect';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector2, Vector3, Vector4 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
import type { Scene } from '@babylonjs/core/scene';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { SessionSnapshot } from '../game/GameSession';
import { PPU, type IsoView } from './iso';

export interface KeepFootprint {
  x: number;
  z: number;
  width?: number;
  height?: number;
}

export interface OrderMarker {
  x: number;
  z: number;
  kind: 'move' | 'attackMove';
  expiresAt: number;
}

export interface SelectionBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const ELLIPSE_SHADER_KEY = 'bordevSelectionEllipse';
const HEALTH_SHADER_KEY = 'bordevHealthBar';
const MARQUEE_SHADER_KEY = 'bordevMarquee';

const RIGHT_BASIS = new Vector3(1 / Math.SQRT2, 0, -1 / Math.SQRT2);
const UP_BASIS = new Vector3(
  -0.5 / Math.SQRT2,
  Math.sqrt(3) / 2,
  -0.5 / Math.SQRT2,
);

const COLOR_FRIENDLY: readonly [number, number, number, number] = [
  0.2, 0.9, 0.35, 0.95,
];
const COLOR_ENEMY: readonly [number, number, number, number] = [
  0.95, 0.2, 0.2, 0.95,
];
const COLOR_NEUTRAL: readonly [number, number, number, number] = [
  0.95, 0.9, 0.25, 0.95,
];

function ensureOverlayShaders(): void {
  if (!Effect.ShadersStore[`${ELLIPSE_SHADER_KEY}VertexShader`]) {
    Effect.ShadersStore[`${ELLIPSE_SHADER_KEY}VertexShader`] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 world0;
attribute vec4 world1;
attribute vec4 world2;
attribute vec4 world3;
attribute vec4 iColor;

uniform mat4 viewProjection;
varying vec2 vLocalUV;
varying vec4 vColor;

void main() {
    mat4 finalWorld = mat4(world0, world1, world2, world3);
    gl_Position = viewProjection * (finalWorld * vec4(position, 1.0));
    vLocalUV = uv * 2.0 - 1.0;
    vColor = iColor;
}
`;
  }

  if (!Effect.ShadersStore[`${ELLIPSE_SHADER_KEY}FragmentShader`]) {
    Effect.ShadersStore[`${ELLIPSE_SHADER_KEY}FragmentShader`] = `
precision highp float;
varying vec2 vLocalUV;
varying vec4 vColor;

void main() {
    float dist = length(vLocalUV);
    if (dist > 1.0) {
        discard;
    }
    float ring = smoothstep(0.78, 0.85, dist) * smoothstep(1.0, 0.93, dist);
    float fill = 0.16 * smoothstep(0.0, 0.85, 1.0 - dist);
    float alpha = clamp(ring + fill, 0.0, 1.0) * vColor.a;
    gl_FragColor = vec4(vColor.rgb, alpha);
}
`;
  }

  if (!Effect.ShadersStore[`${HEALTH_SHADER_KEY}VertexShader`]) {
    Effect.ShadersStore[`${HEALTH_SHADER_KEY}VertexShader`] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 world0;
attribute vec4 world1;
attribute vec4 world2;
attribute vec4 world3;
attribute vec3 iPos;
attribute vec4 iBar;
attribute vec4 iBarColor;

uniform mat4 viewProjection;
uniform vec3 uRightBasis;
uniform vec3 uUpBasis;

varying vec2 vUV;
varying vec4 vBar;
varying vec4 vBarColor;

void main() {
    float dx = (uv.x - 0.5) * iBar.x;
    float dy = (uv.y - 0.5) * iBar.y + iBar.w;
    vec3 worldPos = iPos + dx * uRightBasis + dy * uUpBasis;
    gl_Position = viewProjection * vec4(worldPos, 1.0);
    vUV = uv;
    vBar = iBar;
    vBarColor = iBarColor;
}
`;
  }

  if (!Effect.ShadersStore[`${HEALTH_SHADER_KEY}FragmentShader`]) {
    Effect.ShadersStore[`${HEALTH_SHADER_KEY}FragmentShader`] = `
precision highp float;
varying vec2 vUV;
varying vec4 vBar;
varying vec4 vBarColor;

void main() {
    float borderX = 0.035;
    float borderY = 0.14;
    if (vUV.x < borderX || vUV.x > (1.0 - borderX) || vUV.y < borderY || vUV.y > (1.0 - borderY)) {
        gl_FragColor = vec4(0.06, 0.06, 0.06, 0.95);
        return;
    }

    float innerX = (vUV.x - borderX) / (1.0 - 2.0 * borderX);
    float hpFrac = clamp(vBar.z, 0.0, 1.0);

    if (innerX <= hpFrac) {
        vec3 hpColor;
        if (hpFrac > 0.5) {
            hpColor = vec3(0.2, 0.88, 0.25);
        } else if (hpFrac > 0.25) {
            hpColor = vec3(0.95, 0.82, 0.12);
        } else {
            hpColor = vec3(0.95, 0.2, 0.12);
        }
        gl_FragColor = vec4(hpColor, 0.98);
    } else {
        gl_FragColor = vec4(0.22, 0.06, 0.06, 0.82);
    }
}
`;
  }

  if (!Effect.ShadersStore[`${MARQUEE_SHADER_KEY}VertexShader`]) {
    Effect.ShadersStore[`${MARQUEE_SHADER_KEY}VertexShader`] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;

uniform vec2 uScreenSize;
uniform vec4 uBox;

varying vec2 vUV;
varying vec2 vBoxSize;

void main() {
    float minX = min(uBox.x, uBox.z);
    float maxX = max(uBox.x, uBox.z);
    float minY = min(uBox.y, uBox.w);
    float maxY = max(uBox.y, uBox.w);

    float px = mix(minX, maxX, uv.x);
    float py = mix(minY, maxY, uv.y);

    float ndcX = (px / uScreenSize.x) * 2.0 - 1.0;
    float ndcY = 1.0 - (py / uScreenSize.y) * 2.0;

    gl_Position = vec4(ndcX, ndcY, -0.999, 1.0);
    vUV = uv;
    vBoxSize = vec2(max(maxX - minX, 1.0), max(maxY - minY, 1.0));
}
`;
  }

  if (!Effect.ShadersStore[`${MARQUEE_SHADER_KEY}FragmentShader`]) {
    Effect.ShadersStore[`${MARQUEE_SHADER_KEY}FragmentShader`] = `
precision highp float;
varying vec2 vUV;
varying vec2 vBoxSize;

void main() {
    float dx = min(vUV.x, 1.0 - vUV.x) * vBoxSize.x;
    float dy = min(vUV.y, 1.0 - vUV.y) * vBoxSize.y;
    float dist = min(dx, dy);

    if (dist < 1.5) {
        gl_FragColor = vec4(0.2, 0.92, 0.38, 0.92);
    } else {
        gl_FragColor = vec4(0.2, 0.92, 0.38, 0.12);
    }
}
`;
  }
}

export class Overlays {
  private readonly scene: Scene;
  private readonly mapSize: number;
  private gridMesh: LinesMesh | null = null;
  private footprintMesh: LinesMesh | null = null;
  private dynamicLinesMesh: LinesMesh | null = null;
  private dynamicLinesMaterial: ShaderMaterial | null = null;
  private dynamicLinesCapacity = 128;
  private dynamicSegmentCount = 0;
  private dynamicPositionsBuffer = new Float32Array(128 * 6);
  private dynamicColorsBuffer = new Float32Array(128 * 8);
  private selectionStamps = new Uint32Array(512);
  private selectionStamp = 0;
  private selectedCount = 0;
  private readonly marqueeScreenSize = new Vector2(0, 0);
  private readonly marqueeBox = new Vector4(0, 0, 0, 0);
  private visible = true;
  private keeps: KeepFootprint[] = [];

  // Selection ellipses (group 1, beneath sprites)
  private readonly ellipsesMesh: Mesh;
  private readonly ellipsesMaterial: ShaderMaterial;
  private ellipseCapacity = 64;
  private ellipseCount = 0;
  private ellipseMatrixBuffer = new Float32Array(64 * 16);
  private ellipseColorBuffer = new Float32Array(64 * 4);

  // Health bars (group 3, on top, billboarded)
  private readonly healthBarsMesh: Mesh;
  private readonly healthBarsMaterial: ShaderMaterial;
  private healthCapacity = 64;
  private healthCount = 0;
  private healthMatrixBuffer = new Float32Array(64 * 16);
  private healthPosBuffer = new Float32Array(64 * 3);
  private healthBarBuffer = new Float32Array(64 * 4);
  private healthColorBuffer = new Float32Array(64 * 4);

  // Marquee box (group 3, screen quad)
  private readonly marqueeMesh: Mesh;
  private readonly marqueeMaterial: ShaderMaterial;

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'g' || event.key === 'G') {
      this.toggleGrid();
    }
  };

  constructor(scene: Scene, mapSize = 128, initialKeeps: KeepFootprint[] = []) {
    this.scene = scene;
    this.mapSize = mapSize;
    this.keeps = [...initialKeeps];

    ensureOverlayShaders();

    // 1. Grid & footprint line meshes
    this.createGridMesh();
    this.createFootprintMesh();

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
    this.createGroundQuad(this.ellipsesMesh);

    this.ellipsesMesh.thinInstanceRegisterAttribute('iColor', 4);
    this.ellipsesMesh.thinInstanceSetBuffer(
      'matrix',
      this.ellipseMatrixBuffer,
      16,
      false,
    );
    this.ellipsesMesh.thinInstanceSetBuffer(
      'iColor',
      this.ellipseColorBuffer,
      4,
      false,
    );
    this.ellipsesMesh.thinInstanceCount = 0;
    this.ellipsesMesh.material = this.ellipsesMaterial;

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
          'iBarColor',
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
    this.createUnitQuad(this.healthBarsMesh);

    this.initIdentityMatrices(this.healthMatrixBuffer, 0, this.healthCapacity);
    this.healthBarsMesh.thinInstanceRegisterAttribute('iPos', 3);
    this.healthBarsMesh.thinInstanceRegisterAttribute('iBar', 4);
    this.healthBarsMesh.thinInstanceRegisterAttribute('iBarColor', 4);
    this.healthBarsMesh.thinInstanceSetBuffer(
      'matrix',
      this.healthMatrixBuffer,
      16,
      false,
    );
    this.healthBarsMesh.thinInstanceSetBuffer(
      'iPos',
      this.healthPosBuffer,
      3,
      false,
    );
    this.healthBarsMesh.thinInstanceSetBuffer(
      'iBar',
      this.healthBarBuffer,
      4,
      false,
    );
    this.healthBarsMesh.thinInstanceSetBuffer(
      'iBarColor',
      this.healthColorBuffer,
      4,
      false,
    );
    this.healthBarsMesh.thinInstanceCount = 0;
    this.healthBarsMesh.material = this.healthBarsMaterial;

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
    this.createUnitQuad(this.marqueeMesh);
    this.marqueeMesh.material = this.marqueeMaterial;

    // 5. Dynamic lines pooled mesh (rendering group 3: on top)
    this.createDynamicLinesMesh();
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

  update(
    snapshot?: SessionSnapshot,
    view?: IsoView,
    selectedIds: readonly number[] = [],
    markers: readonly OrderMarker[] = [],
    box: SelectionBox | null = null,
    timeSeconds?: number,
    getFrameAy?: (id: number) => number | undefined,
  ): void {
    if (this.scene.isDisposed) return;

    const now =
      timeSeconds ??
      (typeof performance !== 'undefined' ? performance.now() / 1000 : 0);

    this.selectedCount = selectedIds.length;
    this.selectionStamp = (this.selectionStamp + 1) >>> 0;
    if (this.selectionStamp === 0) {
      this.selectionStamps.fill(0);
      this.selectionStamp = 1;
    }
    for (let s = 0; s < selectedIds.length; s++) {
      const id = selectedIds[s];
      if (id >= this.selectionStamps.length) {
        const grown = new Uint32Array(
          Math.max(id + 1, this.selectionStamps.length * 2),
        );
        grown.set(this.selectionStamps);
        this.selectionStamps = grown;
      }
      this.selectionStamps[id] = this.selectionStamp;
    }

    // 1. Marquee box (reusing scratch vectors)
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

    // 2. Dynamic lines: Waypoints, Rally lines, and Order Markers
    this.updateDynamicLines(snapshot, markers, now);
    // 3. Selection Ellipses and Health Bars
    this.ellipseCount = 0;
    this.healthCount = 0;

    if (snapshot && snapshot.entities && this.selectedCount > 0) {
      const entities = snapshot.entities;
      const count = entities.length;

      for (let i = 0; i < count; i++) {
        const ent = entities[i];
        if (this.selectionStamps[ent.id] !== this.selectionStamp) continue;

        const kind = ent.kind;
        let color = COLOR_FRIENDLY;
        if (ent.player === 1) {
          color = COLOR_ENEMY;
        } else if (ent.player === undefined || ent.player < 0) {
          color = COLOR_NEUTRAL;
        }

        // Add selection ellipse
        if (kind === 'unit') {
          const r = (ent.radius ?? 0.35) * 1.25;
          this.addEllipse(ent.x, ent.z, r, r, color);
        } else if (kind === 'building') {
          const w = ent.width ?? 4;
          const h = ent.height ?? 4;
          this.addEllipse(
            ent.x + w * 0.5,
            ent.z + h * 0.5,
            w * 0.55,
            h * 0.55,
            color,
          );
        } else if (kind === 'mine') {
          const w = ent.width ?? 2;
          const h = ent.height ?? 2;
          this.addEllipse(
            ent.x + w * 0.5,
            ent.z + h * 0.5,
            w * 0.55,
            h * 0.55,
            COLOR_NEUTRAL,
          );
        }

        // Add health bar
        const hp = ent.hp;
        const maxHp = ent.maxHp;
        if (hp !== undefined && maxHp !== undefined && maxHp > 0) {
          const frac = Math.max(0, Math.min(1, hp / maxHp));
          let barW = 0.7;
          let barH = 0.09;
          let posX = ent.x;
          let posZ = ent.z;
          let margin = 8;

          if (kind === 'building') {
            const bw = ent.width ?? 4;
            const bh = ent.height ?? 4;
            barW = Math.max(1.2, bw * 0.5);
            barH = 0.12;
            posX = ent.x + bw * 0.5;
            posZ = ent.z + bh * 0.5;
            margin = 12;
          } else if (kind === 'mine') {
            const mw = ent.width ?? 2;
            barW = 1.0;
            barH = 0.1;
            posX = ent.x + mw * 0.5;
            posZ = ent.z + mw * 0.5;
            margin = 10;
          }

          const frameAy = getFrameAy ? getFrameAy(ent.id) : undefined;
          let barY: number;
          if (frameAy !== undefined) {
            barY = (frameAy + margin) / PPU + barH * 0.5;
          } else {
            if (kind === 'building') {
              barY = 3.6;
            } else if (kind === 'mine') {
              barY = 1.6;
            } else {
              barY = 1.55;
            }
          }

          this.addHealthBar(posX, posZ, barW, barH, frac, barY, color);
        }
      }
    }

    this.endEllipses();
    this.endHealthBars();
  }

  private addEllipse(
    x: number,
    z: number,
    radiusX: number,
    radiusZ: number,
    color: readonly [number, number, number, number],
  ): void {
    if (this.ellipseCount >= this.ellipseCapacity) {
      this.growEllipses();
    }

    const idx = this.ellipseCount;
    const mOffset = idx * 16;
    this.ellipseMatrixBuffer[mOffset + 0] = radiusX;
    this.ellipseMatrixBuffer[mOffset + 1] = 0;
    this.ellipseMatrixBuffer[mOffset + 2] = 0;
    this.ellipseMatrixBuffer[mOffset + 3] = 0;

    this.ellipseMatrixBuffer[mOffset + 4] = 0;
    this.ellipseMatrixBuffer[mOffset + 5] = 1;
    this.ellipseMatrixBuffer[mOffset + 6] = 0;
    this.ellipseMatrixBuffer[mOffset + 7] = 0;

    this.ellipseMatrixBuffer[mOffset + 8] = 0;
    this.ellipseMatrixBuffer[mOffset + 9] = 0;
    this.ellipseMatrixBuffer[mOffset + 10] = radiusZ;
    this.ellipseMatrixBuffer[mOffset + 11] = 0;

    this.ellipseMatrixBuffer[mOffset + 12] = x;
    this.ellipseMatrixBuffer[mOffset + 13] = 0.008;
    this.ellipseMatrixBuffer[mOffset + 14] = z;
    this.ellipseMatrixBuffer[mOffset + 15] = 1;

    const cOffset = idx * 4;
    this.ellipseColorBuffer[cOffset + 0] = color[0];
    this.ellipseColorBuffer[cOffset + 1] = color[1];
    this.ellipseColorBuffer[cOffset + 2] = color[2];
    this.ellipseColorBuffer[cOffset + 3] = color[3];

    this.ellipseCount++;
  }

  private endEllipses(): void {
    if (this.ellipseCount === 0) {
      this.ellipsesMesh.thinInstanceCount = 0;
      this.ellipsesMesh.isVisible = false;
      return;
    }

    this.ellipsesMesh.isVisible = true;
    this.ellipsesMesh.thinInstancePartialBufferUpdate(
      'matrix',
      this.ellipseCount,
      0,
    );
    this.ellipsesMesh.thinInstancePartialBufferUpdate(
      'iColor',
      this.ellipseCount,
      0,
    );
    this.ellipsesMesh.thinInstanceCount = this.ellipseCount;
  }

  private growEllipses(): void {
    const newCap = this.ellipseCapacity * 2;
    const nextMatrix = new Float32Array(newCap * 16);
    nextMatrix.set(this.ellipseMatrixBuffer);
    this.ellipseMatrixBuffer = nextMatrix;

    const nextColor = new Float32Array(newCap * 4);
    nextColor.set(this.ellipseColorBuffer);
    this.ellipseColorBuffer = nextColor;

    this.ellipseCapacity = newCap;
    this.ellipsesMesh.thinInstanceSetBuffer(
      'matrix',
      this.ellipseMatrixBuffer,
      16,
      false,
    );
    this.ellipsesMesh.thinInstanceSetBuffer(
      'iColor',
      this.ellipseColorBuffer,
      4,
      false,
    );
  }

  private addHealthBar(
    posX: number,
    posZ: number,
    barW: number,
    barH: number,
    hpFrac: number,
    barY: number,
    color: readonly [number, number, number, number],
  ): void {
    if (this.healthCount >= this.healthCapacity) {
      this.growHealthBars();
    }

    const idx = this.healthCount;
    const pOffset = idx * 3;
    this.healthPosBuffer[pOffset + 0] = posX;
    this.healthPosBuffer[pOffset + 1] = 0;
    this.healthPosBuffer[pOffset + 2] = posZ;

    const bOffset = idx * 4;
    this.healthBarBuffer[bOffset + 0] = barW;
    this.healthBarBuffer[bOffset + 1] = barH;
    this.healthBarBuffer[bOffset + 2] = hpFrac;
    this.healthBarBuffer[bOffset + 3] = barY;

    const cOffset = idx * 4;
    this.healthColorBuffer[cOffset + 0] = color[0];
    this.healthColorBuffer[cOffset + 1] = color[1];
    this.healthColorBuffer[cOffset + 2] = color[2];
    this.healthColorBuffer[cOffset + 3] = color[3];

    this.healthCount++;
  }

  private endHealthBars(): void {
    if (this.healthCount === 0) {
      this.healthBarsMesh.thinInstanceCount = 0;
      this.healthBarsMesh.isVisible = false;
      return;
    }

    this.healthBarsMesh.isVisible = true;
    this.healthBarsMesh.thinInstancePartialBufferUpdate(
      'matrix',
      this.healthCount,
      0,
    );
    this.healthBarsMesh.thinInstancePartialBufferUpdate(
      'iPos',
      this.healthCount,
      0,
    );
    this.healthBarsMesh.thinInstancePartialBufferUpdate(
      'iBar',
      this.healthCount,
      0,
    );
    this.healthBarsMesh.thinInstancePartialBufferUpdate(
      'iBarColor',
      this.healthCount,
      0,
    );
    this.healthBarsMesh.thinInstanceCount = this.healthCount;
  }

  private growHealthBars(): void {
    const newCap = this.healthCapacity * 2;

    const nextMatrix = new Float32Array(newCap * 16);
    nextMatrix.set(this.healthMatrixBuffer);
    this.initIdentityMatrices(
      nextMatrix,
      this.healthCapacity,
      newCap - this.healthCapacity,
    );
    this.healthMatrixBuffer = nextMatrix;

    const nextPos = new Float32Array(newCap * 3);
    nextPos.set(this.healthPosBuffer);
    this.healthPosBuffer = nextPos;

    const nextBar = new Float32Array(newCap * 4);
    nextBar.set(this.healthBarBuffer);
    this.healthBarBuffer = nextBar;

    const nextColor = new Float32Array(newCap * 4);
    nextColor.set(this.healthColorBuffer);
    this.healthColorBuffer = nextColor;

    this.healthCapacity = newCap;
    this.healthBarsMesh.thinInstanceSetBuffer(
      'matrix',
      this.healthMatrixBuffer,
      16,
      false,
    );
    this.healthBarsMesh.thinInstanceSetBuffer(
      'iPos',
      this.healthPosBuffer,
      3,
      false,
    );
    this.healthBarsMesh.thinInstanceSetBuffer(
      'iBar',
      this.healthBarBuffer,
      4,
      false,
    );
    this.healthBarsMesh.thinInstanceSetBuffer(
      'iBarColor',
      this.healthColorBuffer,
      4,
      false,
    );
  }

  private addSegment(
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number,
    r: number,
    g: number,
    b: number,
    a: number,
  ): void {
    if (this.dynamicSegmentCount >= this.dynamicLinesCapacity) {
      this.growDynamicLines();
    }

    const idx = this.dynamicSegmentCount;
    const pOffset = idx * 6;
    this.dynamicPositionsBuffer[pOffset + 0] = x1;
    this.dynamicPositionsBuffer[pOffset + 1] = y1;
    this.dynamicPositionsBuffer[pOffset + 2] = z1;
    this.dynamicPositionsBuffer[pOffset + 3] = x2;
    this.dynamicPositionsBuffer[pOffset + 4] = y2;
    this.dynamicPositionsBuffer[pOffset + 5] = z2;

    const cOffset = idx * 8;
    this.dynamicColorsBuffer[cOffset + 0] = r;
    this.dynamicColorsBuffer[cOffset + 1] = g;
    this.dynamicColorsBuffer[cOffset + 2] = b;
    this.dynamicColorsBuffer[cOffset + 3] = a;
    this.dynamicColorsBuffer[cOffset + 4] = r;
    this.dynamicColorsBuffer[cOffset + 5] = g;
    this.dynamicColorsBuffer[cOffset + 6] = b;
    this.dynamicColorsBuffer[cOffset + 7] = a;

    this.dynamicSegmentCount++;
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

  private growDynamicLines(): void {
    const newCap = this.dynamicLinesCapacity * 2;

    const nextPositions = new Float32Array(newCap * 6);
    nextPositions.set(this.dynamicPositionsBuffer);
    this.dynamicPositionsBuffer = nextPositions;

    const nextColors = new Float32Array(newCap * 8);
    nextColors.set(this.dynamicColorsBuffer);
    this.dynamicColorsBuffer = nextColors;

    this.dynamicLinesCapacity = newCap;

    if (this.dynamicLinesMesh) {
      this.dynamicLinesMesh.dispose(false, false, true);
      this.dynamicLinesMesh = null;
    }

    this.createDynamicLinesMesh();
  }

  private updateDynamicLines(
    snapshot: SessionSnapshot | undefined,
    markers: readonly OrderMarker[],
    now: number,
  ): void {
    this.dynamicSegmentCount = 0;

    const COL_GREEN_R = 0.2;
    const COL_GREEN_G = 0.9;
    const COL_GREEN_B = 0.35;
    const COL_GREEN_A = 0.85;

    const COL_RED_R = 0.95;
    const COL_RED_G = 0.2;
    const COL_RED_B = 0.2;
    const COL_RED_A = 0.85;

    const COL_YELLOW_R = 1.0;
    const COL_YELLOW_G = 0.82;
    const COL_YELLOW_B = 0.2;
    const COL_YELLOW_A = 0.85;

    const yLine = 0.02;

    // 1. Unit waypoints, paths, and building rally lines (ONLY for local player 0!)
    if (snapshot && snapshot.entities && this.selectedCount > 0) {
      const entities = snapshot.entities;
      const entCount = entities.length;

      for (let i = 0; i < entCount; i++) {
        const ent = entities[i];
        if (this.selectionStamps[ent.id] !== this.selectionStamp) continue;
        // Hide waypoint and rally lines for entities the player does not own
        if (ent.player !== 0) continue;

        if (ent.raw.kind === 'unit') {
          const unit = ent.raw;
          const isAttack =
            unit.order?.kind === 'attackMove' || unit.order?.kind === 'attack';
          const colR = isAttack ? COL_RED_R : COL_GREEN_R;
          const colG = isAttack ? COL_RED_G : COL_GREEN_G;
          const colB = isAttack ? COL_RED_B : COL_GREEN_B;
          const colA = isAttack ? COL_RED_A : COL_GREEN_A;

          let currentX = ent.x;
          let currentZ = ent.z;

          // Follow path if present
          if (unit.path && unit.path.length > 0) {
            for (let p = 0; p < unit.path.length; p++) {
              const pt = unit.path[p];
              this.addSegment(
                currentX,
                yLine,
                currentZ,
                pt.x,
                yLine,
                pt.z,
                colR,
                colG,
                colB,
                colA,
              );
              currentX = pt.x;
              currentZ = pt.z;
            }
          } else if (
            unit.order &&
            unit.order.x !== undefined &&
            unit.order.z !== undefined
          ) {
            this.addSegment(
              currentX,
              yLine,
              currentZ,
              unit.order.x,
              yLine,
              unit.order.z,
              colR,
              colG,
              colB,
              colA,
            );
            currentX = unit.order.x;
            currentZ = unit.order.z;
          }

          // Follow queued orders if any
          if (unit.orders && unit.orders.length > 0) {
            for (let o = 0; o < unit.orders.length; o++) {
              const qOrder = unit.orders[o];
              if (qOrder.x !== undefined && qOrder.z !== undefined) {
                const qIsAttack =
                  qOrder.kind === 'attackMove' || qOrder.kind === 'attack';
                const qColR = qIsAttack ? COL_RED_R : COL_GREEN_R;
                const qColG = qIsAttack ? COL_RED_G : COL_GREEN_G;
                const qColB = qIsAttack ? COL_RED_B : COL_GREEN_B;
                const qColA = qIsAttack ? COL_RED_A : COL_GREEN_A;
                this.addSegment(
                  currentX,
                  yLine,
                  currentZ,
                  qOrder.x,
                  yLine,
                  qOrder.z,
                  qColR,
                  qColG,
                  qColB,
                  qColA,
                );
                currentX = qOrder.x;
                currentZ = qOrder.z;
              }
            }
          }

          // If unit has destination, add waypoint marker cross
          if (currentX !== ent.x || currentZ !== ent.z) {
            const arm = 0.25;
            this.addSegment(
              currentX - arm,
              yLine,
              currentZ,
              currentX + arm,
              yLine,
              currentZ,
              colR,
              colG,
              colB,
              colA,
            );
            this.addSegment(
              currentX,
              yLine,
              currentZ - arm,
              currentX,
              yLine,
              currentZ + arm,
              colR,
              colG,
              colB,
              colA,
            );
          }
        } else if (ent.raw.kind === 'building') {
          // Rally line for buildings
          const bld = ent.raw;
          if (bld.rallyPoint) {
            const bx = ent.x + (bld.width ?? 4) * 0.5;
            const bz = ent.z + (bld.height ?? 4) * 0.5;
            const rx = bld.rallyPoint.x;
            const rz = bld.rallyPoint.z;

            this.addSegment(
              bx,
              yLine,
              bz,
              rx,
              yLine,
              rz,
              COL_YELLOW_R,
              COL_YELLOW_G,
              COL_YELLOW_B,
              COL_YELLOW_A,
            );

            // Small diamond marker at rally point
            const d = 0.3;
            this.addSegment(
              rx,
              yLine,
              rz - d,
              rx + d,
              yLine,
              rz,
              COL_YELLOW_R,
              COL_YELLOW_G,
              COL_YELLOW_B,
              COL_YELLOW_A,
            );
            this.addSegment(
              rx + d,
              yLine,
              rz,
              rx,
              yLine,
              rz + d,
              COL_YELLOW_R,
              COL_YELLOW_G,
              COL_YELLOW_B,
              COL_YELLOW_A,
            );
            this.addSegment(
              rx,
              yLine,
              rz + d,
              rx - d,
              yLine,
              rz,
              COL_YELLOW_R,
              COL_YELLOW_G,
              COL_YELLOW_B,
              COL_YELLOW_A,
            );
            this.addSegment(
              rx - d,
              yLine,
              rz,
              rx,
              yLine,
              rz - d,
              COL_YELLOW_R,
              COL_YELLOW_G,
              COL_YELLOW_B,
              COL_YELLOW_A,
            );
          }
        }
      }
    }

    // 2. Active unexpired OrderMarkers
    for (let m = 0; m < markers.length; m++) {
      const marker = markers[m];
      if (marker.expiresAt > now) {
        const isAttack = marker.kind === 'attackMove';
        const mColR = isAttack ? COL_RED_R : COL_GREEN_R;
        const mColG = isAttack ? COL_RED_G : COL_GREEN_G;
        const mColB = isAttack ? COL_RED_B : COL_GREEN_B;
        const mColA = isAttack ? COL_RED_A : COL_GREEN_A;
        const mx = marker.x;
        const mz = marker.z;
        const d = 0.35;

        // Diamond outline
        this.addSegment(
          mx,
          yLine,
          mz - d,
          mx + d,
          yLine,
          mz,
          mColR,
          mColG,
          mColB,
          mColA,
        );
        this.addSegment(
          mx + d,
          yLine,
          mz,
          mx,
          yLine,
          mz + d,
          mColR,
          mColG,
          mColB,
          mColA,
        );
        this.addSegment(
          mx,
          yLine,
          mz + d,
          mx - d,
          yLine,
          mz,
          mColR,
          mColG,
          mColB,
          mColA,
        );
        this.addSegment(
          mx - d,
          yLine,
          mz,
          mx,
          yLine,
          mz - d,
          mColR,
          mColG,
          mColB,
          mColA,
        );

        // Inner cross
        const c = 0.2;
        this.addSegment(
          mx - c,
          yLine,
          mz,
          mx + c,
          yLine,
          mz,
          mColR,
          mColG,
          mColB,
          mColA,
        );
        this.addSegment(
          mx,
          yLine,
          mz - c,
          mx,
          yLine,
          mz + c,
          mColR,
          mColG,
          mColB,
          mColA,
        );
      }
    }

    // Flush dynamic lines to GPU mesh with in-place buffer update
    if (this.dynamicSegmentCount === 0) {
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

    if (!this.dynamicLinesMesh) {
      this.createDynamicLinesMesh();
    }

    if (this.dynamicLinesMesh) {
      this.dynamicLinesMesh.isVisible = true;
      this.dynamicLinesMesh.updateVerticesData(
        VertexBuffer.PositionKind,
        this.dynamicPositionsBuffer,
        false,
      );
      this.dynamicLinesMesh.updateVerticesData(
        VertexBuffer.ColorKind,
        this.dynamicColorsBuffer,
        false,
      );
      if (this.dynamicLinesMesh.subMeshes.length > 0) {
        this.dynamicLinesMesh.subMeshes[0].indexCount =
          this.dynamicSegmentCount * 2;
        this.dynamicLinesMesh.subMeshes[0].verticesCount =
          this.dynamicSegmentCount * 2;
        this.dynamicLinesMesh.subMeshes[0].setBoundingInfo(
          this.dynamicLinesMesh.getBoundingInfo(),
        );
      }
    }
  }

  private createGroundQuad(mesh: Mesh): void {
    const vertexData = new VertexData();
    vertexData.positions = [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1];
    vertexData.uvs = [0, 0, 1, 0, 1, 1, 0, 1];
    vertexData.indices = [0, 1, 2, 0, 2, 3];
    vertexData.applyToMesh(mesh);
  }

  private createUnitQuad(mesh: Mesh): void {
    const vertexData = new VertexData();
    vertexData.positions = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];
    vertexData.uvs = [0, 0, 1, 0, 1, 1, 0, 1];
    vertexData.indices = [0, 1, 2, 0, 2, 3];
    vertexData.applyToMesh(mesh);
  }

  private initIdentityMatrices(
    buffer: Float32Array,
    start: number,
    count: number,
  ): void {
    for (let i = start; i < start + count; i++) {
      const offset = i * 16;
      buffer[offset + 0] = 1;
      buffer[offset + 5] = 1;
      buffer[offset + 10] = 1;
      buffer[offset + 15] = 1;
    }
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
      lines.push([new Vector3(ax - arm, y, az), new Vector3(ax + arm, y, az)]);
      lines.push([new Vector3(ax, y, az - arm), new Vector3(ax, y, az + arm)]);
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
