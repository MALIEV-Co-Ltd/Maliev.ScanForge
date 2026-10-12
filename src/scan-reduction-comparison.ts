import type { MeshProcessingOptions } from "./mesh-processing";
import { nativeNoiseColor } from "./scan-noise-color";

/** Recovered reduction callback: palette/search range and report tolerance are distinct. */
export function compareReductionSamples(
  coordinates: ArrayLike<number>,
  tolerance: number,
  paletteThreshold: number,
  query: (point: number[], radius: number) => { distance: number } | undefined,
  options: MeshProcessingOptions = {},
) {
  const reportTolerance = Math.fround(tolerance);
  const colorThreshold = Math.fround(paletteThreshold);
  if (coordinates.length % 3)
    throw new Error(
      "Reduction comparison requires complete vertex coordinates.",
    );
  if (
    !Number.isFinite(reportTolerance) ||
    reportTolerance <= 0 ||
    !Number.isFinite(colorThreshold) ||
    colorThreshold <= 0
  )
    throw new Error(
      "Reduction comparison thresholds must be positive finite Float32 values.",
    );
  const check = () => {
    if (options.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
  };
  check();
  const total = coordinates.length / 3;
  const rgb = new Uint8Array(coordinates.length);
  const distances = new Float64Array(total).fill(NaN);
  const point = [0, 0, 0];
  const radius = colorThreshold * 5;
  let matched = 0,
    within = 0;
  for (let id = 0; id < total; id++) {
    if (id % 1024 === 0) {
      check();
      options.onProgress?.(
        id / total,
        "Comparing original vertices with reduced surface",
      );
      check();
    }
    for (let axis = 0; axis < 3; axis++) {
      const value = Math.fround(coordinates[id * 3 + axis]);
      if (!Number.isFinite(value))
        throw new Error(
          "Reduction comparison coordinates must be finite Float32 values.",
        );
      point[axis] = value;
    }
    const hit = query(point, radius);
    check();
    if (!hit) {
      rgb.fill(50, id * 3, id * 3 + 3);
      continue;
    }
    if (!Number.isFinite(hit.distance))
      throw new Error(
        "Reduction comparison query returned an invalid distance.",
      );
    // The native callback clears a negative sign outside its search range.
    const distance =
      Math.abs(hit.distance) > radius ? Math.abs(hit.distance) : hit.distance;
    distances[id] = distance;
    matched++;
    if (Math.abs(distance) <= reportTolerance) within++;
    rgb.set(nativeNoiseColor(distance, colorThreshold), id * 3);
  }
  options.onProgress?.(1, "Reduction comparison completed");
  check();
  return {
    distances,
    rgb,
    matched,
    within,
    total,
    percentage: total ? (within * 100) / total : 0,
  };
}
