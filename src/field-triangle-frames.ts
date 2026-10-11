export interface TriangleFieldFrames {
  tangents: Float32Array;
  bitangents: Float32Array;
  edgeLengths: Float32Array;
}

/** Scan-derived frame stage; face normals and optional reference-edge mapping are upstream inputs. */
export function buildTriangleFieldFrames(
  positions: Float32Array,
  triangles: Uint32Array,
  normals: Float32Array,
  referenceEdges?: Uint8Array,
): TriangleFieldFrames {
  if (
    positions.length % 3 ||
    triangles.length % 3 ||
    normals.length !== triangles.length ||
    (referenceEdges && referenceEdges.length !== triangles.length / 3)
  )
    throw new Error("Triangle field frame dimensions are inconsistent.");
  for (const values of [positions, normals])
    for (const value of values)
      if (!Number.isFinite(value))
        throw new Error("Triangle field geometry must be finite.");
  for (const index of triangles)
    if (index >= positions.length / 3)
      throw new Error("Triangle field references an invalid vertex.");
  if (referenceEdges)
    for (const edge of referenceEdges)
      if (edge > 2)
        throw new Error("Triangle field reference edge must be 0, 1 or 2.");

  const f = Math.fround;
  const multiply = (a: number, b: number) => f(a * b);
  const subtract = (a: number, b: number) => f(a - b);
  const tangents = new Float32Array(triangles.length);
  const bitangents = new Float32Array(triangles.length);
  const edgeLengths = new Float32Array(triangles.length / 3);
  const normalize = (vector: Float32Array, start: number) => {
    const x = vector[start];
    const y = vector[start + 1];
    const z = vector[start + 2];
    const length = f(
      Math.sqrt(f(f(multiply(x, x) + multiply(y, y)) + multiply(z, z))),
    );
    if (!Number.isFinite(length))
      throw new Error("Triangle field frame arithmetic overflowed.");
    if (length >= 1e-24) {
      // Assembly promotes the float length/components for reciprocal scaling.
      const reciprocal = 1 / length;
      for (let axis = 0; axis < 3; axis++)
        vector[start + axis] = f(vector[start + axis] * reciprocal);
    }
    return length;
  };
  for (let face = 0; face < edgeLengths.length; face++) {
    const start = face * 3;
    const edge = referenceEdges?.[face] ?? 0;
    const from = triangles[start + edge] * 3;
    const to = triangles[start + ((edge + 1) % 3)] * 3;
    for (let axis = 0; axis < 3; axis++)
      tangents[start + axis] = subtract(
        positions[to + axis],
        positions[from + axis],
      );
    edgeLengths[face] = normalize(tangents, start);
    // The recovered orientation is normal cross tangent.
    for (let axis = 0; axis < 3; axis++) {
      const a = start + ((axis + 1) % 3);
      const b = start + ((axis + 2) % 3);
      bitangents[start + axis] = subtract(
        multiply(normals[a], tangents[b]),
        multiply(normals[b], tangents[a]),
      );
    }
    normalize(bitangents, start);
  }
  return { tangents, bitangents, edgeLengths };
}
