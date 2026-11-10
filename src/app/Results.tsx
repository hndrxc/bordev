import type { MatchResult } from '../game/matchResult';
import { getPlayerColour } from '../render/playerColours';

export interface ResultsProps {
  result: MatchResult;
  onMainMenu: () => void;
}

const HEADINGS = {
  victory: 'Victory',
  defeat: 'Defeat',
  draw: 'Draw',
};

export function Results({ result, onMainMenu }: ResultsProps) {
  const seconds = Math.floor(result.durationTicks / 20);
  const minutes = String(Math.floor(seconds / 60)).padStart(2, '0');
  const remainingSeconds = String(seconds % 60).padStart(2, '0');

  return (
    <main className="screen-shell">
      <section className="screen-panel">
        <h1 className="screen-title">{HEADINGS[result.outcome]}</h1>
        <p className="results-time">
          Match time {minutes}:{remainingSeconds}
        </p>
        <table className="results-table" data-testid="results-table">
          <thead>
            <tr>
              <th scope="col">Player</th>
              <th scope="col">Colour</th>
              <th scope="col">Units trained</th>
              <th scope="col">Units lost</th>
              <th scope="col">Food gathered</th>
              <th scope="col">Gold gathered</th>
            </tr>
          </thead>
          <tbody>
            {result.players.map((player) => {
              const colour = getPlayerColour(player.colour);
              return (
                <tr
                  key={player.player}
                  data-testid={`results-row-${player.player}`}
                >
                  <th scope="row">{player.label}</th>
                  <td>
                    <span
                      className="results-swatch"
                      role="img"
                      aria-label={colour.name}
                      style={{ backgroundColor: colour.css }}
                    />
                  </td>
                  <td>{player.unitsTrained}</td>
                  <td>{player.unitsLost}</td>
                  <td>
                    {Math.floor(player.foodCollected).toLocaleString('en-US')}
                  </td>
                  <td>
                    {Math.floor(player.goldCollected).toLocaleString('en-US')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="menu-actions">
          <button type="button" className="menu-button" onClick={onMainMenu}>
            Main menu
          </button>
        </div>
      </section>
    </main>
  );
}
