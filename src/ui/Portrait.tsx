import { useEffect, useRef } from 'react';
import type { GameSession } from '../game/GameSession';

export interface PortraitProps {
  session?: GameSession | null;
  kind?: string;
  type: string;
  size?: number;
  className?: string;
}

const imageCache: Record<string, HTMLImageElement> = {};

function getImage(src: string): HTMLImageElement {
  let img = imageCache[src];
  if (!img) {
    img = new Image();
    img.src = src;
    imageCache[src] = img;
  }
  return img;
}

export function Portrait({
  session,
  kind,
  type,
  size = 54,
  className = '',
}: PortraitProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const portrait = session?.renderer?.getPortrait({ kind, type });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !portrait) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr =
      typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);

    const img = getImage(portrait.url);
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      const padding = 4;
      const avail = size - padding * 2;
      const scale = Math.min(avail / portrait.w, avail / portrait.h);
      const dw = portrait.w * scale;
      const dh = portrait.h * scale;
      const dx = (size - dw) * 0.5;
      const dy = (size - dh) * 0.5;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(
        img,
        portrait.x,
        portrait.y,
        portrait.w,
        portrait.h,
        dx,
        dy,
        dw,
        dh,
      );
    };

    if (img.complete && img.naturalWidth > 0) {
      draw();
    } else {
      img.addEventListener('load', draw);
      return () => {
        img.removeEventListener('load', draw);
      };
    }
  }, [portrait?.url, portrait?.x, portrait?.y, portrait?.w, portrait?.h, size]);

  if (!portrait) {
    return (
      <div
        className={`portrait-fallback ${className}`}
        style={{ width: size, height: size }}
      >
        <span>{type.slice(0, 2).toUpperCase()}</span>
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size }}
      className={`portrait-canvas ${className}`}
    />
  );
}
