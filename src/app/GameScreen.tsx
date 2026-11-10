import { useEffect, useRef, useState } from 'react';
import { GameSession, type GameSessionOptions } from '../game/GameSession';
import type { MatchResult } from '../game/matchResult';
import { readUrlFlags } from '../game/urlFlags';
import { PLAYER_COLOURS } from '../render/playerColours';
import { AlertToasts } from '../ui/AlertToasts';
import { Hud } from '../ui/HudRoot';
import { useHudStore } from '../ui/hud';
import type { SkirmishConfig } from './App';
import { GameMenu } from './GameMenu';

export interface GameScreenProps {
  config: SkirmishConfig;
  onMatchEnd: (result: MatchResult) => void;
  onQuit: () => void;
}

export function GameScreen({ config, onMatchEnd, onQuit }: GameScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [session, setSession] = useState<GameSession | null>(null);
  const menuOpen = useHudStore((state) => state.menuOpen);
  const onMatchEndRef = useRef(onMatchEnd);
  const { mapUrl, seed, humanColour, opponent } = config;
  const { debugScene } = readUrlFlags();

  useEffect(() => {
    onMatchEndRef.current = onMatchEnd;
  }, [onMatchEnd]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const opponentColour = PLAYER_COLOURS.find(
      (colour) => colour.id !== humanColour,
    )!;
    const options: GameSessionOptions = {
      mapUrl,
      seed,
      ai: opponent === 'normal' ? { 1: 'normal' } : undefined,
      playerColours: [humanColour, opponentColour.id],
      debugScene,
      onMatchEnd: (result) => onMatchEndRef.current(result),
    };
    const gameSession = new GameSession(canvas, options);
    setSession(gameSession);

    return () => {
      setSession(null);
      gameSession.dispose();
    };
  }, [mapUrl, seed, humanColour, opponent, debugScene]);

  return (
    <main className="game-screen">
      <canvas ref={canvasRef} aria-label="Game view" />
      <h1 className="title-overlay">bordev</h1>
      <Hud session={session} />
      {menuOpen && session && <GameMenu session={session} onQuit={onQuit} />}
      <AlertToasts session={session} />
    </main>
  );
}
