import { useEffect, useRef, useState, useCallback } from 'react';
import type { GameSession } from '../game/GameSession';
import { useHudStore } from './hud';

export interface MinimapProps {
  session?: GameSession | null;
  width?: number;
  height?: number;
}

const TERRAIN_RGB: Record<number, readonly [number, number, number]> = {
  0: [58, 102, 50], // Grass
  1: [124, 101, 68], // Dirt
  2: [194, 178, 128], // Sand
  3: [74, 144, 164], // Shallow
  4: [43, 90, 120], // Water
  5: [30, 60, 26], // Forest
  6: [97, 99, 102], // Rock
};

const VOID_RGB: readonly [number, number, number] = [18, 20, 24];

function minimapToWorld(
  mx: number,
  my: number,
  mapSize: number,
  width: number,
  height: number,
): { x: number; z: number } {
  const u = (mx / width) * 2 - 1;
  const v = (my / height) * 2;
  const x = (u + v) * mapSize * 0.5;
  const z = (v - u) * mapSize * 0.5;
  return {
    x: Math.max(0, Math.min(mapSize, x)),
    z: Math.max(0, Math.min(mapSize, z)),
  };
}

export function Minimap({ session, width = 180, height = 180 }: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const terrainCacheRef = useRef<ImageData | null>(null);
  const cachedTilesRef = useRef<Uint8Array | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const minimapData = useHudStore((state) => state.minimap);
  const mapSize = minimapData.mapSize || 128;
  const tiles = minimapData.tiles;

  // Generate or reuse cached ImageData for terrain
  useEffect(() => {
    if (!tiles || tiles === cachedTilesRef.current) return;
    cachedTilesRef.current = tiles;

    const imgData = new ImageData(width, height);
    const data = imgData.data;

    for (let py = 0; py < height; py++) {
      const v = (py / height) * 2;
      for (let px = 0; px < width; px++) {
        const u = (px / width) * 2 - 1;
        const tx = (u + v) * mapSize * 0.5;
        const tz = (v - u) * mapSize * 0.5;
        const idx = (py * width + px) * 4;

        if (tx >= 0 && tx < mapSize && tz >= 0 && tz < mapSize) {
          const tileX = Math.floor(tx);
          const tileZ = Math.floor(tz);
          const code = tiles[tileZ * mapSize + tileX];
          const rgb = TERRAIN_RGB[code] ?? TERRAIN_RGB[0];
          data[idx] = rgb[0];
          data[idx + 1] = rgb[1];
          data[idx + 2] = rgb[2];
          data[idx + 3] = 255;
        } else {
          data[idx] = VOID_RGB[0];
          data[idx + 1] = VOID_RGB[1];
          data[idx + 2] = VOID_RGB[2];
          data[idx + 3] = 255;
        }
      }
    }

    terrainCacheRef.current = imgData;
  }, [tiles, mapSize, width, height]);

  // Render terrain, units, and camera viewport
  const renderMinimap = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (terrainCacheRef.current) {
      ctx.putImageData(terrainCacheRef.current, 0, 0);
    } else {
      ctx.fillStyle = '#121418';
      ctx.fillRect(0, 0, width, height);
    }

    // Draw diamond border
    ctx.strokeStyle = '#3a3f4b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(width * 0.5, 0);
    ctx.lineTo(width, height * 0.5);
    ctx.lineTo(width * 0.5, height);
    ctx.lineTo(0, height * 0.5);
    ctx.closePath();
    ctx.stroke();

    // Draw units & buildings
    const units = minimapData.units;
    for (const u of units) {
      const nu = (u.x - u.z) / mapSize;
      const nv = (u.x + u.z) / mapSize;
      const mx = (nu + 1) * 0.5 * width;
      const my = nv * 0.5 * height;

      if (u.player === 0) {
        ctx.fillStyle = '#3b82f6'; // Blue (player 0)
      } else if (u.player === 1) {
        ctx.fillStyle = '#ef4444'; // Red (player 1)
      } else {
        ctx.fillStyle = '#f59e0b'; // Amber (neutral/mine)
      }

      if (u.kind === 'building') {
        ctx.fillRect(mx - 2, my - 2, 4, 4);
      } else if (u.kind === 'mine') {
        ctx.fillRect(mx - 1.5, my - 1.5, 3, 3);
      } else {
        ctx.beginPath();
        ctx.arc(mx, my, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw camera viewport ground polygon
    const corners = minimapData.viewportCorners;
    if (corners && corners.length >= 4) {
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const c = corners[i];
        const nu = (c.x - c.z) / mapSize;
        const nv = (c.x + c.z) / mapSize;
        const cx = (nu + 1) * 0.5 * width;
        const cy = nv * 0.5 * height;
        if (i === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }, [minimapData, mapSize, width, height]);

  useEffect(() => {
    renderMinimap();
  }, [renderMinimap]);

  const centerCameraAt = (mx: number, my: number) => {
    const worldPos = minimapToWorld(mx, my, mapSize, width, height);
    const sessionObj: unknown = session;
    if (sessionObj && typeof sessionObj === 'object' && 'input' in sessionObj) {
      const input = sessionObj.input;
      if (input && typeof input === 'object' && 'camera' in input) {
        const cam = input.camera;
        if (
          cam &&
          typeof cam === 'object' &&
          'centerOn' in cam &&
          typeof cam.centerOn === 'function'
        ) {
          cam.centerOn(worldPos.x, worldPos.z);
        }
      }
    }
  };

  const issueContextOrderAt = (mx: number, my: number, queued: boolean) => {
    const worldPos = minimapToWorld(mx, my, mapSize, width, height);
    const sessionObj: unknown = session;
    if (sessionObj && typeof sessionObj === 'object' && 'input' in sessionObj) {
      const input = sessionObj.input;
      if (input && typeof input === 'object' && 'orders' in input) {
        const orders = input.orders;
        if (
          orders &&
          typeof orders === 'object' &&
          'contextOrder' in orders &&
          typeof orders.contextOrder === 'function'
        ) {
          orders.contextOrder(worldPos.x, worldPos.z, queued);
        }
      }
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.stopPropagation();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (e.button === 0) {
      // Left click jump
      setIsDragging(true);
      canvas.setPointerCapture?.(e.pointerId);
      centerCameraAt(mx, my);
    } else if (e.button === 2) {
      // Right click move/context order
      e.preventDefault();
      issueContextOrderAt(mx, my, e.shiftKey);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.stopPropagation();
    if (!isDragging) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    centerCameraAt(mx, my);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.stopPropagation();
    if (isDragging) {
      setIsDragging(false);
      try {
        canvasRef.current?.releasePointerCapture?.(e.pointerId);
      } catch {
        // Ignore if pointer capture wasn't active
      }
    }
  };

  return (
    <div
      className="minimap-container"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <canvas
        ref={canvasRef}
        data-testid="minimap"
        aria-label="Minimap"
        width={width}
        height={height}
        className="minimap-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      />
    </div>
  );
}
