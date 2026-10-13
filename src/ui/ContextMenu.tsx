import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { matchesLocalShortcut } from "../shortcut-registry";

export interface ContextAction {
  label: string;
  disabled?: boolean;
  run: () => void;
}
export function menuPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  bounds: { width: number; height: number },
) {
  return {
    left: Math.max(0, Math.min(x, bounds.width - width)),
    top: Math.max(0, Math.min(y, bounds.height - height)),
  };
}
export function nextMenuIndex(
  current: number,
  direction: number,
  enabled: number[],
): number {
  if (!enabled.length) return -1;
  const index = enabled.indexOf(current);
  if (index < 0)
    return direction < 0 ? enabled[enabled.length - 1] : enabled[0];
  return enabled[(index + direction + enabled.length) % enabled.length];
}
export function ContextMenu({
  x,
  y,
  label,
  actions,
  onClose,
}: {
  x: number;
  y: number;
  label: string;
  actions: ContextAction[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const menu = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    const rect = menu.getBoundingClientRect();
    setPosition(
      menuPosition(x, y, rect.width, rect.height, {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    );
    menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const outside = (e: PointerEvent) => {
      if (!menu.contains(e.target as Node)) onClose();
    };
    const escape = (e: KeyboardEvent) => {
      if (matchesLocalShortcut(e, "cancel")) {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", onClose);
      previous?.focus();
    };
  }, [x, y, onClose]);
  return createPortal(
    <div
      ref={ref}
      className="app-context-menu"
      role="menu"
      aria-label={label}
      style={position}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        const buttons = Array.from(
          ref.current!.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ),
        );
        const current = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          buttons[
            nextMenuIndex(
              current,
              e.key === "ArrowDown" ? 1 : -1,
              buttons.map((_, i) => i),
            )
          ]?.focus();
        }
        if (e.key === "Home" || e.key === "End") {
          e.preventDefault();
          buttons[e.key === "Home" ? 0 : buttons.length - 1]?.focus();
        }
        if (e.key === "Tab") onClose();
      }}
    >
      {actions.map((action) => (
        <button
          key={action.label}
          role="menuitem"
          disabled={action.disabled}
          onClick={() => {
            onClose();
            action.run();
          }}
        >
          {action.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
