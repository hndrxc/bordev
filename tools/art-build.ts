import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { mkdir, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { parseArgs } from 'node:util';
import { parseArtManifest } from '../src/assets/atlas';
import type { ArtManifestEntry } from '../src/assets/atlas';

const terrainNames = ['grass', 'dirt', 'sand', 'shallow', 'water', 'rock-ground'];
const { values } = parseArgs({ options: { asset: { type: 'string' } } });

async function pythonSources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const name = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== '__pycache__') return pythonSources(name);
    return entry.isFile() && name.endsWith('.py') ? [name] : [];
  }));
  return files.flat().sort();
}

async function sourceHash(files: string[], settings: string): Promise<string> {
  const hash = createHash('sha256').update(settings);
  for (const file of files) hash.update(file).update(await readFile(file));
  return hash.digest('hex');
}

async function complete(files: string[]): Promise<boolean> {
  // Checking every expected frame prevents a partial render being mistaken for a hit.
  for (const file of files) {
    try {
      if ((await stat(file)).size === 0) return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return false;
    }
  }
  return true;
}

async function cached(file: string, hash: string, outputs: string[]): Promise<boolean> {
  try {
    return (await readFile(file, 'utf8')) === hash && await complete(outputs);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return false;
  }
}

async function render(id: string, script: string, args: string[]): Promise<void> {
  const logPath = `build/logs/${id}.log`;
  const log = await open(logPath, 'w');
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('blender', [
        '-b', '--factory-startup', '-t', '2', '--python-exit-code', '1',
        '--python', script, '--', ...args,
      ], { stdio: ['ignore', log.fd, log.fd] });
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(`${id}: Blender exited ${signal ?? code}; see ${logPath}`));
      });
    });
  } finally {
    await log.close();
  }
}

function framePaths(asset: ArtManifestEntry): string[] {
  const passes = asset.kind === 'building' || asset.kind === 'doodad'
    ? ['body', 'mask', 'shadow'] : ['body', 'mask'];
  const files: string[] = [];
  for (const pass of passes) {
    for (const [animation, spec] of Object.entries(asset.anims)) {
      for (let dir = 0; dir < asset.dirs; dir++) {
        for (let frame = 0; frame < spec.frames; frame++) {
          files.push(`build/renders/${asset.id}/${pass}/${animation}/${dir}/${frame}.png`);
        }
      }
    }
  }
  return files;
}

async function main(): Promise<void> {
  const manifest = parseArtManifest(JSON.parse(await readFile('art/manifest.json', 'utf8')));
  const assets = values.asset ? manifest.filter(({ id }) => id === values.asset) : manifest;
  if (assets.length === 0) throw new Error(`Unknown asset: ${values.asset}`);
  const { stdout: blenderVersion } = await promisify(execFile)('blender', ['--version']);
  const shared = ['tools/art-build.ts', 'art/blender/render_asset.py',
    ...await pythonSources('art/blender/lib')];
  await mkdir('build/logs', { recursive: true });
  const jobs = assets.map((asset) => async () => {
    const output = `build/renders/${asset.id}`;
    const marker = `${output}/.hash`;
    const outputs = framePaths(asset);
    const hash = await sourceHash([...shared, `art/blender/${asset.script}`],
      blenderVersion + JSON.stringify(asset));
    if (await cached(marker, hash, outputs)) {
      console.log(`skip ${asset.id}`);
      return;
    }
    await mkdir(output, { recursive: true });
    await rm(marker, { force: true });
    console.log(`render ${asset.id}`);
    await render(asset.id, 'art/blender/render_asset.py', ['--asset', asset.id, '--out', output]);
    if (!await complete(outputs)) throw new Error(`${asset.id}: render is missing expected frames`);
    await writeFile(marker, hash);
    console.log(`done ${asset.id}`);
  });
  if (!values.asset) jobs.push(async () => {
    const marker = 'build/terrain.hash';
    const outputs = terrainNames.map((name) => `public/terrain/${name}.png`);
    const hash = await sourceHash(['tools/art-build.ts', 'art/blender/render_terrain.py'], blenderVersion);
    if (await cached(marker, hash, outputs)) {
      console.log('skip terrain');
      return;
    }
    await rm(marker, { force: true });
    console.log('render terrain');
    await render('terrain', 'art/blender/render_terrain.py', []);
    if (!await complete(outputs)) throw new Error('Terrain render is missing expected textures');
    await writeFile(marker, hash);
    console.log('done terrain');
  });
  let next = 0;
  let failed = false;
  const workers = Array.from({ length: Math.min(4, jobs.length) }, async () => {
    while (!failed && next < jobs.length) {
      const job = jobs[next++]!;
      try {
        await job();
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  });
  const results = await Promise.allSettled(workers);
  const failure = results.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
