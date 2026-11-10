import type { Faction } from '../data/types.js';
import type { AiDifficulty } from './ai/difficulty.js';
import type { SimEvent } from './commands.js';
import type { GameMap } from './map.js';
import { Sim } from './sim.js';
import { summarizeMatch, type MatchSummary } from './systems/victory.js';

export type SlotSpec =
  | { kind: 'none'; faction: Faction }
  | { kind: 'ai'; faction: Faction; difficulty: AiDifficulty };

export interface HeadlessMatchOptions {
  seed: number;
  slots: readonly SlotSpec[];
  maxTicks: number;
}

export interface HeadlessMatchResult extends MatchSummary {
  seed: number;
  timedOut: boolean;
  error: string | null;
}

export function runHeadlessMatch(
  map: GameMap,
  options: HeadlessMatchOptions,
): HeadlessMatchResult {
  const result: HeadlessMatchResult = {
    seed: options.seed,
    winnerTeam: null,
    endTick: null,
    tick: 0,
    players: [],
    timedOut: false,
    error: null,
  };

  if (options.slots.length !== map.players) {
    result.error = `Expected ${map.players} player slots for map ${map.id}, got ${options.slots.length}`;
    return result;
  }

  let sim: Sim | undefined;
  try {
    const factions: Record<number, Faction> = {};
    const ai: Record<number, AiDifficulty> = {};
    for (let player = 0; player < options.slots.length; player++) {
      const slot = options.slots[player];
      factions[player] = slot.faction;
      if (slot.kind === 'ai') ai[player] = slot.difficulty;
    }

    sim = new Sim(map, options.seed, factions, ai);
    const events: SimEvent[] = [];
    while (!sim.world.outcome && sim.world.tick < options.maxTicks) {
      sim.step();
      if (sim.world.tick % 200 === 0) {
        sim.drainEvents(events);
        events.length = 0;
      }
    }
    result.timedOut = sim.world.outcome === null;
  } catch (err) {
    result.error = String(err);
  }

  if (sim) Object.assign(result, summarizeMatch(sim.world));
  return result;
}
