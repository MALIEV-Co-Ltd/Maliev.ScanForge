import type { MeshProcessingOptions } from "./mesh-processing";
import { ShrinkwrapSurface } from "./scan-shrinkwrap-surface";

/** Deterministic stratified facet samples, independent of fitting provenance.
 * Deliberately not presented as a certified or exhaustive surface bound. */
export function measureShrinkwrapCoverage(
  source: Float32Array,
  output: Float32Array,
  extraThickness: number,
  options: MeshProcessingOptions,
) {
  const index = new ShrinkwrapSurface(output, options);
  let measured = 0,
    maximum = 0,
    sum = 0,
    worstSourceFace = -1,
    worstSourcePoint = "";
  const triangles = source.length / 9,
    stride = Math.max(1, Math.ceil(triangles / 1024));
  try {
    for (let face = 0; face < triangles; face += stride) {
      if (options.signal?.aborted)
        throw new DOMException("Mesh operation cancelled.", "AbortError");
      const i = face * 9;
      const ux = source[i + 3] - source[i],
        uy = source[i + 4] - source[i + 1],
        uz = source[i + 5] - source[i + 2];
      const vx = source[i + 6] - source[i],
        vy = source[i + 7] - source[i + 1],
        vz = source[i + 8] - source[i + 2];
      const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx],
        length = Math.hypot(...n);
      if (!length) continue;
      for (const weights of [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
        [1 / 3, 1 / 3, 1 / 3],
      ]) {
        const p = [0, 1, 2].map(
          (axis) =>
            source[i + axis] * weights[0] +
            source[i + 3 + axis] * weights[1] +
            source[i + 6 + axis] * weights[2] +
            (extraThickness * n[axis]) / length,
        );
        const hit = index.nearest(p);
        if (!hit)
          throw Error("ShrinkWrap generated no measurable output surface.");
        measured++;
        if (hit.distance > maximum) {
          maximum = hit.distance;
          worstSourceFace = face;
          worstSourcePoint = JSON.stringify(p);
        }
        sum += hit.distance ** 2;
      }
    }
    return {
      sourceCoverageSamples: measured,
      worstSourceFace,
      worstSourcePoint,
      sourceCoverageMaxDeviation: maximum,
      sourceCoverageRmsDeviation: Math.sqrt(sum / Math.max(1, measured)),
      sourceCoverageMethod:
        "up to 1024 uniformly stratified source facets; three corners and centroid; Euclidean nearest output surface relative to oriented source offset",
    };
  } finally {
    index.dispose();
  }
}
