import type { ComponentProps } from "react";
import "./kbd.css";

export function Kbd({ className = "", ...props }: ComponentProps<"kbd">) {
  return <kbd className={`app-kbd ${className}`.trim()} {...props} />;
}

/** Format only known input tokens; ordinary tool instructions remain prose. */
export function ShortcutText({ text }: { text: string }) {
  return (
    <>
      {text
        .split(
          /(Hold left-click|Left\/middle-drag|Left-click|Right-click|Middle-drag|Left-drag|Ctrl\+wheel|Ctrl\+drag|Shift\+drag|Escape|Alt)(?=\s|$)/gi,
        )
        .map((part, i) =>
          i % 2 ? (
            <span className="kbd-chord" key={i}>
              {part.split("+").map((key, j) => (
                <span key={j}>
                  {j > 0 && <span aria-hidden="true"> + </span>}
                  <Kbd>{key}</Kbd>
                </span>
              ))}
            </span>
          ) : (
            part
          ),
        )}
    </>
  );
}
