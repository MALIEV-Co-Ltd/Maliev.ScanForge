import type { ReductionFace } from "./scan-reduction-validity";

/** Native final export order: surviving faces, then used vertices by original index. */
export function compactReductionMesh(
  coordinates: ArrayLike<number>,
  faces: readonly ReductionFace[],
  checkpoint?: () => void,
) {
  let work = 0;
  const check = () => {
    if (work++ % 4096 === 0) checkpoint?.();
  };
  const count = coordinates.length / 3;
  const used = new Uint8Array(count);
  let faceCount = 0;
  for (const face of faces) {
    check();
    if (face.deleted) continue;
    faceCount++;
    for (const id of face.vertices) used[id] = 1;
  }
  const mapping = new Uint32Array(count);
  let vertexCount = 0;
  for (let id = 0; id < count; id++) {
    check();
    if (used[id]) mapping[id] = vertexCount++;
  }
  const vertices = new Float64Array(vertexCount * 3);
  for (let id = 0; id < count; id++) {
    check();
    if (!used[id]) continue;
    const target = mapping[id] * 3;
    for (let axis = 0; axis < 3; axis++)
      vertices[target + axis] = coordinates[id * 3 + axis];
  }
  const triangles = new Uint32Array(faceCount * 3);
  let corner = 0;
  for (const face of faces) {
    check();
    if (face.deleted) continue;
    for (const id of face.vertices) triangles[corner++] = mapping[id];
  }
  checkpoint?.();
  return { vertices, triangles };
}
