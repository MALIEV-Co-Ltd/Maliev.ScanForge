import { expect, it } from "vitest";
import { groupGuideQueryFaces } from "../src/field-query-groups";
import type { GuideQueryNode } from "../src/field-surface-query";
import { queryGuideSurface } from "../src/field-surface-query";
import native from "./fixtures/field-native-query-groups.json";

const bounds = new Float32Array(6);
const nodes: GuideQueryNode[] = [
  { bounds, children: [1, 2] },
  { bounds, range: [0, 1] },
  { bounds, children: [3, 4] },
  { bounds, range: [1, 2] },
  { bounds, range: [2, 3] },
];
const faces = new Uint32Array([2, 0, 1]);

it.each(native.cases.map((entry, id) => ({ ...entry, id })))(
  "matches complete original tree-depth grouping case $id",
  (entry) => {
    const tree: GuideQueryNode[] = entry.nodes.map((node) => ({
      bounds,
      ...("range" in node && node.range
        ? { range: node.range as [number, number] }
        : {}),
      ...("children" in node && node.children
        ? { children: node.children as [number, number] }
        : {}),
    }));
    const actual = groupGuideQueryFaces(
      tree,
      new Uint32Array(entry.faces),
      entry.root,
      entry.faceCount,
      entry.depth,
    );
    expect(Array.from(actual.labels)).toEqual(entry.labels);
    expect(actual.groups).toBe(entry.groups);
  },
);

it("labels first-child-first and increments at the requested ancestor after visiting its children", () => {
  expect(groupGuideQueryFaces(nodes, faces, 0, 4, 0)).toEqual({
    labels: new Int32Array([0, 0, 0, 0]),
    groups: 1,
  });
  expect(groupGuideQueryFaces(nodes, faces, 0, 4, 1)).toEqual({
    labels: new Int32Array([1, 1, 0, 0]),
    groups: 2,
  });
  expect(groupGuideQueryFaces(nodes, faces, 0, 4, 2)).toEqual({
    labels: new Int32Array([1, 2, 0, 0]),
    groups: 3,
  });
  expect(groupGuideQueryFaces(nodes, faces, 0, 4, -1)).toEqual({
    labels: new Int32Array(4),
    groups: 0,
  });
});

it("counts empty internal nodes at the requested depth and preserves last writes for repeated face IDs", () => {
  expect(
    groupGuideQueryFaces([{ bounds }], new Uint32Array(), 0, 0, 0).groups,
  ).toBe(1);
  expect(
    groupGuideQueryFaces(nodes, new Uint32Array([0, 0, 0]), 0, 2, 2),
  ).toEqual({ labels: new Int32Array([2, 0]), groups: 3 });
});

it("rejects invalid dimensions, leaf ranges, missing children and cyclic trees", () => {
  expect(() => groupGuideQueryFaces(nodes, faces, 0, 1, 0)).toThrow("face");
  expect(() => groupGuideQueryFaces(nodes, faces, 0, 4, 0.5)).toThrow("depth");
  expect(() =>
    groupGuideQueryFaces([{ bounds, range: [0, 4] }], faces, 0, 4, 0),
  ).toThrow("range");
  expect(() =>
    groupGuideQueryFaces([{ bounds, children: [0, 0] }], faces, 0, 4, 0),
  ).toThrow("cyclic");
  expect(() =>
    groupGuideQueryFaces(
      [{ bounds, children: [1, null] }, nodes[1]],
      faces,
      0,
      4,
      0,
    ),
  ).toThrow("missing");
});

it("maps a recovered surface query's original face ID to its depth group", () => {
  const box = new Float32Array([0, 0, 0, 2, 2, 2]);
  const tree = nodes.map((node) => ({ ...node, bounds: box }));
  const surface = {
    positions: new Float32Array([
      0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 1, 2, 0, 1, 0, 2, 1, 0, 0, 2, 2, 0, 2, 0,
      2, 2,
    ]),
    triangles: new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    bounds: box,
    faces,
    nodes: tree,
    root: 0,
  };
  const grouped = groupGuideQueryFaces(tree, faces, 0, 3, 1);
  const hit = queryGuideSurface(
    surface,
    new Float32Array([0.25, 0.25, 1.9]),
    1,
  );
  expect(hit.face).toBe(2);
  expect(grouped.labels[hit.face]).toBe(0);
  expect(Array.from(grouped.labels)).toEqual([1, 1, 0]);
});
