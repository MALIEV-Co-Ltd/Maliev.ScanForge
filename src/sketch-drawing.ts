import { solveSketch, validateSketch, type Sketch } from "./sketch";

export type SketchDrawingTool = "navigate" | "line" | "move";
export type SketchUV = [number, number];

/** Screen-space snapping tolerance is supplied by the viewport in local mm. */
export function drawSketchLine(
  sketch: Sketch,
  start: SketchUV,
  end: SketchUV,
  tolerance: number,
  constraints: boolean,
  id: () => string = () => crypto.randomUUID(),
): Sketch {
  validateSketch(sketch);
  if (!Number.isFinite(tolerance) || tolerance < 0)
    throw new Error("Invalid drawing tolerance.");
  const points = sketch.points.map((p) => ({ ...p }));
  const endpoint = ([x, y]: SketchUV) => {
    if (![x, y].every(Number.isFinite))
      throw new Error("Drawing coordinates must be finite.");
    const near = constraints
      ? points.reduce<(typeof points)[number] | undefined>((best, p) => {
          const distance = Math.hypot(p.x - x, p.y - y);
          return distance <= tolerance &&
            (!best || distance < Math.hypot(best.x - x, best.y - y))
            ? p
            : best;
        }, undefined)
      : undefined;
    if (near) return near;
    const p = { id: id(), x, y };
    points.push(p);
    return p;
  };
  const a = endpoint(start);
  let finish: SketchUV = [...end];
  let relation: "horizontal" | "vertical" | undefined;
  if (constraints) {
    const dx = Math.abs(end[0] - a.x),
      dy = Math.abs(end[1] - a.y);
    if (dy <= tolerance && dx > tolerance) {
      finish = [end[0], a.y];
      relation = "horizontal";
    } else if (dx <= tolerance && dy > tolerance) {
      finish = [a.x, end[1]];
      relation = "vertical";
    }
  }
  const b = endpoint(finish);
  if (a.id === b.id || Math.hypot(a.x - b.x, a.y - b.y) < 1e-8)
    throw new Error("Drag to create a nonzero line.");
  const segment = { id: id(), a: a.id, b: b.id };
  const next: Sketch = {
    ...sketch,
    points,
    segments: [...sketch.segments, segment],
    constraints: relation
      ? [
          ...sketch.constraints,
          { id: id(), kind: relation, segment: segment.id },
        ]
      : [...sketch.constraints],
  };
  const solved = solveSketch(next);
  if (!solved.converged)
    throw new Error("Drawing conflicts with sketch constraints.");
  return solved.sketch;
}

/** Solve an endpoint target atomically; the temporary drag relation is not saved. */
export function moveSketchEndpoint(
  sketch: Sketch,
  pointId: string,
  position: SketchUV,
): Sketch {
  validateSketch(sketch);
  if (
    !sketch.points.some((p) => p.id === pointId) ||
    !position.every(Number.isFinite)
  )
    throw new Error("Invalid endpoint target.");
  const temporary = `drag-${crypto.randomUUID()}`;
  const next: Sketch = {
    ...sketch,
    points: sketch.points.map((p) =>
      p.id === pointId ? { ...p, x: position[0], y: position[1] } : { ...p },
    ),
    constraints: [
      ...sketch.constraints,
      {
        id: temporary,
        kind: "fixed",
        point: pointId,
        x: position[0],
        y: position[1],
      },
    ],
  };
  const solved = solveSketch(next);
  if (!solved.converged)
    throw new Error("Endpoint movement conflicts with sketch constraints.");
  return {
    ...solved.sketch,
    constraints: solved.sketch.constraints.filter((c) => c.id !== temporary),
  };
}
