import { flushSync } from "react-dom";
import type { ParametricProfile } from "../parametric";
import { AppSelect } from "./AppSelect";
import { useMemo, useState } from "react";
import { coordinateSketchFrame } from "../sketch-frame";
import { resetSketchRectangle } from "../sketch-authoring";
import { cornerTrimSketch, type SketchCornerSelection } from "../sketch-corner";
import type { SketchDrawingTool } from "../sketch-drawing";
import {
  rectangleSketch,
  sketchCurveProfile,
  solveSketch,
  sampleSketchArc,
  removeSketchGeometry,
  constrainSketch,
  type Sketch,
  type SketchConstraint,
} from "../sketch";

export interface SketchToolsProps {
  value?: Sketch;
  onChange?: (sketch: Sketch) => void;
  onConstrain?: (constraint: SketchConstraint) => void | Promise<void>;
  onCornerTrim?: (options: SketchCornerSelection) => void | Promise<void>;
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

export function SketchTools({
  value,
  onChange,
  onConstrain,
  onCornerTrim,
  onExtrude,
  disabled = false,
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
  const [local, setLocal] = useState<Sketch>(() => rectangleSketch());
  const sketch = value ?? local;
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
  const firstLine = sketch.segments.some((s) => s.id === cornerFirst)
    ? cornerFirst
    : (sketch.segments[0]?.id ?? "");
  const otherLines = sketch.segments.filter((s) => s.id !== firstLine);
  const secondLine = otherLines.some((s) => s.id === cornerSecond)
    ? cornerSecond
    : (otherLines[0]?.id ?? "");
  const axes = sketch.segments.filter((segment) => segment.construction);
  const symmetryAxis = axes.some((segment) => segment.id === requestedAxis)
    ? requestedAxis
    : (axes[0]?.id ?? "");
  const update = (next: Sketch) => {
    setLocal(next);
    onChange?.(next);
    setError("");
  };
  const diagnostics = useMemo(() => {
    try {
      return solveSketch(sketch);
    } catch {
      return null;
    }
  }, [sketch]);
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
    kind === "symmetric"
      ? references.filter(
          (r) =>
            r.id !== first &&
            "center" in r ===
              (firstCurve !== undefined && "center" in firstCurve),
        )
      : references;
  const second = secondReferences.some((r) => r.id === requestedSecond)
    ? requestedSecond
    : ((kind === "symmetric"
        ? secondReferences[0]?.id
        : (references[1]?.id ?? references[0]?.id)) ?? "");
  const tangentPoint = sketch.points.some((p) => p.id === requestedTangentPoint)
    ? requestedTangentPoint
    : (sketch.points[0]?.id ?? "");
  const addConstraint = () =>
    attempt(() => {
      const id = crypto.randomUUID();
      let constraint: SketchConstraint;
      if (kind === "fixed") {
        const p = sketch.points.find((p) => p.id === first);
        if (!p) throw new Error("Select a point.");
        constraint = { id, kind, point: first, x: p.x, y: p.y };
      } else if (kind === "horizontal" || kind === "vertical")
        constraint = { id, kind, segment: first };
      else if (
        kind === "distance" ||
        kind === "horizontalDistance" ||
        kind === "verticalDistance"
      )
        constraint = { id, kind, a: first, b: second, value: dimension };
      else if (kind === "coincident")
        constraint = { id, kind, a: first, b: second };
      else if (kind === "angle")
        constraint = { id, kind, first, second, value: dimension };
      else if (kind === "radius")
        constraint = { id, kind, arc: first, value: dimension };
      else if (kind === "tangent")
        constraint = { id, kind, first, second, point: tangentPoint };
      else if (kind === "symmetric")
        constraint = {
          id,
          kind,
          first,
          second,
          axis: symmetryAxis,
          reverse: reversePairing,
        };
      else constraint = { id, kind, first, second };
      if (onConstrain) {
        void Promise.resolve(onConstrain(constraint)).catch((error: unknown) =>
          setError(
            error instanceof Error ? error.message : "Constraint failed.",
          ),
        );
      } else update(constrainSketch(sketch, constraint));
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
            update({
              ...sketch,
              frame: coordinateSketchFrame(
                event.target.value as "OXY" | "OYZ" | "OXZ",
                offset,
              ),
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
        <input
          type="number"
          value={offset}
          disabled={disabled}
          onChange={(event) =>
            attempt(() => {
              const next = Number(event.target.value);
              const origin = frame.origin.map(
                (n, i) => n + (next - offset) * frame.normal[i],
              ) as typeof frame.origin;
              const placed = { ...sketch, frame: { ...frame, origin } };
              solveSketch(placed);
              update(placed);
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
                <input
                  type="number"
                  aria-label={`${p.id} ${axis}`}
                  value={p[axis]}
                  onChange={(e) =>
                    update({
                      ...sketch,
                      points: sketch.points.map((q) =>
                        q.id === p.id
                          ? { ...q, [axis]: Number(e.target.value) }
                          : q,
                      ),
                    })
                  }
                />
              </label>
            ))}
            <button
              aria-label={`Remove point ${p.id}`}
              onClick={() =>
                update(removeSketchGeometry(sketch, "point", p.id))
              }
            >
              ×
            </button>
          </div>
        ))}
        <button
          onClick={() =>
            update({
              ...sketch,
              points: [
                ...sketch.points,
                { id: crypto.randomUUID(), x: 0, y: 0 },
              ],
            })
          }
        >
          Add point
        </button>
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
                    update({
                      ...sketch,
                      arcs: (sketch.arcs ?? []).map((a) =>
                        a.id === arc.id
                          ? { ...a, [reference]: event.target.value }
                          : a,
                      ),
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
                  update({
                    ...sketch,
                    arcs: (sketch.arcs ?? []).map((a) =>
                      a.id === arc.id
                        ? { ...a, clockwise: event.target.checked }
                        : a,
                    ),
                  })
                }
              />
              Clockwise
            </label>
            <button
              aria-label={`Remove arc ${arc.id}`}
              onClick={() =>
                update(removeSketchGeometry(sketch, "arc", arc.id))
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
                  update({
                    ...sketch,
                    arcs: sketch.arcs?.map((a) =>
                      a.id === arc.id
                        ? { ...a, construction: e.target.checked }
                        : a,
                    ),
                  })
                }
              />
              For construction
            </label>
          </div>
        ))}
        <button
          disabled={preview.length < 3}
          onClick={() =>
            update({
              ...sketch,
              arcs: [
                ...(sketch.arcs ?? []),
                {
                  id: crypto.randomUUID(),
                  a: preview[0].id,
                  b: preview[1].id,
                  center: preview[2].id,
                  clockwise: false,
                },
              ],
            })
          }
        >
          Add arc
        </button>
        <button
          onClick={() =>
            update({
              ...sketch,
              version: 1,
              points: [
                { id: "center", x: 0, y: 0 },
                { id: "east", x: 10, y: 0 },
                { id: "west", x: -10, y: 0 },
              ],
              segments: [],
              arcs: [
                {
                  id: "upper",
                  a: "east",
                  b: "west",
                  center: "center",
                  clockwise: false,
                },
                {
                  id: "lower",
                  a: "west",
                  b: "east",
                  center: "center",
                  clockwise: false,
                },
              ],
              constraints: [
                { id: "origin", kind: "fixed", point: "center", x: 0, y: 0 },
                { id: "anchor", kind: "fixed", point: "east", x: 10, y: 0 },
                { id: "radius-upper", kind: "radius", arc: "upper", value: 10 },
                { id: "radius-lower", kind: "radius", arc: "lower", value: 10 },
              ],
            })
          }
        >
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
                  update({
                    ...sketch,
                    segments: sketch.segments.map((q) =>
                      q.id === s.id ? { ...q, [end]: e.target.value } : q,
                    ),
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
                update(removeSketchGeometry(sketch, "segment", s.id))
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
                  update({
                    ...sketch,
                    segments: sketch.segments.map((segment) =>
                      segment.id === s.id
                        ? { ...segment, construction: e.target.checked }
                        : segment,
                    ),
                  })
                }
              />
              For construction
            </label>
          </div>
        ))}
        <button
          disabled={sketch.points.length < 2}
          onClick={() =>
            update({
              ...sketch,
              segments: [
                ...sketch.segments,
                {
                  id: crypto.randomUUID(),
                  a: sketch.points[0].id,
                  b: sketch.points[1].id,
                },
              ],
            })
          }
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
              <input
                aria-label={`${c.id} dimension`}
                type="number"
                value={c.value}
                onChange={(e) =>
                  update({
                    ...sketch,
                    constraints: sketch.constraints.map((q) =>
                      q.id === c.id
                        ? { ...c, value: Number(e.target.value) }
                        : q,
                    ),
                  })
                }
              />
            )}
            <button
              aria-label={`Remove constraint ${c.id}`}
              onClick={() =>
                update({
                  ...sketch,
                  constraints: sketch.constraints.filter((q) => q.id !== c.id),
                })
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
          : "Invalid references"}
      </p>
      <button
        disabled={disabled}
        onClick={() =>
          attempt(() => {
            const result = solveSketch(sketch);
            update(result.sketch);
            if (!result.converged)
              setError(
                `Unresolved constraints: ${result.conflictingConstraintIds.join(", ")}`,
              );
          })
        }
      >
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
            const result = solveSketch(sketch);
            if (!result.converged)
              throw new Error(
                "Resolve conflicting constraints before extrusion.",
              );
            if (!(height > 0) || !Number.isFinite(height))
              throw new Error("Extrusion height must be positive.");
            sketchCurveProfile(result.sketch);
            // Publish the solved draft before the shared operation captures its revision.
            flushSync(() => update(result.sketch));
            onExtrude({ kind: "sketch-curves", sketch: result.sketch }, height);
          })
        }
      >
        Extrude solved profile
      </button>
      <button
        disabled={disabled}
        onClick={() => update(resetSketchRectangle(sketch))}
      >
        Reset rectangle
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
