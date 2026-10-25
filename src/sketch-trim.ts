import {
  validateSketch,
  type Sketch,
  type SketchArc,
  type SketchSegment,
} from "./sketch";

export const SKETCH_TRIM_LIMITS = Object.freeze({
  strokePoints: 4096,
  points: 32768,
  constraints: 4096,
  curves: 512,
  intersections: 65536,
  outputCurves: 8192,
  work: 2000000,
});
export interface SketchTrimStroke {
  stroke: [number, number][];
  radiusMm: number;
}
export interface SketchTrimOptions {
  signal?: AbortSignal;
  check?: () => void;
}
export interface SketchTrimResult {
  sketch: Sketch;
  changed: boolean;
  removedCurveIds: string[];
  retainedCurveIds: string[];
  intersectionCount: number;
}
type UV = [number, number];
type Curve = {
  kind: "line" | "arc";
  sources: (SketchSegment | SketchArc)[];
  a: UV;
  b: UV;
  center?: UV;
  radius?: number;
  start?: number;
  sweep?: number;
  periodic: boolean;
  cuts: number[];
  tolerance?: number;
  geometryTolerance?: number;
};
const TAU = 2 * Math.PI;
const geometryTolerance = (...points: UV[]) => {
  let scale = 1;
  for (const p of points)
    scale = Math.max(scale, Math.abs(p[0]), Math.abs(p[1]));
  return Math.max(1e-10, scale * Number.EPSILON * 4);
};
const cross = (a: UV, b: UV) => a[0] * b[1] - a[1] * b[0];
const sub = (a: UV, b: UV): UV => [a[0] - b[0], a[1] - b[1]];
const distance = (a: UV, b: UV) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const positive = (x: number) => ((x % TAU) + TAU) % TAU;
function at(c: Curve, t: number): UV {
  return c.kind === "line"
    ? [c.a[0] + (c.b[0] - c.a[0]) * t, c.a[1] + (c.b[1] - c.a[1]) * t]
    : [
        c.center![0] + c.radius! * Math.cos(c.start! + c.sweep! * t),
        c.center![1] + c.radius! * Math.sin(c.start! + c.sweep! * t),
      ];
}
function retainedArcIsLine(c: Curve, lo: number, hi: number): boolean {
  if (c.periodic) return false;
  const middle = at(c, (lo + hi) * 0.5),
    first = sub(at(c, lo), middle),
    last = sub(at(c, hi), middle);
  for (const chord of [first, last]) {
    const length = Math.sqrt(chord[1] * chord[1] + chord[0] * chord[0]);
    if (length >= 2 ** -52) {
      const reciprocal = 1 / length;
      chord[0] *= reciprocal;
      chord[1] *= reciprocal;
    }
  }
  // Installed CRT cosine at 0.0008726646259971648; equality retains an arc.
  return Math.abs(first[1] * last[1] + first[0] * last[0]) > 0.9999996192282494;
}
function parameter(c: Curve, p: UV): number {
  if (c.kind === "line") {
    const d = sub(c.b, c.a);
    return (
      ((p[0] - c.a[0]) * d[0] + (p[1] - c.a[1]) * d[1]) /
      (d[0] * d[0] + d[1] * d[1])
    );
  }
  const angle = Math.atan2(p[1] - c.center![1], p[0] - c.center![0]);
  let delta =
    c.sweep! > 0 ? positive(angle - c.start!) : positive(c.start! - angle);
  if (TAU - delta <= (c.tolerance ?? 1e-14) * Math.abs(c.sweep!)) delta = 0;
  return delta / Math.abs(c.sweep!);
}
function inRange(
  c: Curve,
  t: number,
  lo = 0,
  hi = 1,
  tol = c.tolerance ?? 1e-10,
) {
  if (c.periodic) {
    while (t < lo - tol) t += 1;
    while (t > hi + tol && t - 1 >= lo - tol) t -= 1;
  }
  return t >= lo - tol && t <= hi + tol;
}
function pointSegment(p: UV, a: UV, b: UV) {
  const d = sub(b, a),
    length = d[0] * d[0] + d[1] * d[1],
    t = length
      ? Math.max(
          0,
          Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / length),
        )
      : 0;
  return distance(p, [a[0] + d[0] * t, a[1] + d[1] * t]);
}
function lineCircle(a: UV, b: UV, center: UV, r: number, tol: number): UV[] {
  const d = sub(b, a),
    offset = sub(a, center),
    length = Math.hypot(...d);
  if (!length) return [];
  const unit: UV = [d[0] / length, d[1] / length],
    projection = -(offset[0] * unit[0] + offset[1] * unit[1]);
  const nearest: UV = [
    offset[0] + projection * unit[0],
    offset[1] + projection * unit[1],
  ];
  const squared = r * r - nearest[0] * nearest[0] - nearest[1] * nearest[1];
  if (squared < -tol * (2 * r + tol)) return [];
  const h = Math.sqrt(Math.max(0, squared));
  return h <= tol
    ? [[a[0] + projection * unit[0], a[1] + projection * unit[1]]]
    : [projection - h, projection + h].map(
        (t) => [a[0] + t * unit[0], a[1] + t * unit[1]] as UV,
      );
}
function intersections(a: Curve, b: Curve, tol: number): UV[] {
  if (a.kind === "line" && b.kind === "line") {
    const u = sub(a.b, a.a),
      v = sub(b.b, b.a),
      delta = sub(b.a, a.a),
      den = cross(u, v),
      scale = Math.hypot(...u) * Math.hypot(...v);
    if (Math.abs(den) <= scale * 1e-12) {
      if (Math.abs(cross(delta, u)) <= tol * Math.hypot(...u)) {
        const ts = [parameter(a, b.a), parameter(a, b.b)].sort((x, y) => x - y),
          lo = Math.max(0, ts[0]),
          hi = Math.min(1, ts[1]);
        if (hi - lo > tol / Math.hypot(...u))
          throw Error("Coincident overlapping sketch curves are ambiguous.");
        if (hi >= lo) return [at(a, (lo + hi) / 2)];
      }
      return [];
    }
    const t = cross(delta, v) / den,
      s = cross(delta, u) / den;
    return inRange(a, t) && inRange(b, s)
      ? [at(a, Math.max(0, Math.min(1, t)))]
      : [];
  }
  if (a.kind === "line" || b.kind === "line") {
    const line = a.kind === "line" ? a : b,
      arc = a.kind === "arc" ? a : b;
    return lineCircle(line.a, line.b, arc.center!, arc.radius!, tol).filter(
      (p) =>
        inRange(line, parameter(line, p)) && inRange(arc, parameter(arc, p)),
    );
  }
  const delta = sub(b.center!, a.center!),
    d = Math.hypot(...delta),
    r = a.radius!,
    s = b.radius!;
  if (d <= tol && Math.abs(r - s) <= tol) {
    // Distinct co-circular open arcs can meet at endpoints, but must not overlap.
    const candidates = [a.a, a.b, b.a, b.b];
    const interior = (curve: Curve, p: UV) =>
      inRange(curve, parameter(curve, p), 0, 1, -(curve.tolerance ?? 1e-10));
    if (
      a.periodic ||
      b.periodic ||
      interior(a, b.a) ||
      interior(a, b.b) ||
      interior(b, a.a) ||
      interior(b, a.b) ||
      interior(a, at(b, 0.5)) ||
      interior(b, at(a, 0.5))
    )
      throw Error("Coincident overlapping arcs are ambiguous.");
    return candidates.filter(
      (p) => inRange(a, parameter(a, p)) && inRange(b, parameter(b, p)),
    );
  }
  if (d <= tol || d > r + s + tol || d < Math.abs(r - s) - tol) return [];
  const along = (r * r - s * s + d * d) / (2 * d),
    h2 = r * r - along * along;
  if (h2 < -tol * (2 * r + tol)) return [];
  const x = a.center![0] + (along * delta[0]) / d,
    y = a.center![1] + (along * delta[1]) / d,
    h = Math.sqrt(Math.max(0, h2)),
    offset: UV = [(-delta[1] * h) / d, (delta[0] * h) / d];
  return (
    h <= tol
      ? [[x, y] as UV]
      : ([
          [x + offset[0], y + offset[1]],
          [x - offset[0], y - offset[1]],
        ] as UV[])
  ).filter((p) => inRange(a, parameter(a, p)) && inRange(b, parameter(b, p)));
}
function pointArc(p: UV, c: Curve, lo: number, hi: number) {
  const radial = parameter(c, p);
  return Math.min(
    distance(p, at(c, lo)),
    distance(p, at(c, hi)),
    inRange(c, radial, lo, hi)
      ? Math.abs(distance(p, c.center!) - c.radius!)
      : Infinity,
  );
}
function capsuleHit(
  c: Curve,
  lo: number,
  hi: number,
  a: UV,
  b: UV,
  r: number,
  tol: number,
) {
  const first = at(c, lo),
    last = at(c, hi);
  if (c.kind === "line") {
    const part: Curve = {
      ...c,
      a: first,
      b: last,
      periodic: false,
      tolerance: tol / distance(first, last),
    };
    const stroke: Curve = {
      kind: "line",
      sources: [],
      a,
      b,
      periodic: false,
      cuts: [],
      tolerance: tol / Math.max(distance(a, b), tol),
    };
    const u = sub(last, first),
      v = sub(b, a);
    if (
      Math.abs(cross(u, v)) > Math.hypot(...u) * Math.hypot(...v) * 1e-12 &&
      intersections(part, stroke, tol).length
    )
      return true;
    return (
      Math.min(
        pointSegment(first, a, b),
        pointSegment(last, a, b),
        pointSegment(a, first, last),
        pointSegment(b, first, last),
      ) <= r
    );
  }
  let minimum = Math.min(
    pointSegment(first, a, b),
    pointSegment(last, a, b),
    pointArc(a, c, lo, hi),
    pointArc(b, c, lo, hi),
  );
  const direction = sub(b, a),
    length = Math.hypot(...direction);
  if (length > tol) {
    for (const p of lineCircle(a, b, c.center!, c.radius!, tol))
      if (inRange(c, parameter(c, p), lo, hi) && pointSegment(p, a, b) <= tol)
        return true;
    for (const sign of [-1, 1]) {
      const p: UV = [
        c.center![0] - (sign * direction[1] * c.radius!) / length,
        c.center![1] + (sign * direction[0] * c.radius!) / length,
      ];
      if (inRange(c, parameter(c, p), lo, hi))
        minimum = Math.min(minimum, pointSegment(p, a, b));
    }
  }
  return minimum <= r;
}

/** Analytic paint trim. Limits reject work explicitly; no geometry is sampled. */
export async function trimSketchStroke(
  sketch: Sketch,
  request: SketchTrimStroke,
  options: SketchTrimOptions = {},
): Promise<SketchTrimResult> {
  const check = () => {
    options.signal?.throwIfAborted();
    options.check?.();
    options.signal?.throwIfAborted();
  };
  check();
  if (
    !sketch ||
    !Array.isArray(sketch.points) ||
    !Array.isArray(sketch.segments) ||
    !Array.isArray(sketch.constraints) ||
    (sketch.arcs !== undefined && !Array.isArray(sketch.arcs))
  )
    throw Error("Unsupported sketch trim structure.");
  if (
    sketch.points.length > SKETCH_TRIM_LIMITS.points ||
    sketch.segments.length + (sketch.arcs?.length ?? 0) >
      SKETCH_TRIM_LIMITS.curves ||
    sketch.constraints.length > SKETCH_TRIM_LIMITS.constraints
  )
    throw Error("Sketch trim collection limit exceeded.");
  const validationCost = (s: Sketch) => {
    let count =
      s.points.length +
      s.segments.length +
      (s.arcs?.length ?? 0) +
      s.constraints.length * 8;
    for (const c of s.constraints)
      if (c?.kind === "symmetric")
        count += 2 * s.points.length + s.segments.length;
    return count;
  };
  const initialValidationCost = validationCost(sketch);
  if (initialValidationCost > SKETCH_TRIM_LIMITS.work)
    throw Error("Sketch trim validation work budget exceeded.");
  validateSketch(sketch);
  if (
    !request ||
    !Array.isArray(request.stroke) ||
    !request.stroke.length ||
    request.stroke.length > SKETCH_TRIM_LIMITS.strokePoints ||
    !Number.isFinite(request.radiusMm) ||
    request.radiusMm <= 0 ||
    request.radiusMm > 1e9
  )
    throw Error("Invalid trim stroke or stroke point limit exceeded.");
  if (
    request.stroke.some(
      (p) =>
        !Array.isArray(p) ||
        p.length !== 2 ||
        p.some(
          (n) =>
            typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 1e9,
        ),
    )
  )
    throw Error("Trim stroke coordinates must be finite and bounded.");
  if (
    sketch.segments.length + (sketch.arcs?.length ?? 0) >
    SKETCH_TRIM_LIMITS.curves
  )
    throw Error("Sketch trim curve limit exceeded.");
  if (sketch.points.some((p) => Math.abs(p.x) > 1e9 || Math.abs(p.y) > 1e9))
    throw Error("Sketch trim coordinates are out of bounds.");
  if (sketch.points.length > SKETCH_TRIM_LIMITS.points)
    throw Error("Sketch trim point limit exceeded.");
  let workCount = initialValidationCost,
    lastYield = 0;
  const work = () => {
    check();
    if (++workCount > SKETCH_TRIM_LIMITS.work)
      throw Error("Sketch trim work budget exceeded.");
  };
  const yieldWork = async () => {
    if (workCount - lastYield >= 256) {
      lastYield = workCount;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      check();
    }
  };
  const points = new Map(sketch.points.map((p) => [p.id, p])),
    uv = (id: string): UV => {
      const p = points.get(id)!;
      return [p.x, p.y];
    };
  const curves: Curve[] = sketch.segments.map((s) => {
    const a = uv(s.a),
      b = uv(s.b),
      tol = geometryTolerance(a, b);
    if (distance(a, b) <= tol) throw Error("Degenerate sketch trim line.");
    return {
      kind: "line",
      sources: [s],
      a,
      b,
      periodic: false,
      cuts: [],
      geometryTolerance: tol,
    };
  });
  const arcCurves = (sketch.arcs ?? []).map((arc) => {
    const a = uv(arc.a),
      b = uv(arc.b),
      center = uv(arc.center),
      radius = distance(a, center),
      tol = geometryTolerance(a, b, center);
    if (
      radius <= tol ||
      Math.abs(radius - distance(b, center)) > Math.max(tol, radius * 1e-10)
    )
      throw Error(
        "Sketch trim arc endpoints require a matching positive radius.",
      );
    const start = Math.atan2(a[1] - center[1], a[0] - center[0]),
      end = Math.atan2(b[1] - center[1], b[0] - center[0]);
    let magnitude = arc.clockwise
      ? positive(start - end)
      : positive(end - start);
    if (magnitude < 1e-14) magnitude = TAU;
    return {
      kind: "arc",
      sources: [arc],
      a,
      b,
      center,
      radius,
      start,
      sweep: arc.clockwise ? -magnitude : magnitude,
      periodic: magnitude === TAU,
      cuts: [],
      geometryTolerance: tol,
    } as Curve;
  });
  const consumed = new Set<Curve>();
  for (const arc of arcCurves) {
    if (consumed.has(arc)) continue;
    const source = arc.sources[0] as SketchArc;
    const matches = arcCurves.filter((other) => {
      work();
      const candidate = other.sources[0] as SketchArc;
      return (
        other !== arc &&
        !consumed.has(other) &&
        candidate.center === source.center &&
        candidate.a === source.b &&
        candidate.b === source.a &&
        candidate.clockwise === source.clockwise &&
        !!candidate.construction === !!source.construction &&
        Math.abs(Math.abs(arc.sweep!) + Math.abs(other.sweep!) - TAU) < 1e-10
      );
    });
    if (matches.length > 1)
      throw Error("Ambiguous periodic circle representation.");
    if (matches.length === 1) {
      const other = matches[0];
      consumed.add(other);
      arc.sources.push(...other.sources);
      arc.periodic = true;
      arc.sweep = source.clockwise ? -TAU : TAU;
      arc.b = arc.a;
    }
    curves.push(arc);
    await yieldWork();
  }
  for (const c of curves)
    c.tolerance = Math.max(
      Number.EPSILON * 8,
      c.geometryTolerance! /
        (c.kind === "line"
          ? distance(c.a, c.b)
          : c.radius! * Math.abs(c.sweep!)),
    );
  type Vertex = { point: UV; curves: Set<Curve> };
  const vertices: Vertex[] = [];
  const findVertex = (p: UV, curve?: Curve) => {
    for (const v of vertices) {
      work();
      if (
        (!curve || v.curves.has(curve)) &&
        distance(v.point, p) <= geometryTolerance(v.point, p)
      )
        return v;
    }
    return undefined;
  };
  for (let i = 0; i < curves.length; i++)
    for (let j = i + 1; j < curves.length; j++) {
      work();
      const a = curves[i],
        b = curves[j],
        tol = Math.max(a.geometryTolerance!, b.geometryTolerance!);
      for (const p of intersections(a, b, tol)) {
        if (p.some((n) => !Number.isFinite(n) || Math.abs(n) > 1e9))
          throw Error("Trim intersection is out of bounds.");
        let v = findVertex(p);
        if (!v) {
          if (vertices.length >= SKETCH_TRIM_LIMITS.intersections)
            throw Error("Sketch trim intersection limit exceeded.");
          v = { point: p, curves: new Set() };
          vertices.push(v);
        }
        v.curves.add(a);
        v.curves.add(b);
        for (const c of [a, b]) {
          let t = parameter(c, v.point);
          if (c.periodic && Math.abs(t - 1) < c.tolerance!) t = 0;
          let duplicate = false;
          for (const x of c.cuts) {
            work();
            if (Math.abs(x - t) <= c.tolerance!) {
              duplicate = true;
              break;
            }
          }
          if (!duplicate) c.cuts.push(Math.max(0, Math.min(1, t)));
        }
      }
      await yieldWork();
    }
  const plans = new Map<Curve, [number, number][]>();
  for (const c of curves) {
    const tol = c.geometryTolerance!;
    let cuts = c.cuts
      .filter((t) => c.periodic || (t > c.tolerance! && t < 1 - c.tolerance!))
      .sort((a, b) => a - b);
    let cells: [number, number][];
    if (c.periodic)
      cells = cuts.length
        ? cuts.map((t, i) => [
            t,
            i + 1 < cuts.length ? cuts[i + 1] : cuts[0] + 1,
          ])
        : [[0, 1]];
    else {
      cuts = [0, ...cuts, 1];
      cells = cuts.slice(0, -1).map((t, i) => [t, cuts[i + 1]]);
    }
    const kept: [number, number][] = [];
    let changed = false;
    for (const cell of cells) {
      let hit = false;
      for (let i = 0; i < Math.max(1, request.stroke.length - 1); i++) {
        work();
        if (
          capsuleHit(
            c,
            ...cell,
            request.stroke[i],
            request.stroke[Math.min(i + 1, request.stroke.length - 1)],
            request.radiusMm,
            tol,
          )
        )
          hit = true;
        await yieldWork();
        if (hit) break;
      }
      if (hit) changed = true;
      else if (
        kept.length &&
        Math.abs(kept.at(-1)![1] - cell[0]) < c.tolerance!
      )
        kept.at(-1)![1] = cell[1];
      else kept.push([...cell]);
    }
    if (changed) {
      if (
        c.periodic &&
        kept.length > 1 &&
        Math.abs(kept[0][0] - cells[0][0]) < c.tolerance! &&
        Math.abs(kept.at(-1)![1] - cells.at(-1)![1]) < c.tolerance!
      ) {
        const last = kept.pop()!,
          first = kept.shift()!;
        kept.unshift([last[0], first[1] + 1]);
      }
      plans.set(c, kept);
    }
  }
  check();
  if (!plans.size) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    check();
    return {
      sketch,
      changed: false,
      removedCurveIds: [],
      retainedCurveIds: [],
      intersectionCount: vertices.length,
    };
  }
  const affectedIds = new Set(
    [...plans.keys()].flatMap((c) => c.sources.map((s) => s.id)),
  );
  const affectedEndpoints = new Set(
    [...plans.keys()].flatMap((c) => c.sources.flatMap((s) => [s.a, s.b])),
  );
  for (const constraint of sketch.constraints) {
    work();
    await yieldWork();
    const c = constraint as unknown as Record<string, unknown>;
    if (
      ["segment", "arc", "first", "second", "axis"].some((key) =>
        affectedIds.has(c[key] as string),
      ) ||
      ["point", "a", "b"].some((key) => affectedEndpoints.has(c[key] as string))
    )
      throw Error(
        `Trim affects constraint ${constraint.id}; remove the affected relation explicitly first.`,
      );
  }
  const usedIds = new Set(
    [
      ...sketch.points,
      ...sketch.segments,
      ...(sketch.arcs ?? []),
      ...sketch.constraints,
    ].map((v) => v.id),
  );
  let pointSerial = 0,
    curveSerial = 0;
  const nextId = (kind: "point" | "curve") => {
    let id: string;
    do {
      id = `trim-${kind}-${kind === "point" ? pointSerial++ : curveSerial++}`;
    } while (usedIds.has(id));
    usedIds.add(id);
    return id;
  };
  const added: Sketch["points"] = [],
    vertexIds = new Map<Vertex, string>();
  const endpoint = (c: Curve, t: number) => {
    const p = at(c, t),
      tol = c.geometryTolerance!,
      vertex = findVertex(p, c);
    if (vertex) {
      const cached = vertexIds.get(vertex);
      if (cached) return cached;
      for (const other of vertex.curves)
        for (const s of other.sources)
          for (const id of [s.a, s.b]) {
            work();
            if (distance(uv(id), vertex.point) <= tol) {
              vertexIds.set(vertex, id);
              return id;
            }
          }
      const id = nextId("point");
      added.push({ id, x: vertex.point[0], y: vertex.point[1] });
      vertexIds.set(vertex, id);
      return id;
    }
    for (const s of c.sources)
      for (const id of [s.a, s.b]) {
        work();
        if (distance(uv(id), p) <= tol) return id;
      }
    const id = nextId("point");
    added.push({ id, x: p[0], y: p[1] });
    return id;
  };
  const outputRank = new Map(
    [...sketch.segments, ...(sketch.arcs ?? [])].map((source, i) => [
      source.id,
      i,
    ]),
  );
  const segments: SketchSegment[] = [],
    arcs: SketchArc[] = [],
    retainedCurveIds: string[] = [];
  for (const c of curves) {
    await yieldWork();
    check();
    const kept = plans.get(c);
    if (!kept) {
      for (const s of c.sources)
        if (c.kind === "line") segments.push(s as SketchSegment);
        else arcs.push(s as SketchArc);
      continue;
    }
    for (let i = 0; i < kept.length; i++) {
      await yieldWork();
      check();
      const [lo, hi] = kept[i],
        a = endpoint(c, lo),
        b = endpoint(c, hi);
      if (a === b || distance(at(c, lo), at(c, hi)) <= c.geometryTolerance!)
        throw Error("Trim would create a degenerate retained curve.");
      const id = i === 0 ? c.sources[0].id : nextId("curve");
      outputRank.set(
        id,
        outputRank.get(c.sources[0].id)! + i / (kept.length + 1),
      );
      retainedCurveIds.push(id);
      if (c.kind === "line") segments.push({ ...c.sources[0], id, a, b });
      else if (retainedArcIsLine(c, lo, hi))
        segments.push({
          id,
          a,
          b,
          ...(c.sources[0].construction !== undefined
            ? { construction: c.sources[0].construction }
            : {}),
        });
      else arcs.push({ ...(c.sources[0] as SketchArc), id, a, b });
      if (segments.length + arcs.length > SKETCH_TRIM_LIMITS.outputCurves)
        throw Error("Sketch trim output curve limit exceeded.");
    }
  }
  const bySourceOrder = (a: { id: string }, b: { id: string }) =>
    outputRank.get(a.id)! - outputRank.get(b.id)!;
  segments.sort(bySourceOrder);
  arcs.sort(bySourceOrder);
  retainedCurveIds.sort((a, b) => outputRank.get(a)! - outputRank.get(b)!);
  const outputIds = new Set([...segments, ...arcs].map((c) => c.id)),
    removedCurveIds = [...affectedIds].filter((id) => !outputIds.has(id));
  const referenced = new Set([
    ...segments.flatMap((s) => [s.a, s.b]),
    ...arcs.flatMap((a) => [a.a, a.b, a.center]),
  ]);
  for (const c of sketch.constraints) {
    work();
    await yieldWork();
    const record = c as unknown as Record<string, unknown>;
    for (const key of ["point", "a", "b"])
      if (typeof record[key] === "string")
        referenced.add(record[key] as string);
  }
  const candidates = new Set(
    [...plans.keys()].flatMap((c) =>
      c.sources.flatMap((s) =>
        "center" in s ? [s.a, s.b, s.center] : [s.a, s.b],
      ),
    ),
  );
  const result: Sketch = {
    ...sketch,
    points: [
      ...sketch.points.filter(
        (p) => !candidates.has(p.id) || referenced.has(p.id),
      ),
      ...added,
    ],
    segments,
    ...(sketch.arcs !== undefined ? { arcs } : {}),
    constraints: [...sketch.constraints],
  };
  check();
  if (result.points.length > SKETCH_TRIM_LIMITS.points)
    throw Error("Sketch trim output point limit exceeded.");
  workCount += validationCost(result);
  if (workCount > SKETCH_TRIM_LIMITS.work)
    throw Error("Sketch trim validation work budget exceeded.");
  validateSketch(result);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  check();
  return {
    sketch: result,
    changed: true,
    removedCurveIds,
    retainedCurveIds,
    intersectionCount: vertices.length,
  };
}
