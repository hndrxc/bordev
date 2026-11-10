import type { PlayerColourId } from '../render/playerColours';
import type { AiDifficulty } from '../sim/ai/difficulty';
import type { MatchSummary, PlayerSummary } from '../sim/systems/victory';

export type MatchResult = {
  outcome: 'victory' | 'defeat' | 'draw';
  durationTicks: number;
  players: (PlayerSummary & { label: string; colour: PlayerColourId })[];
};

export function buildMatchResult(
  summary: MatchSummary,
  opts: {
    viewer: 0;
    ai: Record<number, AiDifficulty> | undefined;
    colours: readonly PlayerColourId[];
  },
): MatchResult {
  const viewerTeam = summary.players.find(
    (player) => player.player === opts.viewer,
  )?.team;

  return {
    outcome:
      summary.winnerTeam === null
        ? 'draw'
        : summary.winnerTeam === viewerTeam
          ? 'victory'
          : 'defeat',
    durationTicks: summary.endTick ?? summary.tick,
    players: summary.players.map((player) => ({
      ...player,
      label:
        player.player === opts.viewer
          ? 'You'
          : opts.ai?.[player.player]
            ? 'Normal AI'
            : `Player ${player.player + 1}`,
      colour: opts.colours[player.player] ?? 'blue',
    })),
  };
}
