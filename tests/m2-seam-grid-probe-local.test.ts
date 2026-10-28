import { expect, it } from "vitest";
import { refineFiniteCutterMesh } from "../src/scan-split-finite-pipeline";

it("proves the retained original seam has no interior Float32 point on its edge", () => {
  const source = new Float32Array([
    19.898012161254883, 47.31754684448242, -315.9837341308594,
    20.04651641845703, 47.50707244873047, -315.9645080566406, 20.04990005493164,
    47.18638610839844, -315.8510437011719,
  ]);
  const cutter = new Float32Array([
    19.9250431060791, -149.8528594970703, -442.96917724609375, 19.9250431060791,
    -149.8528594970703, 72.22071838378906, 19.9250431060791, 406.9168701171875,
    -442.96917724609375,
  ]);
  const refined = refineFiniteCutterMesh(
    source,
    new Uint32Array([0, 1, 2]),
    cutter,
  );
  const vertices = new Float32Array([...source, ...refined.addedVertices]);
  expect(refined.constraints).toHaveLength(2);
  const [a, b] = refined.constraints;
  const first = Array.from(vertices.slice(3 * a, 3 * a + 3));
  const second = Array.from(vertices.slice(3 * b, 3 * b + 3));
  expect(first[0]).toBe(second[0]);
  // The whole edge stays in these two fixed-exponent Float32 intervals.
  for (const point of [first, second]) {
    expect(point[1]).toBeGreaterThanOrEqual(32);
    expect(point[1]).toBeLessThan(64);
    expect(point[2]).toBeGreaterThan(-512);
    expect(point[2]).toBeLessThanOrEqual(-256);
  }
  const dy = (second[1] - first[1]) / 2 ** -18;
  const dz = (second[2] - first[2]) / 2 ** -15;
  expect([dy, dz]).toEqual([15162, -659]);
  const gcd = (x: number, y: number): number => {
    x = Math.abs(x);
    y = Math.abs(y);
    while (y) [x, y] = [y, x % y];
    return x;
  };
  // A point at fraction t must make both t*dy and t*dz integers.
  // Coprime grid distances admit only the two endpoints.
  expect(gcd(dy, dz)).toBe(1);
});
