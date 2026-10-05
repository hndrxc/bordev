import { Engine } from '@babylonjs/core/Engines/engine';
import { Effect } from '@babylonjs/core/Materials/effect';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import { ThinInstancePool } from './ThinInstancePool';

const SHADER_KEY = 'bordevUnitShadow';

function ensureUnitShadowShaders(): void {
  if (!Effect.ShadersStore[`${SHADER_KEY}VertexShader`]) {
    Effect.ShadersStore[`${SHADER_KEY}VertexShader`] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 world0;
attribute vec4 world1;
attribute vec4 world2;
attribute vec4 world3;

uniform mat4 viewProjection;
varying vec2 vLocalUV;

void main() {
    mat4 finalWorld = mat4(world0, world1, world2, world3);
    gl_Position = viewProjection * (finalWorld * vec4(position, 1.0));
    vLocalUV = uv * 2.0 - 1.0;
}
`;
  }

  if (!Effect.ShadersStore[`${SHADER_KEY}FragmentShader`]) {
    Effect.ShadersStore[`${SHADER_KEY}FragmentShader`] = `
precision highp float;
varying vec2 vLocalUV;

void main() {
    float dist = length(vLocalUV);
    if (dist > 1.0) {
        discard;
    }
    float alpha = 0.35 * smoothstep(1.0, 0.7, dist);
    gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
}
`;
  }
}

export class UnitShadows {
  private readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private readonly pool: ThinInstancePool;

  constructor(scene: Scene) {
    ensureUnitShadowShaders();

    this.material = new ShaderMaterial(
      'UnitShadowMaterial',
      scene,
      {
        vertex: SHADER_KEY,
        fragment: SHADER_KEY,
      },
      {
        attributes: ['position', 'uv', 'world0', 'world1', 'world2', 'world3'],
        uniforms: ['viewProjection'],
      },
    );

    this.material.disableDepthWrite = true;
    this.material.forceDepthWrite = false;
    this.material.alphaMode = Engine.ALPHA_COMBINE;
    this.material.needAlphaBlending = () => true;
    this.material.backFaceCulling = false;

    this.mesh = new Mesh('UnitShadowsMesh', scene);
    this.mesh.renderingGroupId = 1;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.doNotSyncBoundingInfo = true;
    this.mesh.isVisible = false;

    const vertexData = new VertexData();
    vertexData.positions = [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1];
    vertexData.uvs = [0, 0, 1, 0, 1, 1, 0, 1];
    vertexData.indices = [0, 1, 2, 0, 2, 3];
    vertexData.applyToMesh(this.mesh);
    this.mesh.material = this.material;

    this.pool = new ThinInstancePool({
      meshes: this.mesh,
      attributes: [{ name: 'matrix', stride: 16 }],
      initialCapacity: 64,
    });
  }

  beginFrame(): void {
    this.pool.beginFrame();
  }

  add(x: number, z: number, radius: number): void {
    const index = this.pool.alloc();
    const matrixBuffer = this.pool.getBuffer('matrix');
    const offset = index * 16;

    matrixBuffer[offset + 0] = radius;
    matrixBuffer[offset + 1] = 0;
    matrixBuffer[offset + 2] = 0;
    matrixBuffer[offset + 3] = 0;

    matrixBuffer[offset + 4] = 0;
    matrixBuffer[offset + 5] = 1;
    matrixBuffer[offset + 6] = 0;
    matrixBuffer[offset + 7] = 0;

    matrixBuffer[offset + 8] = 0;
    matrixBuffer[offset + 9] = 0;
    matrixBuffer[offset + 10] = radius;
    matrixBuffer[offset + 11] = 0;

    matrixBuffer[offset + 12] = x;
    matrixBuffer[offset + 13] = 0.005;
    matrixBuffer[offset + 14] = z;
    matrixBuffer[offset + 15] = 1;
  }

  endFrame(): void {
    this.pool.endFrame();
  }

  dispose(): void {
    this.mesh.dispose();
    this.material.dispose();
  }
}
