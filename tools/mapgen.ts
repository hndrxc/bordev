import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Rng } from '../src/sim/rng.js';
import { Terrain, type GameMap } from '../src/sim/map.js';

export interface MapGenOptions {
  seed?: number;
  players?: number;
  size?: number;
  id?: string;
  name?: string;
}

export interface CliOptions {
  seed: number;
  players: number;
  size: number;
  out: string;
  id?: string;
  name?: string;
  help?: boolean;
}

const TREE_VARIANTS = ['tree_1', 'tree_2', 'tree_3', 'tree_4'] as const;
const ROCK_VARIANTS = ['rock_1', 'rock_2'] as const;

/**
 * Generates a deterministic, rotationally symmetric 2-player 128x128 map.
 */
export function generateMap(options: MapGenOptions = {}): GameMap {
  const seed = options.seed ?? 1;
  const players = options.players ?? 2;
  const size = options.size ?? 128;
  const id = options.id ?? 'alpha_test';
  const name = options.name ?? 'Alpha simulation test';

  if (players === 3 || players === 4) {
    throw new Error(
      `Unsupported player count: ${players}. Alpha M2 generator only supports 2 players (3 and 4 players will be supported in Beta).`,
    );
  }
  if (players !== 2) {
    throw new Error(`Unsupported player count: ${players}. Only 2 players are supported in Alpha M2.`);
  }
  if (size !== 128) {
    throw new Error(`Unsupported map size: ${size}. Alpha M2 generator requires a 128x128 map.`);
  }
  if (!Number.isFinite(seed) || !Number.isInteger(seed)) {
    throw new Error(`Invalid seed: ${seed}. Seed must be an integer.`);
  }

  const rng = new Rng(seed);
  const N = size;
  const tiles = new Uint8Array(N * N); // Defaults to Terrain.GRASS (0)

  // Sets tile at (x, z) and its 180-degree rotationally symmetric partner
  function setTile(x: number, z: number, code: number): void {
    if (x >= 0 && x < N && z >= 0 && z < N) {
      tiles[z * N + x] = code;
      tiles[(N - 1 - z) * N + (N - 1 - x)] = code;
    }
  }

  // 1. Dirt clearing around bases
  // Player 0 Keep is 4x4 at [20, 20], centered around (22, 22)
  for (let z = 12; z <= 38; z++) {
    for (let x = 12; x <= 38; x++) {
      setTile(x, z, Terrain.DIRT);
    }
  }

  // 2. Critical Forest Barriers (M3 acceptance test requirement)
  // Left barrier: x=49..53, z=38..89
  // Right barrier: x=74..78, z=38..89 (rotational symmetric partner)
  for (let z = 38; z <= 89; z++) {
    for (let x = 49; x <= 53; x++) {
      setTile(x, z, Terrain.FOREST);
    }
  }

  // 3. Flank Water features (East flank and symmetric West flank)
  // Small seeded jitter for natural procedural variation
  const waterJitterX = rng.int(3) - 1; // -1, 0, 1
  const waterJitterZ = rng.int(3) - 1;

  // Sand beach border
  for (let z = 41 + waterJitterZ; z <= 46 + waterJitterZ; z++) {
    for (let x = 100 + waterJitterX; x <= 122 + waterJitterX; x++) {
      setTile(x, z, Terrain.SAND);
    }
  }

  // Shallow water transition border
  for (let z = 47 + waterJitterZ; z <= 64 + waterJitterZ; z++) {
    for (let x = 101 + waterJitterX; x <= 120 + waterJitterX; x++) {
      setTile(x, z, Terrain.SHALLOW);
    }
  }

  // Deep water core
  for (let z = 48 + waterJitterZ; z <= 62 + waterJitterZ; z++) {
    for (let x = 103 + waterJitterX; x <= 119 + waterJitterX; x++) {
      setTile(x, z, Terrain.WATER);
    }
  }

  // 4. Rock outcroppings in upper-right quadrant (and symmetric lower-left)
  const rockJitterX = rng.int(3) - 1;
  const rockJitterZ = rng.int(3) - 1;
  for (let z = 26 + rockJitterZ; z <= 32 + rockJitterZ; z++) {
    for (let x = 89 + rockJitterX; x <= 96 + rockJitterX; x++) {
      setTile(x, z, Terrain.ROCK);
    }
  }

  // 5. Ensure detour corridors and barrier approaches are clear and passable
  // North detour corridor (above barrier z=38)
  for (let z = 34; z <= 37; z++) {
    for (let x = 44; x <= 83; x++) {
      setTile(x, z, Terrain.GRASS);
    }
  }
  // South detour corridor (below barrier z=89)
  for (let z = 90; z <= 93; z++) {
    for (let x = 44; x <= 83; x++) {
      setTile(x, z, Terrain.GRASS);
    }
  }
  // Approaches on west and east of the left barrier
  for (let z = 34; z <= 93; z++) {
    for (let x = 44; x <= 48; x++) {
      setTile(x, z, Terrain.GRASS);
    }
    for (let x = 54; x <= 59; x++) {
      setTile(x, z, Terrain.GRASS);
    }
  }
  // M3 acceptance movement coordinates: start (45.5, 60.5) and target (58.5, 60.5)
  setTile(45, 60, Terrain.GRASS);
  setTile(58, 60, Terrain.GRASS);

  // 6. Mines: 3 per start + 4 contested (10 mines total, 2x2 footprint)
  const starts: [number, number][] = [
    [20, 20],
    [104, 104],
  ];

  // Base mines for Player 0
  // Near mine (~7-8 tiles from keep center 22, 22)
  const p0Near: [number, number] = [28, 22];
  // Far mine 1 (along +X: ~15 tiles from keep center)
  const p0Far1: [number, number] = [36, 20];
  // Far mine 2 (along +Z: ~15 tiles from keep center)
  const p0Far2: [number, number] = [20, 36];
  const p0Mines = [p0Near, p0Far1, p0Far2];

  // Player 1 mines: exact 180-degree rotation of 2x2 footprint (126 - mx, 126 - mz)
  const p1Mines: [number, number][] = p0Mines.map(([mx, mz]) => [126 - mx, 126 - mz]);

  // Contested mines in central pocket corridor (x in 54..73, z in 38..89)
  // Jittered slightly with seed while keeping corridor z in [60..67] completely open
  const pocketJitterX = rng.int(3) - 1; // 57..59
  const pocketJitterZ = rng.int(3) - 1; // -1, 0, 1

  const c1: [number, number] = [58 + pocketJitterX, 58 + Math.min(0, pocketJitterZ)]; // z is 57 or 58
  const c1Sym: [number, number] = [126 - c1[0], 126 - c1[1]];
  const c2: [number, number] = [58 + pocketJitterX, 68 + Math.max(0, pocketJitterZ)]; // z is 68 or 69
  const c2Sym: [number, number] = [126 - c2[0], 126 - c2[1]];

  const goldMines: [number, number][] = [
    p0Near,
    p0Far1,
    p0Far2,
    p1Mines[0],
    p1Mines[1],
    p1Mines[2],
    c1,
    c1Sym,
    c2,
    c2Sym,
  ];

  // Ensure a 1-tile clearance margin of passable terrain around all 2x2 mines
  for (const [mx, mz] of goldMines) {
    for (let dz = -1; dz <= 2; dz++) {
      for (let dx = -1; dx <= 2; dx++) {
        const x = mx + dx;
        const z = mz + dz;
        if (x >= 0 && x < N && z >= 0 && z < N) {
          const code = tiles[z * N + x];
          if (code === Terrain.FOREST || code === Terrain.ROCK || code === Terrain.WATER) {
            setTile(x, z, Terrain.DIRT);
          }
        }
      }
    }
  }

  // 7. Seeded blocked tile doodads
  // Doodads originate at top-left blocked tile with checkerboard (x + z) % 2 === 0
  const doodads: [number, number, string][] = [];

  for (let z = 0; z < N / 2; z++) {
    for (let x = 0; x < N; x++) {
      const code = tiles[z * N + x];
      if (code === Terrain.FOREST || code === Terrain.ROCK) {
        if ((x + z) % 2 === 0) {
          const variant =
            code === Terrain.FOREST
              ? TREE_VARIANTS[rng.int(TREE_VARIANTS.length)]
              : ROCK_VARIANTS[rng.int(ROCK_VARIANTS.length)];
          doodads.push([x, z, variant]);
          doodads.push([N - 1 - x, N - 1 - z, variant]);
        }
      }
    }
  }

  // Sort doodads in row-major order: z ascending, then x ascending
  doodads.sort((a, b) => a[1] - b[1] || a[0] - b[0]);

  return {
    version: 1,
    id,
    name,
    size: N,
    players,
    tiles,
    goldMines,
    starts,
    doodads,
  };
}

/**
 * Serializes a GameMap to the canonical JSON format with base64 encoded tiles.
 */
export function serializeMap(map: GameMap): string {
  const b64Tiles = Buffer.from(map.tiles).toString('base64');
  const payload = {
    version: map.version,
    id: map.id,
    name: map.name,
    size: map.size,
    players: map.players,
    tiles: b64Tiles,
    goldMines: map.goldMines,
    starts: map.starts,
    doodads: map.doodads,
  };
  return JSON.stringify(payload);
}

/**
 * Parses command-line arguments for the map generator CLI.
 */
export function parseCliArgs(args: string[]): CliOptions {
  let seed = 1;
  let players = 2;
  let size = 128;
  let out = '';
  let id: string | undefined;
  let name: string | undefined;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--seed' || arg === '-s') {
      if (i + 1 >= args.length) throw new Error('Missing argument for --seed');
      seed = Number(args[++i]);
    } else if (arg.startsWith('--seed=')) {
      seed = Number(arg.slice('--seed='.length));
    } else if (arg === '--players' || arg === '-p') {
      if (i + 1 >= args.length) throw new Error('Missing argument for --players');
      players = Number(args[++i]);
    } else if (arg.startsWith('--players=')) {
      players = Number(arg.slice('--players='.length));
    } else if (/^--players\d+$/.test(arg)) {
      players = Number(arg.slice('--players'.length));
    } else if (arg === '--size') {
      if (i + 1 >= args.length) throw new Error('Missing argument for --size');
      size = Number(args[++i]);
    } else if (arg.startsWith('--size=')) {
      size = Number(arg.slice('--size='.length));
    } else if (arg === '--out' || arg === '-o') {
      if (i + 1 >= args.length) throw new Error('Missing argument for --out');
      out = args[++i];
    } else if (arg.startsWith('--out=')) {
      out = arg.slice('--out='.length);
    } else if (arg === '--id') {
      if (i + 1 >= args.length) throw new Error('Missing argument for --id');
      id = args[++i];
    } else if (arg.startsWith('--id=')) {
      id = arg.slice('--id='.length);
    } else if (arg === '--name') {
      if (i + 1 >= args.length) throw new Error('Missing argument for --name');
      name = args[++i];
    } else if (arg.startsWith('--name=')) {
      name = arg.slice('--name='.length);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return { seed, players, size, out, id, name, help };
}

/**
 * CLI runner for map generation. Returns exit code (0 for success, non-zero for error).
 */
export async function runCli(args: string[]): Promise<number> {
  let cliOpts: CliOptions;
  try {
    cliOpts = parseCliArgs(args);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  if (cliOpts.help) {
    console.log(`
Usage: tsx tools/mapgen.ts [options]

Options:
  --seed <number>, -s <number>      Seed for generation (default: 1)
  --players <number>, -p <number>   Player count (must be 2; 3/4 supported in Beta)
  --out <path|id>, -o <path|id>     Output path or map ID (required)
  --size <number>                   Map size (default: 128)
  --id <string>                     Map identifier
  --name <string>                   Map display name
  --help, -h                        Show this help message
`);
    return 0;
  }

  if (cliOpts.players === 3 || cliOpts.players === 4) {
    console.error(
      `Error: Unsupported player count: ${cliOpts.players}. Alpha M2 generator only supports 2 players (3 and 4 players will be supported in Beta).`,
    );
    return 1;
  }
  if (cliOpts.players !== 2) {
    console.error(`Error: Unsupported player count: ${cliOpts.players}. Only 2 players are supported in Alpha M2.`);
    return 1;
  }
  if (!cliOpts.out || cliOpts.out.trim() === '') {
    console.error('Error: Missing required argument: --out');
    return 1;
  }
  if (!Number.isFinite(cliOpts.seed) || !Number.isInteger(cliOpts.seed)) {
    console.error(`Error: Invalid seed: ${cliOpts.seed}. Seed must be an integer.`);
    return 1;
  }
  if (cliOpts.size !== 128) {
    console.error(`Error: Unsupported map size: ${cliOpts.size}. Alpha M2 generator requires a 128x128 map.`);
    return 1;
  }

  const mapId = cliOpts.id ?? (cliOpts.out.endsWith('.json') ? path.basename(cliOpts.out, '.json') : cliOpts.out);
  const mapName = cliOpts.name ?? 'Alpha simulation test';

  const map = generateMap({
    seed: cliOpts.seed,
    players: cliOpts.players,
    size: cliOpts.size,
    id: mapId,
    name: mapName,
  });

  let outPath: string;
  if (cliOpts.out.endsWith('.json') || cliOpts.out.includes('/') || cliOpts.out.includes('\\')) {
    outPath = path.resolve(process.cwd(), cliOpts.out);
  } else {
    outPath = path.resolve(process.cwd(), 'public/maps', `${cliOpts.out}.json`);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, serializeMap(map), 'utf8');

  console.log(`Generated map '${map.id}' (seed: ${cliOpts.seed}, players: 2, size: ${cliOpts.size}x${cliOpts.size}) -> ${outPath}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2))
    .then((code) => {
      if (code !== 0) {
        process.exit(code);
      }
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
