import { GeneratedIcon } from "./GeneratedIcon";
import { AppSelect } from "./AppSelect";
import { PreviewButton } from "./PreviewButton";
import { ReductionModeSelect } from "./ReductionModeSelect";
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
  | "shrinkwrap"
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
  | {
      kind: "shrinkwrap";
      sampleInterval: number;
      gapFill: number;
      organicShape: boolean;
      extraThickness: number;
      maxDeviation: number;
      scope: "whole" | "selected" | "isolated";
      targetIds?: string[];
    }
  | { kind: "repolygonize"; resolution: number; targetIds?: string[] }
  | { kind: "averageMesh"; targetIds: string[]; tolerance: number }
  | {
      kind: "mirrorMesh";
      plane: "OXY" | "OYZ" | "OXZ" | "object";
      referenceId?: string;
    }
  | {
      kind: "unroll";
      cylinderId: string;
      offsetDegrees: number;
      instances?: number;
    };

export const scanToolTitles: Record<ScanToolId, string> = {
  reducePolygons: "Reduce polygons",
  reduceNoise: "Reduce noise",
  scaleMesh: "Scale mesh",
  flipNormals: "Flip normals",
  shrinkwrap: "ShrinkWrap",
  repolygonize: "Re-polygonize",
  averageMesh: "Average mesh",
  mirrorMesh: "Mirror mesh",
  unroll: "Unroll",
};

function ToolDiagram({ tool }: { tool: ScanToolId }) {
  return (
    <GeneratedIcon
      asset={`ribbon-${tool}`}
      size={28}
      className="scan-tools-diagram"
    />
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
  previewSettings?: import("../scan-preview-request").ScanPreviewParameters;
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
  previewSettings,
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
    if (enabled && previewReady && onCompare)
      onCompare(deviation, paletteThreshold);
    else if (comparison?.visible && onToggleComparison) onToggleComparison();
  }
  const paletteThreshold = deviation;
  const [factor, setFactor] = useState(1);
  const [scaleMode, setScaleMode] = useState<"factor" | "percentage">("factor");
  const [center, setCenter] = useState<Vec3>([0, 0, 0]);
  const [createNewObject, setCreateNewObject] = useState(false);
  const [sampleInterval, setSampleInterval] = useState(0.5);
  const [gapFill, setGapFill] = useState(0);
  const [organicShape, setOrganicShape] = useState(false);
  const [extraThickness, setExtraThickness] = useState(0);
  const [maxDeviation, setMaxDeviation] = useState(0.1);
  const [scope, setScope] = useState<"whole" | "selected" | "isolated">(
    "whole",
  );
  const [resolution, setResolution] = useState(0.5);
  const [tolerance, setTolerance] = useState(10);
  const [targetIds, setTargetIds] = useState<string[]>([]);
  useEffect(() => {
    if (!previewSettings) return;
    if (previewSettings.kind === "shrinkwrap") {
      setSampleInterval(previewSettings.sampleInterval ?? 0.5);
      setGapFill(previewSettings.gapFill ?? 0);
      setOrganicShape(previewSettings.organicShape ?? false);
      setExtraThickness(previewSettings.extraThickness ?? 0);
      setMaxDeviation(previewSettings.maxDeviation ?? 0.1);
      setScope(previewSettings.scope ?? "whole");
      setTargetIds(previewSettings.targetIds ?? []);
    } else if (previewSettings.kind === "reduceNoise") {
      setIterations(previewSettings.iterations ?? 1);
      setDeviation(previewSettings.deviation ?? 0.05);
      setSelectionOnly(previewSettings.selectionOnly ?? false);
      setApplyBoundaryEdges(previewSettings.applyBoundaryEdges ?? true);
      setMeasureDeviation(previewSettings.measureDeviation ?? false);
    } else if (previewSettings.kind === "reducePolygons") {
      setMode(previewSettings.mode);
      setTargetTriangles(previewSettings.targetTriangles ?? 100000);
      setPercentage(previewSettings.percentage ?? 50);
      setDeviation(previewSettings.deviation ?? 0.05);
    } else if (previewSettings.kind === "scaleMesh") {
      setFactor(previewSettings.factor);
      setCenter(previewSettings.center ?? [0, 0, 0]);
    } else {
      setPlane(previewSettings.plane);
      setReferenceId(previewSettings.referenceId ?? "");
    }
  }, [previewSettings]);
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
  const [instances, setInstances] = useState(1);
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
    if (
      tool === "shrinkwrap" &&
      (!positive(sampleInterval) ||
        !positive(maxDeviation) ||
        !Number.isFinite(gapFill) ||
        gapFill < 0 ||
        !Number.isFinite(extraThickness) ||
        extraThickness < 0)
    )
      problem =
        "Use positive sample interval and maximum deviation, and nonnegative gap fill and thickness.";
    if (
      tool === "shrinkwrap" &&
      scope === "selected" &&
      !triangleSelection?.some(
        (value, index) =>
          !!value && !selected?.meshSelection?.hidden.includes(index),
      )
    )
      problem = "Select visible triangles before local ShrinkWrap.";
    if (
      tool === "shrinkwrap" &&
      scope === "isolated" &&
      !selected?.meshSelection?.hidden.length
    )
      problem =
        "Isolate triangles or hide a subset before using isolated scope.";
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
        !Number.isFinite(offsetDegrees) ||
        !Number.isSafeInteger(instances) ||
        instances < 1)
    )
      problem =
        "Select a fitted cylinder, enter a finite angle and a positive whole instance count.";
  }
  const blocked = disabled || busy || !!problem;
  const readyToAccept =
    previewReady && (tool !== "reducePolygons" || !!comparison?.statistics);
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
      case "shrinkwrap":
        onApply({
          kind: tool,
          sampleInterval,
          gapFill,
          organicShape,
          extraThickness,
          maxDeviation,
          scope,
          targetIds: scope === "whole" ? targetIds : undefined,
        });
        break;
      case "repolygonize":
        onApply({ kind: tool, resolution, targetIds });
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
        onApply({ kind: tool, cylinderId, offsetDegrees, instances });
        break;
    }
  }
  return (
    <section
      className="scan-tools-panel tool-panel"
      aria-label={scanToolTitles[tool]}
    >
      <header>
        <ToolDiagram tool={tool} />
        <h3>{scanToolTitles[tool]}</h3>
        <button aria-label="Close scan tool" disabled={busy} onClick={onClose}>
          ×
        </button>
      </header>
      <div className="tool-panel-content">
        {selected && (
          <div className="scan-tools-summary">
            <span>Triangles</span>
            <strong>{count.toLocaleString()}</strong>
          </div>
        )}
        <fieldset
          disabled={busy || disabled}
          onChange={() => onInvalidatePreview?.()}
        >
          {tool === "reducePolygons" && (
            <>
              <ReductionModeSelect
                value={mode}
                disabled={busy || disabled}
                onChange={(value) => {
                  setMode(value);
                  onInvalidatePreview?.();
                }}
              />
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
                  onChange={(e) => {
                    e.stopPropagation();
                    changeComparison(e.target.checked);
                  }}
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
                <AppSelect
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
                </AppSelect>
              </label>
              <Field
                label={
                  scaleMode === "percentage" ? "Scale (%)" : "Scale factor"
                }
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
                  onChange={(event) => {
                    event.stopPropagation();
                    setCreateNewObject(event.target.checked);
                  }}
                />
                Create new object
              </label>
            </>
          )}
          {tool === "flipNormals" && (
            <p>Reverse the winding and normal direction of every triangle.</p>
          )}
          {tool === "shrinkwrap" && (
            <>
              <Field
                label="Sample interval (mm)"
                value={sampleInterval}
                min={0.001}
                step={0.1}
                onChange={setSampleInterval}
              />
              <Field
                label="Gap fill (mm)"
                value={gapFill}
                min={0}
                step={0.1}
                onChange={setGapFill}
              />
              <label>
                <input
                  type="checkbox"
                  checked={organicShape}
                  onChange={(e) => setOrganicShape(e.target.checked)}
                />
                Organic shape
              </label>
              <Field
                label="Add extra thickness (mm)"
                value={extraThickness}
                min={0}
                step={0.1}
                onChange={setExtraThickness}
              />
              <Field
                label="Maximum surface deviation (mm)"
                value={maxDeviation}
                min={0.001}
                step={0.01}
                onChange={setMaxDeviation}
              />
              <label>
                Scope
                <AppSelect
                  value={scope}
                  onChange={(e) => {
                    setScope(e.target.value as typeof scope);
                    onInvalidatePreview?.();
                  }}
                >
                  <option value="whole">Whole mesh object</option>
                  <option value="selected">Selected triangles</option>
                  <option value="isolated">Isolated visible triangles</option>
                </AppSelect>
              </label>
              {scope === "whole" &&
                targets
                  .filter((e) => e.visible)
                  .map((e) => (
                    <label key={e.id}>
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
              <label>
                <input
                  type="checkbox"
                  checked={createNewObject}
                  onChange={(event) => {
                    event.stopPropagation();
                    setCreateNewObject(event.target.checked);
                  }}
                />
                Create new object
              </label>
              <p>
                Sample spacing controls detail. Thickness adds outward offset
                and tapers at a local fixed seam. Gap fill can close intentional
                separations; inspect the preview. Fit tolerance checks supported
                output vertices and sampled source coverage; it is not a
                certified global error bound. Local wrapping leaves unrelated
                parent holes unchanged.
              </p>
            </>
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
              <p>Additional aligned meshes (optional; retained unchanged)</p>
              <div
                className="scan-tools-references"
                aria-label="Additional reconstruction meshes"
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
              <p className="muted">
                Voxel reconstruction closes small gaps and fills enclosed
                cavities. Open scans become thick shells; the surface can move
                by about 0.75 times point resolution. Results are checked for
                closed, manifold topology; separated regions can remain separate
                closed components. Self-intersections are not checked. Undo
                restores the original. Finer spacing retains smaller details; it
                is not a maximum-deviation tolerance. Reconstruction supports up
                to one billion grid points and sixteen million output triangles.
              </p>
            </>
          )}
          {tool === "averageMesh" && (
            <>
              <p className="hint">
                Creates a new mesh using the input with the most facets. All
                inputs are retained; reference contributions follow object-list
                order. Open boundary hits are excluded.
              </p>
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
                  onChange={(event) => {
                    event.stopPropagation();
                    setCreateNewObject(event.target.checked);
                  }}
                />
                Create new object
              </label>
              <label>
                Mirror plane
                <AppSelect
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
                </AppSelect>
              </label>
              {plane === "object" && (
                <>
                  <label>
                    Reference plane
                    <AppSelect
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
                    </AppSelect>
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
                first; cap faces cannot be flattened without collapsing. Facets
                crossing the angular seam are removed. Instances repeat the
                flattened surface along the arc-length axis.
              </p>
              <label>
                Cylinder
                <AppSelect
                  value={cylinderId}
                  onChange={(e) => setCylinderId(e.target.value)}
                >
                  <option value="">Choose cylinder…</option>
                  {cylinders.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </AppSelect>
              </label>
              {onPickReference && (
                <button
                  type="button"
                  onClick={() => onPickReference("cylinder")}
                >
                  Pick cylinder on canvas
                </button>
              )}
              <Field
                label="Angular offset (degrees)"
                value={offsetDegrees}
                step={1}
                onChange={setOffsetDegrees}
              />
              <Field
                label="Instances"
                value={instances}
                step={1}
                onChange={setInstances}
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
        {onCompare && tool === "shrinkwrap" && (
          <button
            disabled={busy || !previewReady || !positive(maxDeviation)}
            onClick={() => onCompare(maxDeviation, maxDeviation)}
          >
            Compare to source
          </button>
        )}
        {tool === "shrinkwrap" && comparison && onToggleComparison && (
          <button
            aria-pressed={comparison.visible}
            onClick={onToggleComparison}
          >
            {comparison.visible ? "Show wrapped mesh" : "Show source deviation"}
          </button>
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
        {tool === "reducePolygons" &&
          (mode !== "deviation" || comparison?.statistics) && (
            <section
              className="scan-tools-deviation"
              aria-label="Deviation comparison"
            >
              <h4>Deviation comparison</h4>
              {mode !== "deviation" && (
                <fieldset
                  disabled={busy || disabled}
                  onChange={() => onInvalidatePreview?.()}
                >
                  <Field
                    label="Comparison tolerance (mm)"
                    value={deviation}
                    min={0.001}
                    step={0.01}
                    onChange={setDeviation}
                  />
                </fieldset>
              )}
              {comparison?.statistics && (
                <ReductionResults statistics={comparison.statistics} />
              )}
              {comparison && onToggleComparison && (
                <button
                  aria-pressed={comparison.visible}
                  onClick={onToggleComparison}
                >
                  {comparison.visible ? "Show reduced mesh" : "Show deviation"}
                </button>
              )}
            </section>
          )}
      </div>
      <footer className="tool-panel-actions">
        {onAccept && <PreviewButton disabled={blocked} onClick={apply} />}
        {busy ? (
          <button onClick={onCancel}>Cancel operation</button>
        ) : (
          <button onClick={onClose}>{onAccept ? "Cancel" : "Close"}</button>
        )}
        {!onAccept && (
          <button disabled={blocked} onClick={apply}>
            Apply
          </button>
        )}
        {onAccept && (
          <button
            disabled={blocked}
            onClick={() =>
              readyToAccept
                ? onAccept(
                    tool === "scaleMesh" ||
                      tool === "mirrorMesh" ||
                      tool === "shrinkwrap"
                      ? { createNewObject }
                      : undefined,
                  )
                : apply()
            }
          >
            {readyToAccept ? "Accept" : "Preview"}
          </button>
        )}
      </footer>
    </section>
  );
}
