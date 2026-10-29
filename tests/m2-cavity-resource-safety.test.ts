import { expect, it } from "vitest";
import { refineFiniteCutterMesh } from "../src/scan-split-finite-pipeline";
import { Box3, Triangle, Vector3 } from "three";
import {
  buildExperimentalNativeTree,
  visitExperimentalNativeTree,
} from "../src/scan-split-native-order-tree";

const fixture = () => ({
  vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  triangles: new Uint32Array([0, 1, 2]),
  cutter: new Float32Array([0.5, -1, -1, 0.5, 2, -1, 0.5, 0, 1]),
});

it("rejects a depleted tree budget without changing source or cutter", () => {
  const { vertices, triangles, cutter } = fixture();
  const before = [vertices.slice(), triangles.slice(), cutter.slice()];
  expect(() =>
    refineFiniteCutterMesh(vertices, triangles, cutter, {
      maxEstimatedTemporaryBytes: 0,
    }),
  ).toThrow(/tree reference budget/i);
  expect([vertices, triangles, cutter]).toEqual(before);
});

it("rejects a depleted point-order budget without changing inputs", () => {
  const { vertices, triangles, cutter } = fixture();
  const before = [vertices.slice(), triangles.slice(), cutter.slice()];
  expect(() =>
    refineFiniteCutterMesh(vertices, triangles, cutter, {
      maxPointOrderEntries: 0,
    }),
  ).toThrow(/point-order budget/i);
  expect([vertices, triangles, cutter]).toEqual(before);
});

it("honors cancellation during traversal without changing inputs", () => {
  const { vertices, triangles, cutter } = fixture();
  const before = [vertices.slice(), triangles.slice(), cutter.slice()];
  const controller = new AbortController();
  let calls = 0;
  expect(() =>
    refineFiniteCutterMesh(vertices, triangles, cutter, {
      signal: controller.signal,
      check: () => {
        if (++calls === 40) controller.abort();
      },
    }),
  ).toThrow(/abort/i);
  expect(calls).toBeGreaterThanOrEqual(40);
  expect([vertices, triangles, cutter]).toEqual(before);
});

it("does not exhaust the work budget on a distant repeated cutter", () => {
  const vertices = new Float32Array([
    5000, 5000, 2, 5001, 5000, 2, 5000, 5001, 2,
  ]);
  const triangles = new Uint32Array([0, 1, 2]);
  const cutter = Float32Array.from(
    Array.from({ length: 25 }, () => [0, 0, 0, 1000, 0, 0, 0, 1000, 0]).flat(),
  );
  const original = [vertices.slice(), triangles.slice(), cutter.slice()];
  const result = refineFiniteCutterMesh(vertices, triangles, cutter, {
    maxWork: 150000,
  });
  expect(result.affectedFaces).toBe(0);
  expect([vertices, triangles, cutter]).toEqual(original);
});

it("does not exhaust the work budget on irrelevant cutter faces when one face is nearby", () => {
  const vertices = new Float32Array([
    5000, 5000, 2, 5001, 5000, 2, 5000, 5001, 2,
  ]);
  const triangles = new Uint32Array([0, 1, 2]);
  const cutter = Float32Array.from([
    ...Array.from({ length: 25 }, () => [
      0, 0, 0, 1000, 0, 0, 0, 1000, 0,
    ]).flat(),
    5000.5,
    4999,
    1,
    5000.5,
    5002,
    1,
    5000.5,
    5000,
    3,
  ]);
  const original = [vertices.slice(), triangles.slice(), cutter.slice()];
  const result = refineFiniteCutterMesh(vertices, triangles, cutter, {
    maxWork: 150000,
  });
  expect(result.affectedFaces).toBe(1);
  expect([vertices, triangles, cutter]).toEqual(original);
});

it("keeps query order independent of earlier tree expansion", () => {
  const faces = Array.from({ length: 30 }, (_, index) => ({
    index,
    triangle: new Triangle(
      new Vector3(index / 30, 0, 0),
      new Vector3(index / 30, 1, 0),
      new Vector3(index / 30, 0, 1),
    ),
  }));
  const box = new Box3(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
  const first = new Box3(new Vector3(0, 0, 0), new Vector3(0.45, 1, 1));
  const second = new Box3(new Vector3(0.55, 0, 0), new Vector3(1, 1, 1));
  const run = (
    tree: ReturnType<
      typeof buildExperimentalNativeTree<(typeof faces)[number]>
    >,
    query: Box3,
  ) => {
    const order: number[] = [];
    visitExperimentalNativeTree(
      tree,
      query,
      (f) => order.push(f.index),
      () => {},
    );
    return order;
  };
  const fresh = buildExperimentalNativeTree(box, faces, () => {});
  const expanded = buildExperimentalNativeTree(box, faces, () => {});
  const expected = run(fresh, first);
  run(expanded, second);
  expect(run(expanded, first)).toEqual(expected);
});

it("checks cancellation while expanding a native-order tree", () => {
  const faces = Array.from({ length: 30 }, (_, index) => ({
    index,
    triangle: new Triangle(
      new Vector3(0, 0, 0),
      new Vector3(1, 0, 0),
      new Vector3(0, 1, 0),
    ),
  }));
  const box = new Box3(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
  const tree = buildExperimentalNativeTree(box, faces, () => {}, {
    maxReferences: 300,
  });
  let checks = 0;
  expect(() =>
    visitExperimentalNativeTree(
      tree,
      box,
      () => {},
      () => {
        if (++checks === 50) throw new DOMException("Aborted", "AbortError");
      },
    ),
  ).toThrow(/abort/i);
  expect(checks).toBe(50);
  const resumed: number[] = [],
    fresh: number[] = [];
  visitExperimentalNativeTree(
    tree,
    box,
    (f) => resumed.push(f.index),
    () => {},
  );
  visitExperimentalNativeTree(
    buildExperimentalNativeTree(box, faces, () => {}, { maxReferences: 300 }),
    box,
    (f) => fresh.push(f.index),
    () => {},
  );
  expect(resumed).toEqual(fresh);
});
