import type { GameSession } from '../game/GameSession';

export interface GameMenuProps {
  session: GameSession;
  onQuit: () => void;
}

export function GameMenu({ session, onQuit }: GameMenuProps) {
  return (
    <div
      className="game-menu-overlay"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <section
        className="game-menu-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Game menu"
      >
        <h2 className="screen-title">Game menu</h2>
        <div className="menu-actions">
          <button
            className="menu-button"
            type="button"
            onClick={() => session.closeMenu()}
          >
            Resume
          </button>
          <button
            className="menu-button menu-button-secondary"
            type="button"
            onClick={() => session.surrender()}
          >
            Surrender
          </button>
          <button
            className="menu-button menu-button-secondary"
            type="button"
            onClick={onQuit}
          >
            Quit to menu
          </button>
        </div>
      </section>
    </div>
  );
}
