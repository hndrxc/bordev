import { useEffect, useRef } from 'react';
import type { GameSession } from '../game/GameSession';
import { useHudStore, setHudStatus, publishHud, resetHud } from './hud';
import { Minimap } from './Minimap';
import { getCommandSlots, type CommandSlot } from './commandCard';

export { useHudStore, publishHud, resetHud, setHudStatus, Minimap };

export interface HudProps {
  session: GameSession | null;
}

// ---------------------------------------------------------------------------
// Helpers to execute session actions safely without inline casts
// ---------------------------------------------------------------------------

function executeCommand(
  session: GameSession | null | undefined,
  action: string,
) {
  const sessionObj: unknown = session;
  if (sessionObj && typeof sessionObj === 'object' && 'input' in sessionObj) {
    const input = sessionObj.input;
    if (input && typeof input === 'object' && 'orders' in input) {
      const orders = input.orders;
      if (
        orders &&
        typeof orders === 'object' &&
        'execute' in orders &&
        typeof orders.execute === 'function'
      ) {
        orders.execute(action);
      }
    }
  }
}

function selectSingleEntity(
  session: GameSession | null | undefined,
  id: number,
) {
  const sessionObj: unknown = session;
  if (sessionObj && typeof sessionObj === 'object' && 'input' in sessionObj) {
    const input = sessionObj.input;
    if (input && typeof input === 'object' && 'selection' in input) {
      const sel = input.selection;
      if (
        sel &&
        typeof sel === 'object' &&
        'set' in sel &&
        typeof sel.set === 'function'
      ) {
        sel.set([id]);
      }
    }
  }
}

function clearSelection(session: GameSession | null | undefined) {
  const sessionObj: unknown = session;
  if (sessionObj && typeof sessionObj === 'object' && 'input' in sessionObj) {
    const input = sessionObj.input;
    if (input && typeof input === 'object' && 'selection' in input) {
      const sel = input.selection;
      if (
        sel &&
        typeof sel === 'object' &&
        'clear' in sel &&
        typeof sel.clear === 'function'
      ) {
        sel.clear();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Portrait renderer: crops sprite atlases to a crisp canvas portrait
// ---------------------------------------------------------------------------

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
}: {
  session?: GameSession | null;
  kind?: string;
  type: string;
  size?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const portrait = session?.renderer?.getPortrait({ kind, type });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !portrait) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, size, size);

    const img = getImage(portrait.url);
    const draw = () => {
      ctx.clearRect(0, 0, size, size);
      const padding = 4;
      const avail = size - padding * 2;
      const scale = Math.min(avail / portrait.w, avail / portrait.h);
      const dw = portrait.w * scale;
      const dh = portrait.h * scale;
      const dx = (size - dw) * 0.5;
      const dy = (size - dh) * 0.5;

      ctx.imageSmoothingEnabled = false;
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
      width={size}
      height={size}
      className={`portrait-canvas ${className}`}
    />
  );
}

// ---------------------------------------------------------------------------
// TopBar: resources, faith, pop, age, and status ticker
// ---------------------------------------------------------------------------

export function TopBar() {
  const resources = useHudStore((state) => state.resources);
  const status = useHudStore((state) => state.status);

  return (
    <header
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
            {resources.food}
          </span>
        </div>

        <div
          className="resource-item resource-gold"
          data-testid="resource-gold"
          title="Gold (buildings, tech, advanced units)"
        >
          <span className="resource-icon">Gold</span>
          <span className="resource-value" data-testid="hud-gold">
            {resources.gold}
          </span>
        </div>

        <div
          className="resource-item resource-faith"
          data-testid="resource-faith"
          title="Faith used / Faith produced"
        >
          <span className="resource-icon">Faith</span>
          <span className="resource-value">
            {resources.faithUsed} / {resources.faithProduced}
          </span>
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
}

// ---------------------------------------------------------------------------
// SelectionPanel: single entity stats/portrait or multi-entity portrait grid
// ---------------------------------------------------------------------------

export function SelectionPanel({ session }: { session?: GameSession | null }) {
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
          onClick={() => clearSelection(session)}
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
              onClick={() => selectSingleEntity(session, ent.id)}
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

// ---------------------------------------------------------------------------
// CommandCard: 3x5 grid (QWERT / ASDFG / ZXCVB) with hotkeys and truthful tooltips
// ---------------------------------------------------------------------------

export function CommandCard({ session }: { session?: GameSession | null }) {
  const selection = useHudStore((state) => state.selection);
  const orders = useHudStore((state) => state.orders);

  const slots = getCommandSlots(selection, orders.submenu);

  const rows: (readonly CommandSlot[])[] = [
    slots.slice(0, 5),
    slots.slice(5, 10),
    slots.slice(10, 15),
  ];

  const handleAction = (slot: CommandSlot) => {
    if (slot.disabled) {
      if (slot.reason) {
        setHudStatus(slot.reason);
      }
      return;
    }
    if (slot.action) {
      executeCommand(session, slot.action);
    }
  };

  return (
    <div
      className="hud-command-card"
      data-testid="command-card"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {rows.map((row, rIdx) => (
        <div key={rIdx} className="command-row">
          {row.map((slot, cIdx) => {
            if (!slot.label) {
              return (
                <div key={cIdx} className="command-slot empty">
                  <span className="slot-hotkey-dim">{slot.key}</span>
                </div>
              );
            }

            const testId = slot.id ? `command-${slot.id}` : undefined;
            const secondaryTestId =
              slot.id === 'attack-move'
                ? 'command-attackMove'
                : slot.id === 'back'
                  ? 'command-cancel'
                  : undefined;

            const isActive =
              (slot.action === 'move' && orders.mode === 'move') ||
              (slot.action === 'attackMove' && orders.mode === 'attackMove');

            return (
              <button
                key={cIdx}
                type="button"
                className={`command-slot ${slot.disabled ? 'disabled' : 'enabled'} ${isActive ? 'active' : ''}`}
                data-testid={testId}
                aria-label={slot.label}
                title={
                  slot.tooltip ??
                  (slot.reason
                    ? `${slot.label} [${slot.key}] (${slot.reason})`
                    : `${slot.label} [${slot.key}]`)
                }
                disabled={slot.disabled}
                onClick={() => handleAction(slot)}
              >
                <span className="slot-hotkey">{slot.key}</span>
                <span className="slot-label" data-testid={secondaryTestId}>
                  {slot.label}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Hud Component
// ---------------------------------------------------------------------------

export function Hud({ session }: HudProps) {
  return (
    <div
      className="hud-overlay"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <TopBar />

      <footer className="hud-bottom-bar">
        <Minimap session={session} width={180} height={180} />
        <SelectionPanel session={session} />
        <CommandCard session={session} />
      </footer>
    </div>
  );
}

export default Hud;
