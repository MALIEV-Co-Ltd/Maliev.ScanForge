import { ReductionSurfaceBVH } from "./scan-reduction-surface";
import { INSPECTION_COORDINATE_LIMIT, inspectionVisible } from "./inspection";
import { assertSampledGeometry } from "./reference-entity";
import type { Entity } from "./types";

export interface ReferenceDeviationOptions {
  maxDistance: number;
  tolerance?: number;
  signed?: boolean;
}
/** Compare authoritative source slots against visible reference display triangles.
 * Winding signs on open surfaces are local orientation, never solid containment. */
export async function inspectReferenceDeviation(
  source: Entity,
  reference: Entity,
  input: ReferenceDeviationOptions,
  options: {
    check?: () => void;
    progress?: (fraction: number, stage: string) => void;
  } = {},
) {
  const check = () => options.check?.();
  check();
  assertSampledGeometry(source);
  assertSampledGeometry(reference);
  if (source.id === reference.id || reference.kind === "pointcloud")
    throw new Error(
      "Select a distinct triangle surface as inspection reference.",
    );
  const tolerance = input.tolerance ?? 0.1;
  if (
    !Number.isFinite(input.maxDistance) ||
    !(input.maxDistance > 0) ||
    !Number.isFinite(tolerance) ||
    !(tolerance > 0)
  )
    throw new Error(
      "Comparison distance and tolerance must be positive and finite.",
    );
  for (const entity of [source, reference]) {
    if (
      !entity.positions.length ||
      entity.positions.length > INSPECTION_COORDINATE_LIMIT ||
      entity.positions.length % (entity.kind === "pointcloud" ? 3 : 9)
    )
      throw new Error(
        "Comparison requires complete geometry within 2,250,000 coordinates per object; reduce a copy first.",
      );
    for (let i = 0; i < entity.positions.length; i++)
      if (
        !Number.isFinite(entity.positions[i]) ||
        !Number.isFinite(Math.fround(entity.positions[i]))
      )
        throw new Error(
          "Comparison coordinates must be finite Float32 values.",
        );
  }
  const referenceVisible = inspectionVisible(reference),
    sourceVisible = inspectionVisible(source);
  const indices: number[] = [],
    slots: number[] = [];
  for (let slot = 0; slot < reference.positions.length / 9; slot++)
    if (referenceVisible(slot * 3)) {
      indices.push(slot * 3, slot * 3 + 1, slot * 3 + 2);
      slots.push(slot);
    }
  if (!indices.length)
    throw new Error("Comparison requires visible reference triangles.");
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  check();
  const surface = new ReductionSurfaceBVH(
    { coordinates: reference.positions, indices },
    {
      onProgress: (fraction) => {
        check();
        options.progress?.(fraction * 0.2, "Indexing inspection reference");
      },
    },
  );
  const query = surface.createQuery(),
    point = [0, 0, 0];
  const total = source.positions.length / 3,
    distances: (number | null)[] = new Array(total).fill(null),
    referenceTriangles: (number | null)[] = new Array(total).fill(null);
  let eligible = 0,
    samples = 0,
    sum = 0,
    squares = 0,
    minimum = Infinity,
    maximum = -Infinity,
    withinTolerance = 0;
  for (let i = 0; i < total; i++) {
    if (i % 4096 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      check();
      options.progress?.(
        0.2 + (0.8 * i) / total,
        "Comparing source samples to reference",
      );
    }
    if (!sourceVisible(i)) continue;
    eligible++;
    for (let axis = 0; axis < 3; axis++)
      point[axis] = source.positions[i * 3 + axis];
    const hit = query(point, input.maxDistance);
    if (!hit) continue;
    const d = input.signed ? hit.distance : Math.abs(hit.distance);
    distances[i] = d;
    referenceTriangles[i] = slots[hit.triangle];
    samples++;
    sum += d;
    squares += d * d;
    minimum = Math.min(minimum, d);
    maximum = Math.max(maximum, d);
    if (Math.abs(d) <= tolerance) withinTolerance++;
  }
  check();
  if (!eligible) throw new Error("Comparison requires visible source samples.");
  if (!Number.isFinite(sum + squares))
    throw new Error("Comparison statistics exceed numeric range.");
  return {
    version: 1,
    entityId: source.id,
    referenceId: reference.id,
    units: "mm",
    semantics: input.signed
      ? "reference-triangle-winding"
      : "unsigned-reference-distance",
    sampleOrder:
      source.kind === "pointcloud"
        ? "source-points"
        : "source-triangle-corners",
    tolerance,
    maxDistance: input.maxDistance,
    signed: input.signed ?? false,
    referenceGeometry: "Float32-display-triangles",
    distances,
    referenceTriangles,
    samples,
    eligible,
    excluded: total - eligible,
    unmatched: eligible - samples,
    coverage: samples / eligible,
    minimum: samples ? minimum : null,
    maximum: samples ? maximum : null,
    mean: samples ? sum / samples : null,
    rms: samples ? Math.sqrt(squares / samples) : null,
    maxError: samples ? Math.max(Math.abs(minimum), Math.abs(maximum)) : null,
    withinTolerance,
    limits:
      "Source vertex samples strictly within maxDistance of visible reference display triangles. Null means hidden or unmatched. Local winding sign is not watertight containment. CAD tessellation, sparse sampling and open boundaries limit accuracy; not exact BREP distance or a continuous error bound.",
  };
}
export type ReferenceDeviationReport = Awaited<
  ReturnType<typeof inspectReferenceDeviation>
>;
