import { validateSketch, type Sketch, type SketchConstraint } from "./sketch";

export interface SketchCornerSelection {
  first: string;
  second: string;
  firstEnd: "a" | "b";
  secondEnd: "a" | "b";
}

/** Join explicitly chosen ends of two straight lines; never discard relations. */
export function cornerTrimSketch(
  sketch: Sketch,
  selection: SketchCornerSelection,
): {
  sketch: Sketch;
  intersection: [number, number];
  pointId: string;
  changed: boolean;
} {
  validateSketch(sketch);
  if (
    !selection ||
    !["a", "b"].includes(selection.firstEnd) ||
    !["a", "b"].includes(selection.secondEnd)
  )
    throw new Error("Choose an endpoint a or b for each line.");
  const first = sketch.segments.find((s) => s.id === selection.first);
  const second = sketch.segments.find((s) => s.id === selection.second);
  if (!first || !second || first.id === second.id)
    throw new Error("Choose two distinct existing line segments.");
  if (
    sketch.points.some(
      (p) =>
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        Math.abs(p.x) > 1e9 ||
        Math.abs(p.y) > 1e9,
    )
  )
    throw new Error("Sketch coordinates are out of bounds.");
  const point = (id: string) => sketch.points.find((p) => p.id === id)!;
  const a = point(first.a),
    b = point(first.b),
    c = point(second.a),
    d = point(second.b);
  const dx = b.x - a.x,
    dy = b.y - a.y,
    ex = d.x - c.x,
    ey = d.y - c.y;
  const length = Math.hypot(dx, dy),
    otherLength = Math.hypot(ex, ey);
  if (length < 1e-10 || otherLength < 1e-10)
    throw new Error("Cannot intersect a degenerate line.");
  const determinant = dx * ey - dy * ex;
  if (Math.abs(determinant) <= length * otherLength * 1e-12)
    throw new Error("Parallel or coincident lines have no unique corner.");
  const selectedFirst = first[selection.firstEnd],
    selectedSecond = second[selection.secondEnd];
  if (selectedFirst === selectedSecond)
    return {
      sketch,
      intersection: [point(selectedFirst).x, point(selectedFirst).y],
      pointId: selectedFirst,
      changed: false,
    };
  const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / determinant;
  const intersection: [number, number] = [a.x + t * dx, a.y + t * dy];
  if (intersection.some((n) => !Number.isFinite(n) || Math.abs(n) > 1e9))
    throw new Error("Corner intersection is out of bounds.");
  for (const [line, end] of [
    [first, selection.firstEnd],
    [second, selection.secondEnd],
  ] as const) {
    const retained = point(line[end === "a" ? "b" : "a"]);
    if (
      Math.hypot(retained.x - intersection[0], retained.y - intersection[1]) <
      1e-10
    )
      throw new Error("Corner intersection would collapse a retained line.");
  }
  const selectedPoints = new Set([selectedFirst, selectedSecond]);
  const selectedSegments = new Set([first.id, second.id]);
  const dependent = (constraint: SketchConstraint) => {
    const c = constraint as unknown as Record<string, unknown>;
    return (
      ["point", "a", "b"].some(
        (key) =>
          typeof c[key] === "string" && selectedPoints.has(c[key] as string),
      ) ||
      ["segment", "first", "second", "axis"].some(
        (key) =>
          typeof c[key] === "string" && selectedSegments.has(c[key] as string),
      )
    );
  };
  if (sketch.constraints.some(dependent))
    throw new Error(
      "Corner trim depends on constrained geometry; remove the affected constraints first.",
    );
  for (const line of sketch.segments) {
    for (const end of ["a", "b"] as const) {
      if (!selectedPoints.has(line[end])) continue;
      if (
        (line.id === first.id && end === selection.firstEnd) ||
        (line.id === second.id && end === selection.secondEnd)
      )
        continue;
      throw new Error("Selected endpoint is shared with other geometry.");
    }
  }
  if (
    (sketch.arcs ?? []).some((arc) =>
      [arc.a, arc.b, arc.center].some((id) => selectedPoints.has(id)),
    )
  )
    throw new Error("Selected endpoint is used by an arc.");
  const next: Sketch = {
    ...sketch,
    points: sketch.points
      .filter((p) => p.id !== selectedSecond)
      .map((p) =>
        p.id === selectedFirst
          ? { ...p, x: intersection[0], y: intersection[1] }
          : { ...p },
      ),
    segments: sketch.segments.map((line) =>
      line.id === second.id
        ? { ...line, [selection.secondEnd]: selectedFirst }
        : { ...line },
    ),
    ...(sketch.arcs ? { arcs: sketch.arcs.map((arc) => ({ ...arc })) } : {}),
    constraints: sketch.constraints.map((constraint) => ({ ...constraint })),
  };
  validateSketch(next);
  return { sketch: next, intersection, pointId: selectedFirst, changed: true };
}
