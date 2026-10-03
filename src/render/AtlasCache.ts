import type { Scene } from '@babylonjs/core/scene';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { parseAtlas, type Atlas } from '../assets/atlas';

export interface LoadedAtlasPage {
  body: Texture;
  mask: Texture;
  shadow?: Texture;
  width: number;
  height: number;
}

export interface LoadedAtlas {
  atlas: Atlas;
  pages: LoadedAtlasPage[];
}
function loadTexture(
  url: string,
  scene: Scene,
  onCreated?: (tex: Texture) => void,
): Promise<Texture> {
  return new Promise<Texture>((resolve, reject) => {
    let settled = false;
    const texture = new Texture(
      url,
      scene,
      false,
      false,
      Texture.BILINEAR_SAMPLINGMODE,
      () => {
        if (settled) return;
        settled = true;
        texture.wrapU = Texture.CLAMP_ADDRESSMODE;
        texture.wrapV = Texture.CLAMP_ADDRESSMODE;
        resolve(texture);
      },
      (message, exception) => {
        if (settled) return;
        settled = true;
        texture.dispose();
        reject(new Error(`Failed to load texture ${url}: ${message ?? String(exception)}`));
      },
    );
    onCreated?.(texture);

    if (texture.isReady()) {
      if (!settled) {
        settled = true;
        texture.wrapU = Texture.CLAMP_ADDRESSMODE;
        texture.wrapV = Texture.CLAMP_ADDRESSMODE;
        resolve(texture);
      }
    }
  });
}

export class AtlasCache {
  private readonly scene: Scene;
  private readonly cache = new Map<string, LoadedAtlas>();
  private readonly inFlight = new Map<string, Promise<LoadedAtlas>>();
  private disposed = false;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  async load(id: string): Promise<LoadedAtlas> {
    if (this.disposed) {
      throw new Error(`AtlasCache disposed; cannot load atlas "${id}"`);
    }

    const existing = this.cache.get(id);
    if (existing) {
      return existing;
    }

    const pending = this.inFlight.get(id);
    if (pending) {
      return pending;
    }

    const loadPromise = (async () => {
      const response = await fetch(`/atlases/${id}.json`);
      if (!response.ok) {
        throw new Error(`Failed to fetch atlas "${id}": ${response.status} ${response.statusText}`);
      }

      const json: unknown = await response.json();
      const atlas = parseAtlas(json);

      if (this.disposed) {
        throw new Error(`AtlasCache disposed while loading "${id}"`);
      }

      const createdTextures: Texture[] = [];
      const onCreated = (tex: Texture) => createdTextures.push(tex);

      interface PageSlot {
        bodyPromise: Promise<Texture>;
        maskPromise: Promise<Texture>;
        shadowPromise?: Promise<Texture>;
      }

      const slots: PageSlot[] = atlas.pages.map((page) => ({
        bodyPromise: loadTexture(`/atlases/${page.image}`, this.scene, onCreated),
        maskPromise: loadTexture(`/atlases/${page.mask}`, this.scene, onCreated),
        shadowPromise: page.shadow
          ? loadTexture(`/atlases/${page.shadow}`, this.scene, onCreated)
          : undefined,
      }));

      const allTexturePromises: Promise<Texture>[] = [];
      for (const slot of slots) {
        allTexturePromises.push(slot.bodyPromise);
        allTexturePromises.push(slot.maskPromise);
        if (slot.shadowPromise) {
          allTexturePromises.push(slot.shadowPromise);
        }
      }

      const results = await Promise.allSettled(allTexturePromises);

      const rejection = results.find((r) => r.status === 'rejected') as
        | PromiseRejectedResult
        | undefined;

      if (this.disposed || rejection) {
        for (const tex of createdTextures) {
          tex.dispose();
        }
        if (this.disposed) {
          throw new Error(`AtlasCache disposed while loading "${id}"`);
        }
        throw rejection?.reason ?? new Error(`Failed loading atlas textures for "${id}"`);
      }

      const pages: LoadedAtlasPage[] = [];
      for (const slot of slots) {
        const body = await slot.bodyPromise;
        const mask = await slot.maskPromise;
        const shadow = slot.shadowPromise ? await slot.shadowPromise : undefined;

        const bodyBase = body.getBaseSize();
        const width = bodyBase.width || 1;
        const height = bodyBase.height || 1;

        const maskBase = mask.getBaseSize();
        if (maskBase.width && (maskBase.width !== width || maskBase.height !== height)) {
          for (const tex of createdTextures) {
            tex.dispose();
          }
          throw new Error(
            `Atlas page mask dimensions (${maskBase.width}x${maskBase.height}) do not match body (${width}x${height})`,
          );
        }

        if (shadow) {
          const shadowBase = shadow.getBaseSize();
          if (shadowBase.width && (shadowBase.width !== width || shadowBase.height !== height)) {
            for (const tex of createdTextures) {
              tex.dispose();
            }
            throw new Error(
              `Atlas page shadow dimensions (${shadowBase.width}x${shadowBase.height}) do not match body (${width}x${height})`,
            );
          }
        }

        pages.push({
          body,
          mask,
          shadow,
          width,
          height,
        });
      }

      const loadedAtlas: LoadedAtlas = {
        atlas,
        pages,
      };

      if (this.disposed) {
        this.disposeAtlas(loadedAtlas);
        throw new Error(`AtlasCache disposed while loading "${id}"`);
      }

      this.cache.set(id, loadedAtlas);
      this.inFlight.delete(id);
      return loadedAtlas;
    })().catch((error) => {
      this.inFlight.delete(id);
      throw error;
    });

    this.inFlight.set(id, loadPromise);
    return loadPromise;
  }

  get(id: string): LoadedAtlas {
    const loaded = this.cache.get(id);
    if (!loaded) {
      throw new Error(`Atlas "${id}" is not loaded`);
    }
    return loaded;
  }

  getEstimatedTextureMemoryBytes(): number {
    let totalBytes = 0;
    for (const loaded of this.cache.values()) {
      for (const page of loaded.pages) {
        const pageBytes = page.width * page.height * 4 * 1.33;
        const layers = page.shadow ? 3 : 2;
        totalBytes += pageBytes * layers;
      }
    }
    return totalBytes;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const atlas of this.cache.values()) {
      this.disposeAtlas(atlas);
    }
    this.cache.clear();
    this.inFlight.clear();
  }


  private disposeAtlas(atlas: LoadedAtlas): void {
    for (const page of atlas.pages) {
      page.body.dispose();
      page.mask.dispose();
      page.shadow?.dispose();
    }
  }
}
