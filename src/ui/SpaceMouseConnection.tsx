import { SpaceMouseIcon } from "./SpaceMouseIcon";
import "./spacemouse-connection.css";

export function SpaceMouseConnection({
  status,
  connected,
  connecting,
  available,
  onConnect,
  onSettings,
  compact = false,
}: {
  status: string;
  connected: boolean;
  connecting: boolean;
  available: boolean;
  onConnect: () => void;
  onSettings: () => void;
  compact?: boolean;
}) {
  const label = connecting
    ? "Connecting SpaceMouse…"
    : !available
      ? "SpaceMouse unavailable"
      : "SpaceMouse settings";
  return (
    <div className={`spacemouse-connection${compact ? " compact" : ""}`}>
      <button
        type="button"
        aria-label={label}
        disabled={connecting || !available}
        onClick={connected ? onSettings : onConnect}
        title={
          connected
            ? `${status}. Click for navigation preferences.`
            : available
              ? "Move the SpaceMouse cap for automatic detection, or open settings to connect via 3Dconnexion."
              : "SpaceMouse navigation is unavailable in this browser."
        }
      >
        <SpaceMouseIcon />
        {compact && (
          <span className="header-tooltip" role="tooltip">
            {label}
          </span>
        )}
        {!compact && label}
        {compact && connected && (
          <i className="spacemouse-connected-dot" aria-hidden="true" />
        )}
      </button>
      <small
        className={compact ? "visually-hidden" : undefined}
        role="status"
        aria-live="polite"
        title={status}
      >
        {connecting
          ? "Connecting to 3Dconnexion"
          : !available
            ? "Navigation unavailable"
            : connected
              ? status.startsWith("Receiving motion:")
                ? "Receiving motion"
                : "Connected · waiting for motion"
              : "Move the cap for automatic detection"}
      </small>
    </div>
  );
}
