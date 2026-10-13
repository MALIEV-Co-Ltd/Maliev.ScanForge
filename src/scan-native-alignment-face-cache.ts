import type { MeshProcessingOptions } from "./mesh-processing";

/** Native facet cache uses double edge/cross arithmetic and a Float32 length denominator. */
export function nativeAlignmentFaceCache(
  vertices: ArrayLike<number>,
  triangles: ArrayLike<number>,
  options: MeshProcessingOptions = {},
) {
  if (vertices.length % 3 || triangles.length % 3)
    throw new Error(
      "Face cache requires complete XYZ vertices and triangle indices.",
    );
  const normals = new Float32Array(triangles.length);
  const degenerate = new Uint8Array(triangles.length / 3);
  const points = new Float64Array(9);
  for (let face = 0; face < degenerate.length; face++) {
    if (face % 4096 === 0 && options.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
    for (let corner = 0; corner < 3; corner++) {
      const id = triangles[face * 3 + corner];
      if (!Number.isInteger(id) || id < 0 || id * 3 + 2 >= vertices.length)
        throw new Error(
          "Face cache triangle index is outside the vertex buffer.",
        );
      for (let axis = 0; axis < 3; axis++) {
        const value = Math.fround(vertices[id * 3 + axis]);
        if (!Number.isFinite(value))
          throw new Error("Face cache requires finite Float32 coordinates.");
        points[corner * 3 + axis] = value;
      }
    }
    const bx = points[3] - points[0],
      by = points[4] - points[1],
      bz = points[5] - points[2];
    const cx = points[6] - points[0],
      cy = points[7] - points[1],
      cz = points[8] - points[2];
    let x = cz * by - cy * bz,
      y = cx * bz - cz * bx,
      z = cy * bx - cx * by;
    const length = Math.sqrt(x * x + y * y + z * z);
    degenerate[face] = +(length <= Number.EPSILON);
    if (length > Number.EPSILON) {
      const denominator = Math.fround(length);
      x /= denominator;
      y /= denominator;
      z /= denominator;
    }
    // Tiny nonzero cross products are retained; they are not replaced with zero.
    normals[face * 3] = x;
    normals[face * 3 + 1] = y;
    normals[face * 3 + 2] = z;
  }
  return { normals, degenerate };
}
