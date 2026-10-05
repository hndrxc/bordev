import { useEffect, useRef, useState } from 'react';
import { GameSession } from '../game/GameSession';
import { Hud } from '../ui/HudRoot';

export function GameScreen() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [session, setSession] = useState<GameSession | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gameSession = new GameSession(canvas);
    setSession(gameSession);

    return () => {
      setSession(null);
      gameSession.dispose();
    };
  }, []);

  return (
    <main className="game-screen">
      <canvas ref={canvasRef} aria-label="Game view" />
      <h1 className="title-overlay">bordev</h1>
      <Hud session={session} />
    </main>
  );
}
