import type { ReactNode } from "react";
import { Keyboard } from "lucide-react";
import { activeToolGuidance, type ToolGuidanceContext } from "./tool-guidance";
import "./status-feedback.css";
import { Kbd, ShortcutText } from "./Kbd";
import { shortcutReference } from "./shortcut-reference";
import type { ShortcutContext } from "../keyboard-shortcuts";
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
export function ActiveToolHint({
  context,
  shortcuts,
}: {
  context: ToolGuidanceContext;
  shortcuts?: ShortcutContext;
}) {
  const hint = activeToolGuidance(context);
  return (
    <>
      <span
        className="status-navigation-hint"
        aria-label="Active tool controls"
        aria-live="polite"
        title={hint}
        tabIndex={0}
      >
        <ShortcutText text={hint} />
      </span>
      <div className="status-keyboard">
        <span className="status-keyboard-icon" aria-label="Keyboard shortcuts">
          <Keyboard size={16} aria-hidden="true" />
        </span>
        <section className="shortcut-reference" aria-label="Shortcut reference">
          <h3>Keyboard shortcuts</h3>
          {!context.busy && (
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
          {context.busy && <p>Modeling shortcuts paused while processing.</p>}
        </section>
      </div>
    </>
  );
}
