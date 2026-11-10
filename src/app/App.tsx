import { useCallback, useState } from 'react';
import type { MatchResult } from '../game/matchResult';
import { readUrlFlags } from '../game/urlFlags';
import type { PlayerColourId } from '../render/playerColours';
import { GameScreen } from './GameScreen';
import { MainMenu } from './MainMenu';
import { Results } from './Results';
import { SkirmishSetup } from './SkirmishSetup';

export interface SkirmishConfig {
  mapUrl: string;
  seed: number;
  humanColour: PlayerColourId;
  opponent: 'normal' | 'none';
}

type Screen =
  | { name: 'menu' }
  | { name: 'setup' }
  | { name: 'game'; config: SkirmishConfig }
  | { name: 'results'; result: MatchResult };

export function App() {
  const [screen, setScreen] = useState<Screen>(() =>
    readUrlFlags().startSandbox
      ? {
          name: 'game',
          config: {
            mapUrl: '/maps/alpha_test.json',
            seed: 7,
            humanColour: 'blue',
            opponent: 'none',
          },
        }
      : { name: 'menu' },
  );
  const showMenu = useCallback(() => setScreen({ name: 'menu' }), []);
  const showSetup = useCallback(() => setScreen({ name: 'setup' }), []);
  const startGame = useCallback((config: SkirmishConfig) => {
    setScreen({ name: 'game', config });
  }, []);
  const showResults = useCallback((result: MatchResult) => {
    setScreen({ name: 'results', result });
  }, []);

  switch (screen.name) {
    case 'menu':
      return <MainMenu onSkirmish={showSetup} />;
    case 'setup':
      return <SkirmishSetup onBack={showMenu} onStart={startGame} />;
    case 'game':
      return (
        <GameScreen
          config={screen.config}
          onMatchEnd={showResults}
          onQuit={showMenu}
        />
      );
    case 'results':
      return <Results result={screen.result} onMainMenu={showMenu} />;
  }
}
