import { useEffect, useRef } from 'react';
import type { GameSession } from '../game/GameSession';
import { Minimap } from './Minimap';
import { TopBar } from './TopBar';
import { SelectionPanel } from './SelectionPanel';
import { CommandCard } from './CommandCard';

export interface HudProps {
  session: GameSession | null;
}

export function Hud({ session }: HudProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const topBarRef = useRef<HTMLElement>(null);
  const bottomBarRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const updateInsets = () => {
      if (!session?.input?.camera) return;
      const canvas =
        session.renderer?.canvas ??
        rootRef.current?.parentElement?.querySelector('canvas');
      const topBar = topBarRef.current;
      const bottomBar = bottomBarRef.current;
      if (!canvas || !topBar || !bottomBar) return;

      const canvasRect = canvas.getBoundingClientRect();
      const topRect = topBar.getBoundingClientRect();
      const bottomRect = bottomBar.getBoundingClientRect();

      const top = Math.max(0, topRect.bottom - canvasRect.top);
      const bottom = Math.max(0, canvasRect.bottom - bottomRect.top);

      session.input.camera.setViewportInsets(top, bottom);
    };

    updateInsets();

    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(updateInsets)
        : null;

    if (ro) {
      if (topBarRef.current) ro.observe(topBarRef.current);
      if (bottomBarRef.current) ro.observe(bottomBarRef.current);
      const canvas =
        session?.renderer?.canvas ??
        rootRef.current?.parentElement?.querySelector('canvas');
      if (canvas) ro.observe(canvas);
      if (rootRef.current) ro.observe(rootRef.current);
    }

    window.addEventListener('resize', updateInsets);

    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', updateInsets);
    };
  }, [session]);

  return (
    <div
      ref={rootRef}
      className="hud-overlay"
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <TopBar ref={topBarRef} />

      <footer
        ref={bottomBarRef}
        className="hud-bottom-bar"
        data-testid="hud-bottom-bar"
      >
        <Minimap session={session} width={180} height={180} />
        <SelectionPanel session={session} />
        <CommandCard session={session} />
      </footer>
    </div>
  );
}
