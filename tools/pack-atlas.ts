import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { MaxRectsPacker } from 'maxrects-packer';
import sharp from 'sharp';
import {
  parseArtManifest,
  parseAtlas,
  type ArtManifestEntry,
  type Atlas,
  type AtlasFrame,
  type AtlasPage,
} from '../src/assets/atlas';

const resolveRequire = createRequire(import.meta.url);
const { version: packerVersion } = resolveRequire(
  'maxrects-packer/package.json',
) as { version: string };
if (typeof packerVersion !== 'string') {
  throw new Error('Failed to resolve maxrects-packer version');
}

const PAGE_SIZE = 2048;
const PADDING = 2;
type Pass = 'body' | 'mask' | 'shadow';

interface PackOptions {
  rendersDir?: string;
  outputDir?: string;
  cacheDir?: string;
}

interface Sprite {
  key: string;
  width: number;
  height: number;
  x: number;
  y: number;
  ax: number;
  ay: number;
  pixels: Partial<Record<Pass, Buffer>>;
}

function frameKeys(entry: ArtManifestEntry): string[] {
  const keys: string[] = [];
  for (const anim of Object.keys(entry.anims).sort()) {
    for (let dir = 0; dir < entry.dirs; dir++) {
      for (let frame = 0; frame < entry.anims[anim].frames; frame++) {
        keys.push(`${anim}/${dir}/${frame}`);
      }
    }
  }
  return keys;
}

function outputNames(atlas: Atlas): string[] {
  return [
    `${atlas.id}.json`,
    ...atlas.pages.flatMap((page) => [
      page.image,
      page.mask,
      ...(page.shadow ? [page.shadow] : []),
    ]),
  ];
}

async function optionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function readAtlas(path: string): Promise<Atlas | undefined> {
  const text = await optionalText(path);
  if (text === undefined) return undefined;
  try {
    return parseAtlas(JSON.parse(text));
  } catch {
    return undefined;
  }
}

async function cachedAtlas(
  cachePath: string,
  hash: string,
  entry: ArtManifestEntry,
  outputDir: string,
): Promise<Atlas | undefined> {
  const text = await optionalText(cachePath);
  if (text === undefined) return undefined;
  let cache: { hash?: unknown; outputs?: unknown };
  try {
    cache = JSON.parse(text) as typeof cache;
  } catch {
    return undefined;
  }
  if (!cache || cache.hash !== hash || !Array.isArray(cache.outputs))
    return undefined;
  const atlas = await readAtlas(join(outputDir, `${entry.id}.json`));
  if (!atlas || atlas.id !== entry.id) return undefined;
  const outputs = outputNames(atlas);
  if (JSON.stringify(outputs) !== JSON.stringify(cache.outputs))
    return undefined;
  try {
    await Promise.all(
      outputs.map((filename) => access(join(outputDir, filename))),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  return atlas;
}

async function loadSprite(
  entry: ArtManifestEntry,
  rendersDir: string,
  key: string,
  passes: Pass[],
): Promise<Sprite> {
  let left = entry.frame;
  let top = entry.frame;
  let right = -1;
  let bottom = -1;
  const pixels: Partial<Record<Pass, Buffer>> = {};
  for (const pass of passes) {
    const path = join(rendersDir, entry.id, pass, `${key}.png`);
    const image = sharp(await readFile(path));
    const metadata = await image.metadata();
    if (
      metadata.width !== entry.frame * 2 ||
      metadata.height !== entry.frame * 2
    ) {
      throw new Error(
        `${path}: expected ${entry.frame * 2}x${entry.frame * 2} raw render`,
      );
    }
    const data = await image
      .resize(entry.frame, entry.frame, { kernel: sharp.kernel.lanczos3 })
      .toColourspace('srgb')
      .ensureAlpha()
      .raw()
      .toBuffer();
    pixels[pass] = data;
    // Preserve antialiased tips, exclude low-alpha Lanczos ringing; shadows retain faint coverage.
    const minimumAlpha = pass === 'shadow' ? 1 : 64;
    for (let y = 0; y < entry.frame; y++) {
      for (let x = 0; x < entry.frame; x++) {
        if (data[(y * entry.frame + x) * 4 + 3] < minimumAlpha) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }
  // Empty frames remain addressable without inventing a visible pixel or moving the origin.
  if (right < 0) {
    left = right = Math.floor(entry.frame / 2);
    top = bottom = Math.floor(entry.frame / 2);
  }
  const width = right - left + 1;
  const height = bottom - top + 1;
  if (width + 2 * PADDING > PAGE_SIZE || height + 2 * PADDING > PAGE_SIZE) {
    throw new Error(
      `${entry.id}/${key}: trimmed sprite exceeds ${PAGE_SIZE}px atlas capacity`,
    );
  }
  for (const pass of passes) {
    pixels[pass] = await sharp(pixels[pass]!, {
      raw: { width: entry.frame, height: entry.frame, channels: 4 },
    })
      .extract({ left, top, width, height })
      .raw()
      .toBuffer();
  }
  return {
    key,
    width,
    height,
    x: 0,
    y: 0,
    ax: entry.frame / 2 - left,
    ay: entry.frame / 2 - top,
    pixels,
  };
}

/** Pack every declared frame together so all render passes share rectangles and anchors. */
export async function packAsset(
  entry: ArtManifestEntry,
  options: PackOptions = {},
): Promise<{ id: string; status: 'packed' | 'skipped'; atlas: Atlas }> {
  parseArtManifest([entry]);
  const rendersDir = options.rendersDir ?? 'build/renders';
  const outputDir = options.outputDir ?? 'public/atlases';
  const cacheDir = options.cacheDir ?? 'build/atlas-cache';
  const markerPath = join(rendersDir, entry.id, '.hash');
  try {
    await access(markerPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      throw new Error(
        `Missing render completion marker for ${entry.id}: ${markerPath}`,
        { cause: error },
      );
    }
    throw error;
  }
  const cachePath = join(cacheDir, `${entry.id}.json`);
  const passes: Pass[] =
    entry.kind === 'building' || entry.kind === 'doodad'
      ? ['body', 'mask', 'shadow']
      : ['body', 'mask'];
  const keys = frameKeys(entry);
  const digest = createHash('sha256');
  digest.update(JSON.stringify(entry));
  digest.update(await readFile(fileURLToPath(import.meta.url)));
  digest.update(
    await readFile(new URL('../src/assets/atlas.ts', import.meta.url)),
  );
  digest.update(
    JSON.stringify({ ...sharp.versions, 'maxrects-packer': packerVersion }),
  );
  for (const key of keys) {
    for (const pass of passes) {
      const raw = await readFile(
        join(rendersDir, entry.id, pass, `${key}.png`),
      );
      digest.update(`${pass}/${key}:${raw.length}:`);
      digest.update(raw);
    }
  }
  const hash = digest.digest('hex');
  const cached = await cachedAtlas(cachePath, hash, entry, outputDir);
  if (cached) return { id: entry.id, status: 'skipped', atlas: cached };

  const sprites: Sprite[] = [];
  for (const key of keys)
    sprites.push(await loadSprite(entry, rendersDir, key, passes));
  const packer = new MaxRectsPacker<Sprite>(PAGE_SIZE, PAGE_SIZE, PADDING, {
    smart: true,
    pot: false,
    square: false,
    allowRotation: false,
    border: PADDING,
  });
  // Stable input order resolves equal-sized rectangle ties reproducibly.
  packer.addArray(sprites);
  const placements: Record<string, AtlasFrame> = {};
  const pages: AtlasPage[] = [];
  await mkdir(outputDir, { recursive: true });
  const previous = await readAtlas(join(outputDir, `${entry.id}.json`));
  for (const [index, bin] of packer.bins.entries()) {
    if (bin.width > PAGE_SIZE || bin.height > PAGE_SIZE) {
      throw new Error(`${entry.id}: packer produced an oversized page`);
    }
    const page: AtlasPage = {
      image: `${entry.id}_${index}.png`,
      mask: `${entry.id}_${index}_mask.png`,
    };
    if (passes.includes('shadow'))
      page.shadow = `${entry.id}_${index}_shadow.png`;
    pages.push(page);
    for (const sprite of bin.rects) {
      placements[sprite.key] = {
        page: index,
        x: sprite.x,
        y: sprite.y,
        w: sprite.width,
        h: sprite.height,
        ax: sprite.ax,
        ay: sprite.ay,
      };
    }
    for (const pass of passes) {
      const filename = pass === 'body' ? page.image : page[pass]!;
      await sharp({
        create: {
          width: bin.width,
          height: bin.height,
          channels: 4,
          background: '#00000000',
        },
      })
        .composite(
          bin.rects.map((sprite) => ({
            input: sprite.pixels[pass]!,
            raw: { width: sprite.width, height: sprite.height, channels: 4 },
            left: sprite.x,
            top: sprite.y,
          })),
        )
        .png({ compressionLevel: 9, adaptiveFiltering: false })
        .toFile(join(outputDir, filename));
    }
  }
  const atlas: Atlas = {
    version: 1,
    id: entry.id,
    pages,
    fps: 12,
    anims: Object.fromEntries(
      Object.keys(entry.anims)
        .sort()
        .map((name) => [name, { ...entry.anims[name], dirs: entry.dirs }]),
    ),
    frames: Object.fromEntries(keys.map((key) => [key, placements[key]])),
  };
  parseAtlas(atlas);
  await writeFile(
    join(outputDir, `${entry.id}.json`),
    `${JSON.stringify(atlas, null, 2)}\n`,
  );
  const outputs = outputNames(atlas);
  if (previous?.id === entry.id) {
    for (const filename of outputNames(previous)) {
      if (
        !outputs.includes(filename) &&
        new RegExp(`^${entry.id}_\\d+(_mask|_shadow)?\\.png$`).test(filename)
      ) {
        await rm(join(outputDir, filename), { force: true });
      }
    }
  }
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cachePath, `${JSON.stringify({ hash, outputs })}\n`);
  return { id: entry.id, status: 'packed', atlas };
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { asset: { type: 'string' } } });
  const manifest = parseArtManifest(
    JSON.parse(await readFile('art/manifest.json', 'utf8')),
  );
  const entries = values.asset
    ? manifest.filter((entry) => entry.id === values.asset)
    : manifest;
  if (entries.length === 0) throw new Error(`Unknown asset: ${values.asset}`);
  for (const entry of entries) {
    const result = await packAsset(entry);
    console.log(
      `${result.status}: ${result.id} (${result.atlas.pages.length} pages)`,
    );
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
