import { describe, expect, it } from "vitest";
import captures from "./fixtures/field-native-query-tree.json";
import { buildGuideQueryTree } from "../src/field-query-tree";
import { groupGuideQueryFaces } from "../src/field-query-groups";

describe("recovered ordered query tree", () => {
  it.each(captures.cases.map((capture, index) => ({ capture, index })))(
    "matches whole original tree case $index",
    ({ capture }) => {
      const result = buildGuideQueryTree(
        capture.faceBounds.map((box) => new Float32Array(box)),
        new Uint32Array(capture.inputFaces),
        new Float32Array(capture.bounds),
      );
      expect(Array.from(result.faces)).toEqual(capture.faces);
      expect(
        result.nodes.map((node) => ({
          ...node,
          bounds: Array.from(node.bounds),
        })),
      ).toEqual(capture.nodes);
      expect(result.root).toBe(capture.root);
    },
  );
  it("feeds reconstructed trees into recovered depth grouping", () => {
    const capture = captures.cases.find((c) => c.nodes.length > 3)!;
    const tree = buildGuideQueryTree(
      capture.faceBounds.map((box) => new Float32Array(box)),
      new Uint32Array(capture.inputFaces),
      new Float32Array(capture.bounds),
    );
    const result = groupGuideQueryFaces(
      tree.nodes,
      tree.faces,
      tree.root!,
      capture.faceBounds.length,
      1,
    );
    expect(result.labels.length).toBe(capture.faceBounds.length);
    expect(new Set(result.labels).size).toBeGreaterThan(1);
  });
  it("handles an empty ordered range and rejects malformed bounds or face IDs", () => {
    expect(
      buildGuideQueryTree([], new Uint32Array(), new Float32Array(6)),
    ).toEqual({ faces: new Uint32Array(), nodes: [], root: null });
    expect(() =>
      buildGuideQueryTree([], new Uint32Array([0]), new Float32Array(6)),
    ).toThrow("face");
    expect(() =>
      buildGuideQueryTree(
        [],
        new Uint32Array(),
        new Float32Array([1, 0, 0, 0, 0, 0]),
      ),
    ).toThrow("bounds");
  });
});
