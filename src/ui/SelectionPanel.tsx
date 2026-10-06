import type { GameSession } from '../game/GameSession';
import { useHudStore, getEntityDisplayName } from './hud';
import { Portrait } from './Portrait';

export interface SelectionPanelProps {
  session?: GameSession | null;
}

export function SelectionPanel({ session }: SelectionPanelProps) {
  const selection = useHudStore((state) => state.selection);

  if (selection.length === 0) {
    return (
      <div
        className="hud-selection-panel empty"
        data-testid="selection-panel"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="selection-empty-hint">No selection</div>
      </div>
    );
  }

  if (selection.length === 1) {
    const ent = selection[0];
    const hpPercent =
      ent.maxHp > 0
        ? Math.max(0, Math.min(100, (ent.hp / ent.maxHp) * 100))
        : 100;

    return (
      <div
        className="hud-selection-panel single"
        data-testid="selection-panel"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div
          className="selection-portrait-wrapper"
          data-testid="selection-portrait"
        >
          <Portrait
            session={session}
            kind={ent.kind}
            type={ent.type}
            size={64}
          />
        </div>

        <div className="selection-details">
          <div className="selection-header">
            <span className="selection-name" data-testid="selection-name">
              {ent.name}
            </span>
          </div>

          {ent.maxHp > 0 ? (
            <div className="selection-hp-section" data-testid="selection-hp">
              <div className="hp-bar-container">
                <div
                  className="hp-bar-fill"
                  style={{
                    width: `${hpPercent}%`,
                    backgroundColor:
                      hpPercent > 50
                        ? '#22c55e'
                        : hpPercent > 25
                          ? '#eab308'
                          : '#ef4444',
                  }}
                />
              </div>
              <span className="hp-text">
                {ent.hp} / {ent.maxHp}
              </span>
            </div>
          ) : null}

          <div className="selection-stats-grid">
            {ent.attack !== undefined && ent.attack > 0 ? (
              <div className="stat-badge" title="Attack damage">
                Attack {ent.attack}
              </div>
            ) : null}
            {ent.meleeArmor !== undefined || ent.pierceArmor !== undefined ? (
              <div className="stat-badge" title="Melee / Pierce armor">
                Armor {ent.meleeArmor ?? 0} / {ent.pierceArmor ?? 0}
              </div>
            ) : null}
            {ent.speed !== undefined && ent.speed > 0 ? (
              <div className="stat-badge" title="Movement speed">
                Speed {ent.speed.toFixed(1)}
              </div>
            ) : null}
            {ent.goldRemaining !== undefined ? (
              <div className="stat-badge" title="Remaining gold">
                Gold {ent.goldRemaining}
              </div>
            ) : null}
            {ent.buildProgress !== undefined && !ent.built ? (
              <div className="stat-badge" title="Construction progress">
                🔨 {Math.round(ent.buildProgress * 100)}%
              </div>
            ) : null}
            {(ent.trainingQueueCount !== undefined &&
              ent.trainingQueueCount > 0) ||
            ent.trainingProgress !== undefined ? (
              <div
                className="stat-badge selection-training-badge"
                title={
                  ent.trainingUnitType
                    ? `Training ${getEntityDisplayName({ kind: 'unit', type: ent.trainingUnitType })}: ${Math.round((ent.trainingProgress ?? 0) * 100)}% (${ent.trainingQueueCount ?? 1} queued)`
                    : `Training: ${Math.round((ent.trainingProgress ?? 0) * 100)}% (${ent.trainingQueueCount ?? 1} queued)`
                }
                data-testid="selection-training"
              >
                ⏳ {Math.round((ent.trainingProgress ?? 0) * 100)}% (
                {ent.trainingQueueCount ?? 1})
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  // Multi-selection grid
  return (
    <div
      className="hud-selection-panel multi"
      data-testid="selection-panel"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="multi-selection-header">
        <span className="multi-count">{selection.length} Selected</span>
        <button
          type="button"
          className="multi-clear-btn"
          onClick={() => session?.input?.selection.clear()}
        >
          Clear
        </button>
      </div>

      <div className="multi-portrait-grid">
        {selection.slice(0, 24).map((ent) => {
          const hpPct = ent.maxHp > 0 ? (ent.hp / ent.maxHp) * 100 : 100;
          return (
            <button
              key={ent.id}
              type="button"
              className="multi-portrait-card"
              onClick={() => session?.input?.selection.set([ent.id])}
              title={`${ent.name} (HP: ${ent.hp}/${ent.maxHp})`}
            >
              <Portrait
                session={session}
                kind={ent.kind}
                type={ent.type}
                size={36}
              />
              <div className="multi-hp-mini">
                <div
                  className="multi-hp-fill"
                  style={{
                    width: `${hpPct}%`,
                    backgroundColor:
                      hpPct > 50
                        ? '#22c55e'
                        : hpPct > 25
                          ? '#eab308'
                          : '#ef4444',
                  }}
                />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
