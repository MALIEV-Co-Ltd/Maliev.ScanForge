export interface SketchPoint {
  id: string;
  x: number;
  y: number;
}
export interface SketchSegment {
  id: string;
  a: string;
  b: string;
  construction?: boolean;
}
export interface SketchArc {
  id: string;
  a: string;
  b: string;
  center: string;
  clockwise: boolean;
  construction?: boolean;
}
export type SketchConstraint =
  | { id: string; kind: "fixed"; point: string; x: number; y: number }
  | { id: string; kind: "coincident"; a: string; b: string }
  | { id: string; kind: "horizontal" | "vertical"; segment: string }
  | {
      id: string;
      kind: "distance" | "horizontalDistance" | "verticalDistance";
      a: string;
      b: string;
      value: number;
    }
  | { id: string; kind: "radius"; arc: string; value: number }
  | {
      id: string;
      kind: "tangent";
      first: string;
      second: string;
      point: string;
    }
  | {
      id: string;
      kind: "parallel" | "perpendicular" | "equal";
      first: string;
      second: string;
    }
  | { id: string; kind: "angle"; first: string; second: string; value: number };
export interface Sketch {
  version: 1;
  points: SketchPoint[];
  segments: SketchSegment[];
  arcs?: SketchArc[];
  constraints: SketchConstraint[];
}
export interface SketchSolution {
  sketch: Sketch;
  converged: boolean;
  maxResidual: number;
  conflictingConstraintIds: string[];
  degreesOfFreedom: number;
  iterations: number;
}

export function validateSketch(input: unknown): asserts input is Sketch {
  if (!input || typeof input !== "object")
    throw new Error("Sketch must be an object.");
  const value = input as Record<string, unknown>;
  if (
    value.version !== 1 ||
    !Array.isArray(value.points) ||
    !Array.isArray(value.segments) ||
    !Array.isArray(value.constraints)
  )
    throw new Error("Unsupported sketch structure.");
  const object = (item: unknown): item is Record<string, unknown> =>
    !!item && typeof item === "object" && !Array.isArray(item);
  const string = (item: unknown): item is string =>
    typeof item === "string" && item.length > 0;
  const finite = (item: unknown) =>
    typeof item === "number" && Number.isFinite(item);
  for (const p of value.points)
    if (!object(p) || !string(p.id) || !finite(p.x) || !finite(p.y))
      throw new Error("Sketch point structure is invalid.");
  for (const s of value.segments)
    if (
      !object(s) ||
      !string(s.id) ||
      !string(s.a) ||
      !string(s.b) ||
      (s.construction !== undefined && typeof s.construction !== "boolean")
    )
      throw new Error("Sketch segment structure is invalid.");
  if (value.arcs !== undefined && !Array.isArray(value.arcs))
    throw new Error("Sketch arcs must be an array.");
  for (const arc of (value.arcs as unknown[] | undefined) ?? [])
    if (
      !object(arc) ||
      !string(arc.id) ||
      !string(arc.a) ||
      !string(arc.b) ||
      !string(arc.center) ||
      typeof arc.clockwise !== "boolean" ||
      (arc.construction !== undefined && typeof arc.construction !== "boolean")
    )
      throw new Error("Sketch arc structure is invalid.");
  for (const c of value.constraints) {
    if (!object(c) || !string(c.id) || !string(c.kind))
      throw new Error("Sketch constraint structure is invalid.");
    if (c.kind === "fixed") {
      if (!string(c.point) || !finite(c.x) || !finite(c.y))
        throw new Error("Fixed constraint structure is invalid.");
    } else if (
      c.kind === "coincident" ||
      c.kind === "distance" ||
      c.kind === "horizontalDistance" ||
      c.kind === "verticalDistance"
    ) {
      if (
        !string(c.a) ||
        !string(c.b) ||
        (c.kind !== "coincident" && !finite(c.value))
      )
        throw new Error("Point constraint structure is invalid.");
    } else if (c.kind === "horizontal" || c.kind === "vertical") {
      if (!string(c.segment))
        throw new Error("Segment constraint structure is invalid.");
    } else if (c.kind === "radius") {
      if (!string(c.arc) || !finite(c.value))
        throw new Error("Radius constraint structure is invalid.");
    } else if (c.kind === "tangent") {
      if (!string(c.first) || !string(c.second) || !string(c.point))
        throw new Error("Tangent constraint structure is invalid.");
    } else if (
      ["parallel", "perpendicular", "equal", "angle"].includes(c.kind)
    ) {
      if (
        !string(c.first) ||
        !string(c.second) ||
        (c.kind === "angle" && !finite(c.value))
      )
        throw new Error("Angular constraint structure is invalid.");
    } else throw new Error("Unknown sketch constraint kind.");
  }
  const sketch = input as Sketch;
  if (sketch.version !== 1) throw new Error("Unsupported sketch version.");
  const ids = new Set<string>();
  for (const item of [
    ...sketch.points,
    ...sketch.segments,
    ...(sketch.arcs ?? []),
    ...sketch.constraints,
  ]) {
    if (!item.id || ids.has(item.id))
      throw new Error("Sketch IDs must be unique.");
    ids.add(item.id);
  }
  const points = new Set(sketch.points.map((p) => p.id));
  const segments = new Set(sketch.segments.map((s) => s.id));
  const arcs = new Map((sketch.arcs ?? []).map((arc) => [arc.id, arc]));
  const curves = new Map(
    [...sketch.segments, ...(sketch.arcs ?? [])].map((curve) => [
      curve.id,
      curve,
    ]),
  );
  for (const p of sketch.points)
    if (![p.x, p.y].every(Number.isFinite))
      throw new Error("Sketch coordinates must be finite.");
  for (const s of sketch.segments)
    if (!points.has(s.a) || !points.has(s.b) || s.a === s.b)
      throw new Error("Segment references are invalid.");
  for (const arc of arcs.values())
    if (
      !points.has(arc.a) ||
      !points.has(arc.b) ||
      !points.has(arc.center) ||
      new Set([arc.a, arc.b, arc.center]).size !== 3
    )
      throw new Error(
        "Arc references must identify distinct endpoints and center.",
      );
  for (const c of sketch.constraints) {
    const refs =
      c.kind === "fixed"
        ? [c.point]
        : c.kind === "coincident" ||
            c.kind === "distance" ||
            c.kind === "horizontalDistance" ||
            c.kind === "verticalDistance"
          ? [c.a, c.b]
          : [];
    if (refs.some((id) => !points.has(id)))
      throw new Error("Constraint point is missing.");
    if (
      (c.kind === "horizontal" || c.kind === "vertical") &&
      !segments.has(c.segment)
    )
      throw new Error("Constraint segment is missing.");
    if (c.kind === "radius" && (!arcs.has(c.arc) || c.value <= 0))
      throw new Error("Radius requires an arc and a positive dimension.");
    if (c.kind === "tangent") {
      const a = curves.get(c.first),
        b = curves.get(c.second);
      if (
        !a ||
        !b ||
        c.first === c.second ||
        (!arcs.has(c.first) && !arcs.has(c.second)) ||
        ![a.a, a.b].includes(c.point) ||
        ![b.a, b.b].includes(c.point)
      )
        throw new Error(
          "Tangency requires an arc and curves sharing the specified endpoint.",
        );
    }
    if (
      "first" in c &&
      c.kind !== "tangent" &&
      (!segments.has(c.first) || !segments.has(c.second))
    )
      throw new Error("Constraint segment is missing.");
    if (
      "value" in c &&
      (!Number.isFinite(c.value) ||
        (["distance", "horizontalDistance", "verticalDistance"].includes(
          c.kind,
        ) &&
          c.value < 0))
    )
      throw new Error("Constraint dimension is invalid.");
    if (c.kind === "fixed" && ![c.x, c.y].every(Number.isFinite))
      throw new Error("Fixed point is invalid.");
  }
}
export function parseSketch(text: string): Sketch {
  const input: unknown = JSON.parse(text);
  validateSketch(input);
  return input;
}
export function serializeSketch(sketch: Sketch): string {
  validateSketch(sketch);
  return JSON.stringify(sketch);
}

/** Remove a primitive and only relations whose referenced geometry disappeared. */
export function removeSketchGeometry(
  sketch: Sketch,
  kind: "point" | "segment" | "arc",
  id: string,
): Sketch {
  validateSketch(sketch);
  const points = sketch.points.filter((p) => kind !== "point" || p.id !== id);
  const pointIds = new Set(points.map((p) => p.id));
  const segments = sketch.segments.filter(
    (s) =>
      (kind !== "segment" || s.id !== id) &&
      pointIds.has(s.a) &&
      pointIds.has(s.b),
  );
  const arcs = (sketch.arcs ?? []).filter(
    (a) =>
      (kind !== "arc" || a.id !== id) &&
      [a.a, a.b, a.center].every((p) => pointIds.has(p)),
  );
  const segmentIds = new Set(segments.map((s) => s.id));
  const arcIds = new Set(arcs.map((a) => a.id));
  const curveIds = new Set([...segmentIds, ...arcIds]);
  const constraints = sketch.constraints.filter((c) => {
    if (c.kind === "fixed") return pointIds.has(c.point);
    if (
      c.kind === "coincident" ||
      c.kind === "distance" ||
      c.kind === "horizontalDistance" ||
      c.kind === "verticalDistance"
    )
      return pointIds.has(c.a) && pointIds.has(c.b);
    if (c.kind === "horizontal" || c.kind === "vertical")
      return segmentIds.has(c.segment);
    if (c.kind === "radius") return arcIds.has(c.arc);
    if (c.kind === "tangent")
      return (
        pointIds.has(c.point) && curveIds.has(c.first) && curveIds.has(c.second)
      );
    return "first" in c && segmentIds.has(c.first) && segmentIds.has(c.second);
  });
  const next = {
    ...sketch,
    points,
    segments,
    arcs: sketch.arcs === undefined ? undefined : arcs,
    constraints,
  };
  validateSketch(next);
  return next;
}

function rank(matrix: number[][], tolerance = 1e-7) {
  const a = matrix.map((r) => [...r]);
  let pivot = 0;
  for (
    let column = 0;
    column < (a[0]?.length ?? 0) && pivot < a.length;
    column++
  ) {
    let best = pivot;
    for (let row = pivot + 1; row < a.length; row++)
      if (Math.abs(a[row][column]) > Math.abs(a[best][column])) best = row;
    if (Math.abs(a[best][column]) < tolerance) continue;
    [a[pivot], a[best]] = [a[best], a[pivot]];
    const divisor = a[pivot][column];
    for (let j = column; j < a[pivot].length; j++) a[pivot][j] /= divisor;
    for (let row = pivot + 1; row < a.length; row++) {
      const factor = a[row][column];
      for (let j = column; j < a[row].length; j++)
        a[row][j] -= factor * a[pivot][j];
    }
    pivot++;
  }
  return pivot;
}
function linear(a: number[][], b: number[]) {
  const m = a.map((r, i) => [...r, b[i]]);
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let best = i;
    for (let k = i + 1; k < n; k++)
      if (Math.abs(m[k][i]) > Math.abs(m[best][i])) best = k;
    [m[i], m[best]] = [m[best], m[i]];
    if (Math.abs(m[i][i]) < 1e-20) return null;
    const v = m[i][i];
    for (let j = i; j <= n; j++) m[i][j] /= v;
    for (let k = 0; k < n; k++)
      if (k !== i) {
        const f = m[k][i];
        for (let j = i; j <= n; j++) m[k][j] -= f * m[i][j];
      }
  }
  return m.map((r) => r[n]);
}

/** Damped least-squares solver. Angle dimensions are signed degrees; DOF is local Jacobian nullity. */
export function solveSketch(
  input: Sketch,
  tolerance = 1e-6,
  maxIterations = 100,
): SketchSolution {
  validateSketch(input);
  if (!(tolerance > 0) || !Number.isFinite(tolerance))
    throw new Error("Solver tolerance must be positive.");
  const index = new Map(input.points.map((p, i) => [p.id, i * 2]));
  const segments = new Map(input.segments.map((s) => [s.id, s]));
  const arcs = new Map((input.arcs ?? []).map((arc) => [arc.id, arc]));
  const point = (x: number[], id: string) => {
    const i = index.get(id)!;
    return [x[i], x[i + 1]];
  };
  const vector = (x: number[], id: string) => {
    const s = segments.get(id)!;
    const a = point(x, s.a),
      b = point(x, s.b);
    return [b[0] - a[0], b[1] - a[1]];
  };
  const residual = (x: number[]) => [
    ...input.constraints.flatMap((c) => {
      if (c.kind === "fixed") {
        const p = point(x, c.point);
        return [p[0] - c.x, p[1] - c.y];
      }
      if (c.kind === "coincident") {
        const a = point(x, c.a),
          b = point(x, c.b);
        return [a[0] - b[0], a[1] - b[1]];
      }
      if (
        c.kind === "distance" ||
        c.kind === "horizontalDistance" ||
        c.kind === "verticalDistance"
      ) {
        const a = point(x, c.a),
          b = point(x, c.b);
        return [
          (c.kind === "distance"
            ? Math.hypot(a[0] - b[0], a[1] - b[1])
            : Math.abs(
                a[c.kind === "horizontalDistance" ? 0 : 1] -
                  b[c.kind === "horizontalDistance" ? 0 : 1],
              )) - c.value,
        ];
      }
      if (c.kind === "radius") {
        const arc = arcs.get(c.arc)!,
          a = point(x, arc.a),
          center = point(x, arc.center);
        return [Math.hypot(a[0] - center[0], a[1] - center[1]) - c.value];
      }
      if (c.kind === "tangent") {
        const tangent = (id: string) => {
          const arc = arcs.get(id);
          if (!arc) return vector(x, id);
          const p = point(x, c.point),
            center = point(x, arc.center);
          return [-(p[1] - center[1]), p[0] - center[0]];
        };
        const a = tangent(c.first),
          b = tangent(c.second),
          denominator = Math.hypot(...a) * Math.hypot(...b);
        return [
          denominator < 1e-12 ? 1 : (a[0] * b[1] - a[1] * b[0]) / denominator,
        ];
      }
      if (c.kind === "horizontal" || c.kind === "vertical") {
        const v = vector(x, c.segment);
        return [v[c.kind === "horizontal" ? 1 : 0]];
      }
      if (!("first" in c)) throw new Error("Unsupported segment constraint.");
      const a = vector(x, c.first),
        b = vector(x, c.second),
        la = Math.hypot(...a),
        lb = Math.hypot(...b);
      if (c.kind === "equal") return [la - lb];
      if (la < 1e-10 || lb < 1e-10) return [1];
      const cross = (a[0] * b[1] - a[1] * b[0]) / (la * lb),
        dot = (a[0] * b[0] + a[1] * b[1]) / (la * lb);
      if (c.kind === "parallel") return [cross];
      if (c.kind === "perpendicular") return [dot];
      if (!("value" in c)) throw new Error("Angle dimension is missing.");
      const delta = Math.atan2(cross, dot) - (c.value * Math.PI) / 180;
      return [Math.atan2(Math.sin(delta), Math.cos(delta))];
    }),
    ...[...arcs.values()].map((arc) => {
      const a = point(x, arc.a),
        b = point(x, arc.b),
        c = point(x, arc.center);
      const ra = Math.hypot(a[0] - c[0], a[1] - c[1]),
        rb = Math.hypot(b[0] - c[0], b[1] - c[1]);
      return Math.min(ra, rb) < 1e-10 ? 1 : ra - rb;
    }),
  ];
  const jacobian = (x: number[], r: number[]) => {
    const j = r.map(() => Array(x.length).fill(0) as number[]);
    for (let k = 0; k < x.length; k++) {
      const h = 1e-5 * Math.max(1, Math.abs(x[k]));
      const t = [...x];
      t[k] += h;
      const rr = residual(t);
      for (let i = 0; i < r.length; i++) j[i][k] = (rr[i] - r[i]) / h;
    }
    return j;
  };
  let x = input.points.flatMap((p) => [p.x, p.y]),
    r = residual(x),
    damping = 1e-3,
    iterations = 0;
  const cost = (v: number[]) => v.reduce((sum, n) => sum + n * n, 0);
  for (
    ;
    iterations < maxIterations && r.some((v) => Math.abs(v) > tolerance);
    iterations++
  ) {
    const j = jacobian(x, r),
      n = x.length;
    const a = Array.from({ length: n }, (_, i) =>
      Array.from(
        { length: n },
        (_, k) =>
          j.reduce((s, row) => s + row[i] * row[k], 0) +
          (i === k ? damping : 0),
      ),
    );
    const b = Array.from(
      { length: n },
      (_, i) => -j.reduce((s, row, k) => s + row[i] * r[k], 0),
    );
    const delta = linear(a, b);
    if (!delta) break;
    const trial = x.map((v, i) => v + delta[i]),
      next = residual(trial);
    if (cost(next) < cost(r)) {
      x = trial;
      r = next;
      damping = Math.max(1e-12, damping / 3);
    } else damping *= 10;
    if (damping > 1e12) break;
  }
  let cursor = 0;
  const conflictingConstraintIds = input.constraints
    .filter((c) => {
      const count = c.kind === "fixed" || c.kind === "coincident" ? 2 : 1;
      const values = r.slice(cursor, cursor + count);
      cursor += count;
      return values.some((v) => Math.abs(v) > tolerance);
    })
    .map((c) => c.id);
  [...arcs.values()].forEach((arc, i) => {
    if (Math.abs(r[cursor + i]) > tolerance)
      conflictingConstraintIds.push(`arc:${arc.id}`);
  });
  return {
    sketch: {
      ...input,
      points: input.points.map((p, i) => ({
        ...p,
        x: x[i * 2],
        y: x[i * 2 + 1],
      })),
    },
    converged: !conflictingConstraintIds.length,
    maxResidual: Math.max(0, ...r.map(Math.abs)),
    conflictingConstraintIds,
    degreesOfFreedom: Math.max(0, x.length - rank(jacobian(x, r))),
    iterations,
  };
}

/** Sample a circular edge without its end point, using a maximum chord sag in mm. */
export function sampleSketchArc(
  sketch: Sketch,
  arc: SketchArc,
  reverse = false,
  chordTolerance = 0.1,
): [number, number][] {
  if (!Number.isFinite(chordTolerance) || chordTolerance <= 0)
    throw new Error("Arc chord tolerance must be positive.");
  const get = (id: string) => {
    const p = sketch.points.find((p) => p.id === id);
    if (!p) throw new Error("Arc point is missing.");
    return p;
  };
  const a = get(reverse ? arc.b : arc.a),
    b = get(reverse ? arc.a : arc.b),
    c = get(arc.center),
    radius = Math.hypot(a.x - c.x, a.y - c.y),
    endRadius = Math.hypot(b.x - c.x, b.y - c.y);
  if (
    radius < 1e-8 ||
    Math.abs(radius - endRadius) > Math.max(1e-5, radius * 1e-6)
  )
    throw new Error(
      "Arc endpoints must lie on the same positive-radius circle; solve constraints first.",
    );
  const start = Math.atan2(a.y - c.y, a.x - c.x),
    end = Math.atan2(b.y - c.y, b.x - c.x),
    clockwise = reverse ? !arc.clockwise : arc.clockwise;
  let sweep = end - start;
  if (clockwise) {
    while (sweep >= 0) sweep -= 2 * Math.PI;
  } else {
    while (sweep <= 0) sweep += 2 * Math.PI;
  }
  const maxAngle = Math.min(
    Math.PI / 18,
    2 * Math.acos(Math.max(-1, 1 - chordTolerance / radius)),
  );
  const steps = Math.ceil(Math.abs(sweep) / maxAngle);
  if (!Number.isFinite(steps) || steps > 8192)
    throw new Error(
      "Arc sampling exceeds 8192 segments; increase chord tolerance.",
    );
  return Array.from({ length: steps }, (_, i) => {
    const t = start + (sweep * i) / steps;
    return [c.x + radius * Math.cos(t), c.y + radius * Math.sin(t)];
  });
}

/** Traverse one mixed line/arc cycle. Arcs become polygon chords for extrusion. */
export function sketchProfile(
  sketch: Sketch,
  chordTolerance = 0.1,
): [number, number][] {
  validateSketch(sketch);
  const curves = [...sketch.segments, ...(sketch.arcs ?? [])].filter(
    (curve) => !curve.construction,
  );
  if (curves.length < 2)
    throw new Error("Extrusion requires one closed profile.");
  const adjacent = new Map(sketch.points.map((p) => [p.id, [] as string[]]));
  for (const s of curves) {
    adjacent.get(s.a)!.push(s.id);
    adjacent.get(s.b)!.push(s.id);
  }
  if ([...adjacent.values()].some((v) => v.length !== 0 && v.length !== 2))
    throw new Error("Profile must be a single unbranched cycle.");
  const points = new Map(sketch.points.map((p) => [p.id, p]));
  const byId = new Map(curves.map((curve) => [curve.id, curve])),
    used = new Set<string>();
  const byArcId = new Map((sketch.arcs ?? []).map((arc) => [arc.id, arc]));
  const profile: [number, number][] = [];
  const start = curves[0].a;
  let current = start,
    previous = "";
  while (used.size < curves.length) {
    const id = adjacent
      .get(current)!
      .find((id) => id !== previous && !used.has(id));
    if (!id) break;
    const curve = byId.get(id)!;
    used.add(id);
    const arc = byArcId.get(id);
    if (arc)
      profile.push(
        ...sampleSketchArc(sketch, arc, arc.b === current, chordTolerance),
      );
    else {
      const point = points.get(current)!;
      profile.push([point.x, point.y]);
    }
    current = curve.a === current ? curve.b : curve.a;
    previous = id;
    if (current === start) break;
  }
  if (current !== start || used.size !== curves.length)
    throw new Error("Profile contains disconnected cycles.");
  if (profile.length < 3)
    throw new Error("Profile must enclose a nonzero area.");
  const cross = (a: number[], b: number[], c: number[]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  let area = 0;
  for (let i = 0; i < profile.length; i++) {
    const a = profile[i],
      b = profile[(i + 1) % profile.length];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-8)
      throw new Error("Profile has zero-length edges.");
    area += a[0] * b[1] - a[1] * b[0];
    for (let j = i + 2; j < profile.length; j++) {
      if (i === 0 && j === profile.length - 1) continue;
      const c = profile[j],
        d = profile[(j + 1) % profile.length];
      if (
        cross(a, b, c) * cross(a, b, d) <= 0 &&
        cross(c, d, a) * cross(c, d, b) <= 0 &&
        Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) <=
          Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) &&
        Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])) <=
          Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1]))
      )
        throw new Error("Profile edges intersect.");
    }
  }
  if (Math.abs(area) < 1e-8) throw new Error("Profile area is zero.");
  return profile;
}

export function rectangleSketch(width = 40, height = 30): Sketch {
  return {
    version: 1,
    points: [
      { id: "p1", x: 0, y: 0 },
      { id: "p2", x: width, y: 0 },
      { id: "p3", x: width, y: height },
      { id: "p4", x: 0, y: height },
    ],
    segments: [
      { id: "s1", a: "p1", b: "p2" },
      { id: "s2", a: "p2", b: "p3" },
      { id: "s3", a: "p3", b: "p4" },
      { id: "s4", a: "p4", b: "p1" },
    ],
    constraints: [
      { id: "c1", kind: "fixed", point: "p1", x: 0, y: 0 },
      { id: "c2", kind: "horizontal", segment: "s1" },
      { id: "c3", kind: "vertical", segment: "s2" },
      { id: "c4", kind: "horizontal", segment: "s3" },
      { id: "c5", kind: "vertical", segment: "s4" },
      { id: "c6", kind: "distance", a: "p1", b: "p2", value: width },
      { id: "c7", kind: "distance", a: "p2", b: "p3", value: height },
    ],
  };
}

/** Resolve a new relation atomically; a failed solve leaves the caller's draft intact. */
export function constrainSketch(
  sketch: Sketch,
  constraint: SketchConstraint,
): Sketch {
  const solution = solveSketch({
    ...sketch,
    constraints: [...sketch.constraints, constraint],
  });
  if (!solution.converged)
    throw new Error(`Conflicting or unsolved constraint: ${constraint.kind}.`);
  return solution.sketch;
}
