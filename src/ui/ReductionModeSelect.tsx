import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./ReductionModeSelect.css";

export const reductionModes = [
  { value: "triangles", label: "Number of triangles" },
  { value: "percentage", label: "Percentage remaining" },
  { value: "deviation", label: "Deviation from original" },
] as const;
export type ReductionMode = (typeof reductionModes)[number]["value"];

/** An application-rendered popup avoids the browser/OS select-popup lifecycle.
 * The portal stays outside the scrolling and clipped command panel. */
export function ReductionModeSelect({
  value,
  disabled,
  onChange,
}: {
  value: ReductionMode;
  disabled: boolean;
  onChange: (value: ReductionMode) => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);
  const [active, setActive] = useState(0);
  function close(restoreFocus = false) {
    setPosition(null);
    if (restoreFocus) trigger.current?.focus();
  }
  function open() {
    if (disabled) return;
    const rect = trigger.current!.getBoundingClientRect();
    const width = Math.min(rect.width, window.innerWidth - 16);
    setActive(reductionModes.findIndex((option) => option.value === value));
    setPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      top:
        rect.bottom + 116 <= window.innerHeight
          ? rect.bottom + 4
          : Math.max(8, rect.top - 116),
      width,
    });
  }
  useEffect(() => {
    if (!position) return;
    if (disabled) {
      setPosition(null);
      return;
    }
    const away = (event: PointerEvent) => {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !menu.current?.contains(event.target as Node)
      )
        setPosition(null);
    };
    const moved = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) setPosition(null);
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("scroll", moved, true);
    window.addEventListener("resize", moved);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("scroll", moved, true);
      window.removeEventListener("resize", moved);
    };
  }, [position, disabled]);
  useEffect(() => {
    if (position)
      menu.current
        ?.querySelector<HTMLButtonElement>(`[data-index="${active}"]`)
        ?.focus();
  }, [position, active]);
  return (
    <div className="reduction-mode-select">
      <span id={`${id}-label`}>Reduce by</span>
      <button
        ref={trigger}
        type="button"
        aria-label="Reduce by"
        aria-haspopup="listbox"
        aria-expanded={!!position}
        aria-controls={position ? id : undefined}
        disabled={disabled}
        onClick={() => (position ? close() : open())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            open();
          }
        }}
      >
        <span>
          {reductionModes.find((option) => option.value === value)!.label}
        </span>
        <span aria-hidden="true">⌄</span>
      </button>
      {position &&
        createPortal(
          <div
            ref={menu}
            id={id}
            role="listbox"
            aria-labelledby={`${id}-label`}
            className="reduction-mode-menu"
            style={position}
            onKeyDown={(event) => {
              if (event.key === "Escape" || event.key === "Tab") {
                event.preventDefault();
                close(true);
              } else if (
                ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
              ) {
                event.preventDefault();
                setActive(
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? 2
                      : (active + (event.key === "ArrowDown" ? 1 : 2)) % 3,
                );
              }
            }}
          >
            {reductionModes.map((option, index) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={value === option.value}
                data-index={index}
                tabIndex={active === index ? 0 : -1}
                onClick={() => {
                  if (option.value !== value) onChange(option.value);
                  close(true);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
