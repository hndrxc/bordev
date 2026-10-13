import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Effect } from '@babylonjs/core/Materials/effect';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import { ThinInstancePool } from './ThinInstancePool';
import type { SessionSnapshot, InterpolatedEntity } from '../game/GameSession';

const PROJECTILE_SHADER_KEY = 'bordevProjectile';

function ensureProjectileShaders(): void {
  if (!Effect.ShadersStore[`${PROJECTILE_SHADER_KEY}VertexShader`]) {
    Effect.ShadersStore[`${PROJECTILE_SHADER_KEY}VertexShader`] = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec4 world0;
attribute vec4 world1;
attribute vec4 world2;
attribute vec4 world3;

uniform mat4 viewProjection;
uniform vec3 uColor;

varying vec3 vColor;

void main() {
    mat4 finalWorld = mat4(world0, world1, world2, world3);
    vec4 worldPos = finalWorld * vec4(position, 1.0);
    gl_Position = viewProjection * worldPos;

    mat3 normWorld = mat3(finalWorld[0].xyz, finalWorld[1].xyz, finalWorld[2].xyz);
    vec3 n = normalize(normWorld * normal);
    vec3 lightDir = normalize(vec3(-0.6, 1.0, -0.6));
    float diff = max(0.3, dot(n, lightDir));
    vColor = uColor * (0.35 + 0.65 * diff);
}
`;
  }

  if (!Effect.ShadersStore[`${PROJECTILE_SHADER_KEY}FragmentShader`]) {
    Effect.ShadersStore[`${PROJECTILE_SHADER_KEY}FragmentShader`] = `
precision highp float;
varying vec3 vColor;

void main() {
    gl_FragColor = vec4(vColor, 1.0);
}
`;
  }
}

/**
 * Creates arrow geometry: elongated shaft along +Z axis with a tapered head.
 */
function createArrowMesh(scene: Scene, material: ShaderMaterial): Mesh {
  const mesh = new Mesh('ProjectilesArrowMesh', scene);
  mesh.renderingGroupId = 1;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.doNotSyncBoundingInfo = true;
  mesh.isPickable = false;
  mesh.isVisible = false;

  const positions: number[] = [
    // Shaft (box from z = -0.3 to 0.15, width/height = 0.05)
    -0.025, -0.025, -0.3, 0.025, -0.025, -0.3, 0.025, 0.025, -0.3, -0.025,
    0.025, -0.3, -0.025, -0.025, 0.15, 0.025, -0.025, 0.15, 0.025, 0.025, 0.15,
    -0.025, 0.025, 0.15,
    // Arrowhead tip at z = 0.35
    0, 0, 0.35,
    // Arrowhead barbs at z = 0.15
    -0.06, 0, 0.15, 0.06, 0, 0.15, 0, -0.06, 0.15, 0, 0.06, 0.15,
  ];

  const indices: number[] = [
    // Shaft sides
    0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
    // Shaft back cap
    0, 2, 1, 0, 3, 2,
    // Arrowhead triangles to tip
    8, 9, 12, 8, 12, 10, 8, 10, 11, 8, 11, 9,
    // Arrowhead base
    9, 11, 10, 9, 10, 12,
  ];

  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals, {
    useRightHandedSystem: true,
  });

  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  vertexData.applyToMesh(mesh);
  mesh.material = material;
  return mesh;
}

/**
 * Creates stone geometry: faceted octahedron with diameter ~0.44.
 */
function createStoneMesh(scene: Scene, material: ShaderMaterial): Mesh {
  const mesh = new Mesh('ProjectilesStoneMesh', scene);
  mesh.renderingGroupId = 1;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.doNotSyncBoundingInfo = true;
  mesh.isPickable = false;
  mesh.isVisible = false;

  const r = 0.22;
  const positions: number[] = [
    r,
    0,
    0,
    -r,
    0,
    0,
    0,
    r,
    0,
    0,
    -r,
    0,
    0,
    0,
    r,
    0,
    0,
    -r,
  ];

  const indices: number[] = [
    0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4, 2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5,
  ];

  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals, {
    useRightHandedSystem: true,
  });

  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  vertexData.applyToMesh(mesh);
  mesh.material = material;
  return mesh;
}

export class Projectiles {
  private readonly arrowMesh: Mesh;
  private readonly stoneMesh: Mesh;
  private readonly arrowMaterial: ShaderMaterial;
  private readonly stoneMaterial: ShaderMaterial;
  private readonly arrowPool: ThinInstancePool;
  private readonly stonePool: ThinInstancePool;

  private readonly entityById = new Map<number, InterpolatedEntity>();

  private activeArrows = 0;
  private activeStones = 0;
  constructor(scene: Scene) {
    ensureProjectileShaders();

    this.arrowMaterial = new ShaderMaterial(
      'ArrowProjectileMaterial',
      scene,
      { vertex: PROJECTILE_SHADER_KEY, fragment: PROJECTILE_SHADER_KEY },
      {
        attributes: [
          'position',
          'normal',
          'world0',
          'world1',
          'world2',
          'world3',
        ],
        uniforms: ['viewProjection', 'uColor'],
      },
    );
    this.arrowMaterial.setColor3('uColor', new Color3(0.95, 0.85, 0.45));
    this.arrowMaterial.backFaceCulling = true;

    this.stoneMaterial = new ShaderMaterial(
      'StoneProjectileMaterial',
      scene,
      { vertex: PROJECTILE_SHADER_KEY, fragment: PROJECTILE_SHADER_KEY },
      {
        attributes: [
          'position',
          'normal',
          'world0',
          'world1',
          'world2',
          'world3',
        ],
        uniforms: ['viewProjection', 'uColor'],
      },
    );
    this.stoneMaterial.setColor3('uColor', new Color3(0.58, 0.55, 0.52));
    this.stoneMaterial.backFaceCulling = true;

    this.arrowMesh = createArrowMesh(scene, this.arrowMaterial);
    this.stoneMesh = createStoneMesh(scene, this.stoneMaterial);

    this.arrowPool = new ThinInstancePool({
      meshes: this.arrowMesh,
      attributes: [{ name: 'matrix', stride: 16 }],
      initialCapacity: 64,
    });

    this.stonePool = new ThinInstancePool({
      meshes: this.stoneMesh,
      attributes: [{ name: 'matrix', stride: 16 }],
      initialCapacity: 32,
    });
  }

  get count(): number {
    return this.activeArrows + this.activeStones;
  }

  render(snapshot: SessionSnapshot): void {
    this.arrowPool.beginFrame();
    this.stonePool.beginFrame();
    this.activeArrows = 0;
    this.activeStones = 0;

    const entities = snapshot.entities;
    const count = entities.length;
    const alpha = snapshot.alpha;

    this.entityById.clear();
    for (let i = 0; i < count; i++) {
      const ent = entities[i];
      if (!ent.remains) {
        this.entityById.set(ent.id, ent);
      }
    }
    for (let i = 0; i < count; i++) {
      const ent = entities[i];
      const raw = ent.raw;
      if (raw.kind !== 'projectile') continue;

      const isStone = raw.visualKind === 'stone';
      const pool = isStone ? this.stonePool : this.arrowPool;
      const index = pool.alloc();
      const buffer = pool.getBuffer('matrix');
      const offset = index * 16;

      // ent.x/z are already interpolated by GameSession; use them directly.
      const x = ent.x;
      const z = ent.z;

      // Current homing target centre from interpolated entity if available
      const targetRef = raw.targetRef;
      let tx: number;
      let tz: number;
      const targetEnt = this.entityById.get(targetRef.id);
      if (targetEnt) {
        if (targetEnt.kind === 'building') {
          tx = targetEnt.x + (targetEnt.width ?? 1) * 0.5;
          tz = targetEnt.z + (targetEnt.height ?? 1) * 0.5;
        } else {
          tx = targetEnt.x;
          tz = targetEnt.z;
        }
      } else if (targetRef.kind === 'building') {
        tx = targetRef.x + targetRef.width * 0.5;
        tz = targetRef.z + targetRef.height * 0.5;
      } else {
        tx = targetRef.x;
        tz = targetRef.z;
      }
      // Heading: actual current projectile -> target line (follows a moving target).
      const dx = tx - x;
      const dz = tz - z;
      const remaining = Math.sqrt(dx * dx + dz * dz);

      // Flight progress at the rendered (interpolated) position: sim traveledDistance
      // includes the full latest tick step, so back out the un-rendered fraction of it.
      const stepX = raw.x - raw.previousX;
      const stepZ = raw.z - raw.previousZ;
      const step = Math.sqrt(stepX * stepX + stepZ * stepZ);
      const traveled = Math.max(0, raw.traveledDistance - (1 - alpha) * step);
      const totalDist = traveled + remaining;
      const p =
        totalDist > 1e-4 ? Math.max(0, Math.min(1, traveled / totalDist)) : 1;

      const y0 = isStone ? 1.5 : raw.sourceRef?.kind === 'building' ? 1.8 : 0.9;
      const y1 = 0.5;
      const peakHeight = isStone
        ? Math.max(3.0, Math.min(8.0, totalDist * 0.45))
        : Math.max(0.6, Math.min(2.2, totalDist * 0.15));
      const y = y0 * (1 - p) + y1 * p + 4.0 * peakHeight * p * (1.0 - p);

      if (isStone) {
        // Uniform boulder scale
        const scale = 1.0;
        buffer[offset + 0] = scale;
        buffer[offset + 1] = 0;
        buffer[offset + 2] = 0;
        buffer[offset + 3] = 0;

        buffer[offset + 4] = 0;
        buffer[offset + 5] = scale;
        buffer[offset + 6] = 0;
        buffer[offset + 7] = 0;

        buffer[offset + 8] = 0;
        buffer[offset + 9] = 0;
        buffer[offset + 10] = scale;
        buffer[offset + 11] = 0;

        buffer[offset + 12] = x;
        buffer[offset + 13] = y;
        buffer[offset + 14] = z;
        buffer[offset + 15] = 1;
        this.activeStones++;
      } else {
        // Arrow aligned with the 3D arc tangent toward the current target
        const hLen = Math.max(0.001, remaining);
        const dirX = dx / hLen;
        const dirZ = dz / hLen;
        const dy = y1 - y0 + 4.0 * peakHeight * (1.0 - 2.0 * p);
        const slopeY = dy / Math.max(1.0, totalDist);

        const fLen = Math.sqrt(dirX * dirX + slopeY * slopeY + dirZ * dirZ);
        const fx = dirX / fLen;
        const fy = slopeY / fLen;
        const fz = dirZ / fLen;

        let upX = 0,
          upY = 1,
          upZ = 0;
        if (Math.abs(fy) > 0.99) {
          upX = 0;
          upY = 0;
          upZ = 1;
        }

        // r = up × f (right-handed orthonormal basis, det = +1)
        let rx = upY * fz - upZ * fy;
        let ry = upZ * fx - upX * fz;
        let rz = upX * fy - upY * fx;
        const rLen = Math.sqrt(rx * rx + ry * ry + rz * rz);
        rx /= rLen;
        ry /= rLen;
        rz /= rLen;

        // u = f × r
        const ux = fy * rz - fz * ry;
        const uy = fz * rx - fx * rz;
        const uz = fx * ry - fy * rx;
        buffer[offset + 0] = rx;
        buffer[offset + 1] = ry;
        buffer[offset + 2] = rz;
        buffer[offset + 3] = 0;

        buffer[offset + 4] = ux;
        buffer[offset + 5] = uy;
        buffer[offset + 6] = uz;
        buffer[offset + 7] = 0;

        buffer[offset + 8] = fx;
        buffer[offset + 9] = fy;
        buffer[offset + 10] = fz;
        buffer[offset + 11] = 0;

        buffer[offset + 12] = x;
        buffer[offset + 13] = y;
        buffer[offset + 14] = z;
        buffer[offset + 15] = 1;
        this.activeArrows++;
      }
    }

    this.arrowPool.endFrame();
    this.stonePool.endFrame();
  }

  dispose(): void {
    this.arrowMesh.dispose();
    this.stoneMesh.dispose();
    this.arrowMaterial.dispose();
    this.stoneMaterial.dispose();
  }
}
