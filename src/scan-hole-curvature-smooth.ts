import type { MeshTopology } from "./mesh-processing";

/** Collar mode 3: ordered Double neighbor fields, Float32 stores, open-rim pins. */
export function smoothNativeCurvatureCollar(
  topology: MeshTopology,
  selected: Uint8Array,
  iterations: number,
  check?: () => void,
): Float32Array {
  check?.();
  const count = topology.vertices.length / 3;
  if (
    selected.length !== count ||
    selected.some((value) => value !== 0 && value !== 1)
  )
    throw new Error(
      "Curvature smoothing requires a matching vertex selection.",
    );
  if (!Number.isInteger(iterations) || iterations < 1)
    throw new Error(
      "Curvature smoothing requires positive integer iterations.",
    );
  if (
    count > 1_000_000 ||
    iterations * topology.triangles.length * 12 > 250_000_000
  )
    throw new Error("Curvature smoothing exceeds its resource budget.");
  if (topology.nonManifoldEdges || topology.inconsistentEdges)
    throw new Error(
      "Curvature smoothing requires a consistently wound manifold collar.",
    );
  let vertices = Float32Array.from(topology.vertices);
  if (vertices.some((value) => !Number.isFinite(value)))
    throw new Error("Curvature smoothing requires finite Float32 coordinates.");
  const { triangles } = topology;
  const weights = new Uint8Array(triangles.length).fill(1);
  const pinned = new Uint8Array(count),
    neighbors = new Uint32Array(count);
  for (const uses of topology.edges.values()) {
    if (uses.length !== 1) continue;
    const edge = uses[0],
      offset = edge.face * 3;
    pinned[edge.from] = pinned[edge.to] = 1;
    for (let corner = 0; corner < 3; corner++)
      if (
        triangles[offset + corner] === edge.from &&
        triangles[offset + ((corner + 1) % 3)] === edge.to
      )
        weights[offset + corner] = 2;
  }
  for (let face = 0; face < triangles.length; face += 3)
    for (let corner = 0; corner < 3; corner++) {
      const a = triangles[face + corner],
        b = triangles[face + ((corner + 1) % 3)];
      neighbors[a] += weights[face + corner];
      neighbors[b] += weights[face + corner];
    }
  for (let step = 0; step < iterations; step++) {
    check?.();
    const mean = new Float64Array(count * 3),
      displacement = new Float64Array(count * 3);
    for (let face = 0; face < triangles.length; face += 3) {
      if (face % 12288 === 0) check?.();
      for (let corner = 0; corner < 3; corner++) {
        const a = triangles[face + corner] * 3,
          b = triangles[face + ((corner + 1) % 3)] * 3;
        for (let repeat = 0; repeat < weights[face + corner]; repeat++)
          for (let axis = 0; axis < 3; axis++) {
            mean[a + axis] = vertices[b + axis] + mean[a + axis];
            mean[b + axis] = vertices[a + axis] + mean[b + axis];
          }
      }
    }
    for (let id = 0; id < count; id++) {
      if (!neighbors[id]) continue;
      const inverse = 1 / neighbors[id];
      for (let axis = 0; axis < 3; axis++) mean[id * 3 + axis] *= inverse;
    }
    for (let face = 0; face < triangles.length; face += 3) {
      if (face % 12288 === 0) check?.();
      for (let corner = 0; corner < 3; corner++) {
        const a = triangles[face + corner] * 3,
          b = triangles[face + ((corner + 1) % 3)] * 3;
        for (let repeat = 0; repeat < weights[face + corner]; repeat++)
          for (let axis = 0; axis < 3; axis++) {
            displacement[a + axis] =
              mean[b + axis] - vertices[b + axis] + displacement[a + axis];
            displacement[b + axis] =
              mean[a + axis] - vertices[a + axis] + displacement[b + axis];
          }
      }
    }
    const next = vertices.slice();
    for (let id = 0; id < count; id++) {
      if (id % 4096 === 0) check?.();
      if (!selected[id] || pinned[id] || !neighbors[id]) continue;
      const inverse = 1 / neighbors[id];
      for (let axis = 0; axis < 3; axis++) {
        const index = id * 3 + axis,
          average = mean[index];
        const correction = inverse * displacement[index] * 0.5;
        const value = Math.fround(
          average - (average - vertices[index]) * 0.5 + correction,
        );
        if (!Number.isFinite(value))
          throw new Error("Curvature smoothing overflowed.");
        next[index] = value;
      }
    }
    vertices = next;
  }
  return vertices;
}
