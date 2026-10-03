import { Constants } from '@babylonjs/core/Engines/constants.js';
import type { Effect } from '@babylonjs/core/Materials/effect.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { Observer } from '@babylonjs/core/Misc/observable.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { Nullable } from '@babylonjs/core/types.js';
import { TERRAIN_CODES } from '../data/terrain.js';
import type { GameMap } from '../sim/map.js';

export interface SplatData {
  readonly splat0: Uint8Array;
  readonly splat1: Uint8Array;
  readonly width: number;
  readonly height: number;
}

const TERRAIN_VERTEX_SHADER = `
  precision highp float;

  attribute vec3 position;
  attribute vec2 uv;

  uniform mat4 worldViewProjection;

  varying vec2 vUV;

  void main(void) {
    vUV = uv;
    gl_Position = worldViewProjection * vec4(position, 1.0);
  }
`;

const TERRAIN_FRAGMENT_SHADER = `
  precision highp float;

  varying vec2 vUV;

  uniform float uTime;
  uniform float uMapSize;

  uniform sampler2D uSplat0;
  uniform sampler2D uSplat1;

  uniform sampler2D uGrass;
  uniform sampler2D uDirt;
  uniform sampler2D uSand;
  uniform sampler2D uShallow;
  uniform sampler2D uWater;
  uniform sampler2D uRock;

  // 2D pseudo-random hash
  vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
  }

  // 2D gradient noise
  float gnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(dot(hash2(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0)),
          dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
      mix(dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
          dot(hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  void main(void) {
    vec2 tileCoord = vUV * uMapSize;

    // Organic fractal-like noise perturbation for biome borders
    float n1 = gnoise(tileCoord * 0.75) + 0.5 * gnoise(tileCoord * 1.5);
    float n2 = gnoise(tileCoord * 0.75 + vec2(37.2, 17.8)) + 0.5 * gnoise(tileCoord * 1.5 + vec2(19.4, 43.1));

    vec2 noiseOffset = vec2(n1, n2) * (0.3 / uMapSize);
    vec2 splatUV = clamp(vUV + noiseOffset, 0.0, 1.0);

    // Hardware bilinear sampling of 4-texels-per-tile splats
    vec4 s0 = texture2D(uSplat0, splatUV);
    vec4 s1 = texture2D(uSplat1, splatUV);

    // Normalize splat weights to preserve partition of unity
    float totalWeight = s0.r + s0.g + s0.b + s0.a + s1.r + s1.g;
    if (totalWeight > 0.0001) {
      s0 /= totalWeight;
      s1 /= totalWeight;
    } else {
      s0 = vec4(1.0, 0.0, 0.0, 0.0);
      s1 = vec4(0.0);
    }

    // Six terrain textures repeat once per 4 tiles
    vec2 tileUV = vUV * (uMapSize * 0.25);

    vec4 colGrass = texture2D(uGrass, tileUV);
    vec4 colDirt = texture2D(uDirt, tileUV);
    vec4 colSand = texture2D(uSand, tileUV);
    vec4 colShallow = texture2D(uShallow, tileUV);
    vec4 colRock = texture2D(uRock, tileUV);

    // Animated water UV scroll: animate only water texture
    vec2 waterUV = tileUV + vec2(0.04, 0.02) * uTime;
    vec4 colWater = texture2D(uWater, waterUV);

    vec3 blended = s0.r * colGrass.rgb +
                   s0.g * colDirt.rgb +
                   s0.b * colSand.rgb +
                   s0.a * colShallow.rgb +
                   s1.r * colWater.rgb +
                   s1.g * colRock.rgb;

    gl_FragColor = vec4(blended, 1.0);
  }
`;

function loadTexture(url: string, scene: Scene): Promise<Texture> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const texture = new Texture(
      url,
      scene,
      false, // noMipmap
      true,  // invertY
      Texture.TRILINEAR_SAMPLINGMODE,
      () => {
        if (!settled) {
          settled = true;
          resolve(texture);
        }
      },
      (message, exception) => {
        if (!settled) {
          settled = true;
          texture.dispose();
          reject(new Error(`Failed to load texture from ${url}: ${message || exception || 'unknown error'}`));
        }
      }
    );
    texture.wrapU = Texture.WRAP_ADDRESSMODE;
    texture.wrapV = Texture.WRAP_ADDRESSMODE;

    if (texture.isReady() && !settled) {
      settled = true;
      resolve(texture);
    }
  });
}

/**
 * Builds two RGBA splat buffers CPU-side at 4 texels per tile from row-major map tiles.
 * - splat0: R = grass/forest, G = dirt, B = sand, A = shallow
 * - splat1: R = water, G = rock-ground, B = unused (0), A = unused (0)
 */
export function buildTerrainSplats(map: { size: number; tiles: Uint8Array | number[] }): SplatData {
  const size = map.size;
  const texelsPerTile = 4;
  const width = size * texelsPerTile;
  const height = size * texelsPerTile;
  const totalTexels = width * height;
  const splat0 = new Uint8Array(totalTexels * 4);
  const splat1 = new Uint8Array(totalTexels * 4);

  for (let z = 0; z < size; z++) {
    const tileRowOffset = z * size;
    for (let x = 0; x < size; x++) {
      const tileCode = map.tiles[tileRowOffset + x];
      for (let dz = 0; dz < texelsPerTile; dz++) {
        const sz = z * texelsPerTile + dz;
        const rowByteOffset = sz * width * 4;
        for (let dx = 0; dx < texelsPerTile; dx++) {
          const sx = x * texelsPerTile + dx;
          const offset = rowByteOffset + sx * 4;
          switch (tileCode) {
            case TERRAIN_CODES.GRASS:
            case TERRAIN_CODES.FOREST:
              // Forest ground is grass
              splat0[offset] = 255;
              break;
            case TERRAIN_CODES.DIRT:
              splat0[offset + 1] = 255;
              break;
            case TERRAIN_CODES.SAND:
              splat0[offset + 2] = 255;
              break;
            case TERRAIN_CODES.SHALLOW:
              splat0[offset + 3] = 255;
              break;
            case TERRAIN_CODES.WATER:
              splat1[offset] = 255;
              break;
            case TERRAIN_CODES.ROCK:
              // Rock ground is rock-ground
              splat1[offset + 1] = 255;
              break;
            default:
              splat0[offset] = 255;
              break;
          }
        }
      }
    }
  }

  return { splat0, splat1, width, height };
}

export class Terrain {
  public readonly ground: Mesh;
  public readonly material: ShaderMaterial;
  public readonly splat0: RawTexture;
  public readonly splat1: RawTexture;
  public readonly ready: Promise<void>;

  private terrainTextures: Texture[] = [];
  private isDisposed = false;
  private shaderCompileError: string | null = null;
  private onShaderError: ((errors: string) => void) | null = null;
  constructor(scene: Scene, map: GameMap) {
    const size = map.size;

    // Ground mesh in rendering group 0, spanning [0, size] on x and z
    this.ground = CreateGround(
      'terrainGround',
      { width: size, height: size, subdivisions: 1 },
      scene
    );
    this.ground.position.set(size / 2, 0, size / 2);
    this.ground.renderingGroupId = 0;
    this.ground.isPickable = false;

    // Build splat textures with bilinear filtering
    const splats = buildTerrainSplats(map);
    this.splat0 = RawTexture.CreateRGBATexture(
      splats.splat0,
      splats.width,
      splats.height,
      scene,
      false, // generateMipMaps: false
      false, // invertY: false
      Constants.TEXTURE_BILINEAR_SAMPLINGMODE
    );
    this.splat0.wrapU = Texture.CLAMP_ADDRESSMODE;
    this.splat0.wrapV = Texture.CLAMP_ADDRESSMODE;

    this.splat1 = RawTexture.CreateRGBATexture(
      splats.splat1,
      splats.width,
      splats.height,
      scene,
      false, // generateMipMaps: false
      false, // invertY: false
      Constants.TEXTURE_BILINEAR_SAMPLINGMODE
    );
    this.splat1.wrapU = Texture.CLAMP_ADDRESSMODE;
    this.splat1.wrapV = Texture.CLAMP_ADDRESSMODE;

    // ShaderMaterial with depth write disabled
    this.material = new ShaderMaterial(
      'terrainMaterial',
      scene,
      {
        vertexSource: TERRAIN_VERTEX_SHADER,
        fragmentSource: TERRAIN_FRAGMENT_SHADER,
      },
      {
        attributes: ['position', 'uv'],
        uniforms: ['worldViewProjection', 'uTime', 'uMapSize'],
        samplers: [
          'uSplat0',
          'uSplat1',
          'uGrass',
          'uDirt',
          'uSand',
          'uShallow',
          'uWater',
          'uRock',
        ],
      }
    );

    this.material.disableDepthWrite = true;
    this.material.backFaceCulling = false;
    this.material.setFloat('uTime', 0);
    this.material.setFloat('uMapSize', size);
    this.material.setTexture('uSplat0', this.splat0);
    this.material.setTexture('uSplat1', this.splat1);

    this.material.onError = (_effect: Effect, errors: string) => {
      console.error('Terrain shader compilation failed:', errors);
      this.shaderCompileError = errors;
      if (this.onShaderError) {
        this.onShaderError(errors);
      }
    };

    this.ground.material = this.material;

    // Start loading textures and wait for shader compilation
    this.ready = this.init(scene);
  }

  private async init(scene: Scene): Promise<void> {
    const textureDefs = [
      { key: 'uGrass', url: '/terrain/grass.png' },
      { key: 'uDirt', url: '/terrain/dirt.png' },
      { key: 'uSand', url: '/terrain/sand.png' },
      { key: 'uShallow', url: '/terrain/shallow.png' },
      { key: 'uWater', url: '/terrain/water.png' },
      { key: 'uRock', url: '/terrain/rock-ground.png' },
    ] as const;

    const loaded = await Promise.all(
      textureDefs.map(async (def) => {
        const tex = await loadTexture(def.url, scene);
        if (this.isDisposed) {
          tex.dispose();
          throw new Error('Terrain disposed during texture load');
        }
        this.terrainTextures.push(tex);
        return { key: def.key, texture: tex };
      })
    );

    if (this.isDisposed) {
      throw new Error('Terrain disposed during texture load');
    }

    for (const item of loaded) {
      this.material.setTexture(item.key, item.texture);
    }

    if (this.shaderCompileError !== null) {
      throw new Error(`Terrain shader compilation failed: ${this.shaderCompileError}`);
    }

    if (this.material.isReady(this.ground)) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let interval: ReturnType<typeof setInterval> | null = null;
      let renderObserver: Nullable<Observer<Scene>> = null;
      let disposeObserver: Nullable<Observer<Scene>> = null;

      const cleanup = () => {
        this.onShaderError = null;
        if (interval !== null) {
          clearInterval(interval);
          interval = null;
        }
        if (renderObserver !== null) {
          scene.onBeforeRenderObservable.remove(renderObserver);
          renderObserver = null;
        }
        if (disposeObserver !== null) {
          scene.onDisposeObservable.remove(disposeObserver);
          disposeObserver = null;
        }
      };

      this.onShaderError = (errors: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(`Terrain shader compilation failed: ${errors}`));
      };

      const check = () => {
        if (settled) return;
        if (this.shaderCompileError !== null) {
          settled = true;
          cleanup();
          reject(new Error(`Terrain shader compilation failed: ${this.shaderCompileError}`));
          return;
        }
        if (this.isDisposed || scene.isDisposed) {
          settled = true;
          cleanup();
          reject(new Error('Terrain disposed during shader compilation'));
          return;
        }
        if (this.material.isReady(this.ground)) {
          settled = true;
          cleanup();
          resolve();
        }
      };

      renderObserver = scene.onBeforeRenderObservable.add(check);
      disposeObserver = scene.onDisposeObservable.add(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('Scene disposed during shader compilation'));
      });
      interval = setInterval(check, 16);
      check();
    });
  }
  update(timeSeconds: number): void {
    if (this.isDisposed || !this.material) {
      return;
    }
    this.material.setFloat('uTime', timeSeconds);
  }

  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    this.onShaderError = null;
    if (this.ground) {
      this.ground.dispose(false, true);
    }
    if (this.material) {
      this.material.dispose(true, true);
    }
    if (this.splat0) {
      this.splat0.dispose();
    }
    if (this.splat1) {
      this.splat1.dispose();
    }
    for (const tex of this.terrainTextures) {
      tex.dispose();
    }
    this.terrainTextures = [];
  }
}
