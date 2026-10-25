import observed from "./fixtures/average-observed-planes.json";
import rimObserved from "./fixtures/average-observed-open-rim.json";
import { expect, it } from "vitest";
import { averageScanMesh } from "../src/scan-tools-transforms";
import type { IndexedMesh } from "../src/types";

const source = new Float32Array([0, 0, 1, 1, 0, 1, 0, 1, 1]);
const plane = (z: number) =>
  new Float32Array([-10, -10, z, 10, -10, z, 0, 10, z]);

it("matches the observed three-plane export with the 10 mm default", () => {
  const base = Float32Array.from(observed.inputs["base-scan"]);
  const result = averageScanMesh(base, {
    targets: [
      observed.inputs["near-reference"],
      observed.inputs["far-reference"],
    ],
  });
  expect(Array.from(result.positions)).toEqual(observed.positions);
  expect(Array.from(base)).toEqual(observed.inputs["base-scan"]);
});

it("rejects the nearest hit when its projection is on an open rim", () => {
  const original = new Float32Array([11, -10, 1, 12, -10, 1, 11, -9, 1]);
  expect(
    averageScanMesh(original, { targets: [plane(0)], tolerance: 5 }).positions,
  ).toEqual(original);
});

it("uses strict tolerance exclusion", () => {
  expect(
    averageScanMesh(source, { targets: [plane(0)], tolerance: 1 }).positions,
  ).toEqual(source);
});

it("publishes the base indexed identities and unused vertices without retaining stale normals", () => {
  const original = new Float32Array([
    -2, -2, 2, 2, -2, 2, 2, 2, 2, -2, -2, 2, 2, 2, 2, -2, 2, 2,
  ]);
  const topology: IndexedMesh = {
    vertices: new Float32Array([...original, 99, 99, 99]),
    triangles: new Uint32Array([0, 1, 2, 3, 4, 5]),
    normals: new Float32Array(21).fill(7),
  };
  const before = topology.vertices.slice();
  const result = averageScanMesh(original, {
    targets: [plane(0)],
    sourceTopology: topology,
  } as Parameters<typeof averageScanMesh>[1]);
  expect(result.indexedMesh?.vertices.length).toBe(21);
  expect(result.indexedMesh?.triangles).toEqual(topology.triangles);
  expect(result.indexedMesh?.triangles).not.toBe(topology.triangles);
  expect(Array.from(result.indexedMesh!.vertices).slice(-3)).toEqual([
    99, 99, 99,
  ]);
  expect(result.indexedMesh?.normals).toBeUndefined();
  expect(result.indexedMesh?.geometryNormals).toBeInstanceOf(Float32Array);
  expect(result.indexedMesh?.geometryNormals?.length).toBe(21);
  expect(result.indexedMesh?.geometryNormals?.[2]).toBe(1);
  expect(topology.vertices).toEqual(before);
  expect(topology.normals?.[0]).toBe(7);
  expect(result.positions[2]).toBe(1);
});

it("rounds each accumulated contribution to Float32 in reference order", () => {
  const original = source.map((value, index) =>
    index % 3 === 2 ? 16777216 : value,
  );
  const options = { tolerance: 40000000 };
  const first = averageScanMesh(original, {
    ...options,
    targets: [plane(1), plane(-16777216)],
  }).positions;
  const reversed = averageScanMesh(original, {
    ...options,
    targets: [plane(-16777216), plane(1)],
  }).positions;
  expect(first[2]).toBe(0);
  expect(reversed[2]).toBe(Math.fround(1 / 3));
  expect(original[2]).toBe(16777216);
});

it("preserves duplicate indexed seam vertices instead of welding them together", () => {
  const target = new Float32Array([
    -10, 0, 0, 10, 0, 0, 0, 10, 0, 10, 0, 0, -10, 0, 0, 0, 0, 10,
  ]);
  const original = new Float32Array([0, -1, -1, 0.5, -1, -1, 0, -1.5, -1]);
  const mesh: IndexedMesh = {
    vertices: target,
    triangles: new Uint32Array([0, 1, 2, 3, 4, 5]),
  };
  const separated = averageScanMesh(original, {
    targets: [target],
    targetTopology: [mesh],
  }).positions;
  const joined = averageScanMesh(original, { targets: [target] }).positions;
  expect(separated[2]).toBe(-1);
  expect(joined[2]).toBe(-0.5);
});

it("rejects tolerance that cannot be represented as a positive finite Float32", () => {
  for (const tolerance of [1e-50, 1e40])
    expect(() =>
      averageScanMesh(source, { targets: [plane(0)], tolerance }),
    ).toThrow(/Float32/);
});

it("cancels reference preparation without changing any source or reference bytes", () => {
  const original = source.slice(),
    target = plane(0),
    before = target.slice();
  const controller = new AbortController();
  expect(() =>
    averageScanMesh(source, {
      targets: [target],
      signal: controller.signal,
      onProgress: (_fraction, stage) => {
        if (/reference/i.test(stage)) controller.abort();
      },
    }),
  ).toThrow(/cancel|abort/i);
  expect(source).toEqual(original);
  expect(target).toEqual(before);
});

it("keeps preparation, accumulation and publication progress monotonic", () => {
  const progress: number[] = [];
  averageScanMesh(source, {
    targets: [plane(0), plane(2)],
    onProgress: (fraction) => progress.push(fraction),
  });
  expect(progress.at(-1)).toBe(1);
  expect(
    progress.every(
      (fraction, index) =>
        fraction >= 0 &&
        fraction <= 1 &&
        (index === 0 || fraction >= progress[index - 1]),
    ),
  ).toBe(true);
});

it("matches the observed native open-rim rejection export", () => {
  const result = averageScanMesh(rimObserved.inputs["rim-source"], {
    targets: [rimObserved.inputs["rim-reference"]],
    tolerance: rimObserved.tolerance,
  });
  expect(Array.from(result.positions)).toEqual(rimObserved.positions);
  expect(Array.from(result.positions)).toEqual(
    rimObserved.inputs["rim-source"],
  );
});
