import type { IndexedMesh, Positions } from "./types";

/** Check whether indexed vertices reproduce every authored corner bit-for-bit.
 * A false result means callers must retain the expanded source. */
export async function indexedExactAdmission(
  mesh: IndexedMesh,
  positions: Positions,
  options: { check?: () => void; pause?: () => Promise<void> } = {},
): Promise<boolean> {
  const check = options.check ?? (() => {});
  const pause =
    options.pause ??
    (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  const { vertices, triangles, normals, geometryNormals, facetNormals } = mesh;
  check();
  if (
    !(Array.isArray(vertices) || vertices instanceof Float32Array) ||
    !(Array.isArray(triangles) || triangles instanceof Uint32Array) ||
    !vertices.length ||
    vertices.length % 3 ||
    !triangles.length ||
    triangles.length % 3 ||
    triangles.length * 3 !== positions.length ||
    (normals !== undefined &&
      (!(Array.isArray(normals) || normals instanceof Float32Array) ||
        normals.length !== vertices.length)) ||
    (geometryNormals !== undefined &&
      (!(
        Array.isArray(geometryNormals) ||
        geometryNormals instanceof Float32Array
      ) ||
        geometryNormals.length !== vertices.length)) ||
    (facetNormals !== undefined &&
      (!(Array.isArray(facetNormals) || facetNormals instanceof Float32Array) ||
        facetNormals.length !== triangles.length))
  )
    return false;
  const arrays = [vertices, normals, geometryNormals, facetNormals];
  for (let role = 0; role < arrays.length; role++) {
    const values = arrays[role];
    if (!values) continue;
    for (let start = 0; start < values.length; start += 65536) {
      check();
      const end = Math.min(values.length, start + 65536);
      for (let i = start; i < end; i++) {
        const value = values[i];
        if (
          typeof value !== "number" ||
          !(value >= -Number.MAX_VALUE && value <= Number.MAX_VALUE) ||
          (role >= 2 && !Number.isFinite(Math.fround(value)))
        )
          return false;
      }
      if (end < values.length) {
        await pause();
        check();
      }
    }
  }
  for (let start = 0; start < triangles.length; start += 65536) {
    check();
    const end = Math.min(triangles.length, start + 65536);
    for (let slot = start; slot < end; slot++) {
      const id = triangles[slot];
      if (!Number.isSafeInteger(id) || id < 0 || id * 3 + 2 >= vertices.length)
        return false;
      for (let axis = 0; axis < 3; axis++) {
        const vertex = vertices[id * 3 + axis],
          position = positions[slot * 3 + axis];
        // Vertices are finite; reciprocals distinguish the two zero signs.
        if (
          vertex !== position ||
          (vertex === 0 && 1 / vertex !== 1 / position)
        )
          return false;
      }
    }
    if (end < triangles.length) {
      await pause();
      check();
    }
  }
  check();
  return true;
}
