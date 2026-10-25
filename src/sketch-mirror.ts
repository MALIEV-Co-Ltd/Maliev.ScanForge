import {
  validateSketch,
  type Sketch,
  type SketchArc,
  type SketchSegment,
} from "./sketch";

export const SKETCH_MIRROR_LIMITS = Object.freeze({
  points: 32768,
  curves: 8192,
  constraints: 4096,
  selectedCurves: 4096,
  work: 2000000,
});
export interface SketchMirrorRequest {
  axis: string;
  curveIds: string[];
}
export interface SketchMirrorOptions {
  signal?: AbortSignal;
  check?: () => void;
}
export interface SketchMirrorResult {
  sketch: Sketch;
  pointMap: Record<string, string>;
  curveMap: Record<string, string>;
  createdPointIds: string[];
  createdCurveIds: string[];
}

function validationCost(sketch: Sketch) {
  let cost =
    sketch.points.length +
    sketch.segments.length +
    (sketch.arcs?.length ?? 0) +
    sketch.constraints.length * 8 +
    (Array.isArray(sketch.reference?.segments)
      ? sketch.reference.segments.length
      : 0);
  for (const c of sketch.constraints)
    if (c?.kind === "symmetric")
      cost += 2 * sketch.points.length + sketch.segments.length;
  return cost;
}

/** Copy analytic primitives across a construction line without creating relations. */
export async function mirrorSketch(
  sketch: Sketch,
  request: SketchMirrorRequest,
  options: SketchMirrorOptions = {},
): Promise<SketchMirrorResult> {
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
    throw Error("Unsupported sketch mirror structure.");
  if (
    sketch.points.length > SKETCH_MIRROR_LIMITS.points ||
    sketch.segments.length + (sketch.arcs?.length ?? 0) >
      SKETCH_MIRROR_LIMITS.curves ||
    sketch.constraints.length > SKETCH_MIRROR_LIMITS.constraints
  )
    throw Error("Sketch mirror collection limit exceeded.");
  if (
    !request ||
    typeof request.axis !== "string" ||
    !request.axis ||
    !Array.isArray(request.curveIds) ||
    !request.curveIds.length ||
    request.curveIds.some((id) => typeof id !== "string" || !id)
  )
    throw Error("Choose a construction axis and nonempty curve selection.");
  if (request.curveIds.length > SKETCH_MIRROR_LIMITS.selectedCurves)
    throw Error("Sketch mirror selected curve limit exceeded.");
  const selected = new Set(request.curveIds);
  if (selected.size !== request.curveIds.length || selected.has(request.axis))
    throw Error("Mirror selection must be unique and exclude the axis.");
  let workCount = validationCost(sketch),
    lastYield = 0;
  if (workCount > SKETCH_MIRROR_LIMITS.work)
    throw Error("Sketch mirror validation work budget exceeded.");
  const work = (count = 1) => {
    options.signal?.throwIfAborted();
    workCount += count;
    if (workCount > SKETCH_MIRROR_LIMITS.work)
      throw Error("Sketch mirror work budget exceeded.");
  };
  const pause = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    lastYield = workCount;
    check();
  };
  const yieldWork = async () => {
    if (workCount - lastYield >= 256) await pause();
  };
  // Admit the shared validator's synchronous worst-case searches before calling it.
  await pause();
  validateSketch(sketch);
  check();
  const bounded = (x: number, y: number) =>
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Math.abs(x) <= 1e9 &&
    Math.abs(y) <= 1e9;
  const points = new Map<string, Sketch["points"][number]>(),
    usedIds = new Set<string>();
  for (const p of sketch.points) {
    work();
    if (!bounded(p.x, p.y))
      throw Error("Sketch mirror coordinates are out of bounds.");
    points.set(p.id, p);
    usedIds.add(p.id);
    await yieldWork();
  }
  const curves = new Map<
    string,
    Sketch["segments"][number] | NonNullable<Sketch["arcs"]>[number]
  >();
  for (const collection of [
    sketch.segments,
    sketch.arcs ?? [],
    sketch.constraints,
  ])
    for (const item of collection) {
      work();
      usedIds.add(item.id);
      if ("a" in item && "b" in item && !("kind" in item))
        curves.set(item.id, item);
      await yieldWork();
    }
  const axis = curves.get(request.axis);
  if (!axis || "center" in axis || !axis.construction)
    throw Error("Mirror axis must be an existing straight construction line.");
  const origin = points.get(axis.a)!,
    end = points.get(axis.b)!,
    dx = end.x - origin.x,
    dy = end.y - origin.y,
    length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < 1e-10)
    throw Error("Mirror axis must be nondegenerate and finite.");
  const ux = dx / length,
    uy = dy / length;
  const selectedPoints = new Set<string>();
  for (const id of request.curveIds) {
    work();
    const curve = curves.get(id);
    if (!curve) throw Error(`Unknown mirror curve: ${id}.`);
    selectedPoints.add(curve.a);
    selectedPoints.add(curve.b);
    if ("center" in curve) selectedPoints.add(curve.center);
    await yieldWork();
  }
  if (
    sketch.points.length + selectedPoints.size > SKETCH_MIRROR_LIMITS.points ||
    curves.size + selected.size > SKETCH_MIRROR_LIMITS.curves
  )
    throw Error("Sketch mirror output collection limit exceeded.");
  let pointSerial = 0,
    curveSerial = 0;
  const nextId = async (kind: "point" | "curve") => {
    let id: string;
    do {
      work();
      id = `mirror-${kind}-${kind === "point" ? pointSerial++ : curveSerial++}`;
      await yieldWork();
    } while (usedIds.has(id));
    usedIds.add(id);
    return id;
  };
  const pointMap: Record<string, string> = Object.create(null),
    curveMap: Record<string, string> = Object.create(null),
    createdPointIds: string[] = [],
    createdCurveIds: string[] = [];
  const outputPoints: Sketch["points"] = [],
    copies: Sketch["points"] = [];
  for (const p of sketch.points) {
    work();
    outputPoints.push({ ...p });
    if (selectedPoints.has(p.id)) {
      const x = p.x - origin.x,
        y = p.y - origin.y,
        projection = x * ux + y * uy,
        rx = origin.x + 2 * projection * ux - x,
        ry = origin.y + 2 * projection * uy - y;
      if (!bounded(rx, ry))
        throw Error("Mirrored coordinates are out of bounds.");
      const id = await nextId("point");
      pointMap[p.id] = id;
      createdPointIds.push(id);
      copies.push({ id, x: rx, y: ry });
    }
    await yieldWork();
  }
  outputPoints.push(...copies);
  const segments: Sketch["segments"] = [],
    arcs: NonNullable<Sketch["arcs"]> = [];
  // Preserve stored curve order independently of selection order.
  const curveCollections: (SketchSegment | SketchArc)[][] = [
    sketch.segments,
    sketch.arcs ?? [],
  ];
  for (const collection of curveCollections) {
    const lineCopies: Sketch["segments"] = [],
      arcCopies: NonNullable<Sketch["arcs"]> = [];
    for (const curve of collection) {
      work();
      if ("center" in curve) arcs.push({ ...curve });
      else segments.push({ ...curve });
      if (selected.has(curve.id)) {
        const id = await nextId("curve");
        curveMap[curve.id] = id;
        createdCurveIds.push(id);
        const copy = {
          ...curve,
          id,
          a: pointMap[curve.a],
          b: pointMap[curve.b],
        };
        if ("center" in curve)
          arcCopies.push({
            ...copy,
            center: pointMap[curve.center],
            clockwise: !curve.clockwise,
          });
        else lineCopies.push(copy);
      }
      await yieldWork();
    }
    segments.push(...lineCopies);
    arcs.push(...arcCopies);
  }
  const constraints: Sketch["constraints"] = [];
  for (const c of sketch.constraints) {
    work();
    constraints.push({ ...c });
    await yieldWork();
  }
  let reference: Sketch["reference"];
  if (sketch.reference) {
    const samples: number[] = [];
    for (const n of sketch.reference.segments) {
      work();
      samples.push(n);
      await yieldWork();
    }
    reference = { ...sketch.reference, segments: samples };
  }
  const output: Sketch = {
    ...sketch,
    points: outputPoints,
    segments,
    constraints,
    ...(sketch.arcs !== undefined ? { arcs } : {}),
    ...(sketch.frame ? { frame: structuredClone(sketch.frame) } : {}),
    ...(reference ? { reference } : {}),
  };
  work(validationCost(output));
  await pause();
  validateSketch(output);
  check();
  return {
    sketch: output,
    pointMap,
    curveMap,
    createdPointIds,
    createdCurveIds,
  };
}
