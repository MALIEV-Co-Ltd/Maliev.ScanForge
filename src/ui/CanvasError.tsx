import { X } from "./GeneratedUiIcons";
import "./ErrorBanner.css";

export function CanvasError({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  if (!message) return null;
  return (
    <div className="error-banner" role="alert">
      <span>{message}</span>
      <button aria-label="Dismiss error" onClick={onDismiss}>
        <X size={16} />
      </button>
    </div>
  );
}
