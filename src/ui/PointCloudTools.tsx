import { useState } from "react";
import "./PointCloudTools.css";
import type { PointCloudEditRequest } from "../point-cloud-processing";

export function PointCloudTools({
  tool = "edit",
  count,
  selection,
  busy,
  onApply,
}: {
  tool?: "edit" | "reduce" | "noise";
  count: number;
  selection: Uint8Array | null;
  busy: boolean;
  onApply: (
    operation: Omit<PointCloudEditRequest, "kind" | "positions" | "normals">,
  ) => void;
}) {
  const [resolution, setResolution] = useState(0.5);
  const [target, setTarget] = useState(Math.max(1, Math.floor(count / 2)));
  const [iterations, setIterations] = useState(2);
  const [radius, setRadius] = useState(0.5);
  const [deviation, setDeviation] = useState(0.05);
  const [selectionOnly, setSelectionOnly] = useState(true);
  const hasSelection = !!selection?.some(Boolean);
  const mask = selectionOnly && hasSelection ? selection! : undefined;
  const editableCount = mask
    ? mask.reduce((sum, value) => sum + (value ? 1 : 0), 0)
    : count;
  return (
    <fieldset className="point-cloud-tools" disabled={busy}>
      <legend>
        {tool === "noise"
          ? "Reduce point noise"
          : tool === "reduce"
            ? "Reduce points"
            : "Point-cloud processing"}
      </legend>
      <label className="check">
        <input
          type="checkbox"
          checked={selectionOnly}
          onChange={(event) => setSelectionOnly(event.target.checked)}
        />
        Apply to selection only
      </label>
      <p>
        {selectionOnly && !hasSelection
          ? "Select points to process an area."
          : mask
            ? "Unselected points are preserved."
            : "Processing the entire point cloud."}
      </p>
      {tool !== "noise" && (
        <>
          {" "}
          <label>
            Point spacing (mm)
            <input
              aria-label="Point spacing (mm)"
              type="number"
              min="0.001"
              step="0.1"
              value={resolution}
              onChange={(event) => setResolution(event.target.valueAsNumber)}
            />
          </label>
          <button
            disabled={(selectionOnly && !hasSelection) || !(resolution > 0)}
            onClick={() =>
              onApply({
                action: "voxel",
                cellSize: resolution,
                selection: mask,
              })
            }
          >
            Simplify by spacing
          </button>
          <label>
            Target points
            <input
              aria-label="Target points"
              type="number"
              min="1"
              max={editableCount}
              value={target}
              onChange={(event) => setTarget(event.target.valueAsNumber)}
            />
          </label>
          <button
            disabled={
              (selectionOnly && !hasSelection) ||
              !(
                Number.isInteger(target) &&
                target >= 1 &&
                target <= editableCount
              )
            }
            onClick={() =>
              onApply({
                action: "sampleCount",
                targetPoints: target,
                selection: mask,
              })
            }
          >
            Reduce point count
          </button>
        </>
      )}
      {tool !== "reduce" && (
        <>
          {" "}
          <label>
            Neighbor radius (mm)
            <input
              aria-label="Neighbor radius (mm)"
              type="number"
              min="0.001"
              step="0.1"
              value={radius}
              onChange={(event) => setRadius(event.target.valueAsNumber)}
            />
          </label>
        </>
      )}
      {tool === "edit" && (
        <>
          {" "}
          <button
            disabled={!hasSelection || !(radius > 0)}
            onClick={() =>
              onApply({
                action: "connectedSelection",
                neighborRadius: radius,
                selection: selection ?? undefined,
              })
            }
          >
            Select connected points
          </button>
        </>
      )}
      {tool !== "reduce" && (
        <>
          {" "}
          <label>
            Smoothing iterations
            <input
              aria-label="Smoothing iterations"
              type="number"
              min="1"
              max="100"
              value={iterations}
              onChange={(event) => setIterations(event.target.valueAsNumber)}
            />
          </label>
          <label>
            Maximum deviation (mm)
            <input
              aria-label="Maximum deviation (mm)"
              type="number"
              min="0.001"
              step="0.01"
              value={deviation}
              onChange={(event) => setDeviation(event.target.valueAsNumber)}
            />
          </label>
          <button
            disabled={
              (selectionOnly && !hasSelection) ||
              !(radius > 0 && iterations >= 1 && deviation > 0)
            }
            onClick={() =>
              onApply({
                action: "smooth",
                neighborRadius: radius,
                iterations,
                deviation,
                selection: mask,
              })
            }
          >
            Reduce point noise
          </button>
        </>
      )}{" "}
      <p className="muted">
        Mesh decimation, hole filling and surface repatching require a
        reconstructed triangle mesh. To remove a scanned feature directly,
        select its points and delete them.
      </p>
    </fieldset>
  );
}
