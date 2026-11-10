interface MainMenuProps {
  onSkirmish: () => void;
}

export function MainMenu({ onSkirmish }: MainMenuProps) {
  return (
    <main className="screen-shell">
      <section className="screen-panel">
        <h1 className="screen-title">bordev</h1>
        <div className="menu-actions">
          <button className="menu-button" type="button" onClick={onSkirmish}>
            Skirmish
          </button>
          <button
            className="menu-button menu-button-secondary"
            type="button"
            aria-disabled="true"
            title="Available in the desktop build"
          >
            Quit
          </button>
        </div>
      </section>
    </main>
  );
}
