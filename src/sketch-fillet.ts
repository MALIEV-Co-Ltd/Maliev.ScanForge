import { validateSketch, type Sketch, type SketchArc } from "./sketch";
import type { SketchCornerSelection } from "./sketch-corner";

export const SKETCH_FILLET_LIMITS = Object.freeze({
  points: 32768,
  curves: 8192,
  constraints: 4096,
  work: 2000000,
});
export interface SketchFilletRequest extends SketchCornerSelection {
  radiusMm: number;
}
export interface SketchFilletOptions {
  signal?: AbortSignal;
  check?: () => void;
}
export interface SketchFilletResult {
  sketch: Sketch;
  changed: true;
  intersection: [number, number];
  tangentPoints: [[number, number], [number, number]];
  center: [number, number];
  radiusMm: number;
  arcId: string;
}
type UV = [number, number];
const difference = (a: UV, b: UV): UV => [a[0] - b[0], a[1] - b[1]];
const cross = (a: UV, b: UV) => a[0] * b[1] - a[1] * b[0];
const length = (v: UV) => Math.hypot(v[0], v[1]);
const bounded = (p: UV) =>
  p.every((n) => Number.isFinite(n) && Math.abs(n) <= 1e9);
function validationCost(sketch: Sketch) {
  let cost =
    sketch.points.length +
    sketch.segments.length +
    (sketch.arcs?.length ?? 0) +
    sketch.constraints.length * 8;
  for (const c of sketch.constraints)
    if (c?.kind === "symmetric")
      cost += 2 * sketch.points.length + sketch.segments.length;
  return cost;
}

/** Internal fixed-radius fillet of two explicitly selected straight-line ends.
 * Native auto-fillet/dimension-transfer policies are deliberately not inferred.
 */
export async function filletSketchCorner(
  sketch: Sketch,
  request: SketchFilletRequest,
  options: SketchFilletOptions = {},
): Promise<SketchFilletResult> {
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
    throw Error("Unsupported sketch fillet structure.");
  if (
    sketch.points.length > SKETCH_FILLET_LIMITS.points ||
    sketch.segments.length + (sketch.arcs?.length ?? 0) >
      SKETCH_FILLET_LIMITS.curves ||
    sketch.constraints.length > SKETCH_FILLET_LIMITS.constraints
  )
    throw Error("Sketch fillet collection limit exceeded.");
  if (
    !request ||
    typeof request.first !== "string" ||
    typeof request.second !== "string" ||
    !["a", "b"].includes(request.firstEnd) ||
    !["a", "b"].includes(request.secondEnd)
  )
    throw Error("Choose two line IDs and an endpoint a or b for each.");
  if (
    !Number.isFinite(request.radiusMm) ||
    request.radiusMm <= 0 ||
    request.radiusMm > 1e9
  )
    throw Error("Fillet radius must be finite, positive and at most 1e9 mm.");
  let workCount = validationCost(sketch),
    lastYield = 0;
  if (workCount > SKETCH_FILLET_LIMITS.work)
    throw Error("Sketch fillet validation work budget exceeded.");
  const work = (count = 1) => {
    check();
    workCount += count;
    if (workCount > SKETCH_FILLET_LIMITS.work)
      throw Error("Sketch fillet work budget exceeded.");
  };
  const pause = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    lastYield = workCount;
    check();
  };
  const yieldWork = async () => {
    if (workCount - lastYield >= 256) await pause();
  };
  // The shared validator is synchronous; its worst-case searches are admitted
  // and charged above, with cancellation checks on both sides.
  await pause();
  validateSketch(sketch);
  check();
  const points = new Map<string, Sketch["points"][number]>();
  for (const point of sketch.points) {
    work();
    if (!bounded([point.x, point.y]))
      throw Error("Sketch fillet coordinates are out of bounds.");
    points.set(point.id, point);
    await yieldWork();
  }
  let first: Sketch["segments"][number] | undefined,
    second: Sketch["segments"][number] | undefined;
  for (const segment of sketch.segments) {
    work();
    if (segment.id === request.first) first = segment;
    if (segment.id === request.second) second = segment;
    await yieldWork();
  }
  if (!first || !second || first.id === second.id)
    throw Error("Choose two distinct existing straight-line segments.");
  if (!!first.construction !== !!second.construction)
    throw Error(
      "Fillet construction flags must agree; mixed construction geometry is ambiguous.",
    );
  const selectedFirst = first[request.firstEnd],
    selectedSecond = second[request.secondEnd];
  const selectedPoints = new Set([selectedFirst, selectedSecond]),
    selectedSegments = new Set([first.id, second.id]);
  const affected: string[] = [];
  for (const constraint of sketch.constraints) {
    work();
    const c = constraint as unknown as Record<string, unknown>;
    if (
      ["point", "a", "b"].some((key) => selectedPoints.has(c[key] as string)) ||
      ["segment", "first", "second", "axis"].some((key) =>
        selectedSegments.has(c[key] as string),
      )
    )
      affected.push(constraint.id);
    await yieldWork();
  }
  if (affected.length)
    throw Error(
      `Fillet affects constraints: ${affected.join(", ")}. Remove affected relations explicitly first.`,
    );
  for (const segment of sketch.segments) {
    for (const end of ["a", "b"] as const) {
      work();
      if (
        selectedPoints.has(segment[end]) &&
        !(
          (segment.id === first.id && end === request.firstEnd) ||
          (segment.id === second.id && end === request.secondEnd)
        )
      )
        throw Error("Selected endpoint is shared with unrelated geometry.");
    }
    await yieldWork();
  }
  for (const arc of sketch.arcs ?? []) {
    work(3);
    if ([arc.a, arc.b, arc.center].some((id) => selectedPoints.has(id)))
      throw Error("Selected endpoint is used by an unrelated arc.");
    await yieldWork();
  }
  const uv = (id: string): UV => {
    const p = points.get(id)!;
    return [p.x, p.y];
  };
  const a = uv(first.a),
    b = uv(first.b),
    c = uv(second.a),
    d = uv(second.b),
    u = difference(b, a),
    v = difference(d, c);
  const lineLength = length(u),
    otherLength = length(v),
    determinant = cross(u, v);
  const localTolerance = (...ps: UV[]) => {
    let scale = 1;
    for (const p of ps) scale = Math.max(scale, Math.abs(p[0]), Math.abs(p[1]));
    return Math.max(1e-10, scale * Number.EPSILON * 4);
  };
  if (lineLength <= localTolerance(a, b) || otherLength <= localTolerance(c, d))
    throw Error("Cannot fillet degenerate lines.");
  if (Math.abs(determinant) <= lineLength * otherLength * 1e-12)
    throw Error("Parallel or coincident lines have no unique fillet corner.");
  const t = cross(difference(c, a), v) / determinant;
  const intersection: UV =
    selectedFirst === selectedSecond
      ? uv(selectedFirst)
      : [a[0] + t * u[0], a[1] + t * u[1]];
  if (!bounded(intersection))
    throw Error("Fillet intersection is out of bounds.");
  const oppositeFirst = uv(first[request.firstEnd === "a" ? "b" : "a"]),
    oppositeSecond = uv(second[request.secondEnd === "a" ? "b" : "a"]);
  const rayFirst = difference(oppositeFirst, intersection),
    raySecond = difference(oppositeSecond, intersection),
    availableFirst = length(rayFirst),
    availableSecond = length(raySecond);
  const tolerance = localTolerance(intersection, oppositeFirst, oppositeSecond);
  if (availableFirst <= tolerance || availableSecond <= tolerance)
    throw Error("Fillet intersection collapses a retained line.");
  const firstRay: UV = [
      rayFirst[0] / availableFirst,
      rayFirst[1] / availableFirst,
    ],
    secondRay: UV = [
      raySecond[0] / availableSecond,
      raySecond[1] / availableSecond,
    ];
  const signedSine = cross(firstRay, secondRay),
    sine = Math.abs(signedSine),
    cosine = Math.max(
      -1,
      Math.min(1, firstRay[0] * secondRay[0] + firstRay[1] * secondRay[1]),
    );
  if (sine <= 1e-12)
    throw Error("Nearly parallel retained rays have an ambiguous fillet.");
  // Choose the well-conditioned half-angle identity on each side of 90 degrees.
  const cotangent = cosine >= 0 ? (1 + cosine) / sine : sine / (1 - cosine),
    setback = request.radiusMm * cotangent;
  if (
    !Number.isFinite(setback) ||
    setback <= tolerance ||
    setback >= availableFirst - tolerance ||
    setback >= availableSecond - tolerance
  )
    throw Error(
      "Fillet radius is excessive or would collapse a retained line.",
    );
  const tangentFirst: UV = [
      intersection[0] + firstRay[0] * setback,
      intersection[1] + firstRay[1] * setback,
    ],
    tangentSecond: UV = [
      intersection[0] + secondRay[0] * setback,
      intersection[1] + secondRay[1] * setback,
    ];
  const centerScale = request.radiusMm / sine,
    center: UV = [
      intersection[0] + (firstRay[0] + secondRay[0]) * centerScale,
      intersection[1] + (firstRay[1] + secondRay[1]) * centerScale,
    ];
  if (![tangentFirst, tangentSecond, center].every(bounded))
    throw Error("Fillet radius or resulting geometry is out of bounds.");
  const precision = Math.max(
    localTolerance(tangentFirst, tangentSecond, center) * 8,
    request.radiusMm * 1e-10,
  );
  const radialFirst = difference(tangentFirst, center),
    radialSecond = difference(tangentSecond, center);
  if (
    request.radiusMm <= tolerance ||
    length(difference(tangentFirst, tangentSecond)) <= tolerance ||
    Math.abs(length(radialFirst) - request.radiusMm) > precision ||
    Math.abs(length(radialSecond) - request.radiusMm) > precision ||
    Math.abs(radialFirst[0] * firstRay[0] + radialFirst[1] * firstRay[1]) >
      precision ||
    Math.abs(radialSecond[0] * secondRay[0] + radialSecond[1] * secondRay[1]) >
      precision
  )
    throw Error(
      "Fillet radius or tangency is below representable geometric precision.",
    );
  const extraPoints = selectedFirst === selectedSecond ? 2 : 1;
  if (
    sketch.points.length + extraPoints > SKETCH_FILLET_LIMITS.points ||
    sketch.segments.length + (sketch.arcs?.length ?? 0) + 1 >
      SKETCH_FILLET_LIMITS.curves
  )
    throw Error("Sketch fillet output collection limit exceeded.");
  const usedIds = new Set<string>();
  for (const collection of [
    sketch.points,
    sketch.segments,
    sketch.arcs ?? [],
    sketch.constraints,
  ])
    for (const item of collection) {
      work();
      usedIds.add(item.id);
      await yieldWork();
    }
  let pointSerial = 0,
    arcSerial = 0;
  const nextId = async (kind: "point" | "arc") => {
    let id: string;
    do {
      work();
      id = `fillet-${kind}-${kind === "point" ? pointSerial++ : arcSerial++}`;
      await yieldWork();
    } while (usedIds.has(id));
    usedIds.add(id);
    return id;
  };
  const secondId =
      selectedFirst === selectedSecond ? await nextId("point") : selectedSecond,
    centerId = await nextId("point"),
    arcId = await nextId("arc");
  const outputPoints: Sketch["points"] = [];
  for (const point of sketch.points) {
    work();
    outputPoints.push(
      point.id === selectedFirst
        ? { ...point, x: tangentFirst[0], y: tangentFirst[1] }
        : point.id === selectedSecond
          ? { ...point, x: tangentSecond[0], y: tangentSecond[1] }
          : { ...point },
    );
    await yieldWork();
  }
  if (selectedFirst === selectedSecond)
    outputPoints.push({
      id: secondId,
      x: tangentSecond[0],
      y: tangentSecond[1],
    });
  outputPoints.push({ id: centerId, x: center[0], y: center[1] });
  const segments: Sketch["segments"] = [];
  for (const segment of sketch.segments) {
    work();
    segments.push(
      segment.id === second.id
        ? { ...segment, [request.secondEnd]: secondId }
        : { ...segment },
    );
    await yieldWork();
  }
  const arcs: SketchArc[] = [];
  for (const arc of sketch.arcs ?? []) {
    work();
    arcs.push({ ...arc });
    await yieldWork();
  }
  arcs.push({
    id: arcId,
    a: selectedFirst,
    b: secondId,
    center: centerId,
    clockwise: signedSine > 0,
    ...(first.construction ? { construction: true } : {}),
  });
  const constraints: Sketch["constraints"] = [];
  for (const constraint of sketch.constraints) {
    work();
    constraints.push({ ...constraint });
    await yieldWork();
  }
  const result: Sketch = {
    ...sketch,
    points: outputPoints,
    segments,
    arcs,
    constraints,
  };
  check();
  work(validationCost(result));
  await pause();
  validateSketch(result);
  await pause();
  check();
  return {
    sketch: result,
    changed: true,
    intersection,
    tangentPoints: [tangentFirst, tangentSecond],
    center,
    radiusMm: request.radiusMm,
    arcId,
  };
}
