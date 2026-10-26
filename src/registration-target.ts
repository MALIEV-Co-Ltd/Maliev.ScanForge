import type { Entity, Positions } from "./types";

/** Full target geometry without repeated triangle corners or unused vertices. */
export function registrationTargetPoints(target: Entity): Positions {
  const mesh = target.indexedMesh;
  if (
    target.kind !== "mesh" ||
    target.kernelId ||
    target.brep ||
    target.parametric ||
    !mesh ||
    target.positions.length !== mesh.triangles.length * 3
  )
    return target.positions;
  const count = mesh.vertices.length / 3;
  if (
    !Number.isSafeInteger(count) ||
    count <= 0 ||
    !mesh.triangles.length ||
    mesh.triangles.length % 3
  )
    throw Error("Fine alignment target requires valid indexed geometry.");
  const used = new Uint8Array(count);
  let retained = 0;
  for (let corner = 0; corner < mesh.triangles.length; corner++) {
    const id = mesh.triangles[corner];
    if (!Number.isSafeInteger(id) || id < 0 || id >= count)
      throw Error("Fine alignment target has an invalid vertex reference.");
    for (let a = 0; a < 3; a++)
      if (
        Math.fround(mesh.vertices[id * 3 + a]) !==
        Math.fround(target.positions[corner * 3 + a])
      )
        throw Error("Fine alignment indexed target geometry is stale.");
    if (!used[id]) {
      used[id] = 1;
      retained++;
    }
  }
  if (retained === count) return mesh.vertices;
  const points = new Float32Array(retained * 3);
  for (let i = 0, at = 0; i < count; i++) {
    if (!used[i]) continue;
    for (let a = 0; a < 3; a++) points[at++] = mesh.vertices[i * 3 + a];
  }
  return points;
}
