import type { GameSession } from '../game/GameSession';
import { useHudStore } from './hud';
import {
  getCommandSlots,
  getCommandSlotContext,
  type CommandSlot,
} from './commandSlots';

export interface CommandCardProps {
  session?: GameSession | null;
}

export function CommandCard({ session }: CommandCardProps) {
  const selection = useHudStore((state) => state.selection);
  const orders = useHudStore((state) => state.orders);
  // Slot enablement reads the live world; these subscriptions re-render the card when
  // resources, age, completed buildings or upgrades change.
  useHudStore((state) => state.resources);
  useHudStore((state) => state.progression);
  const slots = getCommandSlots(
    selection,
    orders.submenu,
    getCommandSlotContext(session?.sim?.world),
  );

  const rows: (readonly CommandSlot[])[] = [
    slots.slice(0, 5),
    slots.slice(5, 10),
    slots.slice(10, 15),
  ];

  const handleAction = (slot: CommandSlot) => {
    if (slot.disabled) {
      if (slot.reason) {
        session?.showStatus(slot.reason);
      }
      return;
    }
    session?.input?.orders?.executeSlot(slot);
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

            const isActive =
              (slot.action === 'move' && orders.mode === 'move') ||
              (slot.action === 'attackMove' && orders.mode === 'attackMove') ||
              (slot.action === 'build' &&
                !!slot.buildingType &&
                orders.placementBuilding === slot.buildingType);
            return (
              <button
                key={cIdx}
                type="button"
                className={`command-slot ${slot.disabled ? 'disabled' : 'enabled'} ${isActive ? 'active' : ''}`}
                data-testid={testId}
                aria-label={slot.label}
                aria-disabled={slot.disabled ? 'true' : undefined}
                title={
                  slot.tooltip ??
                  (slot.reason
                    ? `${slot.label} [${slot.key}] (${slot.reason})`
                    : `${slot.label} [${slot.key}]`)
                }
                onClick={() => handleAction(slot)}
              >
                <span className="slot-hotkey">{slot.key}</span>
                <span className="slot-label">{slot.label}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
