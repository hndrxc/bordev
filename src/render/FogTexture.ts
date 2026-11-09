import { Constants } from '@babylonjs/core/Engines/constants.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import type { Scene } from '@babylonjs/core/scene.js';

export class FogTexture {
  public readonly size: number;
  public readonly texture: RawTexture;
  private lastRevision = -1;
  private isDisposed = false;

  constructor(scene: Scene, size: number) {
    this.size = size;
    const initialData = new Uint8Array(size * size);
    this.texture = RawTexture.CreateRTexture(
      initialData,
      size,
      size,
      scene,
      false, // generateMipMaps: false
      false, // invertY: false
      Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
      Constants.TEXTURETYPE_UNSIGNED_BYTE,
    );
    this.texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    this.texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  }

  update(fog: Uint8Array, revision: number): void {
    if (this.isDisposed) {
      return;
    }
    if (revision === this.lastRevision) {
      return;
    }
    this.lastRevision = revision;
    this.texture.update(fog);
  }

  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    this.texture.dispose();
  }
}
