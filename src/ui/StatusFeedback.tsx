import type { ReactNode } from "react";
import { activeToolGuidance, type ToolGuidanceContext } from "./tool-guidance";
import "./status-feedback.css";
import { Kbd, ShortcutText } from "./Kbd";
import { shortcutReference } from "./shortcut-reference";
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
    <div className="status-controls">
      <span
        className="status-navigation-hint"
        aria-label="Active tool controls"
        aria-live="polite"
        title={hint}
        tabIndex={0}
      >
        <ShortcutText text={hint} />
      </span>
      <section className="shortcut-reference" aria-label="Shortcut reference">
        <h3>Current tool controls</h3>
        <p>
          <ShortcutText text={hint} />
        </p>
        {!context.busy && (
          <>
            <h3>Keyboard shortcuts</h3>
            <dl>
              {shortcutReference(
                context.shortcutMode ??
                  (context.sketchTool
                    ? "sketch"
                    : context.mode === "brush"
                      ? "selection"
                      : "main"),
                context.hasSelection,
                context.hasCadSelection,
              ).map(({ keys, label }) => (
                <div style={{ display: "contents" }} key={keys.join("+")}>
                  <dt>{label}</dt>
                  <dd>
                    {keys.map((key, i) => (
                      <span key={key}>
                        {i > 0 && " + "}
                        <Kbd>{key.replace("Arrow", "")}</Kbd>
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </section>
    </div>
  );
}
