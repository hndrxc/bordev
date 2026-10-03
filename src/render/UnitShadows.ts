import { Engine } from '@babylonjs/core/Engines/engine';
import { Effect } from '@babylonjs/core/Materials/effect';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import '@babylonjs/core/Meshes/thinInstanceMesh';

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
  private count = 0;
  private capacity = 64;
  private matrixBuffer = new Float32Array(64 * 16);

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
    this.mesh.thinInstanceSetBuffer('matrix', this.matrixBuffer, 16, false);
    this.mesh.thinInstanceCount = 0;
  }

  beginFrame(): void {
    this.count = 0;
  }

  add(x: number, z: number, radius: number): void {
    if (this.count >= this.capacity) {
      this.grow();
    }

    const offset = this.count * 16;
    this.matrixBuffer[offset + 0] = radius;
    this.matrixBuffer[offset + 1] = 0;
    this.matrixBuffer[offset + 2] = 0;
    this.matrixBuffer[offset + 3] = 0;

    this.matrixBuffer[offset + 4] = 0;
    this.matrixBuffer[offset + 5] = 1;
    this.matrixBuffer[offset + 6] = 0;
    this.matrixBuffer[offset + 7] = 0;

    this.matrixBuffer[offset + 8] = 0;
    this.matrixBuffer[offset + 9] = 0;
    this.matrixBuffer[offset + 10] = radius;
    this.matrixBuffer[offset + 11] = 0;

    this.matrixBuffer[offset + 12] = x;
    this.matrixBuffer[offset + 13] = 0.005;
    this.matrixBuffer[offset + 14] = z;
    this.matrixBuffer[offset + 15] = 1;

    this.count++;
  }

  endFrame(): void {
    if (this.count === 0) {
      this.mesh.thinInstanceCount = 0;
      this.mesh.isVisible = false;
      return;
    }

    this.mesh.isVisible = true;
    this.mesh.thinInstancePartialBufferUpdate('matrix', this.count, 0);
    this.mesh.thinInstanceCount = this.count;
  }

  dispose(): void {
    this.mesh.dispose();
    this.material.dispose();
  }

  private grow(): void {
    const newCapacity = this.capacity * 2;
    const newBuffer = new Float32Array(newCapacity * 16);
    newBuffer.set(this.matrixBuffer);
    this.capacity = newCapacity;
    this.matrixBuffer = newBuffer;
    this.mesh.thinInstanceSetBuffer('matrix', this.matrixBuffer, 16, false);
  }
}
