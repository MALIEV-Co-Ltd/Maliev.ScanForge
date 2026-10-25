import { assertSampledGeometry } from "./reference-entity";
import { deviations, sectionMesh } from "./geometry";
import type { Entity, FitResult, Vec3 } from "./types";

export type MeasurementKind = "distance" | "angle" | "radius" | "diameter";
export interface MeasurementInput {
  kind?: MeasurementKind;
  first: Vec3;
  second: Vec3;
  third?: Vec3;
}
const sub = (a: Vec3, b: Vec3): Vec3 => a.map((v, i) => v - b[i]) as Vec3;
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3) => a.reduce((s, v, i) => s + v * b[i], 0);

/** Three-point angles use the second point as vertex; circles use all three picks. */
export function measureGeometry(input: MeasurementInput) {
  const kind = input.kind ?? "distance";
  if (!["distance", "angle", "radius", "diameter"].includes(kind))
    throw new Error("Unsupported measurement kind.");
  const points =
    kind === "distance"
      ? [input.first, input.second]
      : [input.first, input.second, input.third];
  if (
    points.some(
      (p) => !Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite),
    )
  )
    throw new Error("Measurement requires finite world XYZ points.");
  const a = sub(input.first, input.second);
  if (kind === "distance") {
    const distance = Math.hypot(...a);
    if (!Number.isFinite(distance))
      throw new Error("Measurement exceeds numeric range.");
    return { kind, distance, value: distance, units: "mm", points };
  }
  const b = sub(input.third!, input.second),
    la = Math.hypot(...a),
    lb = Math.hypot(...b);
  if (!(la > 0) || !(lb > 0) || !Number.isFinite(la + lb))
    throw new Error(
      "Measurement picks must be distinct and within numeric range.",
    );
  const u = a.map((v) => v / la) as Vec3,
    v = b.map((x) => x / lb) as Vec3;
  const n = cross(u, v),
    sine = Math.hypot(...n);
  if (kind === "angle") {
    const angle = (Math.atan2(sine, dot(u, v)) * 180) / Math.PI;
    return { kind, angle, value: angle, units: "deg", points };
  }
  if (!(sine > 1e-12)) throw new Error("Circle picks must be noncollinear.");
  const vn = cross(v, n),
    nu = cross(n, u);
  const center = input.second.map(
    (x, i) => x + (la * vn[i] + lb * nu[i]) / (2 * sine * sine),
  ) as Vec3;
  const radius = Math.hypot(...sub(center, input.first)),
    diameter = 2 * radius;
  if (![...center, radius, diameter].every(Number.isFinite))
    throw new Error("Circle measurement exceeds numeric range.");
  return {
    kind,
    radius,
    diameter,
    center,
    value: kind === "radius" ? radius : diameter,
    units: "mm",
    points,
  };
}

export const INSPECTION_COORDINATE_LIMIT = 2_250_000;
function admit(entity: Entity) {
  assertSampledGeometry(entity);
  if (entity.positions.length > INSPECTION_COORDINATE_LIMIT)
    throw new Error(
      "Inspection is limited to 750,000 samples / 250,000 triangles; reduce a copy first.",
    );
  if (
    !entity.positions.length ||
    entity.positions.length % (entity.kind === "pointcloud" ? 3 : 9)
  )
    throw new Error("Inspection requires complete geometry.");
}
/** Hidden slots are point indices for clouds and triangle indices for surfaces. */
export function inspectionVisible(entity: Entity) {
  const hidden = new Set(entity.meshSelection?.hidden ?? []);
  return (sample: number) =>
    !hidden.has(entity.kind === "pointcloud" ? sample : Math.floor(sample / 3));
}
export function inspectSection(
  entity: Entity,
  axis: "x" | "y" | "z",
  offset: number,
) {
  if (entity.kind === "pointcloud")
    throw new Error(
      "A point cloud has no triangle surface for section extraction.",
    );
  admit(entity);
  const visible = inspectionVisible(entity);
  return sectionMesh(entity.positions, axis, offset, {
    includeTriangle: (slot) => visible(slot * 3),
  });
}
/** Keep only supported analytic parameters; unknown caller fields are never retained. */
export function inspectionFit(fit: FitResult): FitResult {
  if (
    !fit ||
    !["plane", "sphere", "cylinder", "cone"].includes(fit.kind) ||
    !Array.isArray(fit.center) ||
    fit.center.length !== 3 ||
    !Array.isArray(fit.axis) ||
    fit.axis.length !== 3 ||
    ![...fit.center, ...fit.axis].every(Number.isFinite) ||
    !Number.isFinite(Math.hypot(...fit.axis)) ||
    !(Math.hypot(...fit.axis) > 0)
  )
    throw new Error("Deviation requires a finite validated analytic fit.");
  for (const value of [fit.rms, fit.maxError])
    if (value !== undefined && (!Number.isFinite(value) || value < 0))
      throw new Error(
        "Fitted residual metadata must be finite and nonnegative.",
      );
  const result: FitResult = {
    kind: fit.kind,
    center: [...fit.center],
    axis: [...fit.axis],
    rms: fit.rms,
    maxError: fit.maxError,
    ...(fit.kind === "plane" ? {} : { radius: fit.radius }),
    ...(fit.kind === "cone"
      ? { height: fit.height, topRadius: fit.topRadius }
      : {}),
  };
  deviations([0, 0, 0], result);
  return result;
}
function* deviationTraversal(entity: Entity, fit: FitResult, tolerance = 0.1) {
  admit(entity);
  fit = inspectionFit(fit);
  if (!(tolerance > 0) || !Number.isFinite(tolerance))
    throw new Error("Deviation tolerance must be positive and finite.");
  const count = entity.positions.length / 3,
    visible = inspectionVisible(entity);
  const distances: (number | null)[] = new Array(count);
  let samples = 0,
    sum = 0,
    squares = 0,
    minimum = Infinity,
    maximum = -Infinity,
    withinTolerance = 0;
  for (let start = 0; start < count; start += 4096) {
    yield start / count;
    const end = Math.min(count, start + 4096);
    const coordinates =
      entity.positions instanceof Float32Array
        ? entity.positions.subarray(start * 3, end * 3)
        : entity.positions.slice(start * 3, end * 3);
    const values = deviations(coordinates, fit);
    for (let i = start; i < end; i++) {
      const d = values[i - start];
      if (!visible(i)) {
        distances[i] = null;
        continue;
      }
      if (!Number.isFinite(d))
        throw new Error("Deviation exceeds numeric range.");
      distances[i] = d;
      samples++;
      sum += d;
      squares += d * d;
      minimum = Math.min(minimum, d);
      maximum = Math.max(maximum, d);
      if (Math.abs(d) <= tolerance) withinTolerance++;
    }
  }
  if (!samples) throw new Error("Deviation requires visible samples.");
  if (!Number.isFinite(sum + squares))
    throw new Error("Deviation statistics exceed numeric range.");
  return {
    version: 1,
    entityId: entity.id,
    units: "mm",
    semantics: "oriented-analytic-surface",
    sampleOrder:
      entity.kind === "pointcloud"
        ? "source-points"
        : "source-triangle-corners",
    fit: structuredClone(fit),
    tolerance,
    distances,
    samples,
    excluded: count - samples,
    minimum,
    maximum,
    mean: sum / samples,
    rms: Math.sqrt(squares / samples),
    maxError: Math.max(Math.abs(minimum), Math.abs(maximum)),
    withinTolerance,
    coverage: samples / count,
    limits:
      "Vertex samples against infinite analytic surfaces; not a continuous error bound or watertight inside/outside test.",
  };
}

export function inspectDeviation(
  entity: Entity,
  fit: FitResult,
  tolerance = 0.1,
) {
  const traversal = deviationTraversal(entity, fit, tolerance);
  let step = traversal.next();
  while (!step.done) step = traversal.next();
  return step.value;
}
/** Yield bounded chunks so Cancel, disconnect and revision checks can fence publication. */
export async function inspectDeviationAsync(
  entity: Entity,
  fit: FitResult,
  tolerance = 0.1,
  options: {
    check?: () => void;
    progress?: (fraction: number, stage: string) => void;
  } = {},
) {
  options.check?.();
  const traversal = deviationTraversal(entity, fit, tolerance);
  let step = traversal.next();
  while (!step.done) {
    options.progress?.(step.value, "Measuring signed primitive deviation");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    options.check?.();
    step = traversal.next();
  }
  options.check?.();
  return step.value;
}
