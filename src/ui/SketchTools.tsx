import { useMemo, useState } from "react";
import {
  rectangleSketch,
  sketchProfile,
  solveSketch,
  type Sketch,
  type SketchConstraint,
} from "../sketch";

export interface SketchToolsProps {
  value?: Sketch;
  onChange?: (sketch: Sketch) => void;
  onExtrude: (points: [number, number][], height: number) => void;
  disabled?: boolean;
}

export function SketchTools({
  value,
  onChange,
  onExtrude,
  disabled = false,
}: SketchToolsProps) {
  const [local, setLocal] = useState<Sketch>(() => rectangleSketch());
  const sketch = value ?? local;
  const [height, setHeight] = useState(20);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<SketchConstraint["kind"]>("distance");
  const [first, setFirst] = useState("p1"),
    [second, setSecond] = useState("p2"),
    [dimension, setDimension] = useState(40);
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
  const segmentConstraint = [
    "horizontal",
    "vertical",
    "parallel",
    "perpendicular",
    "equal",
    "angle",
  ].includes(kind);
  const references = segmentConstraint ? sketch.segments : sketch.points;
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
      else if (kind === "distance")
        constraint = { id, kind, a: first, b: second, value: dimension };
      else if (kind === "coincident")
        constraint = { id, kind, a: first, b: second };
      else if (kind === "angle")
        constraint = { id, kind, first, second, value: dimension };
      else constraint = { id, kind, first, second };
      const next = {
        ...sketch,
        constraints: [...sketch.constraints, constraint],
      };
      solveSketch(next);
      update(next);
    });
  const preview = sketch.points;
  const minX = Math.min(0, ...preview.map((p) => p.x)) - 10,
    minY = Math.min(0, ...preview.map((p) => p.y)) - 10;
  const spanX = Math.max(10, ...preview.map((p) => p.x)) - minX + 10,
    spanY = Math.max(10, ...preview.map((p) => p.y)) - minY + 10;
  return (
    <section className="panel sketch-panel" aria-label="Parametric sketch">
      <h3>Parametric sketch</h3>
      <p className="muted">
        XY plane · dimensions in mm · signed angles in degrees
      </p>
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
            />
          ) : null;
        })}
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
                update({
                  ...sketch,
                  points: sketch.points.filter((q) => q.id !== p.id),
                  segments: sketch.segments.filter(
                    (s) => s.a !== p.id && s.b !== p.id,
                  ),
                  constraints: [],
                })
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
                update({
                  ...sketch,
                  segments: sketch.segments.filter((q) => q.id !== s.id),
                  constraints: [],
                })
              }
            >
              ×
            </button>
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
              {c.kind}
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
              const refs = [
                "horizontal",
                "vertical",
                "parallel",
                "perpendicular",
                "equal",
                "angle",
              ].includes(k)
                ? sketch.segments
                : sketch.points;
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
              "parallel",
              "perpendicular",
              "equal",
              "angle",
            ].map((k) => (
              <option key={k}>{k}</option>
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
        {!["fixed", "horizontal", "vertical"].includes(kind) && (
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
        {(kind === "distance" || kind === "angle") && (
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
            const profile = sketchProfile(result.sketch);
            update(result.sketch);
            onExtrude(profile, height);
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
