import type { NoiseBounds } from "./scan-noise-octree-query";

/** Double arithmetic and child bit layout extracted from the native box helper. */
export function noiseOctantBox(bounds: NoiseBounds, child: number) {
  if (!Number.isInteger(child) || child < 0 || child > 7)
    throw new RangeError("Octant index must be between zero and seven");
  const center: [number, number, number] = [0, 0, 0];
  const inverse: [number, number, number] = [0, 0, 0];
  const result: [number, number, number, number, number, number] = [
    0, 0, 0, 0, 0, 0,
  ];
  for (let axis = 0; axis < 3; axis++) {
    const quarter = (bounds[axis + 3] - bounds[axis]) * 0.5 * 0.5;
    const midpoint = (bounds[axis] + bounds[axis + 3]) * 0.5;
    const offset =
      child & (1 << axis) ? midpoint - quarter : midpoint + quarter;
    result[axis] = offset - quarter;
    result[axis + 3] = quarter + offset;
    center[axis] = (result[axis] + result[axis + 3]) * 0.5;
    inverse[axis] = 1 / (result[axis + 3] - result[axis]);
  }
  return { bounds: result, center, inverse };
}
