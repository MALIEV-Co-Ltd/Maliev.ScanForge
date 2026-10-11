import { useMemo, useState } from "react";
import { coordinateSketchFrame } from "../sketch-frame";
import {
  rectangleSketch,
  sketchProfile,
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
  onExtrude: (
    points: [number, number][],
    height: number,
    profile?: { sketch: Sketch; chordTolerance: number },
  ) => void;
  disabled?: boolean;
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
  onExtrude,
  disabled = false,
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
  const [first, setFirst] = useState("p1"),
    [second, setSecond] = useState("p2"),
    [dimension, setDimension] = useState(40);
  const [tangentPoint, setTangentPoint] = useState("p1");
  const [chordTolerance, setChordTolerance] = useState(0.1);
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
      : kind === "tangent"
        ? [...sketch.segments, ...(sketch.arcs ?? [])]
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
      else constraint = { id, kind, first, second };
      update(constrainSketch(sketch, constraint));
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
  const bounds = [
    ...preview.map((p) => [p.x, p.y]),
    ...arcPreview.flatMap((arc) => arc.samples),
  ];
  const minX = Math.min(0, ...bounds.map((p) => p[0])) - 10,
    minY = Math.min(0, ...bounds.map((p) => p[1])) - 10;
  const spanX = Math.max(10, ...bounds.map((p) => p[0])) - minX + 10,
    spanY = Math.max(10, ...bounds.map((p) => p[1])) - minY + 10;
  return (
    <section className="panel sketch-panel" aria-label="Parametric sketch">
      <h3>Parametric sketch</h3>
      <p className="muted">
        Local UV dimensions in mm · signed angles in degrees
      </p>
      <label>
        Sketch plane
        <select
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
        </select>
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
        {preview.map((p) => (
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
                <select
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
                </select>
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
              <select
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
              </select>
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
          <select
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
            ].map((k) => (
              <option key={k} value={k}>
                {constraintLabel(k)}
              </option>
            ))}
          </select>
        </label>
        <label>
          First reference
          <select value={first} onChange={(e) => setFirst(e.target.value)}>
            {references.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id.slice(0, 6)}
              </option>
            ))}
          </select>
        </label>
        {!["fixed", "horizontal", "vertical", "radius"].includes(kind) && (
          <label>
            Second reference
            <select value={second} onChange={(e) => setSecond(e.target.value)}>
              {references.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id.slice(0, 6)}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === "tangent" && (
          <label>
            Shared endpoint
            <select
              value={tangentPoint}
              onChange={(event) => setTangentPoint(event.target.value)}
            >
              {preview.map((point) => (
                <option key={point.id} value={point.id}>
                  {point.id.slice(0, 6)}
                </option>
              ))}
            </select>
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
        Arc chord tolerance (mm)
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
        Circular arcs are sampled into polygon chords for extrusion.
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
            const profile = sketchProfile(result.sketch, chordTolerance);
            update(result.sketch);
            onExtrude(profile, height, {
              sketch: result.sketch,
              chordTolerance,
            });
          })
        }
      >
        Extrude solved profile
      </button>
      <button disabled={disabled} onClick={() => update(rectangleSketch())}>
        Reset rectangle
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
