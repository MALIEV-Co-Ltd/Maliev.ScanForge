import { useEffect, useRef } from "react";
import { Viewport } from "../viewport";
import {
  landmarkMarkers,
  landmarkReferenceEntities,
  type LandmarkAlignment,
} from "../landmark-alignment";
import type { Entity, Vec3 } from "../types";

export type LandmarkView = "moving" | "fixed";

function PickingView({
  side,
  session,
  theme,
  disabled,
  onPick,
  onRemovePoint,
  onRemoveLast,
  onClear,
  onViewport,
  onError,
}: {
  side: LandmarkView;
  session: LandmarkAlignment;
  theme: "light" | "dark";
  disabled: boolean;
  onPick: (entityId: string, point: Vec3) => void;
  onRemovePoint: (entityId: string, pointIndex: number) => void;
  onRemoveLast: (entityId: string) => void;
  onClear: (entityId: string) => void;
  onViewport: (side: LandmarkView, viewport: Viewport | null) => void;
  onError: (message: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewport = useRef<Viewport | null>(null);
  const callbacks = useRef({
    onPick,
    onRemovePoint,
    onViewport,
    onError,
    disabled,
  });
  callbacks.current = { onPick, onRemovePoint, onViewport, onError, disabled };
  const entity =
    side === "moving"
      ? session.moving
      : (session.fixed ?? landmarkReferenceEntities(session)[0]);
  const fitted = useRef<Entity | undefined>(undefined);
  useEffect(() => {
    try {
      const view = new Viewport(
        host.current!,
        (point, id) => {
          if (!callbacks.current.disabled) callbacks.current.onPick(id, point);
        },
        () => {},
      );
      viewport.current = view;
      callbacks.current.onViewport(side, view);
      return () => {
        callbacks.current.onViewport(side, null);
        viewport.current = null;
        view.dispose();
      };
    } catch (error) {
      callbacks.current.onError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }, [side]);
  useEffect(() => {
    const view = viewport.current;
    if (!view) return;
    view.setTheme(theme);
    view.setEntities(entity ? [entity] : [], null);
    view.setPickTarget(entity?.id ?? null);
    view.setAlignmentMarkers(
      landmarkMarkers({ ...session, preview: undefined }).filter(
        (marker, index) => session.picks[index].entityId === entity?.id,
      ),
      (pointIndex) => {
        if (entity && !callbacks.current.disabled)
          callbacks.current.onRemovePoint(entity.id, pointIndex);
      },
    );
    if (entity !== fitted.current) {
      fitted.current = entity;
      view.fitView();
    }
  }, [entity, session.picks, theme]);
  return (
    <section
      className="landmark-picking-view"
      aria-label={`${side === "moving" ? "Moving" : "Fixed"} alignment view`}
      data-landmark-view={side}
    >
      <header>
        <span>
          {side === "moving" ? "Moving" : "Fixed"} ·{" "}
          {entity?.name ?? "Choose a reference"}
        </span>
        <div className="landmark-view-actions">
          <button
            type="button"
            disabled={
              disabled ||
              !session.picks.some((pick) => pick.entityId === entity?.id)
            }
            aria-label={`Remove last ${side} point`}
            onClick={() => entity && onRemoveLast(entity.id)}
          >
            Undo point
          </button>
          <button
            type="button"
            disabled={
              disabled ||
              !session.picks.some((pick) => pick.entityId === entity?.id)
            }
            aria-label={`Clear ${side} points`}
            onClick={() => entity && onClear(entity.id)}
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => viewport.current?.fitView()}
            aria-label={`Fit ${side} alignment view`}
          >
            Fit
          </button>
        </div>
      </header>
      <div
        className="landmark-viewport"
        ref={host}
        tabIndex={0}
        aria-label={`${side} point picking canvas`}
      />
    </section>
  );
}

export function LandmarkPickingViews({
  onResize,
  ...props
}: Omit<Parameters<typeof PickingView>[0], "side"> & {
  onResize: (percent: number) => void;
}) {
  const dragging = useRef<number | null>(null);
  const percent = props.session.referenceWidthPercent ?? 32;
  return (
    <div className="landmark-picking-views">
      <div
        className="landmark-view-divider"
        role="separator"
        aria-label="Resize alignment views"
        aria-orientation="vertical"
        aria-valuemin={20}
        aria-valuemax={50}
        aria-valuenow={percent}
        aria-valuetext={`Picking views ${percent.toFixed(0)} percent`}
        aria-disabled={props.disabled}
        tabIndex={props.disabled ? -1 : 0}
        onPointerDown={(event) => {
          if (props.disabled || event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          dragging.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (props.disabled || dragging.current !== event.pointerId) return;
          const bounds = event.currentTarget
            .closest(".canvas-area")!
            .getBoundingClientRect();
          if (bounds.width)
            onResize(((bounds.right - event.clientX) / bounds.width) * 100);
        }}
        onPointerUp={(event) => {
          if (dragging.current !== event.pointerId) return;
          dragging.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onLostPointerCapture={() => {
          dragging.current = null;
        }}
        onPointerCancel={() => {
          dragging.current = null;
        }}
        onKeyDown={(event) => {
          if (props.disabled) return;
          const next =
            event.key === "ArrowLeft"
              ? percent + 2
              : event.key === "ArrowRight"
                ? percent - 2
                : event.key === "Home"
                  ? 20
                  : event.key === "End"
                    ? 50
                    : null;
          if (next === null) return;
          event.preventDefault();
          event.stopPropagation();
          onResize(next);
        }}
      />
      <PickingView {...props} side="fixed" />
      <PickingView {...props} side="moving" />
    </div>
  );
}
