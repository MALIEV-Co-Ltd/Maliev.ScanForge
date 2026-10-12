import { useState } from "react";
import { coordinateSketchFrame, type SketchFrame } from "../sketch-frame";
import {
  datumFrame,
  ORIGIN_PLANES,
  PLANE_LABELS,
  type OriginPlane,
} from "../origin";
import type { Entity, Vec3 } from "../types";

export function SketchPlaneDialog({
  initialPlane,
  entities,
  onCreate,
  onCancel,
  onScanSection,
}: {
  initialPlane: OriginPlane;
  entities: Entity[];
  onCreate: (frame: SketchFrame) => void;
  onCancel: () => void;
  onScanSection?: () => void;
}) {
  const [plane, setPlane] = useState<string>(initialPlane);
  const [offset, setOffset] = useState(0);
  const [origin, setOrigin] = useState<Vec3>([0, 0, 0]);
  const [normal, setNormal] = useState<Vec3>([0, 0, 1]);
  const [error, setError] = useState("");
  const fitted = entities.filter(
    (e) => e.kind === "plane" && e.fit?.kind === "plane",
  );
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sketch-plane-title"
      >
        <h2 id="sketch-plane-title">Create sketch on a plane</h2>
        <label className="select-field">
          Sketch plane
          <select
            autoFocus
            value={plane}
            onChange={(e) => setPlane(e.target.value)}
          >
            {ORIGIN_PLANES.map((p) => (
              <option key={p} value={p}>
                {PLANE_LABELS[p]} · world origin
              </option>
            ))}
            {fitted.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
            <option value="custom">Custom plane</option>
          </select>
        </label>
        {plane === "custom" &&
          ["origin", "normal"].map((kind) => (
            <fieldset key={kind}>
              <legend>
                {kind === "origin" ? "Plane origin (mm)" : "Plane normal"}
              </legend>
              {["X", "Y", "Z"].map((axis, i) => (
                <label className="field" key={axis}>
                  {`${kind} ${axis}`}
                  <input
                    aria-label={`${kind} ${axis}`}
                    type="number"
                    value={(kind === "origin" ? origin : normal)[i]}
                    onChange={(e) => {
                      const next = [
                        ...(kind === "origin" ? origin : normal),
                      ] as Vec3;
                      next[i] = Number(e.target.value);
                      (kind === "origin" ? setOrigin : setNormal)(next);
                    }}
                  />
                </label>
              ))}
            </fieldset>
          ))}
        <label className="field">
          Normal offset (mm)
          <input
            type="number"
            value={offset}
            onChange={(e) => setOffset(Number(e.target.value))}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="import-unit-actions">
          <button onClick={onCancel}>Cancel</button>
          {onScanSection && (
            <button onClick={onScanSection}>Use scan section</button>
          )}
          <button
            className="accent"
            onClick={() => {
              try {
                if (!Number.isFinite(offset))
                  throw new Error("Offset must be finite.");
                let frame: SketchFrame;
                if (ORIGIN_PLANES.includes(plane as OriginPlane))
                  frame = coordinateSketchFrame(plane as OriginPlane, offset);
                else {
                  const fit = fitted.find((e) => e.id === plane)?.fit;
                  frame = datumFrame(
                    plane === "custom" ? origin : fit!.center,
                    plane === "custom" ? normal : fit!.axis,
                  );
                  frame.origin = frame.origin.map(
                    (n, i) => n + frame.normal[i] * offset,
                  ) as Vec3;
                }
                onCreate(frame);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            Create sketch
          </button>
        </div>
      </section>
    </div>
  );
}
