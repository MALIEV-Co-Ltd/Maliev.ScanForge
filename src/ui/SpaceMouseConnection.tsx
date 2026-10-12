import { Joystick } from "lucide-react";

export function SpaceMouseConnection({
  status,
  connected,
  connecting,
  available,
  onConnect,
  onSettings,
}: {
  status: string;
  connected: boolean;
  connecting: boolean;
  available: boolean;
  onConnect: () => void;
  onSettings: () => void;
}) {
  const label = connecting
    ? "Connecting SpaceMouse…"
    : !available
      ? "SpaceMouse unavailable"
      : connected
        ? "SpaceMouse settings"
        : "Connect SpaceMouse";
  return (
    <div className="spacemouse-connection">
      <button
        type="button"
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
        <Joystick size={15} aria-hidden="true" />
        {label}
      </button>
      <small role="status" aria-live="polite" title={status}>
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
