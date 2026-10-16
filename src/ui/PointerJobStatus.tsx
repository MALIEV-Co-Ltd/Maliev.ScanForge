import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import "./pointer-job-status.css";

type Point = { x: number; y: number };
type Size = { width: number; height: number };
let lastPointer: Point | undefined;
const observers = new Set<() => void>();
const rememberPointer = (event: PointerEvent) => {
  if (event.pointerType === "touch") return;
  lastPointer = { x: event.clientX, y: event.clientY };
  for (const observer of observers) observer();
};
const leaveWindow = () => {
  lastPointer = undefined;
  for (const observer of observers) observer();
};
const pointerOut = (event: PointerEvent) => {
  if (event.relatedTarget === null) leaveWindow();
};

/** Keep the last pointer even before a job starts. Each caller owns its lease. */
export function trackJobPointer(observer: () => void = () => {}) {
  if (!observers.size) {
    window.addEventListener("pointermove", rememberPointer, { passive: true });
    window.addEventListener("pointerdown", rememberPointer, { passive: true });
    window.addEventListener("pointerout", pointerOut, { passive: true });
    window.addEventListener("blur", leaveWindow);
  }
  observers.add(observer);
  return () => {
    observers.delete(observer);
    if (!observers.size) {
      window.removeEventListener("pointermove", rememberPointer);
      window.removeEventListener("pointerdown", rememberPointer);
      window.removeEventListener("pointerout", pointerOut);
      window.removeEventListener("blur", leaveWindow);
      lastPointer = undefined;
    }
  };
}

export function positionJobStatus(
  pointer: Point,
  label: Size,
  viewport: Size,
): Point {
  const x =
    pointer.x + 16 + label.width > viewport.width - 8
      ? pointer.x - label.width - 16
      : pointer.x + 16;
  const y =
    pointer.y + 24 + label.height > viewport.height - 8
      ? pointer.y - label.height - 12
      : pointer.y + 24;
  return {
    x: Math.max(8, Math.min(x, viewport.width - label.width - 8)),
    y: Math.max(8, Math.min(y, viewport.height - label.height - 8)),
  };
}

/** Noninteractive, cursor-following feedback for a running operation. */
export function PointerJobStatus({ message }: { message: string }) {
  const label = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const element = label.current;
    if (!message || !element) return;
    const update = () => {
      const canvas =
        lastPointer && document.elementFromPoint(lastPointer.x, lastPointer.y);
      if (!lastPointer || !canvas?.matches(".viewport canvas")) {
        element.style.visibility = "hidden";
        return;
      }
      const bounds = canvas.getBoundingClientRect();
      element.style.maxWidth = `${Math.min(320, Math.max(0, bounds.width - 16))}px`;
      const point = positionJobStatus(
        { x: lastPointer.x - bounds.left, y: lastPointer.y - bounds.top },
        element.getBoundingClientRect(),
        bounds,
      );
      element.style.transform = `translate(${point.x + bounds.left}px, ${point.y + bounds.top}px)`;
      element.style.visibility = "visible";
    };
    const measure = () => {
      update();
    };
    const stop = trackJobPointer(update);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    // A dialog can cover a stationary pointer without a pointermove event.
    // Ignore this label's own style writes to avoid an observation loop.
    const occlusion = new MutationObserver((changes) => {
      if (
        changes.some(
          (change) =>
            change.target !== element && !element.contains(change.target),
        )
      )
        update();
    });
    occlusion.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class", "hidden", "open"],
    });
    window.addEventListener("resize", measure);
    update();
    return () => {
      stop();
      observer.disconnect();
      occlusion.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [message]);
  if (!message) return null;
  const content = (
    <span
      ref={label}
      className="pointer-job-status"
      role="status"
      aria-live="polite"
    >
      {message}
    </span>
  );
  return typeof document === "undefined"
    ? content
    : createPortal(
        content,
        document.querySelector(".workbench") ?? document.body,
      );
}
