import { useEffect, useMemo, useState } from "react";
import { ReductionProgress, ReductionResults } from "./ReductionResults";
import type { ReductionStatistics } from "../reduction-report";
import type { Entity, Vec3 } from "../types";
import { mirrorReference, cylinderReference } from "../scan-tools-reference";
import { Field, VectorField } from "./controls";
import "./ScanToolsPanel.css";
import { NoiseComparisonLegend } from "./NoiseComparisonLegend";

export type ScanToolId =
  | "reducePolygons"
  | "reduceNoise"
  | "scaleMesh"
  | "flipNormals"
  | "repolygonize"
  | "averageMesh"
  | "mirrorMesh"
  | "unroll";
export type ScanToolParameters =
  | {
      kind: "reducePolygons";
      mode: "triangles" | "percentage" | "deviation";
      targetTriangles: number;
      percentage: number;
      deviation: number;
      measureDeviation?: boolean;
      paletteThreshold?: number;
    }
  | {
      kind: "reduceNoise";
      iterations: number;
      deviation: number;
      selectionOnly: boolean;
      applyBoundaryEdges?: boolean;
      measureDeviation?: boolean;
    }
  | { kind: "scaleMesh"; factor: number; center: Vec3 }
  | { kind: "flipNormals" }
  | { kind: "repolygonize"; resolution: number }
  | { kind: "averageMesh"; targetIds: string[]; tolerance: number }
  | {
      kind: "mirrorMesh";
      plane: "OXY" | "OYZ" | "OXZ" | "object";
      referenceId?: string;
    }
  | { kind: "unroll"; cylinderId: string; offsetDegrees: number };

export const scanToolTitles: Record<ScanToolId, string> = {
  reducePolygons: "Reduce polygons",
  reduceNoise: "Reduce noise",
  scaleMesh: "Scale mesh",
  flipNormals: "Flip normals",
  repolygonize: "Re-polygonize",
  averageMesh: "Average mesh",
  mirrorMesh: "Mirror mesh",
  unroll: "Unroll",
};

/** Gold is the input mesh; cyan shows the resulting geometry or direction. */
function ToolDiagram({ tool }: { tool: ScanToolId }) {
  return (
    <svg
      className="scan-tools-diagram"
      width="28"
      height="28"
      viewBox="0 0 28 28"
      aria-hidden="true"
      fill="none"
      strokeWidth="1.5"
      strokeLinejoin="round"
    >
      <path
        d="M3 7h15v14H3zM3 7l7 7 8-7M3 21l7-7 8 7M10 14v7"
        fill="#66522d"
        stroke="#f3c667"
      />
      {tool === "reducePolygons" && (
        <path d="M19 4h6v20h-6M20 10l4 4-4 4" stroke="#87d3e8" />
      )}
      {tool === "reduceNoise" && (
        <>
          <path d="m3 5 3-3 4 3 4-3 4 3M3 25c5-3 10-3 15 0" stroke="#87d3e8" />
        </>
      )}
      {tool === "scaleMesh" && (
        <path d="M21 3h4v4M25 3l-9 9M7 25H3v-4M3 25l7-7" stroke="#87d3e8" />
      )}
      {tool === "flipNormals" && (
        <path
          d="M13 12V2m-3 3 3-3 3 3M23 13v12m-3-3 3 3 3-3"
          stroke="#87d3e8"
        />
      )}
      {tool === "repolygonize" && (
        <path
          d="M3 14h15M6.5 7v14M14 7v14m-11 0 15-14M3 7l15 14"
          stroke="#87d3e8"
        />
      )}
      {tool === "averageMesh" && (
        <path d="M6 4h15v14M9 1h15v14M20 21h6m-3-3 3 3-3 3" stroke="#87d3e8" />
      )}
      {tool === "mirrorMesh" && (
        <>
          <path d="M20 2v24" stroke="#b59aeb" strokeDasharray="2 2" />
          <path d="m24 7 2 7-2 7" stroke="#87d3e8" />
        </>
      )}
      {tool === "unroll" && (
        <>
          <ellipse cx="21" cy="5" rx="4" ry="2" stroke="#87d3e8" />
          <path d="M17 5v17c0 3 8 3 8 0V5M17 23H7" stroke="#87d3e8" />
        </>
      )}
    </svg>
  );
}

export interface ScanToolsPanelProps {
  entities: Entity[];
  selected?: Entity;
  triangleSelection?: Uint8Array | null;
  tool: ScanToolId;
  disabled?: boolean;
  busy?: boolean;
  progress?: string;
  progressFraction?: number;
  result?: string;
  comparison?: {
    threshold: number;
    visible: boolean;
    statistics?: ReductionStatistics;
  };
  onToggleComparison?: () => void;
  onApply: (request: ScanToolParameters) => void;
  previewReady?: boolean;
  onAccept?: (options?: { createNewObject?: boolean }) => void;
  onInvalidatePreview?: () => void;
  onCompare?: (deviation: number, paletteThreshold: number) => void;
  onClose: () => void;
  onCancel: () => void;
  onPickReference?: (kind: "plane" | "cylinder") => void;
  pickedReferenceId?: string;
}

export function ScanToolsPanel({
  tool,
  selected,
  entities,
  triangleSelection,
  disabled = false,
  busy = false,
  progress,
  progressFraction,
  result,
  comparison,
  onToggleComparison,
  onApply,
  previewReady = false,
  onAccept,
  onInvalidatePreview,
  onCompare,
  onClose,
  onCancel,
  onPickReference,
  pickedReferenceId,
}: ScanToolsPanelProps) {
  const [mode, setMode] = useState<"triangles" | "percentage" | "deviation">(
    "percentage",
  );
  const [targetTriangles, setTargetTriangles] = useState(
    Math.max(1, Math.floor((selected?.positions.length ?? 18) / 18)),
  );
  const [percentage, setPercentage] = useState(50);
  const [deviation, setDeviation] = useState(0.05);
  const [iterations, setIterations] = useState(1);
  const [selectionOnly, setSelectionOnly] = useState(false);
  const [applyBoundaryEdges, setApplyBoundaryEdges] = useState(true);
  const [measureDeviation, setMeasureDeviation] = useState(false);
  function changeComparison(enabled: boolean) {
    setMeasureDeviation(enabled);
    if (enabled && onCompare) onCompare(deviation, paletteThreshold);
    else if (comparison?.visible && onToggleComparison) onToggleComparison();
  }
  const paletteThreshold = deviation;
  const [factor, setFactor] = useState(1);
  const [scaleMode, setScaleMode] = useState<"factor" | "percentage">("factor");
  const [center, setCenter] = useState<Vec3>([0, 0, 0]);
  const [createNewObject, setCreateNewObject] = useState(false);
  const [resolution, setResolution] = useState(0.5);
  const [tolerance, setTolerance] = useState(10);
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [plane, setPlane] = useState<"OXY" | "OYZ" | "OXZ" | "object">("OXY");
  const planes = useMemo(
    () =>
      tool === "mirrorMesh"
        ? entities.filter(
            (e) => e.id !== selected?.id && mirrorReference(e) !== null,
          )
        : [],
    [entities, selected?.id, tool],
  );
  const cylinders = useMemo(
    () =>
      tool === "unroll"
        ? entities.filter(
            (e) => e.id !== selected?.id && cylinderReference(e) !== null,
          )
        : [],
    [entities, selected?.id, tool],
  );
  const targets = entities.filter(
    (e) =>
      e.id !== selected?.id &&
      e.kind === "mesh" &&
      !e.kernelId &&
      !e.parametric &&
      e.positions.length >= 9,
  );
  const [referenceId, setReferenceId] = useState(planes[0]?.id ?? "");
  const [cylinderId, setCylinderId] = useState(cylinders[0]?.id ?? "");
  const [offsetDegrees, setOffsetDegrees] = useState(0);
  useEffect(() => {
    if (!pickedReferenceId) return;
    if (tool === "mirrorMesh") {
      setPlane("object");
      setReferenceId(pickedReferenceId);
    }
    if (tool === "unroll") setCylinderId(pickedReferenceId);
  }, [pickedReferenceId, tool]);
  const count = Math.floor((selected?.positions.length ?? 0) / 9);
  const positive = (n: number) => Number.isFinite(n) && n > 0;
  let problem = !selected
    ? "Select a mesh to use this tool."
    : selected.kernelId || selected.parametric || selected.kind !== "mesh"
      ? "Create an explicit mesh copy of the CAD object before using mesh tools."
      : "";
  if (!problem && count === 0) problem = "The selected mesh has no triangles.";
  if (!problem) {
    if (
      tool === "reducePolygons" &&
      ((mode === "triangles" &&
        (!Number.isInteger(targetTriangles) ||
          targetTriangles < 1 ||
          targetTriangles >= count)) ||
        (mode === "percentage" &&
          (!positive(percentage) || percentage >= 100)) ||
        (mode === "deviation" && !positive(deviation)) ||
        !positive(deviation) ||
        !positive(paletteThreshold))
    )
      problem =
        "Choose a smaller triangle count, a percentage between 0 and 100, or a positive deviation.";
    if (
      tool === "reduceNoise" &&
      (!Number.isInteger(iterations) ||
        iterations < 1 ||
        iterations > 5 ||
        (measureDeviation && !positive(deviation)))
    )
      problem = "Use 1–5 iterations and a positive comparison threshold.";
    if (
      tool === "reduceNoise" &&
      selectionOnly &&
      !triangleSelection?.some(Boolean)
    )
      problem = "Select triangles before applying to selection only.";
    if (
      tool === "scaleMesh" &&
      (!positive(factor) || !center.every(Number.isFinite))
    )
      problem = "Enter a positive scale factor and finite center coordinates.";
    if (tool === "repolygonize" && !positive(resolution))
      problem = "Point resolution must be greater than zero.";
    if (
      tool === "averageMesh" &&
      (!positive(tolerance) ||
        !targetIds.some((id) => targets.some((e) => e.id === id)))
    )
      problem = targets.length
        ? "Choose at least one reference mesh and a positive search tolerance."
        : "Add another mesh to average with.";
    if (
      tool === "mirrorMesh" &&
      plane === "object" &&
      !planes.some((e) => e.id === referenceId)
    )
      problem = "Select a fitted plane or planar construction object.";
    if (
      tool === "unroll" &&
      (!cylinders.some((e) => e.id === cylinderId) ||
        !Number.isFinite(offsetDegrees))
    )
      problem =
        "Select a fitted cylinder with a valid radius and enter a finite angle.";
  }
  const blocked = disabled || busy || !!problem;
  function apply() {
    if (blocked) return;
    switch (tool) {
      case "reducePolygons":
        onApply({
          kind: tool,
          mode,
          targetTriangles,
          percentage,
          deviation,
          measureDeviation: true,
          paletteThreshold: deviation,
        });
        break;
      case "reduceNoise":
        onApply({
          kind: tool,
          iterations,
          deviation,
          selectionOnly,
          applyBoundaryEdges,
          measureDeviation,
        });
        break;
      case "scaleMesh":
        onApply({
          kind: tool,
          factor: scaleMode === "percentage" ? factor / 100 : factor,
          center,
        });
        break;
      case "flipNormals":
        onApply({ kind: tool });
        break;
      case "repolygonize":
        onApply({ kind: tool, resolution });
        break;
      case "averageMesh":
        onApply({
          kind: tool,
          targetIds: targetIds.filter((id) => targets.some((e) => e.id === id)),
          tolerance,
        });
        break;
      case "mirrorMesh":
        onApply({
          kind: tool,
          plane,
          referenceId: plane === "object" ? referenceId : undefined,
        });
        break;
      case "unroll":
        onApply({ kind: tool, cylinderId, offsetDegrees });
        break;
    }
  }
  return (
    <section className="scan-tools-panel" aria-label={scanToolTitles[tool]}>
      <header>
        <ToolDiagram tool={tool} />
        <h3>{scanToolTitles[tool]}</h3>
        <button aria-label="Close scan tool" disabled={busy} onClick={onClose}>
          ×
        </button>
      </header>
      <p className="scan-tools-summary">
        {selected
          ? `${selected.name} · ${count.toLocaleString()} triangles`
          : "No mesh selected"}
      </p>
      <fieldset disabled={busy || disabled}>
        {tool === "reducePolygons" && (
          <>
            <label>
              Reduce by
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as typeof mode)}
              >
                <option value="triangles">Number of triangles</option>
                <option value="percentage">Percentage remaining</option>
                <option value="deviation">Deviation from original</option>
              </select>
            </label>
            {mode === "triangles" && (
              <Field
                label="Target triangles"
                value={targetTriangles}
                min={1}
                max={count - 1}
                onChange={setTargetTriangles}
              />
            )}
            {mode === "percentage" && (
              <Field
                label="Triangles remaining (%)"
                value={percentage}
                min={0.001}
                max={99.999}
                step={1}
                onChange={setPercentage}
              />
            )}
            {mode === "deviation" && (
              <Field
                label="Maximum deviation (mm)"
                value={deviation}
                min={0.001}
                step={0.01}
                onChange={setDeviation}
              />
            )}
            {mode !== "deviation" && (
              <Field
                label="Comparison tolerance (mm)"
                value={deviation}
                min={0.001}
                step={0.01}
                onChange={setDeviation}
              />
            )}
          </>
        )}
        {tool === "reduceNoise" && (
          <>
            <Field
              label="Smooth iterations"
              value={iterations}
              min={1}
              max={5}
              onChange={setIterations}
            />
            <label className="scan-tools-check">
              <input
                type="checkbox"
                checked={selectionOnly}
                onChange={(e) => setSelectionOnly(e.target.checked)}
              />
              Apply to selection only
            </label>
            <label className="scan-tools-check">
              <input
                type="checkbox"
                checked={applyBoundaryEdges}
                onChange={(e) => setApplyBoundaryEdges(e.target.checked)}
              />
              Smooth boundary edges
            </label>
            <label className="scan-tools-check">
              <input
                type="checkbox"
                checked={measureDeviation}
                disabled={!!onAccept && !previewReady}
                onChange={(e) => changeComparison(e.target.checked)}
              />
              Measure deviation from original
            </label>
            {measureDeviation && (
              <>
                <Field
                  label="Comparison threshold (mm)"
                  value={deviation}
                  min={0.001}
                  step={0.01}
                  onChange={setDeviation}
                />
                <p className="scan-tools-note">
                  Measures original vertices against the smoothed surface
                  without limiting smoothing.
                </p>
              </>
            )}
          </>
        )}
        {tool === "scaleMesh" && (
          <>
            <label>
              Scale by
              <select
                value={scaleMode}
                onChange={(event) => {
                  const next = event.target.value as typeof scaleMode;
                  if (next !== scaleMode)
                    setFactor((value) =>
                      next === "percentage" ? value * 100 : value / 100,
                    );
                  setScaleMode(next);
                }}
              >
                <option value="factor">Factor</option>
                <option value="percentage">Percentage</option>
              </select>
            </label>
            <Field
              label={scaleMode === "percentage" ? "Scale (%)" : "Scale factor"}
              value={factor}
              min={0.001}
              step={0.1}
              onChange={setFactor}
            />
            <VectorField
              label="Scale center (mm)"
              value={center}
              onChange={setCenter}
            />
            <label>
              <input
                type="checkbox"
                checked={createNewObject}
                onChange={(event) => setCreateNewObject(event.target.checked)}
              />
              Create new object
            </label>
          </>
        )}
        {tool === "flipNormals" && (
          <p>Reverse the winding and normal direction of every triangle.</p>
        )}
        {tool === "repolygonize" && (
          <>
            <Field
              label="Point resolution (mm)"
              value={resolution}
              min={0.001}
              step={0.1}
              onChange={setResolution}
            />
            <p className="muted">
              Voxel reconstruction closes small gaps and fills enclosed
              cavities. Open scans become thick shells; the surface can move by
              about 0.75 × point resolution. Undo restores the original.
            </p>
          </>
        )}
        {tool === "averageMesh" && (
          <>
            <Field
              label="Search tolerance (mm)"
              value={tolerance}
              min={0.001}
              step={0.1}
              onChange={setTolerance}
            />
            <div
              className="scan-tools-references"
              aria-label="Reference meshes"
            >
              {targets.map((e) => (
                <label className="scan-tools-check" key={e.id}>
                  <input
                    type="checkbox"
                    checked={targetIds.includes(e.id)}
                    onChange={(event) =>
                      setTargetIds((current) =>
                        event.target.checked
                          ? [...current, e.id]
                          : current.filter((id) => id !== e.id),
                      )
                    }
                  />
                  {e.name}
                </label>
              ))}
            </div>
          </>
        )}
        {tool === "mirrorMesh" && (
          <>
            <label>
              <input
                type="checkbox"
                checked={createNewObject}
                onChange={(event) => setCreateNewObject(event.target.checked)}
              />
              Create new object
            </label>
            <label>
              Mirror plane
              <select
                value={plane}
                onChange={(e) => {
                  setPlane(e.target.value as typeof plane);
                  onInvalidatePreview?.();
                }}
              >
                <option value="OXY">XY origin plane</option>
                <option value="OYZ">YZ origin plane</option>
                <option value="OXZ">XZ origin plane</option>
                <option value="object">CAD / construction plane</option>
              </select>
            </label>
            {plane === "object" && (
              <>
                <label>
                  Reference plane
                  <select
                    value={referenceId}
                    onChange={(e) => {
                      setReferenceId(e.target.value);
                      onInvalidatePreview?.();
                    }}
                  >
                    <option value="">Choose plane…</option>
                    {planes.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </label>
                {onPickReference && (
                  <button
                    type="button"
                    onClick={() => {
                      onInvalidatePreview?.();
                      onPickReference("plane");
                    }}
                  >
                    Pick plane on canvas
                  </button>
                )}
              </>
            )}
          </>
        )}
        {tool === "unroll" && (
          <>
            <p className="muted">
              Unroll cylindrical side surfaces into local XY. Remove end caps
              first; cap faces cannot be flattened without collapsing.
            </p>
            <label>
              Cylinder
              <select
                value={cylinderId}
                onChange={(e) => setCylinderId(e.target.value)}
              >
                <option value="">Choose cylinder…</option>
                {cylinders.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            {onPickReference && (
              <button type="button" onClick={() => onPickReference("cylinder")}>
                Pick cylinder on canvas
              </button>
            )}
            <Field
              label="Angular offset (degrees)"
              value={offsetDegrees}
              step={1}
              onChange={setOffsetDegrees}
            />
          </>
        )}
      </fieldset>
      {problem && (
        <p className="scan-tools-message" role="status">
          {problem}
        </p>
      )}
      {tool === "reducePolygons" && progressFraction !== undefined ? (
        <ReductionProgress
          fraction={progressFraction}
          stage={progress || "Preparing polygon reduction"}
        />
      ) : (
        progress && <p role="status">{progress}</p>
      )}
      {result && tool !== "reducePolygons" && <p role="status">{result}</p>}
      {tool === "reducePolygons" && comparison?.statistics && (
        <ReductionResults statistics={comparison.statistics} />
      )}
      {onCompare && tool !== "reducePolygons" && measureDeviation && (
        <button
          disabled={
            busy ||
            !previewReady ||
            !positive(deviation) ||
            !positive(paletteThreshold)
          }
          onClick={() => onCompare(deviation, paletteThreshold)}
        >
          Update comparison
        </button>
      )}
      {tool === "reduceNoise" && comparison && onToggleComparison && (
        <NoiseComparisonLegend
          {...comparison}
          resultKind="smoothed"
          onToggle={onToggleComparison}
        />
      )}
      {tool === "reducePolygons" && comparison && onToggleComparison && (
        <button aria-pressed={comparison.visible} onClick={onToggleComparison}>
          {comparison.visible ? "Show reduced mesh" : "Show deviation"}
        </button>
      )}
      <footer>
        {busy ? (
          <button onClick={onCancel}>Cancel operation</button>
        ) : (
          <button onClick={onClose}>{onAccept ? "Cancel" : "Close"}</button>
        )}
        <button disabled={blocked} onClick={apply}>
          {onAccept ? "Preview" : "Apply"}
        </button>
        {onAccept && (
          <button
            disabled={
              busy ||
              !previewReady ||
              (tool === "reducePolygons" && !comparison?.statistics)
            }
            onClick={() =>
              onAccept(
                tool === "scaleMesh" || tool === "mirrorMesh"
                  ? { createNewObject }
                  : undefined,
              )
            }
          >
            Accept
          </button>
        )}
      </footer>
    </section>
  );
}
