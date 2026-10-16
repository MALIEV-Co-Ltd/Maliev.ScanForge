import type { MeshProcessingOptions } from "./mesh-processing";
/** Finite source facets shifted inward. Their distance capsule union is a
 * continuous scalar even where the identity or normal of the nearest facet changes. */
export function shiftShrinkwrapTriangles(
  source: Float32Array,
  depth: number,
  options: MeshProcessingOptions,
) {
  const result = new Float32Array(source.length);
  for (let i = 0; i < source.length; i += 9) {
    if (i % 9216 === 0 && options.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
    const ux = source[i + 3] - source[i],
      uy = source[i + 4] - source[i + 1],
      uz = source[i + 5] - source[i + 2];
    const vx = source[i + 6] - source[i],
      vy = source[i + 7] - source[i + 1],
      vz = source[i + 8] - source[i + 2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx],
      length = Math.hypot(...n);
    if (!length)
      throw Error("ShrinkWrap requires nondegenerate source facets.");
    for (let v = 0; v < 3; v++)
      for (let k = 0; k < 3; k++)
        result[i + v * 3 + k] = source[i + v * 3 + k] - (depth * n[k]) / length;
  }
  if (result.some((value) => !Number.isFinite(value)))
    throw Error(
      "ShrinkWrap inferred capsule extent exceeds finite Float32 coordinates; reduce gap fill or extra thickness.",
    );
  return result;
}
