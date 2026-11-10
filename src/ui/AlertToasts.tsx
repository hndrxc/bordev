import type { GameSession } from '../game/GameSession';
import { useHudStore } from './hud';

export interface AlertToastsProps {
  session: GameSession | null;
}

export function AlertToasts({ session }: AlertToastsProps) {
  const alerts = useHudStore((state) => state.alerts);

  return (
    <div
      className="alert-toasts"
      data-testid="alert-toasts"
      role="status"
      aria-live="polite"
      aria-atomic="false"
      aria-relevant="additions text"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {alerts.slice(-4).map((alert) =>
        session && alert.x !== undefined && alert.z !== undefined ? (
          <button
            key={alert.id}
            type="button"
            className="alert-toast"
            data-testid="alert-toast"
            data-kind={alert.kind}
            onClick={() => session.input.camera.centerOn(alert.x!, alert.z!)}
          >
            {alert.text}
          </button>
        ) : (
          <div
            key={alert.id}
            className="alert-toast"
            data-testid="alert-toast"
            data-kind={alert.kind}
          >
            {alert.text}
          </div>
        ),
      )}
    </div>
  );
}
