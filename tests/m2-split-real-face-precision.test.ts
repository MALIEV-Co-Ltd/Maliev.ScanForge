import { expect, it } from "vitest";
import { runScanEdit } from "../src/scan-edit";
import { analyzeIndexedMesh } from "../src/mesh-processing";
import { cross, overlapArea, type Point } from "./split-coverage-utils";

it("splits the original scan face through the shared precise operation with conserved oriented area", () => {
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
  const beforeSource = source.slice(),
    beforeCutter = cutter.slice();
  const result = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: source,
    target: cutter,
  });
  expect(result.indexedMesh).toBeDefined();
  expect(result.positions).toBeDefined();
  const topology = analyzeIndexedMesh(
    Float64Array.from(result.indexedMesh!.vertices),
    Uint32Array.from(result.indexedMesh!.triangles),
  );
  expect(topology.components).toHaveLength(2);
  expect(topology.nonManifoldEdges).toBe(0);
  const normal = (p: ArrayLike<number>, i: number) => {
    const a = [p[i + 3] - p[i], p[i + 4] - p[i + 1], p[i + 5] - p[i + 2]],
      b = [p[i + 6] - p[i], p[i + 7] - p[i + 1], p[i + 8] - p[i + 2]];
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
  };
  const reference = normal(source, 0),
    squared = reference.reduce((sum, v) => sum + v * v, 0);
  const drop = reference.reduce(
    (best, value, axis) =>
      Math.abs(value) > Math.abs(reference[best]) ? axis : best,
    0,
  );
  const axes = [0, 1, 2].filter((axis) => axis !== drop);
  const project = (p: ArrayLike<number>, i: number): Point => [
    p[i + axes[0]],
    p[i + axes[1]],
  ];
  const boundary = [project(source, 0), project(source, 3), project(source, 6)];
  if (cross(boundary[0], boundary[1], boundary[2]) < 0) boundary.reverse();
  const faces: Point[][] = [];
  let sum = 0;
  for (let i = 0; i < result.positions!.length; i += 9) {
    const positions = result.positions!;
    for (let corner = 0; corner < 3; corner++) {
      const at = i + corner * 3;
      const planeDistance = reference.reduce(
        (total, value, axis) =>
          total + value * (positions[at + axis] - source[axis]),
        0,
      );
      expect(Math.abs(planeDistance)).toBeLessThan(1e-12);
    }
    const face = [
      project(positions, i),
      project(positions, i + 3),
      project(positions, i + 6),
    ];
    if (cross(face[0], face[1], face[2]) < 0) face.reverse();
    for (const p of face)
      for (let edge = 0; edge < 3; edge++)
        expect(
          cross(boundary[edge], boundary[(edge + 1) % 3], p),
        ).toBeGreaterThanOrEqual(-1e-12);
    faces.push(face);
    const n = normal(result.positions!, i),
      projection = n.reduce((total, v, k) => total + v * reference[k], 0);
    expect(projection).toBeGreaterThan(0);
    sum += projection;
  }
  expect(sum / squared).toBeCloseTo(1, 10);
  for (let i = 0; i < faces.length; i++)
    for (let j = i + 1; j < faces.length; j++)
      expect(overlapArea(faces[i], faces[j])).toBeLessThan(1e-12);
  expect(source).toEqual(beforeSource);
  expect(cutter).toEqual(beforeCutter);
});
