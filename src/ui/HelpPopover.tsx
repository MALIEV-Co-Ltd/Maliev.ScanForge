import { useId, useRef, useState, type ReactNode } from "react";

/** Top-layer help stays readable outside a scrolling options menu. */
export function HelpPopover({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const id = useId();
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  function show(button: HTMLButtonElement) {
    const element = popup.current;
    if (!element) return;
    element.showPopover();
    const anchor = button.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(anchor.right + 8, window.innerWidth - bounds.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(anchor.top, window.innerHeight - bounds.height - 8))}px`;
  }
  return (
    <span
      className="help-popover"
      onPointerLeave={(event) => {
        if (!event.currentTarget.contains(document.activeElement))
          popup.current?.hidePopover();
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          popup.current?.hidePopover();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") popup.current?.hidePopover();
      }}
    >
      <button
        type="button"
        className="help-icon"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        aria-describedby={open ? id : undefined}
        onPointerEnter={(event) => show(event.currentTarget)}
        onFocus={(event) => show(event.currentTarget)}
        onClick={(event) => show(event.currentTarget)}
      >
        <span aria-hidden="true">?</span>
      </button>
      <div
        ref={popup}
        id={id}
        className="help-popup"
        popover="auto"
        role="tooltip"
        onToggle={(event) => setOpen(event.newState === "open")}
      >
        <strong>{label}</strong>
        {children}
      </div>
    </span>
  );
}
