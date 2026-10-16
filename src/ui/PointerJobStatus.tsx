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

/** Keep the last pointer even before a job starts. Each caller owns its lease. */
export function trackJobPointer(observer: () => void = () => {}) {
  if (!observers.size) {
    window.addEventListener("pointermove", rememberPointer, { passive: true });
    window.addEventListener("pointerdown", rememberPointer, { passive: true });
  }
  observers.add(observer);
  return () => {
    observers.delete(observer);
    if (!observers.size) {
      window.removeEventListener("pointermove", rememberPointer);
      window.removeEventListener("pointerdown", rememberPointer);
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
    let size = element.getBoundingClientRect();
    const update = () => {
      const point = positionJobStatus(
        lastPointer ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 },
        size,
        { width: window.innerWidth, height: window.innerHeight },
      );
      element.style.transform = `translate(${point.x}px, ${point.y}px)`;
      element.style.visibility = "visible";
    };
    const measure = () => {
      size = element.getBoundingClientRect();
      update();
    };
    const stop = trackJobPointer(update);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    update();
    return () => {
      stop();
      observer.disconnect();
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
