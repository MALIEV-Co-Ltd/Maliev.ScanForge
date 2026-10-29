import type { Vec3 } from "./types";

/** Exact oriented area-vector equality for binary64 output coordinates. */
export function exactSplitCoverage(
  vertices: readonly Vec3[],
  triangles: readonly [number, number, number][],
  ring: readonly number[],
  coordinate: (value: number) => number,
  check: () => void,
): boolean {
  const axes = [0, 1, 2];
  const view = new DataView(new ArrayBuffer(8));
  const parts = (n: number): [bigint, number] => {
    if (!Number.isFinite(n))
      throw new Error("Finite coverage coordinates required.");
    view.setFloat64(0, n, false);
    const high = view.getUint32(0, false),
      low = view.getUint32(4, false);
    const exponent = (high >>> 20) & 0x7ff;
    let mantissa = (BigInt(high & 0xfffff) << 32n) | BigInt(low);
    if (exponent) mantissa |= 1n << 52n;
    if (high >>> 31) mantissa = -mantissa;
    return [mantissa, exponent ? exponent - 1075 : -1074];
  };
  let minimum = 0;
  for (const point of vertices) {
    check();
    for (const axis of axes) {
      const [mantissa, exponent] = parts(coordinate(point[axis]));
      if (mantissa !== 0n) minimum = Math.min(minimum, exponent);
    }
  }
  const points = vertices.map((point) => {
    check();
    return axes.map((axis) => {
      const [mantissa, exponent] = parts(coordinate(point[axis]));
      return mantissa << BigInt(exponent - minimum);
    });
  });
  const cross = (a: number, b: number, c: number) => {
    const p = points[a],
      q = points[b],
      r = points[c];
    const u = q.map((v, i) => v - p[i]);
    const v = r.map((value, i) => value - p[i]);
    return [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
  };
  const covered = [0n, 0n, 0n],
    expected = [0n, 0n, 0n];
  for (const [a, b, c] of triangles) {
    check();
    const value = cross(a, b, c);
    for (let axis = 0; axis < 3; axis++) covered[axis] += value[axis];
  }
  for (let i = 1; i + 1 < ring.length; i++) {
    check();
    const value = cross(ring[0], ring[i], ring[i + 1]);
    for (let axis = 0; axis < 3; axis++) expected[axis] += value[axis];
  }
  return (
    expected.some((value) => value !== 0n) &&
    expected.every((value, axis) => value === covered[axis])
  );
}
