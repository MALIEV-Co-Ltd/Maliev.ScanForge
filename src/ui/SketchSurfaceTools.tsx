import { useEffect, useRef, useState } from "react";
import type { Sketch } from "../sketch";
import { CadJobCancel } from "./CadJobCancel";

export interface SketchSurfaceToolsProps {
  sourceKey: string;
  sourceName?: string;
  sketch: Sketch;
  available: boolean;
  active: boolean;
  disabled: boolean;
  onCreate: (snapshot: Sketch, signal: AbortSignal) => Promise<unknown>;
  onError: (message: string) => void;
}

export function SketchSurfaceTools({
  sourceKey,
  sourceName,
  sketch,
  available,
  active,
  disabled,
  onCreate,
  onError,
}: SketchSurfaceToolsProps) {
  const running = useRef<AbortController | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  // Object selection changes when the result is published; only sketch ownership matters.
  useEffect(() => {
    setCreating(false);
    setMessage("");
    return () => {
      const owned = running.current;
      running.current = null;
      owned?.abort();
    };
  }, [sourceKey, sketch, active]);

  async function create() {
    if (!active || disabled || !available || running.current) return;
    const controller = new AbortController();
    running.current = controller;
    setCreating(true);
    setMessage("Creating exact surface…");
    try {
      await onCreate(structuredClone(sketch), controller.signal);
      if (running.current === controller && !controller.signal.aborted)
        setMessage("Exact surface created.");
    } catch (error) {
      if (running.current !== controller) return;
      if (controller.signal.aborted)
        setMessage("Sketch surface cancellation requested.");
      else {
        const text = error instanceof Error ? error.message : String(error);
        setMessage(text);
        onError(text);
      }
    } finally {
      if (running.current === controller) {
        running.current = null;
        setCreating(false);
      }
    }
  }

  if (!active) return null;
  const curves = [...sketch.segments, ...(sketch.arcs ?? [])].filter(
    (curve) => !curve.construction,
  ).length;
  return (
    <section
      className="tool-section sketch-surface-tools"
      aria-label="Surface from sketch"
    >
      <h3>Surface from sketch</h3>
      <p>
        <strong>{sourceName ?? "Current sketch"}</strong> · {curves} editable
        curves
      </p>
      <p className="muted">
        Create an exact planar surface from one closed profile. Construction
        curves and scan section references guide the profile and remain
        unchanged.
      </p>
      <p className="muted">
        Edit the surface's feature recipe to rebuild its sketch and dependent
        solids.
      </p>
      {!available && (
        <p>Add editable sketch curves before creating a surface.</p>
      )}
      <button
        className="accent"
        disabled={disabled || creating || !available}
        onClick={() => void create()}
      >
        Create surface
      </button>
      {creating && (
        <CadJobCancel
          label="Cancel sketch surface"
          onCancel={() => running.current?.abort()}
        />
      )}
      <p role="status">{message}</p>
    </section>
  );
}
