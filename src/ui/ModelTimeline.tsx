import { useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Layers,
} from "lucide-react";
import "./model-timeline.css";

import { RibbonCommandIcon, ribbonCommandPalette } from "./RibbonCommandIcon";
import { timelineCommand } from "./timeline-command";

export function ModelTimeline({
  labels,
  cursor,
  disabled,
  onSeek,
  onContextMenu,
}: {
  labels: string[];
  cursor: number;
  disabled: boolean;
  onSeek: (index: number) => void;
  onContextMenu: (event: MouseEvent, index: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [markerLeft, setMarkerLeft] = useState(0);
  const dragging = useRef<number | null>(null);
  const panning = useRef<{
    pointerId: number;
    x: number;
    scrollLeft: number;
  } | null>(null);
  useEffect(() => {
    const element = track.current;
    const item = element?.querySelector<HTMLElement>(
      '[aria-current="step"]',
    )?.parentElement;
    if (element && item) {
      setMarkerLeft(item.offsetLeft + item.offsetWidth + 8);
      if (item.offsetLeft < element.scrollLeft)
        element.scrollLeft = item.offsetLeft;
      else if (
        item.offsetLeft + item.offsetWidth >
        element.scrollLeft + element.clientWidth
      )
        element.scrollLeft =
          item.offsetLeft + item.offsetWidth - element.clientWidth;
    }
  }, [cursor, labels.length]);
  const control = (label: string, index: number, icon: React.ReactNode) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled || index === cursor}
      onClick={() => onSeek(index)}
    >
      {icon}
    </button>
  );
  return (
    <section className="model-timeline" aria-label="Model timeline">
      <div
        className="timeline-navigation"
        role="toolbar"
        aria-label="Timeline navigation"
      >
        {control("Go to starting state", 0, <ChevronsLeft size={14} />)}
        {control(
          "Previous model step",
          Math.max(0, cursor - 1),
          <ChevronLeft size={14} />,
        )}
        {control(
          "Next model step",
          Math.min(labels.length, cursor + 1),
          <ChevronRight size={14} />,
        )}
        {control(
          "Go to latest model step",
          labels.length,
          <ChevronsRight size={14} />,
        )}
      </div>
      <div
        className="timeline-track"
        ref={track}
        title="Scroll to browse timeline - Middle-drag pans"
        onPointerDown={(event) => {
          if (event.button !== 1) return;
          event.preventDefault();
          panning.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            scrollLeft: event.currentTarget.scrollLeft,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const pan = panning.current;
          if (pan?.pointerId === event.pointerId)
            event.currentTarget.scrollLeft =
              pan.scrollLeft + pan.x - event.clientX;
        }}
        onPointerUp={(event) => {
          if (panning.current?.pointerId !== event.pointerId) return;
          panning.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          panning.current = null;
        }}
        onLostPointerCapture={() => {
          panning.current = null;
        }}
        onAuxClick={(event) => {
          if (event.button === 1) event.preventDefault();
        }}
        onWheel={(event) => {
          if (
            Math.abs(event.deltaY) > Math.abs(event.deltaX) &&
            track.current &&
            track.current.scrollWidth > track.current.clientWidth
          ) {
            track.current.scrollLeft += event.deltaY;
            event.preventDefault();
          }
        }}
      >
        <ol className="timeline-steps">
          {["Starting state", ...labels].map((label, index) => (
            <li
              key={index}
              className={
                index === cursor
                  ? "timeline-current"
                  : index > cursor
                    ? "timeline-future"
                    : ""
              }
              style={
                {
                  "--timeline-operation-color":
                    index === 0
                      ? "var(--border)"
                      : ribbonCommandPalette(timelineCommand(label)).base,
                } as CSSProperties
              }
            >
              <button
                type="button"
                title={`${index}: ${label}`}
                aria-label={`${index}: ${label}`}
                aria-current={index === cursor ? "step" : undefined}
                disabled={disabled}
                onClick={() => onSeek(index)}
                onContextMenu={(event) => onContextMenu(event, index)}
              >
                {index === 0 ? (
                  <Layers size={16} />
                ) : (
                  <RibbonCommandIcon command={timelineCommand(label)} />
                )}
              </button>
            </li>
          ))}
        </ol>
        <span
          className="timeline-playhead"
          style={{ left: markerLeft }}
          role="slider"
          aria-label="Model timeline position"
          aria-valuemin={0}
          aria-valuemax={labels.length}
          aria-valuenow={cursor}
          aria-valuetext={cursor === 0 ? "Starting state" : labels[cursor - 1]}
          aria-disabled={disabled || !labels.length}
          tabIndex={disabled ? -1 : 0}
          title="Drag to move through model steps"
          onKeyDown={(event) => {
            if (disabled) return;
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? labels.length
                  : event.key === "ArrowLeft"
                    ? Math.max(0, cursor - 1)
                    : event.key === "ArrowRight"
                      ? Math.min(labels.length, cursor + 1)
                      : null;
            if (next !== null) {
              event.preventDefault();
              onSeek(next);
            }
          }}
          onPointerDown={(event) => {
            if (disabled || !labels.length || event.button !== 0) return;
            event.preventDefault();
            dragging.current = event.pointerId;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const element = track.current;
            if (disabled || dragging.current !== event.pointerId || !element)
              return;
            const rect = element.getBoundingClientRect();
            if (event.clientX < rect.left + 16) element.scrollLeft -= 16;
            if (event.clientX > rect.right - 16) element.scrollLeft += 16;
            const x = event.clientX - rect.left + element.scrollLeft;
            let closest = 0,
              distance = Infinity;
            element
              .querySelectorAll<HTMLElement>(".timeline-steps li")
              .forEach((item, index) => {
                const delta = Math.abs(
                  item.offsetLeft + item.offsetWidth + 8 - x,
                );
                if (delta < distance) {
                  distance = delta;
                  closest = index;
                }
              });
            onSeek(closest);
          }}
          onPointerUp={(event) => {
            dragging.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            dragging.current = null;
          }}
        />
      </div>
    </section>
  );
}
