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
      : connected
        ? "SpaceMouse settings"
        : "Connect SpaceMouse";
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
              ? "Enable SpaceMouse navigation: choose your device in the browser permission dialog."
              : "SpaceMouse requires Chrome or Edge over HTTPS or localhost."
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
          ? "Choose your device in the browser dialog"
          : !available
            ? "WebHID is unavailable in this browser"
            : connected
              ? status.startsWith("Receiving motion:")
                ? "Receiving motion"
                : "Connected · waiting for motion"
              : "Browser permission needed"}
      </small>
    </div>
  );
}
