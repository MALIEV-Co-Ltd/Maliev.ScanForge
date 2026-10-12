import type { MeshProcessingOptions, MeshTopology } from "./mesh-processing";

const FLOAT_MAX = 3.4028234663852886e38;
const f32 = Math.fround;

function check(options: MeshProcessingOptions, index = 0) {
  if (index % 4096 === 0 && options.signal?.aborted)
    throw new DOMException("Mesh operation cancelled.", "AbortError");
}

/** Angle-weighted normals with the original single-precision accumulation. */
function noiseNormals(t: MeshTopology, options: MeshProcessingOptions) {
  const out = new Float32Array(t.vertices.length);
  const v = t.vertices;
  const point = (id: number) => [v[id * 3], v[id * 3 + 1], v[id * 3 + 2]];
  for (let i = 0; i < t.triangles.length; i += 3) {
    check(options, i / 3);
    const ids = [t.triangles[i], t.triangles[i + 1], t.triangles[i + 2]];
    const p = ids.map(point);
    const a = p[1].map((x, k) => x - p[0][k]);
    const b = p[2].map((x, k) => x - p[0][k]);
    const face = [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
    const length = Math.sqrt(
      face[0] * face[0] + face[1] * face[1] + face[2] * face[2],
    );
    if (length > Number.EPSILON) {
      const denominator = f32(length);
      for (let axis = 0; axis < 3; axis++)
        face[axis] = f32(face[axis] / denominator);
    }
    for (let corner = 0; corner < 3; corner++) {
      const a = p[(corner + 1) % 3].map((x, k) => f32(x - p[corner][k]));
      const b = p[(corner + 2) % 3].map((x, k) => f32(x - p[corner][k]));
      const dot = a[1] * b[1] + a[0] * b[0] + a[2] * b[2];
      const aa = a[1] * a[1] + a[0] * a[0] + a[2] * a[2];
      const bb = b[1] * b[1] + b[0] * b[0] + b[2] * b[2];
      const angle =
        aa < Number.EPSILON || bb < Number.EPSILON
          ? 0
          : Math.acos(Math.max(-1, Math.min(1, dot / Math.sqrt(aa * bb))));
      for (let axis = 0; axis < 3; axis++) {
        const index = ids[corner] * 3 + axis;
        out[index] = f32(out[index] + f32(face[axis] * angle));
      }
    }
  }
  for (let i = 0; i < out.length; i += 3) {
    check(options, i / 3);
    const length = f32(
      Math.sqrt(
        f32(
          f32(f32(out[i] * out[i]) + f32(out[i + 1] * out[i + 1])) +
            f32(out[i + 2] * out[i + 2]),
        ),
      ),
    );
    if (length >= Number.EPSILON) {
      // Rounding the reciprocal before multiplication changes angle weights.
      const reciprocal = 1 / length;
      for (let axis = 0; axis < 3; axis++)
        out[i + axis] = f32(out[i + axis] * reciprocal);
    }
  }
  return out;
}

function noiseWeights(t: MeshTopology, options: MeshProcessingOptions) {
  const normals = noiseNormals(t, options);
  const angles = new Float64Array(t.vertices.length / 3).fill(FLOAT_MAX);
  for (let i = 0; i < t.triangles.length; i += 3) {
    check(options, i / 3);
    for (let corner = 0; corner < 3; corner++) {
      const u = t.triangles[i + corner];
      const v = t.triangles[i + ((corner + 1) % 3)];
      let dot = 0;
      for (let axis = 0; axis < 3; axis++)
        dot += normals[u * 3 + axis] * normals[v * 3 + axis];
      if (dot < angles[u]) angles[u] = dot;
      if (dot < angles[v]) angles[v] = dot;
    }
  }
  let minimum = FLOAT_MAX,
    maximum = -FLOAT_MAX;
  const threshold = 10 * (Math.PI / 180);
  for (let i = 0; i < angles.length; i++) {
    if (angles[i] !== FLOAT_MAX) {
      angles[i] = Math.acos(Math.max(-1, Math.min(1, angles[i])));
      if (angles[i] > threshold) angles[i] = FLOAT_MAX;
      else {
        minimum = Math.min(minimum, angles[i]);
        maximum = Math.max(maximum, angles[i]);
      }
    }
  }
  for (let i = 0; i < angles.length; i++) {
    if (angles[i] > maximum) angles[i] = maximum;
    if (angles[i] < minimum) angles[i] = minimum;
    if (maximum >= 1.1920928955078125e-7 && angles[i] !== FLOAT_MAX)
      angles[i] *= 1 / maximum;
  }
  const sums = new Float64Array(angles.length);
  const counts = new Uint32Array(angles.length);
  for (let i = 0; i < t.triangles.length; i += 3) {
    check(options, i / 3);
    for (let corner = 0; corner < 3; corner++) {
      const u = t.triangles[i + corner];
      for (let offset = 1; offset <= 2; offset++) {
        const value = angles[t.triangles[i + ((corner + offset) % 3)]];
        if (Math.abs(value) !== FLOAT_MAX) {
          sums[u] += value;
          counts[u]++;
        }
      }
    }
  }
  for (let i = 0; i < angles.length; i++)
    if (counts[i]) angles[i] = sums[i] / counts[i];
  return angles;
}

/** Weighted, synchronous noise reduction on retained indexed topology.
 * Facet traversal order is preserved so CPU partitions can reproduce its sums.
 */
export function nativeNoiseVertices(
  topology: MeshTopology,
  iterations = 1,
  selection?: Uint8Array,
  applyBoundaryEdges = true,
  options: MeshProcessingOptions = {},
): Float64Array<ArrayBuffer> {
  if (!Number.isSafeInteger(iterations) || iterations < 1)
    throw new Error("Smooth iterations must be a positive integer.");
  const { triangles } = topology;
  if (selection && selection.length !== triangles.length / 3)
    throw new Error("Selection does not match the mesh triangle count.");
  check(options);
  options.onProgress?.(0, "Preparing noise weights");
  const weights = noiseWeights(topology, options);
  const count = topology.vertices.length / 3;
  const movable = new Uint8Array(count);
  const boundaryVertices = new Uint8Array(count);
  const boundaryEdges = new Uint8Array(triangles.length);
  const counts = new Uint32Array(count);
  for (let i = 0; i < triangles.length; i += 3) {
    check(options, i / 3);
    for (let corner = 0; corner < 3; corner++) {
      const u = triangles[i + corner];
      const v = triangles[i + ((corner + 1) % 3)];
      if (!selection || selection[i / 3]) movable[u] = 1;
      const key = u < v ? `${u}:${v}` : `${v}:${u}`;
      const boundary = topology.edges.get(key)?.length === 1;
      if (boundary) {
        boundaryEdges[i + corner] = 1;
        boundaryVertices[u] = boundaryVertices[v] = 1;
      }
      counts[u] += boundary ? 2 : 1;
      counts[v] += boundary ? 2 : 1;
    }
  }
  let vertices = Float64Array.from(topology.vertices, f32);
  const means = new Float64Array(vertices.length);
  const residuals = new Float64Array(vertices.length);
  for (let iteration = 0; iteration < iterations; iteration++) {
    check(options);
    options.onProgress?.(iteration / iterations, "Reducing mesh noise");
    means.fill(0);
    residuals.fill(0);
    for (let i = 0; i < triangles.length; i += 3) {
      check(options, i / 3);
      for (let corner = 0; corner < 3; corner++) {
        const u = triangles[i + corner];
        const v = triangles[i + ((corner + 1) % 3)];
        for (let axis = 0; axis < 3; axis++) {
          means[u * 3 + axis] += vertices[v * 3 + axis];
          means[v * 3 + axis] += vertices[u * 3 + axis];
          if (boundaryEdges[i + corner]) {
            means[u * 3 + axis] += vertices[v * 3 + axis];
            means[v * 3 + axis] += vertices[u * 3 + axis];
          }
        }
      }
    }
    for (let id = 0; id < count; id++)
      if (counts[id])
        for (let axis = 0; axis < 3; axis++)
          means[id * 3 + axis] *= 1 / counts[id];
    for (let i = 0; i < triangles.length; i += 3) {
      check(options, i / 3);
      for (let corner = 0; corner < 3; corner++) {
        const u = triangles[i + corner];
        const v = triangles[i + ((corner + 1) % 3)];
        for (let axis = 0; axis < 3; axis++) {
          const du = means[u * 3 + axis] - vertices[u * 3 + axis];
          const dv = means[v * 3 + axis] - vertices[v * 3 + axis];
          residuals[u * 3 + axis] += dv;
          residuals[v * 3 + axis] += du;
          if (boundaryEdges[i + corner]) {
            residuals[u * 3 + axis] += dv;
            residuals[v * 3 + axis] += du;
          }
        }
      }
    }
    const next = vertices.slice();
    for (let id = 0; id < count; id++) {
      check(options, id);
      if (
        !movable[id] ||
        !counts[id] ||
        (!applyBoundaryEdges && boundaryVertices[id])
      )
        continue;
      for (let axis = 0; axis < 3; axis++) {
        const index = id * 3 + axis;
        next[index] = f32(
          means[index] -
            (means[index] - vertices[index]) * weights[id] +
            (1 - weights[id]) * (residuals[index] * (1 / counts[id])),
        );
        if (!Number.isFinite(next[index]))
          throw new Error(
            "Noise reduction exceeds coordinate precision; original mesh retained.",
          );
      }
    }
    vertices = next;
  }
  options.onProgress?.(1, "Noise reduction completed");
  return vertices;
}
