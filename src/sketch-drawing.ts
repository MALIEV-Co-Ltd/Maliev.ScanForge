import { solveSketch, validateSketch, type Sketch } from "./sketch";
import { coordinateSketchFrame, sketchWorldPoint } from "./sketch-frame";

export type SketchDrawingTool =
  "navigate" | "line" | "move" | "circle" | "circle3" | "arc3" | "trim";
export type SketchUV = [number, number];
function finishCurve(next: Sketch): Sketch {
  const frame = next.frame ?? coordinateSketchFrame("OXY", 0);
  for (const p of next.points) sketchWorldPoint(frame, [p.x, p.y]);
  const solved = solveSketch(next);
  if (!solved.converged)
    throw new Error("Curve creation conflicts with sketch constraints.");
  return solved.sketch;
}

export function circleThroughThreePoints(
  a: SketchUV,
  via: SketchUV,
  b: SketchUV,
) {
  if (![...a, ...via, ...b].every(Number.isFinite))
    throw new Error("Circle points must be finite.");
  const x1 = via[0] - a[0],
    y1 = via[1] - a[1],
    x2 = b[0] - a[0],
    y2 = b[1] - a[1];
  const cross = x1 * y2 - y1 * x2;
  const scale = Math.max(Math.hypot(x1, y1), Math.hypot(x2, y2), 1e-8);
  if (Math.abs(cross) <= scale * scale * 1e-10)
    throw new Error("Pick three distinct, noncollinear circle points.");
  const r1 = x1 * x1 + y1 * y1,
    r2 = x2 * x2 + y2 * y2;
  const center: SketchUV = [
    a[0] + (r1 * y2 - r2 * y1) / (2 * cross),
    a[1] + (x1 * r2 - x2 * r1) / (2 * cross),
  ];
  const radius = Math.hypot(a[0] - center[0], a[1] - center[1]);
  if (
    !center.every((n) => Number.isFinite(n) && Math.abs(n) <= 1e9) ||
    !Number.isFinite(radius) ||
    radius < 1e-8
  )
    throw new Error(
      "Circle geometry must have a finite positive radius and bounded center.",
    );
  return { center, radius, clockwise: cross < 0 };
}

/** Append a circle as the existing pair of circular edges; preserve its sketch frame/reference. */
export function drawSketchCircle(
  sketch: Sketch,
  center: SketchUV,
  edge: SketchUV,
): Sketch {
  validateSketch(sketch);
  const radius = Math.hypot(edge[0] - center[0], edge[1] - center[1]);
  if (
    ![...center, ...edge].every(Number.isFinite) ||
    !Number.isFinite(radius) ||
    radius < 1e-8
  )
    throw new Error("Drag a positive circle radius.");
  const c = { id: crypto.randomUUID(), x: center[0], y: center[1] };
  const a = { id: crypto.randomUUID(), x: edge[0], y: edge[1] };
  const b = {
    id: crypto.randomUUID(),
    x: 2 * center[0] - edge[0],
    y: 2 * center[1] - edge[1],
  };
  const next: Sketch = {
    ...sketch,
    points: [...sketch.points, c, a, b],
    arcs: [
      ...(sketch.arcs ?? []),
      {
        id: crypto.randomUUID(),
        a: a.id,
        b: b.id,
        center: c.id,
        clockwise: false,
      },
      {
        id: crypto.randomUUID(),
        a: b.id,
        b: a.id,
        center: c.id,
        clockwise: false,
      },
    ],
  };
  return finishCurve(next);
}

export function drawThreePointCurve(
  sketch: Sketch,
  picked: [SketchUV, SketchUV, SketchUV],
  kind: "circle3" | "arc3",
): Sketch {
  validateSketch(sketch);
  const { center, clockwise } = circleThroughThreePoints(...picked);
  if (kind === "circle3") return drawSketchCircle(sketch, center, picked[0]);
  const a = { id: crypto.randomUUID(), x: picked[0][0], y: picked[0][1] },
    b = { id: crypto.randomUUID(), x: picked[2][0], y: picked[2][1] },
    c = { id: crypto.randomUUID(), x: center[0], y: center[1] };
  const next: Sketch = {
    ...sketch,
    points: [...sketch.points, a, b, c],
    arcs: [
      ...(sketch.arcs ?? []),
      { id: crypto.randomUUID(), a: a.id, b: b.id, center: c.id, clockwise },
    ],
  };
  return finishCurve(next);
}

export function previewSketchCurve(
  tool: SketchDrawingTool,
  picked: SketchUV[],
): SketchUV[] {
  let center: SketchUV,
    radius: number,
    start = 0,
    sweep = Math.PI * 2;
  if (tool === "circle" && picked.length === 2) {
    center = picked[0];
    radius = Math.hypot(picked[1][0] - center[0], picked[1][1] - center[1]);
  } else if ((tool === "circle3" || tool === "arc3") && picked.length === 3) {
    try {
      const circle = circleThroughThreePoints(picked[0], picked[1], picked[2]);
      center = circle.center;
      radius = circle.radius;
      if (tool === "arc3") {
        start = Math.atan2(picked[0][1] - center[1], picked[0][0] - center[0]);
        sweep =
          Math.atan2(picked[2][1] - center[1], picked[2][0] - center[0]) -
          start;
        if (circle.clockwise) {
          while (sweep >= 0) sweep -= Math.PI * 2;
        } else {
          while (sweep <= 0) sweep += Math.PI * 2;
        }
      }
    } catch {
      return picked;
    }
  } else return picked;
  return Array.from({ length: 73 }, (_, i) => [
    center[0] + radius * Math.cos(start + (sweep * i) / 72),
    center[1] + radius * Math.sin(start + (sweep * i) / 72),
  ]);
}

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
  const fixedOriginIds: string[] = [];
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
    const atOrigin = constraints && Math.hypot(x, y) <= tolerance;
    const p = { id: id(), x: atOrigin ? 0 : x, y: atOrigin ? 0 : y };
    if (atOrigin) fixedOriginIds.push(p.id);
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
          ...fixedOriginIds.map((point) => ({
            id: id(),
            kind: "fixed" as const,
            point,
            x: 0,
            y: 0,
          })),
          { id: id(), kind: relation, segment: segment.id },
        ]
      : [
          ...sketch.constraints,
          ...fixedOriginIds.map((point) => ({
            id: id(),
            kind: "fixed" as const,
            point,
            x: 0,
            y: 0,
          })),
        ],
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
