export type AssetKind = 'unit' | 'building' | 'doodad' | 'icon' | 'calibration';

export interface ArtAnimation {
  frames: number;
  loop: boolean;
}

export interface ArtManifestEntry {
  id: string;
  kind: AssetKind;
  script: string;
  frame: number;
  dirs: 1 | 8;
  anims: Record<string, ArtAnimation>;
}

export interface AtlasPage {
  image: string;
  mask: string;
  shadow?: string;
}

export interface AtlasAnimation extends ArtAnimation {
  dirs: 1 | 8;
}

export interface AtlasFrame {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  ax: number;
  ay: number;
}

export interface Atlas {
  version: 1;
  id: string;
  pages: AtlasPage[];
  fps: 12;
  anims: Record<string, AtlasAnimation>;
  frames: Record<string, AtlasFrame>;
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path}: expected an object`);
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown, path: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${path}: expected an integer >= ${minimum}`);
  }
  return value;
}

function identifier(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_]*$/.test(value)) {
    throw new Error(`${path}: expected a lowercase identifier`);
  }
  return value;
}

function directions(value: unknown, path: string): 1 | 8 {
  if (value !== 1 && value !== 8) throw new Error(`${path}: expected 1 or 8`);
  return value;
}

function animation(value: unknown, path: string): Record<string, unknown> {
  const result = object(value, path);
  integer(result.frames, `${path}.frames`, 1);
  if (typeof result.loop !== 'boolean') throw new Error(`${path}.loop: expected a boolean`);
  return result;
}

/** Validate external JSON before handing it to the renderer or art tools. */
export function parseArtManifest(value: unknown): ArtManifestEntry[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('manifest: expected a nonempty array');
  }
  const ids = new Set<string>();
  for (const [index, item] of value.entries()) {
    const path = `manifest[${index}]`;
    const entry = object(item, path);
    const id = identifier(entry.id, `${path}.id`);
    if (ids.has(id)) throw new Error(`${path}.id: duplicate ${id}`);
    ids.add(id);
    if (typeof entry.kind !== 'string' || !['unit', 'building', 'doodad', 'icon', 'calibration'].includes(entry.kind)) {
      throw new Error(`${path}.kind: unknown asset kind`);
    }
    if (typeof entry.script !== 'string' || !/^assets\/[a-z][a-z0-9_]*\.py$/.test(entry.script)) {
      throw new Error(`${path}.script: expected assets/<name>.py`);
    }
    integer(entry.frame, `${path}.frame`, 1);
    directions(entry.dirs, `${path}.dirs`);
    const anims = object(entry.anims, `${path}.anims`);
    if (Object.keys(anims).length === 0) throw new Error(`${path}.anims: expected animations`);
    for (const [name, spec] of Object.entries(anims)) {
      identifier(name, `${path}.anims key`);
      animation(spec, `${path}.anims.${name}`);
    }
  }
  return value as ArtManifestEntry[];
}

export function parseAtlas(value: unknown): Atlas {
  const atlas = object(value, 'atlas');
  if (atlas.version !== 1) throw new Error('atlas.version: expected 1');
  identifier(atlas.id, 'atlas.id');
  if (atlas.fps !== 12) throw new Error('atlas.fps: expected 12');
  if (!Array.isArray(atlas.pages) || atlas.pages.length === 0) {
    throw new Error('atlas.pages: expected a nonempty array');
  }
  const images = new Set<string>();
  let shadows: boolean | undefined;
  for (const [index, item] of atlas.pages.entries()) {
    const page = object(item, `atlas.pages[${index}]`);
    const hasShadow = page.shadow !== undefined;
    if (shadows !== undefined && shadows !== hasShadow) {
      throw new Error('atlas.pages: shadow pass must be present on every page or none');
    }
    shadows = hasShadow;
    for (const pass of hasShadow ? ['image', 'mask', 'shadow'] : ['image', 'mask']) {
      const filename = page[pass];
      if (typeof filename !== 'string' || !/^[a-zA-Z0-9_-]+\.png$/.test(filename)) {
        throw new Error(`atlas.pages[${index}].${pass}: expected a relative PNG filename`);
      }
      if (images.has(filename)) throw new Error(`atlas.pages: duplicate image ${filename}`);
      images.add(filename);
    }
  }
  const anims = object(atlas.anims, 'atlas.anims');
  if (Object.keys(anims).length === 0) throw new Error('atlas.anims: expected animations');
  const expected = new Set<string>();
  for (const [name, value] of Object.entries(anims)) {
    identifier(name, 'atlas.anims key');
    const spec = animation(value, `atlas.anims.${name}`);
    const dirs = directions(spec.dirs, `atlas.anims.${name}.dirs`);
    const count = spec.frames as number;
    for (let dir = 0; dir < dirs; dir++) {
      for (let frame = 0; frame < count; frame++) expected.add(`${name}/${dir}/${frame}`);
    }
  }
  const frames = object(atlas.frames, 'atlas.frames');
  for (const [key, value] of Object.entries(frames)) {
    if (!expected.delete(key)) throw new Error(`atlas.frames.${key}: unexpected frame`);
    const frame = object(value, `atlas.frames.${key}`);
    const page = integer(frame.page, `atlas.frames.${key}.page`);
    if (page >= atlas.pages.length) throw new Error(`atlas.frames.${key}.page: missing page`);
    for (const axis of ['x', 'y']) integer(frame[axis], `atlas.frames.${key}.${axis}`);
    for (const size of ['w', 'h']) integer(frame[size], `atlas.frames.${key}.${size}`, 1);
    if ((frame.x as number) + (frame.w as number) > 2048 ||
        (frame.y as number) + (frame.h as number) > 2048) {
      throw new Error(`atlas.frames.${key}: rectangle exceeds maximum page size`);
    }
    for (const anchor of ['ax', 'ay']) {
      if (typeof frame[anchor] !== 'number' || !Number.isFinite(frame[anchor])) {
        throw new Error(`atlas.frames.${key}.${anchor}: expected a finite anchor`);
      }
    }
  }
  if (expected.size > 0) throw new Error(`atlas.frames: missing ${expected.values().next().value}`);
  return value as Atlas;
}
