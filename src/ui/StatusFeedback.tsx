import type { ReactNode } from "react";
import { Keyboard } from "lucide-react";
import { activeToolGuidance, type ToolGuidanceContext } from "./tool-guidance";
import "./status-feedback.css";
import { Kbd, ShortcutText } from "./Kbd";
import { shortcutReference } from "./shortcut-reference";
import type { ShortcutContext } from "../keyboard-shortcuts";
import { StatusMetrics } from "./StatusMetrics";
import { OverflowStatusText } from "./OverflowStatusText";
export function StatusMessage({
  message,
  children,
}: {
  message: string;
  children?: ReactNode;
}) {
  return (
    <div className="status-message" aria-live="polite" title={message}>
      {children === undefined || typeof children === "string" ? (
        <OverflowStatusText
          text={typeof children === "string" ? children : message}
        />
      ) : (
        children
      )}
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
      <ShortcutText text={hint} />
    </span>
  );
}
export function StatusKeyboard({
  busy,
  shortcuts,
}: {
  busy?: boolean;
  shortcuts?: ShortcutContext;
}) {
  return (
    <div className="status-keyboard">
      <span className="status-keyboard-icon" aria-label="Keyboard shortcuts">
        <Keyboard size={16} aria-hidden="true" />
      </span>
      <section className="shortcut-reference" aria-label="Shortcut reference">
        <h3>Keyboard shortcuts</h3>
        {!busy && (
          <>
            <dl>
              {(shortcuts ? shortcutReference(shortcuts) : []).map(
                ({ keys, label, scope, enabled, active }) => (
                  <div
                    className={
                      enabled ? "shortcut-row" : "shortcut-row unavailable"
                    }
                    key={`${label}:${keys.join("+")}`}
                    title={
                      !active
                        ? `Available in ${scope ?? "another tool mode"}`
                        : !enabled
                          ? "Available when the command's required selection or dialog state allows it"
                          : undefined
                    }
                  >
                    <dt>
                      {label}
                      {scope && <small>{scope}</small>}
                    </dt>
                    <dd>
                      {keys.map((key, i) => (
                        <span key={key}>
                          {i > 0 && " + "}
                          <Kbd
                            aria-label={
                              key === "\u2318" ? "Command" : undefined
                            }
                          >
                            {key}
                          </Kbd>
                        </span>
                      ))}
                    </dd>
                  </div>
                ),
              )}
            </dl>
            <p className="shortcut-reference-note">
              Dimmed shortcuts need another tool mode or selection.
            </p>
          </>
        )}
        {busy && <p>Modeling shortcuts paused while processing.</p>}
      </section>
    </div>
  );
}
export function StatusBar({
  busy,
  operation,
  hint,
  facets,
  shortcuts,
}: {
  busy: boolean;
  operation: ReactNode;
  hint: ReactNode;
  facets?: number;
  shortcuts: ShortcutContext;
}) {
  return (
    <footer className="statusbar">
      <div
        className="status-operation"
        role="group"
        aria-label="Operation progress"
      >
        <span
          className={busy ? "status-dot busy" : "status-dot"}
          aria-hidden="true"
        />
        {operation}
      </div>
      <div
        className="status-guidance"
        role="group"
        aria-label="Command guidance"
      >
        {hint}
      </div>
      <div
        className="status-details"
        role="group"
        aria-label="Model information"
      >
        <StatusMetrics facets={facets} />
        <span className="status-end">Units: mm</span>
        <StatusKeyboard busy={busy} shortcuts={shortcuts} />
      </div>
    </footer>
  );
}
