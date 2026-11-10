import type { PlayerState, World } from '../world.js';

export interface PlayerSummary {
  player: number;
  faction: PlayerState['faction'];
  team: number;
  eliminated: boolean;
  age: PlayerState['age'];
  foodCollected: number;
  goldCollected: number;
  unitsTrained: number;
  unitsLost: number;
}

export interface MatchSummary {
  winnerTeam: number | null;
  endTick: number | null;
  tick: number;
  players: PlayerSummary[];
}

export function eliminatePlayer(world: World, player: number): void {
  const state = world.players[player];
  if (!state || state.eliminated) return;

  state.eliminated = true;
  world.emitEvent({ kind: 'playerEliminated', player });
}

export function updateVictory(world: World): void {
  if (world.outcome) return;

  let winnerTeam: number | null = null;
  for (const player of world.players) {
    if (player.eliminated) continue;
    if (winnerTeam !== null && player.team !== winnerTeam) return;
    winnerTeam = player.team;
  }

  world.outcome = { winnerTeam, endTick: world.tick };
  world.emitEvent({ kind: 'matchEnded', winnerTeam, tick: world.tick });
}

export function summarizeMatch(world: World): MatchSummary {
  return {
    winnerTeam: world.outcome?.winnerTeam ?? null,
    endTick: world.outcome?.endTick ?? null,
    tick: world.tick,
    players: world.players.map((player) => ({
      player: player.id,
      faction: player.faction,
      team: player.team,
      eliminated: player.eliminated,
      age: player.age,
      foodCollected: player.foodCollected,
      goldCollected: player.goldCollected,
      unitsTrained: player.unitsTrained,
      unitsLost: player.unitsLost,
    })),
  };
}
