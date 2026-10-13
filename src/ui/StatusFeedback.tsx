import type { ReactNode } from "react";
import { activeToolGuidance, type ToolGuidanceContext } from "./tool-guidance";
import "./status-feedback.css";
export function StatusMessage({
  message,
  children,
}: {
  message: string;
  children?: ReactNode;
}) {
  return (
    <div className="status-message" aria-live="polite" title={message}>
      {children ?? message}
    </div>
  );
}
export function ActiveToolHint({ context }: { context: ToolGuidanceContext }) {
  const hint = activeToolGuidance(context);
  return (
    <span
      className="status-navigation-hint"
      aria-label="Active tool controls"
      aria-live="polite"
      title={hint}
      tabIndex={0}
    >
      {hint}
    </span>
  );
}
