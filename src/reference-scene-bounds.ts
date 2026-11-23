import {
  copyReferenceGeometry,
  referenceLineEnd,
  type ReferenceGeometry,
} from "./reference-construction-values";

/** Native geometry delegate bounds; scene filtering/placement belongs to the caller. */
export function referenceGeometrySceneBounds(
  input: ReferenceGeometry,
): Float32Array {
  const geometry = copyReferenceGeometry(input);
  let bounds: Float32Array;
  if (geometry.kind === "point") {
    const position = geometry.position.map(Math.fround),
      padding = Math.fround(0.001);
    bounds = new Float32Array([
      ...position.map((value) => value - padding),
      ...position.map((value) => value + padding),
    ]);
  } else {
    const start = geometry.start.map(Math.fround),
      end = referenceLineEnd(geometry).map(Math.fround);
    bounds = new Float32Array([...start, ...start]);
    for (let axis = 0; axis < 3; axis++) {
      // Strict comparisons preserve the start carrier on equal endpoints, including zero.
      if (end[axis] < bounds[axis]) bounds[axis] = end[axis];
      if (end[axis] > bounds[axis + 3]) bounds[axis + 3] = end[axis];
    }
  }
  if (!bounds.every(Number.isFinite))
    throw new Error(
      "Reference scene bounds require finite Float32 coordinates.",
    );
  return bounds;
}
