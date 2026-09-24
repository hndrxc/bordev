import { mkdtemp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, expect, test } from 'vitest';
import { parseArtManifest, parseAtlas, type ArtManifestEntry, type Atlas } from '../src/assets/atlas';
import { packAsset } from './pack-atlas';

const temporaryDirectories: string[] = [];

interface Fixture {
  entry: ArtManifestEntry;
  rendersDir: string;
  outputDir: string;
  cacheDir: string;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture(id: string, frame = 32, frames = 1, kind: ArtManifestEntry['kind'] = 'building'): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'bordev-atlas-'));
  temporaryDirectories.push(root);
  const entry: ArtManifestEntry = {
    id, kind, script: `assets/${id}.py`, frame, dirs: 1,
    anims: { idle: { frames, loop: true } },
  };
  return {
    entry,
    rendersDir: join(root, 'renders'),
    outputDir: join(root, 'atlases'),
    cacheDir: join(root, 'cache'),
  };
}

async function render(
  context: Fixture,
  pass: string,
  frame: number,
  rect?: [number, number, number, number],
  color = [255, 255, 255, 255],
) {
  const size = context.entry.frame * 2;
  const pixels = Buffer.alloc(size * size * 4);
  if (rect) {
    for (let y = rect[1]; y < rect[1] + rect[3]; y++) {
      for (let x = rect[0]; x < rect[0] + rect[2]; x++) pixels.set(color, (y * size + x) * 4);
    }
  }
  const directory = join(context.rendersDir, context.entry.id, pass, 'idle', '0');
  await mkdir(directory, { recursive: true });
  await sharp(pixels, { raw: { width: size, height: size, channels: 4 } })
    .png().toFile(join(directory, `${frame}.png`));
}

async function atlasImage(atlas: Atlas, key: string, pass: 'image' | 'mask' | 'shadow', directory = 'public/atlases') {
  const frame = atlas.frames[key];
  const image = atlas.pages[frame.page][pass];
  if (!image) throw new Error(`Missing ${pass} page for ${key}`);
  return sharp(join(directory, image))
    .extract({ left: frame.x, top: frame.y, width: frame.w, height: frame.h })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

async function publicAtlas(id: string) {
  return parseAtlas(JSON.parse(await readFile(`public/atlases/${id}.json`, 'utf8')));
}

function coloredCentroid(
  data: Buffer,
  width: number,
  matches: (r: number, g: number, b: number) => boolean,
) {
  let x = 0;
  let y = 0;
  let weight = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] < 128 || !matches(data[index], data[index + 1], data[index + 2])) continue;
    const alpha = data[index + 3];
    x += ((index / 4) % width + 0.5) * alpha;
    y += (Math.floor(index / 4 / width) + 0.5) * alpha;
    weight += alpha;
  }
  if (weight === 0) throw new Error('Expected identifying calibration pixels');
  return { x: x / weight, y: y / weight };
}

test('rendered calibration tile retains the 96x48 diamond, centered origin and axis edge markers', async () => {
  const atlas = await publicAtlas('calib_tile');
  const frame = atlas.frames['idle/0/0'];
  expect(Math.abs(frame.w - 96)).toBeLessThanOrEqual(1);
  expect(Math.abs(frame.h - 48)).toBeLessThanOrEqual(1);
  expect(Math.abs(frame.ax - frame.w / 2)).toBeLessThanOrEqual(1);
  expect(Math.abs(frame.ay - frame.h / 2)).toBeLessThanOrEqual(1);
  const { data, info } = await atlasImage(atlas, 'idle/0/0', 'image');
  const red = coloredCentroid(data, info.width, (r, g, b) => r > 150 && r > g * 2 && r > b * 2);
  const blue = coloredCentroid(data, info.width, (r, g, b) => b > 150 && b > r * 2 && b > g * 2);
  expect(red.x).toBeGreaterThan(frame.ax + 8);
  expect(red.y).toBeGreaterThan(frame.ay + 3);
  expect(blue.x).toBeLessThan(frame.ax - 8);
  expect(blue.y).toBeGreaterThan(frame.ay + 3);
});

test('rendered arrow tip faces down at dir 0 and left at dir 2', async () => {
  const atlas = await publicAtlas('calib_arrow');
  for (const direction of [0, 2]) {
    const key = `idle/${direction}/0`;
    const frame = atlas.frames[key];
    const { data, info } = await atlasImage(atlas, key, 'image');
    const tip = coloredCentroid(data, info.width, (r, g, b) => r > 150 && b > 150 && g < 100);
    const dx = tip.x - frame.ax;
    const dy = tip.y - frame.ay;
    if (direction === 0) {
      expect(dy).toBeGreaterThan(6);
      expect(dy).toBeGreaterThan(Math.abs(dx) * 3);
    } else {
      expect(dx).toBeLessThan(-12);
      expect(-dx).toBeGreaterThan(Math.abs(dy) * 3);
    }
  }
});

test('every public atlas validates and contains all manifest frames with aligned, bounded, separated passes', async () => {
  const manifest = parseArtManifest(JSON.parse(await readFile('art/manifest.json', 'utf8')));
  const files = (await readdir('public/atlases')).filter((name) => name.endsWith('.json')).sort();
  expect(files).toEqual(manifest.map((entry) => `${entry.id}.json`).sort());
  const required = [
    'calib_tile', 'calib_arrow', 'crown_peasant', 'crown_ox_cart', 'crown_spearman',
    'crown_keep', 'crown_cottage', 'crown_farm', 'gold_mine',
    'tree_1', 'tree_2', 'tree_3', 'tree_4', 'rock_1', 'rock_2',
  ];
  expect(manifest.map((entry) => entry.id)).toEqual(expect.arrayContaining(required));
  const requiredFrameCounts: Record<string, number> = {
    calib_tile: 1, calib_arrow: 8, crown_peasant: 288, crown_ox_cart: 104, crown_spearman: 224,
    crown_keep: 6, crown_cottage: 6, crown_farm: 6, gold_mine: 1,
    tree_1: 1, tree_2: 1, tree_3: 1, tree_4: 1, rock_1: 1, rock_2: 1,
  };
  for (const entry of manifest) {
    const atlas = await publicAtlas(entry.id);
    expect(atlas.id).toBe(entry.id);
    expect(atlas.anims).toEqual(Object.fromEntries(Object.entries(entry.anims).map(([name, anim]) => [
      name, { ...anim, dirs: entry.dirs },
    ])));
    const frameCount = Object.values(entry.anims).reduce((total, anim) => total + anim.frames * entry.dirs, 0);
    expect(Object.keys(atlas.frames)).toHaveLength(frameCount);
    if (entry.id in requiredFrameCounts) expect(frameCount).toBe(requiredFrameCounts[entry.id]);
    const shadow = entry.kind === 'building' || entry.kind === 'doodad';
    for (const [pageIndex, page] of atlas.pages.entries()) {
      expect(page.shadow !== undefined).toBe(shadow);
      const body = await sharp(join('public/atlases', page.image)).metadata();
      expect(body.width).toBeLessThanOrEqual(2048);
      expect(body.height).toBeLessThanOrEqual(2048);
      expect(body.hasAlpha).toBe(true);
      for (const filename of [page.mask, ...(page.shadow ? [page.shadow] : [])]) {
        const pass = await sharp(join('public/atlases', filename)).metadata();
        expect([pass.width, pass.height, pass.hasAlpha]).toEqual([body.width, body.height, true]);
      }
      const frames = Object.values(atlas.frames).filter((frame) => frame.page === pageIndex);
      expect(frames.length).toBeGreaterThan(0);
      for (const [index, frame] of frames.entries()) {
        expect(frame.x).toBeGreaterThanOrEqual(2);
        expect(frame.y).toBeGreaterThanOrEqual(2);
        expect(frame.x + frame.w).toBeLessThanOrEqual(body.width! - 2);
        expect(frame.y + frame.h).toBeLessThanOrEqual(body.height! - 2);
        expect(entry.frame / 2 - frame.ax).toBeGreaterThanOrEqual(0);
        expect(entry.frame / 2 - frame.ay).toBeGreaterThanOrEqual(0);
        expect(entry.frame / 2 - frame.ax + frame.w).toBeLessThanOrEqual(entry.frame);
        expect(entry.frame / 2 - frame.ay + frame.h).toBeLessThanOrEqual(entry.frame);
        for (const other of frames.slice(index + 1)) {
          expect(
            frame.x + frame.w + 2 <= other.x || other.x + other.w + 2 <= frame.x ||
            frame.y + frame.h + 2 <= other.y || other.y + other.h + 2 <= frame.y,
          ).toBe(true);
        }
      }
    }
  }
});

test('union trim retains shadow-only and mask-only pixels at the same ground-relative coordinates', async () => {
  const context = await fixture('union');
  await render(context, 'body', 0, [8, 12, 16, 24], [255, 0, 0, 255]);
  await render(context, 'mask', 0, [28, 20, 12, 12]);
  await render(context, 'shadow', 0, [40, 44, 16, 8], [0, 0, 255, 255]);
  const { atlas } = await packAsset(context.entry, context);
  const frame = atlas.frames['idle/0/0'];
  expect({ w: frame.w, h: frame.h, ax: frame.ax, ay: frame.ay }).toEqual({ w: 27, h: 23, ax: 12, ay: 10 });
  const positions = [[6, 10], [16, 12], [24, 24]];
  for (const [index, pass] of (['image', 'mask', 'shadow'] as const).entries()) {
    const { data, info } = await atlasImage(atlas, 'idle/0/0', pass, context.outputDir);
    for (const [position, [x, y]] of positions.entries()) {
      const offset = ((y - 16 + frame.ay) * info.width + x - 16 + frame.ax) * 4;
      if (position === index) {
        expect(data[offset + 3]).toBeGreaterThan(250);
        expect([...data.subarray(offset, offset + 3)]).toEqual(index === 0 ? [255, 0, 0] : index === 1 ? [255, 255, 255] : [0, 0, 255]);
      } else {
        expect(data[offset + 3]).toBe(0);
      }
    }
  }
});

test('fully transparent frames retain an origin anchor and do not invent opaque pixels', async () => {
  const context = await fixture('empty');
  for (const pass of ['body', 'mask', 'shadow']) await render(context, pass, 0);
  const { atlas } = await packAsset(context.entry, context);
  expect(atlas.frames['idle/0/0']).toMatchObject({ w: 1, h: 1, ax: 0, ay: 0 });
  for (const pass of ['image', 'mask', 'shadow'] as const) {
    const { data } = await atlasImage(atlas, 'idle/0/0', pass, context.outputDir);
    expect([...data]).toEqual([0, 0, 0, 0]);
  }
});

test('large sprites spill to additional pages without rotation or losing their mask alignment', async () => {
  const context = await fixture('pages', 1100, 2, 'unit');
  for (let frame = 0; frame < 2; frame++) {
    await render(context, 'body', frame, [0, 0, 2200, 2200], frame === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255]);
    await render(context, 'mask', frame, [0, 0, 2200, 2200]);
  }
  const { atlas } = await packAsset(context.entry, context);
  expect(atlas.pages).toHaveLength(2);
  expect(new Set(Object.values(atlas.frames).map((frame) => frame.page)).size).toBe(2);
  for (let index = 0; index < 2; index++) {
    const key = `idle/0/${index}`;
    expect(atlas.frames[key]).toMatchObject({ w: 1100, h: 1100, ax: 550, ay: 550 });
    const body = await atlasImage(atlas, key, 'image', context.outputDir);
    const mask = await atlasImage(atlas, key, 'mask', context.outputDir);
    expect([...body.data.subarray(0, 4)]).toEqual(index === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255]);
    expect([...mask.data.subarray(0, 4)]).toEqual([255, 255, 255, 255]);
  }
});

test('cache skips unchanged inputs but rebuilds missing outputs, raw content and manifest changes deterministically', async () => {
  const context = await fixture('cache', 16, 1, 'unit');
  for (const pass of ['body', 'mask']) await render(context, pass, 0, [8, 8, 16, 16]);
  const first = await packAsset(context.entry, context);
  const image = join(context.outputDir, first.atlas.pages[0].image);
  const originalBytes = await readFile(image);
  const originalStat = await stat(image);
  expect((await packAsset(context.entry, context)).status).toBe('skipped');
  expect((await stat(image)).mtimeMs).toBe(originalStat.mtimeMs);
  await rm(join(context.outputDir, first.atlas.pages[0].mask));
  const restored = await packAsset(context.entry, context);
  expect(restored.status).toBe('packed');
  expect(restored.atlas).toEqual(first.atlas);
  expect(await readFile(image)).toEqual(originalBytes);
  await render(context, 'body', 0, [8, 8, 16, 16], [255, 0, 0, 255]);
  expect((await packAsset(context.entry, context)).status).toBe('packed');
  expect(await readFile(image)).not.toEqual(originalBytes);
  const changed = { ...context.entry, anims: { idle: { frames: 1, loop: false } } };
  const updated = await packAsset(changed, context);
  expect(updated.status).toBe('packed');
  expect(updated.atlas.anims.idle.loop).toBe(false);
});

test('missing passes and incorrectly sized raw renders fail before publishing an atlas', async () => {
  const context = await fixture('invalid', 16, 1, 'unit');
  await render(context, 'body', 0);
  await expect(packAsset(context.entry, context)).rejects.toThrow();
  await render(context, 'mask', 0);
  const body = join(context.rendersDir, context.entry.id, 'body/idle/0/0.png');
  await sharp({ create: { width: 16, height: 16, channels: 4, background: '#ff0000' } }).png().toFile(body);
  await expect(packAsset(context.entry, context)).rejects.toThrow('expected 32x32 raw render');
  await expect(stat(join(context.outputDir, 'invalid.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('schema rejects missing facings, invalid page references, unsafe filenames and nonfinite anchors', () => {
  const atlas: Atlas = {
    version: 1, id: 'schema', fps: 12,
    pages: [{ image: 'schema_0.png', mask: 'schema_0_mask.png' }],
    anims: { idle: { frames: 1, dirs: 1, loop: true } },
    frames: { 'idle/0/0': { page: 0, x: 2, y: 2, w: 8, h: 8, ax: 4, ay: 12 } },
  };
  const missing = structuredClone(atlas);
  missing.anims.idle.dirs = 8;
  expect(() => parseAtlas(missing)).toThrow('missing idle/1/0');
  const page = structuredClone(atlas);
  page.frames['idle/0/0'].page = 1;
  expect(() => parseAtlas(page)).toThrow('missing page');
  const bounds = structuredClone(atlas);
  bounds.frames['idle/0/0'].x = 2047;
  expect(() => parseAtlas(bounds)).toThrow('exceeds maximum page size');
  const filename = structuredClone(atlas);
  filename.pages[0].image = '../schema.png';
  expect(() => parseAtlas(filename)).toThrow('relative PNG filename');
  const anchor = structuredClone(atlas);
  anchor.frames['idle/0/0'].ay = NaN;
  expect(() => parseAtlas(anchor)).toThrow('finite anchor');
  // A raised sprite can legitimately have its ground origin outside the trimmed image.
  expect(parseAtlas(atlas).frames['idle/0/0'].ay).toBe(12);
});
