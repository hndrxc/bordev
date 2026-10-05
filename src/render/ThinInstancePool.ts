import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/thinInstanceMesh';

export interface ThinInstanceAttributeSpec {
  readonly name: string;
  readonly stride: number;
  /** If true, this buffer is static across frames and not re-uploaded during endFrame */
  readonly static?: boolean;
  /** Optional initializer called when allocating or expanding slots */
  readonly init?: (buffer: Float32Array, start: number, count: number) => void;
}

export interface ThinInstancePoolOptions {
  readonly meshes: Mesh | readonly Mesh[];
  readonly attributes: readonly ThinInstanceAttributeSpec[];
  readonly initialCapacity?: number;
}

export function initIdentityMatrices(
  buffer: Float32Array,
  start: number,
  count: number,
): void {
  for (let i = start; i < start + count; i++) {
    const offset = i * 16;
    buffer[offset + 0] = 1;
    buffer[offset + 1] = 0;
    buffer[offset + 2] = 0;
    buffer[offset + 3] = 0;

    buffer[offset + 4] = 0;
    buffer[offset + 5] = 1;
    buffer[offset + 6] = 0;
    buffer[offset + 7] = 0;

    buffer[offset + 8] = 0;
    buffer[offset + 9] = 0;
    buffer[offset + 10] = 1;
    buffer[offset + 11] = 0;

    buffer[offset + 12] = 0;
    buffer[offset + 13] = 0;
    buffer[offset + 14] = 0;
    buffer[offset + 15] = 1;
  }
}

export class ThinInstancePool {
  private readonly meshes: readonly Mesh[];
  private readonly attributes: readonly ThinInstanceAttributeSpec[];
  private readonly dynamicAttributes: readonly ThinInstanceAttributeSpec[];
  private readonly buffers: Record<string, Float32Array> = {};

  private _capacity: number;
  private _count = 0;

  constructor(options: ThinInstancePoolOptions) {
    this.meshes = Array.isArray(options.meshes)
      ? options.meshes
      : [options.meshes as Mesh];
    this.attributes = options.attributes;
    this.dynamicAttributes = options.attributes.filter((a) => !a.static);
    this._capacity = options.initialCapacity ?? 64;

    // Register non-matrix attributes on all meshes
    for (const mesh of this.meshes) {
      for (const attr of this.attributes) {
        if (attr.name !== 'matrix') {
          mesh.thinInstanceRegisterAttribute(attr.name, attr.stride);
        }
      }
    }

    // Allocate initial buffers and bind to meshes
    for (const attr of this.attributes) {
      const buf = new Float32Array(this._capacity * attr.stride);
      if (attr.init) {
        attr.init(buf, 0, this._capacity);
      }
      this.buffers[attr.name] = buf;

      for (const mesh of this.meshes) {
        mesh.thinInstanceSetBuffer(attr.name, buf, attr.stride, false);
      }
    }

    for (const mesh of this.meshes) {
      mesh.thinInstanceCount = 0;
    }
  }

  get capacity(): number {
    return this._capacity;
  }

  get count(): number {
    return this._count;
  }

  getBuffer(name: string): Float32Array {
    const buf = this.buffers[name];
    if (!buf) {
      throw new Error(`ThinInstancePool: unknown attribute '${name}'`);
    }
    return buf;
  }

  beginFrame(): void {
    this._count = 0;
  }

  alloc(): number {
    if (this._count >= this._capacity) {
      this.grow();
    }
    return this._count++;
  }

  ensureCapacity(minCapacity: number): void {
    if (minCapacity > this._capacity) {
      let nextCap = this._capacity;
      while (nextCap < minCapacity) {
        nextCap *= 2;
      }
      this.grow(nextCap);
    }
  }

  copyData(name: string, source: Float32Array, count: number): void {
    const attr = this.attributes.find((a) => a.name === name);
    if (!attr) {
      throw new Error(`ThinInstancePool: unknown attribute '${name}'`);
    }
    this.ensureCapacity(count);
    const target = this.getBuffer(name);
    target.set(source.subarray(0, count * attr.stride));
  }

  grow(targetCapacity?: number): void {
    const oldCap = this._capacity;
    const newCap = targetCapacity ?? oldCap * 2;
    this._capacity = newCap;

    for (const attr of this.attributes) {
      const oldBuf = this.buffers[attr.name];
      const newBuf = new Float32Array(newCap * attr.stride);
      newBuf.set(oldBuf);

      if (attr.init) {
        attr.init(newBuf, oldCap, newCap - oldCap);
      }

      this.buffers[attr.name] = newBuf;

      for (const mesh of this.meshes) {
        mesh.thinInstanceSetBuffer(attr.name, newBuf, attr.stride, false);
      }
    }
  }

  endFrame(count?: number): void {
    if (count !== undefined) {
      this._count = count;
    }

    const c = this._count;
    if (c === 0) {
      for (const mesh of this.meshes) {
        mesh.thinInstanceCount = 0;
        mesh.isVisible = false;
      }
      return;
    }

    for (const mesh of this.meshes) {
      mesh.isVisible = true;
      for (const attr of this.dynamicAttributes) {
        mesh.thinInstancePartialBufferUpdate(attr.name, c, 0);
      }
      mesh.thinInstanceCount = c;
    }
  }
}
