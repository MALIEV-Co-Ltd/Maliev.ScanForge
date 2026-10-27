import { AppSelect } from "./AppSelect";
import { useState } from "react";
import { coordinateSketchFrame } from "../sketch-frame";
import {
  datumFrame,
  ORIGIN_PLANES,
  PLANE_LABELS,
  type OriginPlane,
} from "../origin";
import type { Entity, Vec3 } from "../types";
import {
  isSketchPlaneSource,
  offsetSketchPlane,
  type SketchPlaneSelection,
  type CoordinateFramePlane,
} from "../sketch-plane-source";

export function SketchPlaneDialog({
  initialPlane,
  entities,
  onCreate,
  onCancel,
  onScanSection,
}: {
  initialPlane: OriginPlane;
  entities: Entity[];
  onCreate: (selection: SketchPlaneSelection) => void | Promise<void>;
  onCancel: () => void;
  onScanSection?: () => void;
}) {
  const [plane, setPlane] = useState<string>(initialPlane);
  const [offset, setOffset] = useState(0);
  const [framePlane, setFramePlane] = useState<CoordinateFramePlane>("XY");
  const [origin, setOrigin] = useState<Vec3>([0, 0, 0]);
  const [normal, setNormal] = useState<Vec3>([0, 0, 1]);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const fitted = entities.filter(isSketchPlaneSource);
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
          <AppSelect
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
              <option key={e.id} value={`source:${e.id}`}>
                {e.name}
              </option>
            ))}
            <option value="custom">Custom plane</option>
          </AppSelect>
        </label>
        {plane.startsWith("source:") &&
          entities.find((e) => e.id === plane.slice(7))?.kind ===
            "referenceFrame" && (
            <label className="select-field">
              Coordinate-system plane
              <AppSelect
                aria-label="Coordinate-system plane"
                value={framePlane}
                onChange={(e) =>
                  setFramePlane(e.target.value as CoordinateFramePlane)
                }
              >
                {["XY", "YZ", "XZ"].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </AppSelect>
            </label>
          )}
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
            disabled={creating}
            onClick={async () => {
              try {
                setError("");
                if (!Number.isFinite(offset))
                  throw new Error("Offset must be finite.");
                let selection: SketchPlaneSelection;
                if (plane.startsWith("source:"))
                  selection = {
                    planeSourceId: plane.slice(7),
                    normalOffset: offset,
                    ...(entities.find((e) => e.id === plane.slice(7))?.kind ===
                    "referenceFrame"
                      ? { framePlane }
                      : {}),
                  };
                else if (ORIGIN_PLANES.includes(plane as OriginPlane))
                  selection = {
                    frame: coordinateSketchFrame(plane as OriginPlane, offset),
                  };
                else if (plane === "custom")
                  selection = {
                    frame: offsetSketchPlane(
                      datumFrame(origin, normal),
                      offset,
                    ),
                  };
                else throw new Error("Select a sketch plane.");
                setCreating(true);
                await onCreate(selection);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setCreating(false);
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
