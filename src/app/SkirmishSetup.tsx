import { useState } from 'react';
import { PLAYER_COLOURS, type PlayerColourId } from '../render/playerColours';
import type { SkirmishConfig } from './App';

interface SkirmishSetupProps {
  onBack: () => void;
  onStart: (config: SkirmishConfig) => void;
}

export function SkirmishSetup({ onBack, onStart }: SkirmishSetupProps) {
  const [humanColour, setHumanColour] = useState<PlayerColourId>('blue');
  const opponentColour = PLAYER_COLOURS.find(
    (colour) => colour.id !== humanColour,
  )!;

  function start() {
    onStart({
      mapUrl: '/maps/alpha_test.json',
      seed: 1 + Math.floor(Math.random() * 1_000_000),
      humanColour,
      opponent: 'normal',
    });
  }

  return (
    <main className="screen-shell">
      <section className="screen-panel">
        <h1 className="screen-title">Skirmish</h1>
        <label className="setup-field setup-map">
          Map
          <select disabled defaultValue="alpha_test">
            <option value="alpha_test">Alpha Test</option>
          </select>
        </label>
        <div className="setup-slots">
          <div className="setup-slot" data-testid="slot-0">
            <h2>You</h2>
            <label className="setup-field">
              Faction
              <select disabled defaultValue="crown">
                <option value="crown">Crown</option>
              </select>
            </label>
            <label className="setup-field">
              Your colour
              <select
                value={humanColour}
                onChange={(event) =>
                  setHumanColour(event.target.value as PlayerColourId)
                }
              >
                {PLAYER_COLOURS.map((colour) => (
                  <option key={colour.id} value={colour.id}>
                    {colour.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="setup-slot" data-testid="slot-1">
            <h2>Normal AI</h2>
            <label className="setup-field">
              Faction
              <select disabled defaultValue="crown">
                <option value="crown">Crown</option>
              </select>
            </label>
            <label className="setup-field">
              Difficulty
              <select disabled defaultValue="normal">
                <option value="normal">Normal</option>
              </select>
            </label>
            <p className="setup-field">Colour: {opponentColour.name}</p>
          </div>
        </div>
        <div className="setup-actions">
          <button
            className="menu-button menu-button-secondary"
            type="button"
            onClick={onBack}
          >
            Back
          </button>
          <button className="menu-button" type="button" onClick={start}>
            Start
          </button>
        </div>
      </section>
    </main>
  );
}
