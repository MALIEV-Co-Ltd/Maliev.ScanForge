import { expect, it } from "vitest";
import native from "./fixtures/noise-octree-query.json";
import { noiseTriangleDistance } from "../src/scan-noise-deviation";
import {
  queryNoiseOctree,
  type NoiseQueryNode,
  type NoiseBounds,
} from "../src/scan-noise-octree-query";
import {
  packAlignmentTree,
  queryAlignmentPackedTree,
} from "../src/scan-alignment-packed-tree";

it("preserves every captured native winner and the complete evaluation order", () => {
  const nodes: NoiseQueryNode[] = native.nodes.map((n) => ({
    bounds: n.bounds as unknown as NoiseBounds,
    center: n.center as [number, number, number],
    mode: n.mode,
    triangles: n.triangles,
    children: {},
  }));
  native.nodes.forEach((n, id) => {
    nodes[id].children = Object.fromEntries(
      Object.entries(n.children).map(([child, index]) => [child, nodes[index]]),
    );
  });
  const bounds = new Float32Array(
    native.triangles.flatMap((points) => [
      ...[0, 1, 2].map((axis) => Math.min(...points.map((p) => p[axis]))),
      ...[0, 1, 2].map((axis) => Math.max(...points.map((p) => p[axis]))),
    ]),
  );
  for (const sample of native.samples) {
    const tree = packAlignmentTree(nodes[sample.tree]);
    expect(tree.geometry.buffer).toBeInstanceOf(SharedArrayBuffer);
    const traces: number[][] = [[], []];
    const evaluate = (lane: number) => (id: number, radius: number) => {
      traces[lane].push(id, radius);
      const [a, b, c] = native.triangles[id];
      return noiseTriangleDistance(sample.p, a, b, c, radius);
    };
    const expected = queryNoiseOctree(
      nodes[sample.tree],
      sample.p,
      sample.radius,
      bounds,
      evaluate(0),
    );
    const result = queryAlignmentPackedTree(
      structuredClone(tree),
      sample.p,
      sample.radius,
      bounds,
      evaluate(1),
    );
    expect(result, sample.name).toEqual(expected);
    expect(result?.triangle ?? null, sample.name).toBe(sample.winner);
    expect(result?.distance ?? null, sample.name).toBe(sample.distance);
    expect(traces[1], sample.name).toEqual(traces[0]);
  }
});

it("retains double precision centers, signed zero, duplicate memberships and empty children", () => {
  const leaf: NoiseQueryNode = {
    bounds: [-1, -1, -1, 1, 1, 1],
    center: [-0, 2 ** -40, 0],
    mode: 0,
    triangles: [1, 0, 1],
    children: {},
  };
  const root: NoiseQueryNode = {
    ...leaf,
    mode: -1,
    triangles: [],
    children: { 0: leaf, 7: { ...leaf, triangles: [] } },
  };
  const packed = packAlignmentTree(root);
  expect(packed.geometry[7]).toBe(2 ** -40);
  expect(Object.is(packed.geometry[6], -0)).toBe(true);
  expect(Array.from(packed.triangles)).toEqual([1, 0, 1]);
  const bounds = new Float32Array([-1, -1, -1, 1, 1, 1, -1, -1, -1, 1, 1, 1]);
  expect(
    queryAlignmentPackedTree(packed, [0, 0, 0], 1, bounds, (id) =>
      id === 1 ? -0.25 : 0.25,
    ),
  ).toEqual({ triangle: 1, distance: -0.25 });
});
