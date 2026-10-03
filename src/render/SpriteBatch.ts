import { Engine } from '@babylonjs/core/Engines/engine';
import { Effect } from '@babylonjs/core/Materials/effect';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { AtlasFrame } from '../assets/atlas';
import type { LoadedAtlasPage } from './AtlasCache';

export interface RenderSprite {
  asset: string;
  animation: string;
  facing: number;
  x: number;
  z: number;
  tint: readonly [number, number, number];
  alpha: number;
  radius?: number;
}

const BODY_SHADER_KEY = 'bordevSpriteBody';
const SHADOW_SHADER_KEY = 'bordevSpriteShadow';

const PPU = 96 / Math.SQRT2;
const RIGHT_BASIS = new Vector3(1 / Math.SQRT2, 0, -1 / Math.SQRT2);
const UP_BASIS = new Vector3(-0.5 / Math.SQRT2, Math.sqrt(3) / 2, -0.5 / Math.SQRT2);

function ensureSpriteShaders(): void {
  if (!Effect.ShadersStore[`${BODY_SHADER_KEY}VertexShader`]) {
    Effect.ShadersStore[`${BODY_SHADER_KEY}VertexShader`] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 world0;
attribute vec4 world1;
attribute vec4 world2;
attribute vec4 world3;
attribute vec3 iPos;
attribute vec4 iUV;
attribute vec4 iSize;
attribute vec4 iTint;

uniform mat4 viewProjection;
uniform vec3 uRightBasis;
uniform vec3 uUpBasis;
uniform float uPPU;

varying vec2 vUV;
varying vec4 vTint;

void main() {
    mat4 finalWorld = mat4(world0, world1, world2, world3);
    float dx = (uv.x * iSize.x - iSize.z) / uPPU;
    float dy = (iSize.w - uv.y * iSize.y) / uPPU;
    vec3 worldPos = iPos + dx * uRightBasis + dy * uUpBasis;
    gl_Position = viewProjection * (finalWorld * vec4(worldPos, 1.0));
    vUV = iUV.xy + uv * iUV.zw;
    vTint = iTint;
}
`;
  }

  if (!Effect.ShadersStore[`${BODY_SHADER_KEY}FragmentShader`]) {
    Effect.ShadersStore[`${BODY_SHADER_KEY}FragmentShader`] = `
precision highp float;
varying vec2 vUV;
varying vec4 vTint;

uniform sampler2D bodyTexture;
uniform sampler2D maskTexture;

void main() {
    vec4 base = texture2D(bodyTexture, vUV);
    if (base.a < 0.5) {
        discard;
    }
    vec4 mask = texture2D(maskTexture, vUV);
    vec3 team = vTint.rgb;
    vec3 color = mix(base.rgb, clamp(base.rgb * team * 1.25, 0.0, 1.0), mask.r);
    float alpha = base.a * vTint.a;
    if (alpha < 0.005) {
        discard;
    }
    gl_FragColor = vec4(color, alpha);
}
`;
  }

  if (!Effect.ShadersStore[`${SHADOW_SHADER_KEY}VertexShader`]) {
    Effect.ShadersStore[`${SHADOW_SHADER_KEY}VertexShader`] =
      Effect.ShadersStore[`${BODY_SHADER_KEY}VertexShader`];
  }

  if (!Effect.ShadersStore[`${SHADOW_SHADER_KEY}FragmentShader`]) {
    Effect.ShadersStore[`${SHADOW_SHADER_KEY}FragmentShader`] = `
precision highp float;
varying vec2 vUV;
varying vec4 vTint;

uniform sampler2D shadowTexture;

void main() {
    vec4 shadow = texture2D(shadowTexture, vUV);
    float alpha = shadow.a * vTint.a;
    if (alpha < 0.005) {
        discard;
    }
    gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
}
`;
  }
}

function createUnitQuad(mesh: Mesh): void {
  const vertexData = new VertexData();
  vertexData.positions = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];
  vertexData.uvs = [0, 0, 1, 0, 1, 1, 0, 1];
  vertexData.indices = [0, 1, 2, 0, 2, 3];
  vertexData.applyToMesh(mesh);
}

export class SpriteBatch {
  private readonly page: LoadedAtlasPage;
  private readonly bodyMesh: Mesh;
  private readonly shadowMesh?: Mesh;
  private readonly bodyMaterial: ShaderMaterial;
  private readonly shadowMaterial?: ShaderMaterial;

  private count = 0;
  private capacity = 64;

  private matrixBuffer = new Float32Array(64 * 16);
  private iPosBuffer = new Float32Array(64 * 3);
  private iUVBuffer = new Float32Array(64 * 4);
  private iSizeBuffer = new Float32Array(64 * 4);
  private iTintBuffer = new Float32Array(64 * 4);

  constructor(scene: Scene, page: LoadedAtlasPage) {
    this.page = page;
    ensureSpriteShaders();

    this.initIdentityMatrices(this.matrixBuffer, 0, this.capacity);

    // Setup body material and mesh (rendering group 2: sprites with depth test & write)
    this.bodyMaterial = new ShaderMaterial(
      'SpriteBodyMaterial',
      scene,
      {
        vertex: BODY_SHADER_KEY,
        fragment: BODY_SHADER_KEY,
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
          'iUV',
          'iSize',
          'iTint',
        ],
        uniforms: ['viewProjection', 'uRightBasis', 'uUpBasis', 'uPPU'],
        samplers: ['bodyTexture', 'maskTexture'],
      },
    );

    this.bodyMaterial.setTexture('bodyTexture', page.body);
    this.bodyMaterial.setTexture('maskTexture', page.mask);
    this.bodyMaterial.setVector3('uRightBasis', RIGHT_BASIS);
    this.bodyMaterial.setVector3('uUpBasis', UP_BASIS);
    this.bodyMaterial.setFloat('uPPU', PPU);
    this.bodyMaterial.disableDepthWrite = false;
    this.bodyMaterial.forceDepthWrite = true;
    this.bodyMaterial.alphaMode = Engine.ALPHA_COMBINE;
    this.bodyMaterial.needAlphaBlending = () => true;
    this.bodyMaterial.backFaceCulling = false;

    this.bodyMesh = new Mesh('SpriteBodyMesh', scene);
    this.bodyMesh.renderingGroupId = 2;
    this.bodyMesh.alwaysSelectAsActiveMesh = true;
    this.bodyMesh.doNotSyncBoundingInfo = true;
    this.bodyMesh.isVisible = false;
    createUnitQuad(this.bodyMesh);
    this.registerThinAttributes(this.bodyMesh);
    this.bodyMesh.material = this.bodyMaterial;
    this.bodyMesh.thinInstanceSetBuffer('matrix', this.matrixBuffer, 16, false);
    this.bodyMesh.thinInstanceSetBuffer('iPos', this.iPosBuffer, 3, false);
    this.bodyMesh.thinInstanceSetBuffer('iUV', this.iUVBuffer, 4, false);
    this.bodyMesh.thinInstanceSetBuffer('iSize', this.iSizeBuffer, 4, false);
    this.bodyMesh.thinInstanceSetBuffer('iTint', this.iTintBuffer, 4, false);
    this.bodyMesh.thinInstanceCount = 0;
    // Setup shadow material and mesh if shadow texture is available
    // (rendering group 1: shadows with alpha blend, depth test, NO depth write)
    if (page.shadow) {
      this.shadowMaterial = new ShaderMaterial(
        'SpriteShadowMaterial',
        scene,
        {
          vertex: SHADOW_SHADER_KEY,
          fragment: SHADOW_SHADER_KEY,
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
            'iUV',
            'iSize',
            'iTint',
          ],
          uniforms: ['viewProjection', 'uRightBasis', 'uUpBasis', 'uPPU'],
          samplers: ['shadowTexture'],
        },
      );

      this.shadowMaterial.setTexture('shadowTexture', page.shadow);
      this.shadowMaterial.setVector3('uRightBasis', RIGHT_BASIS);
      this.shadowMaterial.setVector3('uUpBasis', UP_BASIS);
      this.shadowMaterial.setFloat('uPPU', PPU);
      this.shadowMaterial.disableDepthWrite = true;
      this.shadowMaterial.forceDepthWrite = false;
      this.shadowMaterial.alphaMode = Engine.ALPHA_COMBINE;
      this.shadowMaterial.needAlphaBlending = () => true;
      this.shadowMaterial.backFaceCulling = false;

      this.shadowMesh = new Mesh('SpriteShadowMesh', scene);
      this.shadowMesh.renderingGroupId = 1;
      this.shadowMesh.alwaysSelectAsActiveMesh = true;
      this.shadowMesh.doNotSyncBoundingInfo = true;
      this.shadowMesh.isVisible = false;
      createUnitQuad(this.shadowMesh);
      this.registerThinAttributes(this.shadowMesh);
      this.shadowMesh.material = this.shadowMaterial;
      this.shadowMesh.thinInstanceSetBuffer('matrix', this.matrixBuffer, 16, false);
      this.shadowMesh.thinInstanceSetBuffer('iPos', this.iPosBuffer, 3, false);
      this.shadowMesh.thinInstanceSetBuffer('iUV', this.iUVBuffer, 4, false);
      this.shadowMesh.thinInstanceSetBuffer('iSize', this.iSizeBuffer, 4, false);
      this.shadowMesh.thinInstanceSetBuffer('iTint', this.iTintBuffer, 4, false);
      this.shadowMesh.thinInstanceCount = 0;
    }
  }

  beginFrame(): void {
    this.count = 0;
  }

  add(frame: AtlasFrame, sprite: RenderSprite): void {
    if (this.count >= this.capacity) {
      this.grow();
    }

    const index = this.count;

    // iPos: world anchor coordinates
    const offsetPos = index * 3;
    this.iPosBuffer[offsetPos + 0] = sprite.x;
    this.iPosBuffer[offsetPos + 1] = 0.0;
    this.iPosBuffer[offsetPos + 2] = sprite.z;

    // iUV: normalized by actual loaded page dimensions (no 2048 assumption)
    const offsetUV = index * 4;
    this.iUVBuffer[offsetUV + 0] = frame.x / this.page.width;
    this.iUVBuffer[offsetUV + 1] = frame.y / this.page.height;
    this.iUVBuffer[offsetUV + 2] = frame.w / this.page.width;
    this.iUVBuffer[offsetUV + 3] = frame.h / this.page.height;

    // iSize: pixel dimensions and anchor offsets (can lie outside frame)
    const offsetSize = index * 4;
    this.iSizeBuffer[offsetSize + 0] = frame.w;
    this.iSizeBuffer[offsetSize + 1] = frame.h;
    this.iSizeBuffer[offsetSize + 2] = frame.ax;
    this.iSizeBuffer[offsetSize + 3] = frame.ay;

    // iTint: team color RGB and alpha
    const offsetTint = index * 4;
    this.iTintBuffer[offsetTint + 0] = sprite.tint[0];
    this.iTintBuffer[offsetTint + 1] = sprite.tint[1];
    this.iTintBuffer[offsetTint + 2] = sprite.tint[2];
    this.iTintBuffer[offsetTint + 3] = sprite.alpha;

    this.count++;
  }

  endFrame(): void {
    if (this.count === 0) {
      this.bodyMesh.thinInstanceCount = 0;
      this.bodyMesh.isVisible = false;
      if (this.shadowMesh) {
        this.shadowMesh.thinInstanceCount = 0;
        this.shadowMesh.isVisible = false;
      }
      return;
    }

    this.bodyMesh.isVisible = true;
    this.bodyMesh.thinInstancePartialBufferUpdate('iPos', this.count, 0);
    this.bodyMesh.thinInstancePartialBufferUpdate('iUV', this.count, 0);
    this.bodyMesh.thinInstancePartialBufferUpdate('iSize', this.count, 0);
    this.bodyMesh.thinInstancePartialBufferUpdate('iTint', this.count, 0);
    this.bodyMesh.thinInstanceCount = this.count;

    if (this.shadowMesh) {
      this.shadowMesh.isVisible = true;
      this.shadowMesh.thinInstancePartialBufferUpdate('iPos', this.count, 0);
      this.shadowMesh.thinInstancePartialBufferUpdate('iUV', this.count, 0);
      this.shadowMesh.thinInstancePartialBufferUpdate('iSize', this.count, 0);
      this.shadowMesh.thinInstancePartialBufferUpdate('iTint', this.count, 0);
      this.shadowMesh.thinInstanceCount = this.count;
    }
  }

  dispose(): void {
    this.bodyMesh.dispose();
    this.bodyMaterial.dispose();
    this.shadowMesh?.dispose();
    this.shadowMaterial?.dispose();
  }

  private registerThinAttributes(mesh: Mesh): void {
    mesh.thinInstanceRegisterAttribute('iPos', 3);
    mesh.thinInstanceRegisterAttribute('iUV', 4);
    mesh.thinInstanceRegisterAttribute('iSize', 4);
    mesh.thinInstanceRegisterAttribute('iTint', 4);
  }

  private initIdentityMatrices(buffer: Float32Array, start: number, count: number): void {
    for (let i = start; i < start + count; i++) {
      const offset = i * 16;
      buffer[offset + 0] = 1;
      buffer[offset + 5] = 1;
      buffer[offset + 10] = 1;
      buffer[offset + 15] = 1;
    }
  }

  private grow(): void {
    const newCapacity = this.capacity * 2;

    const newMatrix = new Float32Array(newCapacity * 16);
    newMatrix.set(this.matrixBuffer);
    this.initIdentityMatrices(newMatrix, this.capacity, newCapacity - this.capacity);

    const newPos = new Float32Array(newCapacity * 3);
    newPos.set(this.iPosBuffer);

    const newUV = new Float32Array(newCapacity * 4);
    newUV.set(this.iUVBuffer);

    const newSize = new Float32Array(newCapacity * 4);
    newSize.set(this.iSizeBuffer);

    const newTint = new Float32Array(newCapacity * 4);
    newTint.set(this.iTintBuffer);

    this.capacity = newCapacity;
    this.matrixBuffer = newMatrix;
    this.iPosBuffer = newPos;
    this.iUVBuffer = newUV;
    this.iSizeBuffer = newSize;
    this.iTintBuffer = newTint;

    this.bodyMesh.thinInstanceSetBuffer('matrix', this.matrixBuffer, 16, false);
    this.bodyMesh.thinInstanceSetBuffer('iPos', this.iPosBuffer, 3, false);
    this.bodyMesh.thinInstanceSetBuffer('iUV', this.iUVBuffer, 4, false);
    this.bodyMesh.thinInstanceSetBuffer('iSize', this.iSizeBuffer, 4, false);
    this.bodyMesh.thinInstanceSetBuffer('iTint', this.iTintBuffer, 4, false);

    if (this.shadowMesh) {
      this.shadowMesh.thinInstanceSetBuffer('matrix', this.matrixBuffer, 16, false);
      this.shadowMesh.thinInstanceSetBuffer('iPos', this.iPosBuffer, 3, false);
      this.shadowMesh.thinInstanceSetBuffer('iUV', this.iUVBuffer, 4, false);
      this.shadowMesh.thinInstanceSetBuffer('iSize', this.iSizeBuffer, 4, false);
      this.shadowMesh.thinInstanceSetBuffer('iTint', this.iTintBuffer, 4, false);
    }
}
}

export { UnitShadows } from './UnitShadows';
