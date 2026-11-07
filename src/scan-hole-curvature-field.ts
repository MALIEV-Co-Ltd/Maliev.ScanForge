import {
  nativeDenseInverse,
  nativeInverseWorkingSet,
} from "./native-surface-fitting";
import type { MeshTopology } from "./mesh-processing";
import type { Vec3 } from "./types";

/** Selected rim faces followed by the native two synchronous adjacency passes. */
export function nativeCurvatureCollar(
  topology: MeshTopology,
  boundary: readonly number[],
  check?: () => void,
): { faces: number[]; indices: number[]; vertices: Vec3[] } {
  check?.();
  const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const invalid = () =>
    new Error("Curvature requires an exposed closed boundary.");
  if (boundary.length < 3 || new Set(boundary).size !== boundary.length)
    throw invalid();
  const selected = new Uint8Array(topology.triangles.length / 3);
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i],
      b = boundary[(i + 1) % boundary.length];
    if (!Number.isInteger(a) || a < 0 || a >= topology.vertices.length / 3)
      throw invalid();
    const uses = topology.edges.get(key(a, b));
    if (uses?.length !== 1) throw invalid();
    selected[uses[0].face] = 1;
  }
  for (let pass = 0; pass < 2; pass++) {
    const next = selected.slice();
    for (let face = 0; face < selected.length; face++) {
      if (face % 4096 === 0) check?.();
      if (!selected[face]) continue;
      for (let corner = 0; corner < 3; corner++) {
        const a = topology.triangles[face * 3 + corner];
        const b = topology.triangles[face * 3 + ((corner + 1) % 3)];
        for (const use of topology.edges.get(key(a, b)) ?? [])
          next[use.face] = 1;
      }
    }
    selected.set(next);
  }
  const marked = new Uint8Array(topology.vertices.length / 3);
  const faces: number[] = [];
  for (let face = 0; face < selected.length; face++) {
    if (face % 4096 === 0) check?.();
    if (!selected[face]) continue;
    faces.push(face);
    for (let corner = 0; corner < 3; corner++)
      marked[topology.triangles[face * 3 + corner]] = 1;
  }
  const vertices: Vec3[] = [];
  const indices: number[] = [];
  for (let vertex = 0; vertex < marked.length; vertex++) {
    if (vertex % 4096 === 0) check?.();
    if (marked[vertex]) {
      indices.push(vertex);
      vertices.push([
        topology.vertices[vertex * 3],
        topology.vertices[vertex * 3 + 1],
        topology.vertices[vertex * 3 + 2],
      ]);
    }
  }
  return { faces, indices, vertices };
}

/** Recovered scalar thin-plate field in the caller's orthonormal graph frame. */
export function nativeThinPlateField(
  inputPoints: readonly (readonly number[])[],
  options: { check?: () => void } = {},
): { evaluate(x: number, y: number): number } {
  const { check } = options;
  check?.();
  const count = inputPoints.length;
  nativeInverseWorkingSet(count);
  if (
    count < 3 ||
    inputPoints.some(
      (point) => point.length !== 3 || !point.every(Number.isFinite),
    )
  )
    throw new Error("Curvature interpolation requires finite graph points.");
  const points = inputPoints.map((point) => [point[0], point[1], point[2]]);
  const kernel = (x: number, y: number) => {
    const radius = Math.sqrt(x * x + y * y);
    return radius <= 0 ? 0 : Math.log(radius * radius) * radius * radius;
  };
  const matrix = new Float64Array(count * count);
  for (let row = 0; row < count; row++) {
    check?.();
    for (let column = 0; column < count; column++)
      matrix[row * count + column] = kernel(
        points[row][0] - points[column][0],
        points[row][1] - points[column][1],
      );
  }
  const inverse = nativeDenseInverse(matrix, count, check);
  if (!inverse)
    throw new Error(
      "Curvature interpolation has a singular or coincident collar.",
    );
  const plane = points.map(([x, y]) => [1, x, y]);
  const projected = Array.from({ length: 3 }, () => new Float64Array(count));
  for (let row = 0; row < 3; row++)
    for (let column = 0; column < count; column++)
      for (let sample = 0; sample < count; sample++)
        projected[row][column] +=
          plane[sample][row] * inverse[sample * count + column];
  const schur = new Float64Array(9);
  for (let row = 0; row < 3; row++)
    for (let column = 0; column < 3; column++)
      for (let sample = 0; sample < count; sample++)
        schur[row * 3 + column] +=
          projected[row][sample] * plane[sample][column];
  const affineInverse = nativeDenseInverse(schur, 3, check);
  if (!affineInverse)
    throw new Error("Curvature interpolation has a singular graph frame.");
  const rhs = projected.map((row) =>
    row.reduce((sum, value, sample) => sum + value * points[sample][2], 0),
  );
  const affine = [0, 1, 2].map((row) =>
    rhs.reduce(
      (sum, value, column) => sum + value * affineInverse[row * 3 + column],
      0,
    ),
  );
  const residual = points.map((point, sample) => {
    let value = point[2];
    for (let column = 0; column < 3; column++)
      value -= plane[sample][column] * affine[column];
    return value;
  });
  const coefficients = points.map((_, row) =>
    residual.reduce(
      (sum, value, column) => sum + value * inverse[row * count + column],
      0,
    ),
  );
  return {
    evaluate(x, y) {
      check?.();
      if (!Number.isFinite(x) || !Number.isFinite(y))
        throw new Error("Curvature query coordinates must be finite.");
      const value = points.reduce(
        (sum, point, sample) =>
          sum + kernel(x - point[0], y - point[1]) * coefficients[sample],
        affine[0] + affine[1] * x + affine[2] * y,
      );
      if (!Number.isFinite(value))
        throw new Error("Curvature interpolation overflowed.");
      return value;
    },
  };
}
