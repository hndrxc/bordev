import { useEffect, useRef } from 'react';
import { GameSession } from '../game/GameSession';

export function GameScreen() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const session = new GameSession(canvas);
    return () => session.dispose();
  }, []);

  return (
    <main className="game-screen">
      <canvas ref={canvasRef} aria-label="Game view" />
      <h1 className="title-overlay">bordev</h1>
    </main>
  );
}
