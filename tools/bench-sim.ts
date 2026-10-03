import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sim } from '../src/sim/sim.js';
import { parseMap } from '../src/sim/map.js';
import { Rng } from '../src/sim/rng.js';

interface BenchOptions {
  units: number;
  ticks: number;
  warmup: number;
  seed: number;
  maxMs: number;
  mapPath: string;
}

function parseArgs(): BenchOptions {
  const args = process.argv.slice(2);
  const options: BenchOptions = {
    units: 300,
    ticks: 300,
    warmup: 50,
    seed: 42,
    maxMs: 4.0,
    mapPath: path.resolve(process.cwd(), 'public/maps/alpha_test.json'),
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--units') {
      if (i + 1 >= args.length) {
        console.error('Error: --units requires an integer argument');
        process.exit(1);
      }
      const val = parseInt(args[++i], 10);
      if (Number.isNaN(val) || val < 0) {
        console.error(`Error: Invalid value for --units: ${args[i]} (must be non-negative integer)`);
        process.exit(1);
      }
      options.units = val;
    } else if (arg === '--ticks') {
      if (i + 1 >= args.length) {
        console.error('Error: --ticks requires an integer argument');
        process.exit(1);
      }
      const val = parseInt(args[++i], 10);
      if (Number.isNaN(val) || val <= 0) {
        console.error(`Error: Invalid value for --ticks: ${args[i]} (must be positive integer >= 1)`);
        process.exit(1);
      }
      options.ticks = val;
    } else if (arg === '--warmup') {
      if (i + 1 >= args.length) {
        console.error('Error: --warmup requires an integer argument');
        process.exit(1);
      }
      const val = parseInt(args[++i], 10);
      if (Number.isNaN(val) || val < 0) {
        console.error(`Error: Invalid value for --warmup: ${args[i]} (must be non-negative integer)`);
        process.exit(1);
      }
      options.warmup = val;
    } else if (arg === '--seed') {
      if (i + 1 >= args.length) {
        console.error('Error: --seed requires an integer argument');
        process.exit(1);
      }
      const val = parseInt(args[++i], 10);
      if (Number.isNaN(val)) {
        console.error(`Error: Invalid value for --seed: ${args[i]}`);
        process.exit(1);
      }
      options.seed = val;
    } else if (arg === '--max-ms') {
      if (i + 1 >= args.length) {
        console.error('Error: --max-ms requires a numeric argument');
        process.exit(1);
      }
      const val = parseFloat(args[++i]);
      if (Number.isNaN(val) || val <= 0) {
        console.error(`Error: Invalid value for --max-ms: ${args[i]} (must be positive number)`);
        process.exit(1);
      }
      options.maxMs = val;
    } else if (arg === '--map') {
      if (i + 1 >= args.length) {
        console.error('Error: --map requires a file path argument');
        process.exit(1);
      }
      options.mapPath = path.resolve(process.cwd(), args[++i]);
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: tsx tools/bench-sim.ts [options]');
      console.log('Options:');
      console.log('  --units <N>    Number of units to benchmark (default: 300)');
      console.log('  --ticks <N>    Number of measurement ticks (default: 300)');
      console.log('  --warmup <N>   Number of warmup ticks (default: 50)');
      console.log('  --seed <N>     Random seed (default: 42)');
      console.log('  --max-ms <N>   Max average ms per tick before failing (default: 4.0)');
      console.log('  --map <path>   Path to map json fixture (default: public/maps/alpha_test.json)');
      process.exit(0);
    } else {
      console.error(`Error: Unknown argument '${arg}'. Use --help to view available options.`);
      process.exit(1);
    }
  }

  return options;
}

function runBenchmark() {
  const options = parseArgs();

  if (!fs.existsSync(options.mapPath)) {
    // Fallback search relative to script location
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const altPath = path.resolve(__dirname, '../public/maps/alpha_test.json');
    if (fs.existsSync(altPath)) {
      options.mapPath = altPath;
    } else {
      console.error(`Error: Map fixture not found at ${options.mapPath}`);
      process.exit(1);
    }
  }

  const rawJson = JSON.parse(fs.readFileSync(options.mapPath, 'utf-8'));
  const gameMap = parseMap(rawJson);

  // Initialize simulation with requested seed
  const sim = new Sim(gameMap, options.seed);
  const rng = new Rng(options.seed + 9999);

  // Collect all passable tile centers
  const passableCoords: { x: number; z: number }[] = [];
  const size = gameMap.size;
  for (let tz = 1; tz < size - 1; tz++) {
    for (let tx = 1; tx < size - 1; tx++) {
      if (sim.world.grid.isPassable(tx + 0.5, tz + 0.5, 0)) {
        passableCoords.push({ x: tx + 0.5, z: tz + 0.5 });
      }
    }
  }

  if (passableCoords.length === 0) {
    console.error('Error: No passable coordinates found in map.');
    process.exit(1);
  }

  // Count existing units spawned by standard starting bases
  let existingUnitCount = 0;
  for (let i = 0; i < sim.world.entities.length; i++) {
    const ent = sim.world.entities[i];
    if (ent && ent.kind === 'unit') {
      existingUnitCount++;
    }
  }

  // Spawn additional units up to options.units
  const unitsNeeded = Math.max(0, options.units - existingUnitCount);
  for (let i = 0; i < unitsNeeded; i++) {
    const player = i % 2;
    const pState = sim.world.players[player];
    const unitType = pState?.faction === 'clans' ? 'thrall' : 'peasant';
    let placed = false;
    for (let attempts = 0; attempts < 50; attempts++) {
      const coord = passableCoords[rng.int(passableCoords.length)];
      if (sim.world.grid.canOccupy(coord.x, coord.z, 0.25, player)) {
        sim.world.spawnUnit(player, unitType, coord.x, coord.z);
        placed = true;
        break;
      }
    }
    if (!placed) {
      const coord = passableCoords[rng.int(passableCoords.length)];
      sim.world.spawnUnit(player, unitType, coord.x, coord.z);
    }
  }

  // Gather all active units
  const activeUnits: number[] = [];
  for (let i = 0; i < sim.world.entities.length; i++) {
    const ent = sim.world.entities[i];
    if (ent && ent.kind === 'unit') {
      activeUnits.push(ent.id);
    }
  }

  // Helper to issue random valid move target to a unit
  function assignRandomTarget(unitId: number) {
    const ent = sim.world.entities[unitId];
    if (!ent || ent.kind !== 'unit') return;
    const dest = passableCoords[rng.int(passableCoords.length)];
    sim.issue({
      kind: 'move',
      player: ent.player,
      ids: [unitId],
      x: dest.x,
      z: dest.z,
      queued: false,
    });
  }

  // Helper to continuously assign movement to maintain active pathing traffic
  function maintainMovementTraffic() {
    // 1. Give new orders to any idle or completed unit
    for (let i = 0; i < activeUnits.length; i++) {
      const uId = activeUnits[i];
      const ent = sim.world.entities[uId];
      if (ent && ent.kind === 'unit') {
        if (!ent.order || ent.order.kind === 'idle' || ent.order.kind === 'stop') {
          assignRandomTarget(uId);
        }
      }
    }

    // 2. Continually reroute a seeded fraction of units (~5% per tick)
    // to ensure sustained pathfinding work and queue pressure each tick
    const rerouteCount = Math.max(1, Math.floor(activeUnits.length * 0.05));
    for (let k = 0; k < rerouteCount; k++) {
      const randIdx = rng.int(activeUnits.length);
      assignRandomTarget(activeUnits[randIdx]);
    }
  }

  // Initial movement orders for all units
  for (let i = 0; i < activeUnits.length; i++) {
    assignRandomTarget(activeUnits[i]);
  }

  console.log(`[bench:sim] Map: ${gameMap.id} (${gameMap.size}x${gameMap.size})`);
  console.log(`[bench:sim] Spawning ${activeUnits.length} units (requested ${options.units})`);
  console.log(`[bench:sim] Warmup ${options.warmup} ticks, measurement ${options.ticks} ticks...`);

  // Warmup phase (allows JIT compilation and spatial hash / component cache stabilization)
  for (let t = 0; t < options.warmup; t++) {
    maintainMovementTraffic();
    sim.step();
  }

  // Measurement phase
  const tickTimes: number[] = new Array(options.ticks);
  const startExpansions = sim.pathQueue.totalExpansions;
  let maxTickExpansions = 0;

  for (let t = 0; t < options.ticks; t++) {
    maintainMovementTraffic();

    const tStart = performance.now();
    sim.step();
    const tEnd = performance.now();

    const dt = tEnd - tStart;
    tickTimes[t] = dt;

    if (sim.pathQueue.lastExpansions > maxTickExpansions) {
      maxTickExpansions = sim.pathQueue.lastExpansions;
    }
  }

  const endExpansions = sim.pathQueue.totalExpansions;
  const measuredExpansions = endExpansions - startExpansions;

  // Compute statistics
  const totalMs = tickTimes.reduce((acc, v) => acc + v, 0);
  const avgMs = totalMs / tickTimes.length;

  const sortedTimes = [...tickTimes].sort((a, b) => a - b);
  const p50Ms = sortedTimes[Math.floor(sortedTimes.length * 0.5)];
  const p95Index = Math.min(Math.floor(sortedTimes.length * 0.95), sortedTimes.length - 1);
  const p95Ms = sortedTimes[p95Index];
  const p99Index = Math.min(Math.floor(sortedTimes.length * 0.99), sortedTimes.length - 1);
  const p99Ms = sortedTimes[p99Index];
  const minMs = sortedTimes[0];
  const maxMs = sortedTimes[sortedTimes.length - 1];

  const avgExpPerTick = measuredExpansions / options.ticks;

  console.log('\n============================================================');
  console.log('              SIMULATION BENCHMARK REPORT                   ');
  console.log('============================================================');
  console.log(`Map:                     ${gameMap.id} (${gameMap.size}x${gameMap.size})`);
  console.log(`Total Active Units:      ${activeUnits.length}`);
  console.log(`Warmup Ticks:            ${options.warmup}`);
  console.log(`Measured Ticks:          ${options.ticks}`);
  console.log('------------------------------------------------------------');
  console.log('Performance:');
  console.log(`  Average Tick Time:     ${avgMs.toFixed(3)} ms (Goal: <= ${options.maxMs.toFixed(3)} ms)`);
  console.log(`  Median (P50):          ${p50Ms.toFixed(3)} ms`);
  console.log(`  P95 Tick Time:         ${p95Ms.toFixed(3)} ms`);
  console.log(`  P99 Tick Time:         ${p99Ms.toFixed(3)} ms`);
  console.log(`  Min Tick Time:         ${minMs.toFixed(3)} ms`);
  console.log(`  Max Tick Time:         ${maxMs.toFixed(3)} ms`);
  console.log('------------------------------------------------------------');
  console.log('Pathfinding Work Counters:');
  console.log(`  Total Node Expansions: ${measuredExpansions.toLocaleString()}`);
  console.log(`  Avg Expansions/Tick:   ${avgExpPerTick.toFixed(1)}`);
  console.log(`  Peak Expansions/Tick:  ${maxTickExpansions.toLocaleString()}`);
  console.log(`  Pending Path Searches: ${sim.pathQueue.pendingCount}`);
  console.log('============================================================');

  if (activeUnits.length >= 300 && avgMs > options.maxMs) {
    console.error(
      `\n[BENCHMARK FAILED] Average tick time ${avgMs.toFixed(3)} ms exceeds the ${options.maxMs} ms requirement.\n`
    );
    process.exit(1);
  } else {
    console.log(
      `\n[BENCHMARK PASSED] Average tick time ${avgMs.toFixed(3)} ms satisfies the <= ${options.maxMs} ms requirement.\n`
    );
    process.exit(0);
  }
}

runBenchmark();
