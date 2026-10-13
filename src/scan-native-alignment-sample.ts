import { ALIGNMENT_QUERY_SENTINEL } from "./scan-native-alignment-query";

/** Native sample-node accumulation; inputs are cached Float32 vertices and center. */
export function nativeAlignmentSampleRepresentative(
  vertices: readonly { point: readonly number[]; flags: number }[],
  center: readonly number[],
) {
  let nearestIndex = -1,
    preferredIndex = -1;
  let nearestDistance = ALIGNMENT_QUERY_SENTINEL,
    preferredDistance = ALIGNMENT_QUERY_SENTINEL;
  for (let index = 0; index < vertices.length; index++) {
    const vertex = vertices[index];
    const dx = vertex.point[0] - center[0],
      dy = vertex.point[1] - center[1],
      dz = vertex.point[2] - center[2];
    // Each term multiplies the double difference by its Float32 counterpart.
    const distance =
      dx * Math.fround(dx) + dy * Math.fround(dy) + dz * Math.fround(dz);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
    if ((vertex.flags & 16) !== 0 && distance < preferredDistance) {
      preferredDistance = distance;
      preferredIndex = index;
    }
  }
  return { nearestIndex, preferredIndex, nearestDistance, preferredDistance };
}
