import { expect, it } from "vitest";
import { analyzeIndexedMesh } from "../src/mesh-processing";
import { smoothNativeCurvatureCollar } from "../src/scan-hole-curvature-smooth";

function tetrahedron() {
  return analyzeIndexedMesh(
    new Float64Array([0, 0, 1, 1, 0, 0, 0, 1, 0, -1, -1, 0]),
    new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
  );
}

it("uses the recovered two-pass displacement correction on a closed selected fan", () => {
  const topology = tetrahedron();
  const result = smoothNativeCurvatureCollar(
    topology,
    new Uint8Array(4).fill(1),
    1,
  );
  expect(Array.from(result)).toEqual([
    0,
    0,
    Math.fround(2 / 3),
    Math.fround(5 / 9),
    0,
    Math.fround(1 / 9),
    0,
    Math.fround(5 / 9),
    Math.fround(1 / 9),
    Math.fround(-5 / 9),
    Math.fround(-5 / 9),
    Math.fround(1 / 9),
  ]);
});

it("publishes only selected vertices while using the complete neighboring field", () => {
  const topology = tetrahedron(),
    before = topology.vertices.slice();
  const result = smoothNativeCurvatureCollar(
    topology,
    new Uint8Array([1, 0, 0, 0]),
    1,
  );
  expect(result[2]).toBe(Math.fround(2 / 3));
  expect(Array.from(result.slice(3))).toEqual(Array.from(before.slice(3)));
  expect(topology.vertices).toEqual(before);
});

it("doubles boundary-edge contributions and pins the exposed source rim", () => {
  const points: number[] = [],
    faces: number[] = [];
  for (let y = 0; y < 3; y++)
    for (let x = 0; x < 3; x++) points.push(x, y, x === 1 && y === 1 ? 1 : 0);
  for (let y = 0; y < 2; y++)
    for (let x = 0; x < 2; x++) {
      const a = y * 3 + x;
      faces.push(a, a + 1, a + 4, a, a + 4, a + 3);
    }
  points.push(99, 99, 99);
  const topology = analyzeIndexedMesh(
    Float64Array.from(points),
    Uint32Array.from(faces),
  );
  const result = smoothNativeCurvatureCollar(
    topology,
    new Uint8Array([1, 1, 1, 1, 1, 1, 1, 1, 1, 0]),
    1,
  );
  expect(result[14]).toBe(Math.fround(23 / 36));
  for (let i = 0; i < 10; i++)
    if (i !== 4)
      expect(Array.from(result.slice(i * 3, i * 3 + 3))).toEqual(
        points.slice(i * 3, i * 3 + 3),
      );
  expect(Array.from(topology.vertices)).toEqual(points);
  expect(Array.from(result).every(Number.isFinite)).toBe(true);
});

it("keeps an unselected collar unchanged through both native iterations", () => {
  const topology = tetrahedron();
  const result = smoothNativeCurvatureCollar(topology, new Uint8Array(4), 2);
  expect(Array.from(result)).toEqual(Array.from(topology.vertices));
  expect(result.buffer).not.toBe(topology.vertices.buffer);
});

it("validates selection and iteration counts and cancels without altering source", () => {
  const topology = tetrahedron(),
    before = topology.vertices.slice();
  expect(() =>
    smoothNativeCurvatureCollar(topology, new Uint8Array(3), 2),
  ).toThrow(/selection|matching/i);
  expect(() =>
    smoothNativeCurvatureCollar(topology, new Uint8Array(4), NaN),
  ).toThrow(/iteration/i);
  let checks = 0;
  expect(() =>
    smoothNativeCurvatureCollar(topology, new Uint8Array(4).fill(1), 2, () => {
      if (++checks === 3) throw new DOMException("Cancelled", "AbortError");
    }),
  ).toThrow(/Cancelled/);
  expect(topology.vertices).toEqual(before);
});
