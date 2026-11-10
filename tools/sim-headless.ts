import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runHeadlessMatch,
  type HeadlessMatchResult,
  type SlotSpec,
} from '../src/sim/headless.js';
import { parseMap } from '../src/sim/map.js';

interface HeadlessArgs {
  map: string;
  slots: SlotSpec[];
  specifiedSlots: number[];
  seeds: number[];
  maxTicks: number;
  json: boolean;
  help: boolean;
}

function defaultSlot(): SlotSpec {
  return { kind: 'ai', faction: 'crown', difficulty: 'normal' };
}

function parseSlot(value: string, flag: string): SlotSpec {
  if (value === 'none') return { kind: 'none', faction: 'crown' };

  const parts = value.split(':');
  const [faction, difficulty] = parts;
  if (
    parts.length !== 2 ||
    (faction !== 'crown' && faction !== 'clans') ||
    difficulty !== 'normal'
  ) {
    throw new Error(
      `Invalid value for ${flag}: ${value} (expected crown:normal, clans:normal, or none)`,
    );
  }
  return { kind: 'ai', faction, difficulty };
}

function parseSeeds(value: string): number[] {
  const match = /^(-?\d+)(?:-(-?\d+))?$/.exec(value);
  if (!match) {
    throw new Error(
      `Invalid value for --seeds: ${value} (expected an integer or ascending a-b range)`,
    );
  }

  const first = Number(match[1]);
  const last = match[2] === undefined ? first : Number(match[2]);
  if (
    !Number.isSafeInteger(first) ||
    !Number.isSafeInteger(last) ||
    first > last
  ) {
    throw new Error(
      `Invalid value for --seeds: ${value} (expected safe integers in ascending order)`,
    );
  }
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

export function parseHeadlessArgs(argv: string[]): HeadlessArgs {
  const options: HeadlessArgs = {
    map: 'alpha_test',
    slots: [defaultSlot(), defaultSlot()],
    specifiedSlots: [],
    seeds: [1],
    maxTicks: 72000,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }

    const slotMatch = /^--p([1-4])$/.exec(arg);
    if (
      !slotMatch &&
      arg !== '--map' &&
      arg !== '--seeds' &&
      arg !== '--max-ticks'
    ) {
      if (/^--p\d+$/.test(arg)) {
        throw new Error(
          `Invalid player slot: ${arg} (expected --p1 through --p4)`,
        );
      }
      throw new Error(
        `Unknown argument: ${arg}. Use --help to view available options.`,
      );
    }

    const value = argv[++i];
    if (value === undefined || value.trim() === '' || value.startsWith('--')) {
      throw new Error(`Missing argument for ${arg}`);
    }

    if (slotMatch) {
      const player = Number(slotMatch[1]) - 1;
      while (options.slots.length <= player) options.slots.push(defaultSlot());
      options.slots[player] = parseSlot(value, arg);
      options.specifiedSlots.push(player);
    } else if (arg === '--map') {
      options.map = value;
    } else if (arg === '--seeds') {
      options.seeds = parseSeeds(value);
    } else {
      const maxTicks = Number(value);
      if (
        !/^\d+$/.test(value) ||
        !Number.isSafeInteger(maxTicks) ||
        maxTicks <= 0
      ) {
        throw new Error(
          `Invalid value for --max-ticks: ${value} (expected a positive integer)`,
        );
      }
      options.maxTicks = maxTicks;
    }
  }

  return options;
}

function slotLabel(slot: SlotSpec): string {
  return slot.kind === 'none' ? 'none' : `${slot.faction}:${slot.difficulty}`;
}

function formatResult(
  result: HeadlessMatchResult,
  slots: readonly SlotSpec[],
): string {
  let outcome: string;
  if (result.error !== null) {
    outcome = `ERROR ${result.error}`;
  } else if (result.timedOut) {
    outcome = 'TIMEOUT';
  } else if (result.winnerTeam === null) {
    outcome = 'DRAW';
  } else {
    const winner = result.players.find(
      (player) => player.team === result.winnerTeam && !player.eliminated,
    )!;
    outcome = `winner P${winner.player + 1} (${slotLabel(slots[winner.player])})`;
  }

  const seconds = Math.floor(result.tick / 20);
  const time = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const stats = result.players.map(
    (player) =>
      `P${player.player + 1} ${slotLabel(slots[player.player])} food ${player.foodCollected} gold ${player.goldCollected} trained ${player.unitsTrained} lost ${player.unitsLost} age ${player.age}${player.eliminated ? ' eliminated' : ''}`,
  );
  return [
    `seed ${result.seed}: ${outcome} at ${time} (${result.tick} ticks)`,
    ...stats,
  ].join(' | ');
}

function runCli(argv: string[]): number {
  try {
    const options = parseHeadlessArgs(argv);
    if (options.help) {
      console.log(`Usage: tsx tools/sim-headless.ts [options]
Options:
  --map <id|path>          Map id or .json path (default: alpha_test)
  --p1 ... --p4 <slot>     crown:normal, clans:normal, or none (default: crown:normal)
  --seeds <n|a-b>          Seed or inclusive ascending range (default: 1)
  --max-ticks <n>          Match tick limit (default: 72000)
  --json                  Print JSON instead of text
  --help, -h              Show this help message

Unspecified slots use Crown Normal AI; none keeps a passive Crown base.`);
      return 0;
    }

    const mapPath = options.map.endsWith('.json')
      ? path.resolve(process.cwd(), options.map)
      : path.resolve(process.cwd(), 'public/maps', `${options.map}.json`);
    const gameMap = parseMap(fs.readFileSync(mapPath, 'utf8'));
    const invalidPlayer = options.specifiedSlots.find(
      (player) => player >= gameMap.players,
    );
    if (invalidPlayer !== undefined) {
      throw new Error(
        `Player slot --p${invalidPlayer + 1} does not exist on map ${gameMap.id} (${gameMap.players} players)`,
      );
    }
    const slots = Array.from(
      { length: gameMap.players },
      (_, player) => options.slots[player] ?? defaultSlot(),
    );

    if (!options.json) {
      console.log(
        `[sim:headless] map ${gameMap.id}, ${gameMap.players} players, seeds ${options.seeds[0]}-${options.seeds[options.seeds.length - 1]}, max ${options.maxTicks} ticks`,
      );
    }
    const results: HeadlessMatchResult[] = [];
    let decided = 0;
    let timedOut = 0;
    let errors = 0;
    for (const seed of options.seeds) {
      const result = runHeadlessMatch(gameMap, {
        seed,
        slots,
        maxTicks: options.maxTicks,
      });
      results.push(result);
      if (result.error !== null) errors++;
      if (result.timedOut) timedOut++;
      if (
        result.winnerTeam !== null &&
        !result.timedOut &&
        result.error === null
      )
        decided++;
      if (!options.json) console.log(formatResult(result, slots));
    }

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            map: gameMap.id,
            maxTicks: options.maxTicks,
            results,
            decided,
            timedOut,
            errors,
          },
          null,
          2,
        ),
      );
    } else {
      console.log(
        `summary: ${decided}/${results.length} decided, ${timedOut} timed out, ${errors} errors`,
      );
    }
    return decided === results.length && timedOut === 0 && errors === 0 ? 0 : 1;
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = runCli(process.argv.slice(2));
}
