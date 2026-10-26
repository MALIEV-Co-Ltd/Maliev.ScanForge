import type { ParametricProfile } from "../parametric";
import { AppSelect } from "./AppSelect";
import { useEffect, useMemo, useRef, useState } from "react";
import { coordinateSketchFrame } from "../sketch-frame";
import {
  applySketchEditIntent,
  type SketchConstraintIntent,
  type SketchEditIntent,
  type SketchEditReceipt,
} from "../sketch-edit-intent";
import { cornerTrimSketch, type SketchCornerSelection } from "../sketch-corner";
import { filletSketchCorner, type SketchFilletRequest } from "../sketch-fillet";
import { mirrorSketch, type SketchMirrorRequest } from "../sketch-mirror";
import type { SketchDrawingTool } from "../sketch-drawing";
import {
  inspectSketchDiagnostics,
  sampleSketchArc,
  type Sketch,
  type SketchConstraint,
} from "../sketch";

export interface SketchToolsProps {
  value?: Sketch;
  onChange?: (sketch: Sketch) => void;
  onEdit?: (
    intent: SketchEditIntent,
  ) => SketchEditReceipt | Promise<SketchEditReceipt>;
  onCornerTrim?: (options: SketchCornerSelection) => void | Promise<void>;
  onCornerFillet?: (options: SketchFilletRequest) => void | Promise<void>;
  onMirror?: (options: SketchMirrorRequest) => void | Promise<void>;
  onExtrude: (profile: ParametricProfile, height: number) => void;
  disabled?: boolean;
  drawingTool?: SketchDrawingTool;
  onDrawingTool?: (tool: SketchDrawingTool) => void;
  trimRadiusMm?: number;
  onTrimRadiusMm?: (radius: number) => void;
  drawingConstraints?: boolean;
  onDrawingConstraints?: (enabled: boolean) => void;
  onNormalView?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  showControlPoints?: boolean;
  onShowControlPoints?: (enabled: boolean) => void;
  showMeshPoints?: boolean;
  onShowMeshPoints?: (enabled: boolean) => void;
}

const constraintLabel = (kind: string) =>
  kind === "horizontalDistance"
    ? "Horizontal distance"
    : kind === "verticalDistance"
      ? "Vertical distance"
      : kind;

/** Preserve incomplete numeric text and focus until the user accepts an edit. */
function SketchNumberInput({
  value,
  resetKey,
  label,
  disabled,
  onCommit,
}: {
  value: number;
  resetKey: Sketch;
  label?: string;
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const dirty = useRef(false);
  useEffect(() => {
    dirty.current = false;
    setText(String(value));
  }, [value, resetKey]);
  return (
    <input
      type="number"
      aria-label={label}
      value={text}
      disabled={disabled}
      onChange={(event) => {
        dirty.current = true;
        setText(event.currentTarget.value);
      }}
      onBlur={(event) => {
        if (!dirty.current) return;
        dirty.current = false;
        const next =
          event.currentTarget.value.trim() === ""
            ? NaN
            : Number(event.currentTarget.value);
        setText(String(value));
        if (!Object.is(next, value)) onCommit(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          dirty.current = false;
          setText(String(value));
          event.currentTarget.blur();
        } else if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export function SketchTools({
  value,
  onChange,
  onEdit,
  onCornerTrim,
  onCornerFillet,
  onMirror,
  onExtrude,
  disabled: inputDisabled = false,
  drawingTool = "navigate",
  onDrawingTool,
  trimRadiusMm = 1,
  onTrimRadiusMm,
  drawingConstraints = true,
  onDrawingConstraints,
  onNormalView,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  showControlPoints = true,
  onShowControlPoints,
  showMeshPoints = true,
  onShowMeshPoints,
}: SketchToolsProps) {
  const [local, setLocal] = useState<Sketch>(
    () =>
      applySketchEditIntent(
        { version: 1, points: [], segments: [], constraints: [] },
        { kind: "preset", profile: "rectangle" },
      ).sketch,
  );
  const sketch = value ?? local;
  const [editPending, setEditPending] = useState(false);
  const pendingEdit = useRef(false);
  const mounted = useRef(true);
  const disabled = inputDisabled || editPending;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const frame = sketch.frame ?? coordinateSketchFrame("OXY", 0);
  const plane =
    frame.normal[2] === 1 && frame.u[0] === 1 && frame.v[1] === 1
      ? "OXY"
      : frame.normal[0] === 1 && frame.u[1] === 1 && frame.v[2] === 1
        ? "OYZ"
        : frame.normal[1] === 1 && frame.u[2] === 1 && frame.v[0] === 1
          ? "OXZ"
          : "Custom";
  const offset = frame.origin.reduce(
    (sum, n, i) => sum + n * frame.normal[i],
    0,
  );
  const [height, setHeight] = useState(20);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<SketchConstraint["kind"]>("distance");
  const [requestedFirst, setFirst] = useState("p1"),
    [requestedSecond, setSecond] = useState("p2"),
    [dimension, setDimension] = useState(40);
  const [requestedTangentPoint, setTangentPoint] = useState("p1");
  const [chordTolerance, setChordTolerance] = useState(0.1);
  const [requestedAxis, setAxis] = useState("");
  const [reversePairing, setReversePairing] = useState(false);
  const [cornerFirst, setCornerFirst] = useState("");
  const [cornerSecond, setCornerSecond] = useState("");
  const [cornerFirstEnd, setCornerFirstEnd] = useState<"a" | "b">("b");
  const [cornerSecondEnd, setCornerSecondEnd] = useState<"a" | "b">("a");
  const [cornerPending, setCornerPending] = useState(false);
  const [filletRadiusMm, setFilletRadiusMm] = useState(2);
  const [requestedMirrorAxis, setMirrorAxis] = useState("");
  const [mirrorSelection, setMirrorSelection] = useState<string[]>([]);
  const [mirrorPending, setMirrorPending] = useState(false);
  const firstLine = sketch.segments.some((s) => s.id === cornerFirst)
    ? cornerFirst
    : (sketch.segments[0]?.id ?? "");
  const otherLines = sketch.segments.filter((s) => s.id !== firstLine);
  const secondLine = otherLines.some((s) => s.id === cornerSecond)
    ? cornerSecond
    : (otherLines[0]?.id ?? "");
  const axes = sketch.segments.filter((segment) => segment.construction);
  const mirrorAxis = axes.some((segment) => segment.id === requestedMirrorAxis)
    ? requestedMirrorAxis
    : (axes[0]?.id ?? "");
  const mirrorCurves = [...sketch.segments, ...(sketch.arcs ?? [])].filter(
    (curve) => curve.id !== mirrorAxis,
  );
  const mirrorSelectedIds = new Set(mirrorSelection);
  const selectedMirrorCurves = mirrorCurves
    .filter((curve) => mirrorSelectedIds.has(curve.id))
    .map((curve) => curve.id);
  const symmetryAxis = axes.some((segment) => segment.id === requestedAxis)
    ? requestedAxis
    : (axes[0]?.id ?? "");
  const update = (next: Sketch) => {
    setLocal(next);
    onChange?.(next);
    setError("");
  };
  const inspected = useMemo(() => inspectSketchDiagnostics(sketch), [sketch]);
  const diagnostics = inspected.available ? inspected.solution : null;
  async function edit(
    intent: SketchEditIntent,
  ): Promise<SketchEditReceipt | undefined> {
    if (disabled || pendingEdit.current) return;
    pendingEdit.current = true;
    setEditPending(true);
    setError("");
    try {
      let receipt: SketchEditReceipt;
      if (onEdit) receipt = await onEdit(intent);
      else {
        const result = applySketchEditIntent(sketch, intent);
        if (result.changed && mounted.current) update(result.sketch);
        const { sketch: _sketch, ...response } = result;
        receipt = response;
      }
      if (mounted.current && receipt.solution && !receipt.solution.converged)
        setError(
          `Unresolved constraints: ${receipt.solution.conflictingConstraintIds.join(", ")}`,
        );
      return receipt;
    } catch (failure) {
      if (mounted.current)
        setError(
          failure instanceof Error ? failure.message : "Invalid sketch edit.",
        );
      throw failure;
    } finally {
      pendingEdit.current = false;
      if (mounted.current) setEditPending(false);
    }
  }
  const submit = (intent: SketchEditIntent) => {
    void edit(intent).catch(() => {});
  };
  const attempt = (fn: () => void) => {
    try {
      fn();
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid sketch.");
    }
  };
  const getReferences = (kind: SketchConstraint["kind"]) =>
    kind === "radius"
      ? (sketch.arcs ?? [])
      : kind === "tangent" || kind === "symmetric"
        ? [...sketch.segments, ...(sketch.arcs ?? [])].filter(
            (curve) => kind !== "symmetric" || curve.id !== symmetryAxis,
          )
        : [
              "horizontal",
              "vertical",
              "parallel",
              "collinear",
              "perpendicular",
              "equal",
              "angle",
            ].includes(kind)
          ? sketch.segments
          : sketch.points;
  const references = getReferences(kind);
  const first = references.some((r) => r.id === requestedFirst)
    ? requestedFirst
    : (references[0]?.id ?? "");
  const firstCurve = references.find((r) => r.id === first);
  const secondReferences =
    kind === "collinear"
      ? references.filter((r) => r.id !== first)
      : kind === "symmetric"
        ? references.filter(
            (r) =>
              r.id !== first &&
              "center" in r ===
                (firstCurve !== undefined && "center" in firstCurve),
          )
        : references;
  const second = secondReferences.some((r) => r.id === requestedSecond)
    ? requestedSecond
    : ((kind === "symmetric" || kind === "collinear"
        ? secondReferences[0]?.id
        : (references[1]?.id ?? references[0]?.id)) ?? "");
  const tangentPoint = sketch.points.some((p) => p.id === requestedTangentPoint)
    ? requestedTangentPoint
    : (sketch.points[0]?.id ?? "");
  const addConstraint = () =>
    attempt(() => {
      let constraint: SketchConstraintIntent;
      if (kind === "fixed") constraint = { kind, point: first };
      else if (kind === "horizontal" || kind === "vertical")
        constraint = { kind, segment: first };
      else if (
        kind === "distance" ||
        kind === "horizontalDistance" ||
        kind === "verticalDistance"
      )
        constraint = { kind, a: first, b: second, value: dimension };
      else if (kind === "coincident")
        constraint = { kind, a: first, b: second };
      else if (kind === "angle")
        constraint = { kind, first, second, value: dimension };
      else if (kind === "radius")
        constraint = { kind, arc: first, value: dimension };
      else if (kind === "tangent")
        constraint = { kind, first, second, point: tangentPoint };
      else if (kind === "symmetric")
        constraint = {
          kind,
          first,
          second,
          axis: symmetryAxis,
          reverse: reversePairing,
        };
      else constraint = { kind, first, second };
      submit({ kind: "constraintAdd", constraint });
    });
  const preview = sketch.points;
  const arcPreview = (sketch.arcs ?? []).map((arc) => {
    try {
      const samples = sampleSketchArc(sketch, arc, false, chordTolerance);
      const end = preview.find((p) => p.id === arc.b);
      if (end) samples.push([end.x, end.y]);
      return { id: arc.id, samples };
    } catch {
      return { id: arc.id, samples: [] as [number, number][] };
    }
  });
  let lowX = 0,
    lowY = 0,
    highX = 10,
    highY = 10;
  const extend = (x: number, y: number) => {
    lowX = Math.min(lowX, x);
    lowY = Math.min(lowY, y);
    highX = Math.max(highX, x);
    highY = Math.max(highY, y);
  };
  for (const p of preview) extend(p.x, p.y);
  for (const arc of arcPreview) for (const p of arc.samples) extend(p[0], p[1]);
  const referenceSegments = sketch.reference?.segments ?? [];
  for (let i = 0; i < referenceSegments.length; i += 2)
    extend(referenceSegments[i], referenceSegments[i + 1]);
  const minX = lowX - 10,
    minY = lowY - 10,
    spanX = highX - minX + 10,
    spanY = highY - minY + 10;
  let referencePath = "";
  for (let i = 0; i < referenceSegments.length; i += 4)
    referencePath += `M${referenceSegments[i]},${referenceSegments[i + 1]}L${referenceSegments[i + 2]},${referenceSegments[i + 3]} `;
  return (
    <section className="panel sketch-panel" aria-label="Parametric sketch">
      <h3>Parametric sketch</h3>
      {onDrawingTool && (
        <fieldset disabled={disabled}>
          <legend>Model-view drawing</legend>
          <div className="button-row">
            {(
              [
                "navigate",
                "line",
                "circle",
                "circle3",
                "arc3",
                "move",
                "trim",
              ] as const
            ).map((tool) => (
              <button
                key={tool}
                aria-pressed={drawingTool === tool}
                onClick={() => onDrawingTool(tool)}
              >
                {
                  {
                    navigate: "Navigate",
                    line: "Line",
                    circle: "Circle · center/radius",
                    circle3: "Circle · 3 points",
                    arc3: "Arc · 3 points",
                    move: "Move endpoint",
                    trim: "Paint trim",
                  }[tool]
                }
              </button>
            ))}
            <button onClick={onNormalView}>Normal to sketch</button>
            <button disabled={disabled || !canUndo} onClick={onUndo}>
              Undo sketch edit
            </button>
            <button disabled={disabled || !canRedo} onClick={onRedo}>
              Redo sketch edit
            </button>
          </div>
          {drawingTool === "trim" && (
            <>
              <label>
                Trim radius (mm)
                <input
                  type="number"
                  min="0"
                  max="1000000000"
                  step="any"
                  value={trimRadiusMm}
                  onChange={(event) =>
                    onTrimRadiusMm?.(Number(event.target.value))
                  }
                />
              </label>
              <p className="hint">
                Paint unwanted portions between intersections in the model view.
                Release to apply one edit; Escape cancels. Affected constraints
                must be removed first.
              </p>
            </>
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={showControlPoints}
              onChange={(event) => onShowControlPoints?.(event.target.checked)}
            />
            Control points
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={showMeshPoints}
              disabled={!sketch.reference}
              onChange={(event) => onShowMeshPoints?.(event.target.checked)}
            />
            Mesh points · extracted scan references
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={drawingConstraints}
              onChange={(event) => onDrawingConstraints?.(event.target.checked)}
            />
            Constraints · snap origin, endpoints and axes
          </label>
          <p className="muted">
            Left-drag draws a line or moves an endpoint. Middle-drag navigates;
            Escape cancels. Orange endpoints are free; blue endpoints have
            relations.
          </p>
          <p className="muted">
            Circle: drag from center to radius. Three-point tools: click three
            points; for arcs, use start, a point on the arc, then end. Escape
            discards unfinished picks.
          </p>
        </fieldset>
      )}
      <p className="muted">
        Local UV dimensions in mm · signed angles in degrees
      </p>
      <label>
        Sketch plane
        <AppSelect
          value={plane}
          disabled={disabled}
          onChange={(event) =>
            submit({
              kind: "plane",
              plane: event.target.value as "OXY" | "OYZ" | "OXZ",
            })
          }
        >
          <option value="OXY">OXY · U=X, V=Y</option>
          <option value="OYZ">OYZ · U=Y, V=Z</option>
          <option value="OXZ">OXZ · U=Z, V=X</option>
          {plane === "Custom" && (
            <option value="Custom" disabled>
              Custom plane
            </option>
          )}
        </AppSelect>
      </label>
      <label>
        Plane offset (mm)
        <SketchNumberInput
          value={offset}
          resetKey={sketch}
          disabled={disabled}
          onCommit={(value) =>
            submit({
              kind: "planeOffset",
              offsetMm: value,
            })
          }
        />
      </label>
      <fieldset disabled={disabled || cornerPending}>
        <legend>Corner Trim</legend>
        <label>
          First line
          <AppSelect
            value={firstLine}
            onChange={(event) => setCornerFirst(event.target.value)}
          >
            {sketch.segments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id}
              </option>
            ))}
          </AppSelect>
        </label>
        <label>
          First line end
          <AppSelect
            value={cornerFirstEnd}
            onChange={(event) =>
              setCornerFirstEnd(event.target.value as "a" | "b")
            }
          >
            <option value="a">Start · a</option>
            <option value="b">End · b</option>
          </AppSelect>
        </label>
        <label>
          Second line
          <AppSelect
            value={secondLine}
            onChange={(event) => setCornerSecond(event.target.value)}
          >
            {otherLines.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id}
              </option>
            ))}
          </AppSelect>
        </label>
        <label>
          Second line end
          <AppSelect
            value={cornerSecondEnd}
            onChange={(event) =>
              setCornerSecondEnd(event.target.value as "a" | "b")
            }
          >
            <option value="a">Start · a</option>
            <option value="b">End · b</option>
          </AppSelect>
        </label>
        <p className="muted">
          Move the chosen ends to their intersection. Other geometry and
          dependent constraints must be detached first.
        </p>
        <button
          disabled={!firstLine || !secondLine}
          onClick={async () => {
            const options = {
              first: firstLine,
              second: secondLine,
              firstEnd: cornerFirstEnd,
              secondEnd: cornerSecondEnd,
            };
            setCornerPending(true);
            try {
              if (onCornerTrim) await onCornerTrim(options);
              else update(cornerTrimSketch(sketch, options).sketch);
              setError("");
            } catch (error) {
              setError(
                error instanceof Error ? error.message : "Corner trim failed.",
              );
            } finally {
              setCornerPending(false);
            }
          }}
        >
          Join corner
        </button>
        <label>
          Fillet radius (mm)
          <input
            type="number"
            min="0"
            max="1000000000"
            step="any"
            value={filletRadiusMm}
            onChange={(event) => setFilletRadiusMm(Number(event.target.value))}
          />
        </label>
        <p className="hint">
          Round the selected line ends with a tangent circular arc. Radius must
          fit before both opposite ends. Affected constraints or endpoints
          shared with other geometry must be detached first.
        </p>
        <button
          disabled={!firstLine || !secondLine}
          onClick={async () => {
            const options = {
              first: firstLine,
              second: secondLine,
              firstEnd: cornerFirstEnd,
              secondEnd: cornerSecondEnd,
              radiusMm: filletRadiusMm,
            };
            setCornerPending(true);
            try {
              if (onCornerFillet) await onCornerFillet(options);
              else update((await filletSketchCorner(sketch, options)).sketch);
              setError("");
            } catch (error) {
              setError(
                error instanceof Error
                  ? error.message
                  : "Sketch fillet failed.",
              );
            } finally {
              setCornerPending(false);
            }
          }}
        >
          Create fillet
        </button>
      </fieldset>
      <fieldset disabled={disabled || mirrorPending}>
        <legend>Mirror geometry</legend>
        <label>
          Mirror axis
          <AppSelect
            value={mirrorAxis}
            disabled={!axes.length}
            onChange={(event) => setMirrorAxis(event.target.value)}
          >
            {!axes.length && (
              <option value="">Create a construction line first</option>
            )}
            {axes.map((axis) => (
              <option key={axis.id} value={axis.id}>
                {axis.id}
              </option>
            ))}
          </AppSelect>
        </label>
        <div className="button-row">
          <button
            disabled={!mirrorCurves.length}
            onClick={() =>
              setMirrorSelection(mirrorCurves.map((curve) => curve.id))
            }
          >
            Select all curves
          </button>
          <button
            disabled={!selectedMirrorCurves.length}
            onClick={() => setMirrorSelection([])}
          >
            Clear mirror selection
          </button>
        </div>
        <div className="sketch-mirror-curves">
          {mirrorCurves.map((curve) => (
            <label className="check" key={curve.id}>
              <input
                type="checkbox"
                checked={mirrorSelectedIds.has(curve.id)}
                onChange={(event) =>
                  setMirrorSelection((selected) =>
                    event.target.checked
                      ? [...selected, curve.id]
                      : selected.filter((id) => id !== curve.id),
                  )
                }
              />
              Mirror {curve.id} · {"center" in curve ? "arc" : "line"}
            </label>
          ))}
        </div>
        <p className="hint">
          Copy selected curves across the construction line. Originals and
          existing relations stay in place; copies have no new relations. Select
          both arcs of a circle.
        </p>
        <button
          disabled={!mirrorAxis || !selectedMirrorCurves.length}
          onClick={async () => {
            const options = {
              axis: mirrorAxis,
              curveIds: selectedMirrorCurves,
            };
            setMirrorPending(true);
            try {
              if (onMirror) await onMirror(options);
              else update((await mirrorSketch(sketch, options)).sketch);
              setError("");
            } catch (error) {
              setError(
                error instanceof Error
                  ? error.message
                  : "Sketch mirror failed.",
              );
            } finally {
              setMirrorPending(false);
            }
          }}
        >
          Mirror selected
        </button>
      </fieldset>
      <svg
        role="img"
        aria-label="Sketch profile preview"
        viewBox={`${minX} ${minY} ${spanX} ${spanY}`}
        style={{
          width: "100%",
          height: 150,
          background: "var(--surface)",
          border: "1px solid var(--border)",
        }}
      >
        {showMeshPoints && referencePath && (
          <path
            aria-label="Scan section references"
            d={referencePath}
            fill="none"
            stroke="#888888"
            strokeWidth={spanX / 250}
          />
        )}
        {sketch.segments.map((s) => {
          const a = preview.find((p) => p.id === s.a),
            b = preview.find((p) => p.id === s.b);
          return a && b ? (
            <line
              key={s.id}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="currentColor"
              strokeWidth={spanX / 150}
              strokeDasharray={
                s.construction ? `${spanX / 60} ${spanX / 100}` : undefined
              }
            />
          ) : null;
        })}
        {arcPreview.map((arc) => (
          <polyline
            key={arc.id}
            points={arc.samples.map((p) => p.join(",")).join(" ")}
            stroke="currentColor"
            strokeWidth={spanX / 150}
            fill="none"
            strokeDasharray={
              sketch.arcs?.find((a) => a.id === arc.id)?.construction
                ? `${spanX / 60} ${spanX / 100}`
                : undefined
            }
          />
        ))}
        {(showControlPoints ? preview : []).map((p) => (
          <circle
            key={p.id}
            cx={p.x}
            cy={p.y}
            r={spanX / 100}
            fill="var(--accent, #579cff)"
          />
        ))}
      </svg>
      <fieldset disabled={disabled}>
        <legend>Points</legend>
        {sketch.points.map((p) => (
          <div key={p.id} className="field-row">
            <span title={p.id}>{p.id.slice(0, 6)}</span>
            {(["x", "y"] as const).map((axis) => (
              <label key={axis}>
                {axis}
                <SketchNumberInput
                  label={`${p.id} ${axis}`}
                  value={p[axis]}
                  resetKey={sketch}
                  onCommit={(value) =>
                    submit({
                      kind: "pointSet",
                      pointId: p.id,
                      [axis]: value,
                    })
                  }
                />
              </label>
            ))}
            <button
              aria-label={`Remove point ${p.id}`}
              onClick={() =>
                submit({ kind: "remove", target: "point", id: p.id })
              }
            >
              ×
            </button>
          </div>
        ))}
        <button onClick={() => submit({ kind: "pointAdd" })}>Add point</button>
      </fieldset>
      <fieldset disabled={disabled}>
        <legend>Circular arcs</legend>
        {(sketch.arcs ?? []).map((arc) => (
          <div className="field-row" key={arc.id}>
            <span title={arc.id}>{arc.id.slice(0, 6)}</span>
            {(["a", "b", "center"] as const).map((reference) => (
              <label key={reference}>
                {reference}
                <AppSelect
                  aria-label={`${arc.id} ${reference}`}
                  value={arc[reference]}
                  onChange={(event) =>
                    submit({
                      kind: "arcSet",
                      arcId: arc.id,
                      [reference]: event.target.value,
                    })
                  }
                >
                  {preview.map((point) => (
                    <option key={point.id} value={point.id}>
                      {point.id.slice(0, 6)}
                    </option>
                  ))}
                </AppSelect>
              </label>
            ))}
            <label>
              <input
                type="checkbox"
                checked={arc.clockwise}
                onChange={(event) =>
                  submit({
                    kind: "arcSet",
                    arcId: arc.id,
                    clockwise: event.target.checked,
                  })
                }
              />
              Clockwise
            </label>
            <button
              aria-label={`Remove arc ${arc.id}`}
              onClick={() =>
                submit({ kind: "remove", target: "arc", id: arc.id })
              }
            >
              ×
            </button>
            <label className="check">
              <input
                type="checkbox"
                aria-label={`${arc.id} For construction`}
                checked={!!arc.construction}
                onChange={(e) =>
                  submit({
                    kind: "construction",
                    curveId: arc.id,
                    enabled: e.target.checked,
                  })
                }
              />
              For construction
            </label>
          </div>
        ))}
        <button
          disabled={preview.length < 3}
          onClick={() => submit({ kind: "arcAdd" })}
        >
          Add arc
        </button>
        <button onClick={() => submit({ kind: "preset", profile: "circle" })}>
          New circular profile
        </button>
      </fieldset>
      <fieldset disabled={disabled}>
        <legend>Segments</legend>
        {sketch.segments.map((s) => (
          <div key={s.id} className="field-row">
            <span title={s.id}>{s.id.slice(0, 6)}</span>
            {(["a", "b"] as const).map((end) => (
              <AppSelect
                key={end}
                aria-label={`${s.id} endpoint ${end}`}
                value={s[end]}
                onChange={(e) =>
                  submit({
                    kind: "segmentSet",
                    segmentId: s.id,
                    [end]: e.target.value,
                  })
                }
              >
                {sketch.points.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id.slice(0, 6)}
                  </option>
                ))}
              </AppSelect>
            ))}
            <button
              aria-label={`Remove segment ${s.id}`}
              onClick={() =>
                submit({ kind: "remove", target: "segment", id: s.id })
              }
            >
              ×
            </button>
            <label className="check">
              <input
                type="checkbox"
                aria-label={`${s.id} For construction`}
                checked={!!s.construction}
                onChange={(e) =>
                  submit({
                    kind: "construction",
                    curveId: s.id,
                    enabled: e.target.checked,
                  })
                }
              />
              For construction
            </label>
          </div>
        ))}
        <button
          disabled={sketch.points.length < 2}
          onClick={() => submit({ kind: "segmentAdd" })}
        >
          Add segment
        </button>
      </fieldset>
      <fieldset disabled={disabled}>
        <legend>Constraints</legend>
        {sketch.constraints.map((c) => (
          <div className="field-row" key={c.id}>
            <span>
              {constraintLabel(c.kind)}
              {"value" in c ? ` ${c.value}` : ""}
            </span>
            {"value" in c && (
              <SketchNumberInput
                label={`${c.id} dimension`}
                value={c.value}
                resetKey={sketch}
                onCommit={(value) =>
                  submit({
                    kind: "dimension",
                    constraintId: c.id,
                    value,
                  })
                }
              />
            )}
            <button
              aria-label={`Remove constraint ${c.id}`}
              onClick={() =>
                submit({ kind: "remove", target: "constraint", id: c.id })
              }
            >
              ×
            </button>
          </div>
        ))}
        <label>
          Constraint
          <AppSelect
            value={kind}
            onChange={(e) => {
              const k = e.target.value as SketchConstraint["kind"];
              setKind(k);
              const refs = getReferences(k);
              setFirst(refs[0]?.id ?? "");
              setSecond(refs[1]?.id ?? refs[0]?.id ?? "");
            }}
          >
            {[
              "fixed",
              "coincident",
              "horizontal",
              "vertical",
              "distance",
              "horizontalDistance",
              "verticalDistance",
              "parallel",
              "collinear",
              "perpendicular",
              "equal",
              "angle",
              "radius",
              "tangent",
              "symmetric",
            ].map((k) => (
              <option key={k} value={k}>
                {constraintLabel(k)}
              </option>
            ))}
          </AppSelect>
        </label>
        <label>
          First reference
          <AppSelect value={first} onChange={(e) => setFirst(e.target.value)}>
            {references.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id.slice(0, 6)}
              </option>
            ))}
          </AppSelect>
        </label>
        {!["fixed", "horizontal", "vertical", "radius"].includes(kind) && (
          <label>
            Second reference
            <AppSelect
              value={second}
              onChange={(e) => setSecond(e.target.value)}
            >
              {secondReferences.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id.slice(0, 6)}
                </option>
              ))}
            </AppSelect>
          </label>
        )}
        {kind === "symmetric" && (
          <>
            <label>
              Symmetry construction line
              <AppSelect
                value={symmetryAxis}
                onChange={(event) => setAxis(event.target.value)}
              >
                {axes.map((axis) => (
                  <option key={axis.id} value={axis.id}>
                    {axis.id.slice(0, 6)}
                  </option>
                ))}
              </AppSelect>
            </label>
            <label>
              <input
                type="checkbox"
                checked={reversePairing}
                onChange={(event) => setReversePairing(event.target.checked)}
              />
              Reverse endpoint pairing
            </label>
          </>
        )}
        {kind === "tangent" && (
          <label>
            Shared endpoint
            <AppSelect
              value={tangentPoint}
              onChange={(event) => setTangentPoint(event.target.value)}
            >
              {preview.map((point) => (
                <option key={point.id} value={point.id}>
                  {point.id.slice(0, 6)}
                </option>
              ))}
            </AppSelect>
          </label>
        )}
        {[
          "distance",
          "horizontalDistance",
          "verticalDistance",
          "angle",
          "radius",
        ].includes(kind) && (
          <label>
            Dimension
            <input
              type="number"
              value={dimension}
              onChange={(e) => setDimension(Number(e.target.value))}
            />
          </label>
        )}
        <button onClick={addConstraint}>Add constraint</button>
      </fieldset>
      <p role="status">
        {diagnostics
          ? `${diagnostics.converged ? "Constraints satisfied" : "Conflicting or unsolved constraints"} · ${diagnostics.degreesOfFreedom} local DOF · residual ${diagnostics.maxResidual.toPrecision(3)}`
          : inspected.available
            ? "Invalid references"
            : inspected.message}
      </p>
      <button disabled={disabled} onClick={() => submit({ kind: "solve" })}>
        Solve constraints
      </button>
      <label>
        Arc preview tolerance (mm)
        <input
          type="number"
          min="0.000001"
          step="0.01"
          value={chordTolerance}
          disabled={disabled}
          onChange={(event) => setChordTolerance(Number(event.target.value))}
        />
      </label>
      <p className="muted">
        Circular arcs remain analytic in CAD. Tolerance controls the sketch
        preview.
      </p>
      <label>
        Extrusion height
        <input
          type="number"
          min="0.001"
          value={height}
          disabled={disabled}
          onChange={(e) => setHeight(Number(e.target.value))}
        />
      </label>
      <button
        disabled={disabled}
        onClick={() =>
          attempt(() => {
            if (!(height > 0) || !Number.isFinite(height))
              throw new Error("Extrusion height must be positive.");
            void edit({ kind: "solve", forProfile: true })
              .then((result) => {
                if (result?.profile && mounted.current)
                  onExtrude(result.profile, height);
              })
              .catch(() => {});
          })
        }
      >
        Extrude solved profile
      </button>
      <button
        disabled={disabled}
        onClick={() => submit({ kind: "preset", profile: "rectangle" })}
      >
        Reset rectangle
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
