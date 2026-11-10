import { forwardRef } from 'react';
import { useHudStore } from './hud';

export const TopBar = forwardRef<HTMLElement>(function TopBar(_props, ref) {
  const resources = useHudStore((state) => state.resources);
  const status = useHudStore((state) => state.status);

  return (
    <header
      ref={ref}
      className="hud-topbar"
      data-testid="hud-topbar"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="topbar-left">
        <span
          className="topbar-title"
          aria-hidden="true"
          style={{ visibility: 'hidden' }}
        >
          bordev
        </span>
        <span className="topbar-faction-age">
          {resources.faction.toUpperCase()} — Age {resources.age}
        </span>
      </div>

      <div className="topbar-resources">
        <div
          className="resource-item resource-food"
          data-testid="resource-food"
          title="Food (workers, military)"
        >
          <span className="resource-icon">Food</span>
          <span className="resource-value" data-testid="hud-food">
            {Math.floor(resources.food)}
          </span>
        </div>

        <div
          className="resource-item resource-gold"
          data-testid="resource-gold"
          title="Gold (buildings, tech, advanced units)"
        >
          <span className="resource-icon">Gold</span>
          <span className="resource-value" data-testid="hud-gold">
            {Math.floor(resources.gold)}
          </span>
        </div>

        <div
          className={`resource-item resource-faith ${resources.lowFaith ? 'low-faith' : ''}`}
          data-testid="resource-faith"
          title={
            resources.lowFaith
              ? 'Low Faith: Faith used exceeds produced (penalties active)'
              : 'Faith used / Faith produced'
          }
        >
          <span className="resource-icon">Faith</span>
          <span className="resource-value" data-testid="hud-faith">
            {resources.faithUsed} / {resources.faithProduced}
          </span>
          {resources.lowFaith ? (
            <span
              className="low-faith-badge"
              data-testid="hud-low-faith"
              style={{
                color: '#ef4444',
                fontWeight: 700,
                fontSize: '0.75rem',
                marginLeft: '4px',
              }}
            >
              (LOW FAITH)
            </span>
          ) : null}
        </div>
        <div
          className="resource-item resource-pop"
          data-testid="resource-pop"
          title="Population / Population capacity"
        >
          <span className="resource-icon">Pop</span>
          <span className="resource-value">
            {resources.pop} / {resources.popCap}
          </span>
        </div>
      </div>

      <div className="topbar-right">
        {status ? (
          <div className="topbar-status" data-testid="hud-status">
            {status}
          </div>
        ) : null}
      </div>
    </header>
  );
});
