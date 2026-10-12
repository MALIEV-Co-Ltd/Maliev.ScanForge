import { useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import "./ScanQuickTools.css";
import { ScanToolIcon } from "./ScanToolIcon";

export function ScanQuickTools(props: {
  x: number;
  y: number;
  onDelete: () => void;
  onHide: () => void;
  onIsolate: () => void;
  onInvert: () => void;
  onDefeature?: () => void;
  onSmooth?: () => void;
}) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const drag = useRef<{
    pointer: number;
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  function move(x: number, y: number, element: HTMLElement) {
    const rect = element.parentElement!.getBoundingClientRect();
    setPosition({
      x: Math.max(8, Math.min(window.innerWidth - rect.width - 8, x)),
      y: Math.max(8, Math.min(window.innerHeight - rect.height - 8, y)),
    });
  }
  return (
    <div
      className="scan-quick-tools"
      role="toolbar"
      aria-label="Quick selection tools"
      style={{
        left:
          position?.x ??
          Math.max(
            8,
            Math.min(
              (typeof window === "undefined" ? 1024 : window.innerWidth) - 244,
              props.x - 112,
            ),
          ),
        top: position?.y ?? Math.max(8, props.y - 48),
      }}
    >
      <button
        className="scan-quick-drag-handle"
        aria-label="Move quick selection tools"
        title="Drag to move � arrow keys to reposition"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          const rect =
            event.currentTarget.parentElement!.getBoundingClientRect();
          drag.current = {
            pointer: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            left: rect.left,
            top: rect.top,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (start?.pointer === event.pointerId)
            move(
              start.left + event.clientX - start.x,
              start.top + event.clientY - start.y,
              event.currentTarget,
            );
        }}
        onPointerUp={(event) => {
          if (drag.current?.pointer === event.pointerId) {
            drag.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
        onKeyDown={(event) => {
          const direction = {
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, -1],
            ArrowDown: [0, 1],
          }[event.key];
          if (!direction) return;
          event.preventDefault();
          event.stopPropagation();
          const rect =
            event.currentTarget.parentElement!.getBoundingClientRect();
          const step = event.shiftKey ? 40 : 10;
          move(
            rect.left + direction[0] * step,
            rect.top + direction[1] * step,
            event.currentTarget,
          );
        }}
      >
        <GripVertical size={18} />
      </button>
      <button
        title="Delete selected"
        aria-label="Delete selected"
        onClick={props.onDelete}
      >
        <ScanToolIcon name="delete" />
      </button>
      <button
        title="Defeature selected area"
        aria-label="Defeature"
        disabled={!props.onDefeature}
        onClick={props.onDefeature}
      >
        <ScanToolIcon name="defeature" />
      </button>
      <button
        title="Smooth selected area"
        aria-label="Smooth selected"
        disabled={!props.onSmooth}
        onClick={props.onSmooth}
      >
        <ScanToolIcon name="smooth" />
      </button>
      <button
        title="Hide selected"
        aria-label="Hide selected"
        onClick={props.onHide}
      >
        <ScanToolIcon name="hide" />
      </button>
      <button
        title="Invert selection"
        aria-label="Invert selection"
        onClick={props.onInvert}
      >
        <ScanToolIcon name="invert" />
      </button>
      <button
        title="Isolate selected"
        aria-label="Isolate selected"
        onClick={props.onIsolate}
      >
        <ScanToolIcon name="isolate" />
      </button>
    </div>
  );
}
