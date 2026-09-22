import { useEffect, useRef } from 'react';
import { Renderer } from '../render/Renderer';

export function GameScreen() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new Renderer(canvas);
    return () => renderer.dispose();
  }, []);

  return (
    <main className="game-screen">
      <canvas ref={canvasRef} aria-label="Game view" />
      <h1 className="title-overlay">bordev</h1>
    </main>
  );
}
