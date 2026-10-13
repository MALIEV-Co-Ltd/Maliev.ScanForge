import { describe, expect, it } from "vitest";
import {
  nativeStlSpatialBucket,
  nativeStlSpatialTree,
  nativeStlTopology,
  type NativeStlSpatialNode,
} from "../src/scan-native-stl-topology";
import capture from "./fixtures/stl-topology-native.json";
import readerCapture from "./fixtures/stl-reader-native.json";

function collectNodes(
  node: NativeStlSpatialNode,
  path: number[] = [],
): {
  path: number[];
  bounds: number[];
  midpoint: number[];
}[] {
  return [
    { path, bounds: node.bounds, midpoint: node.midpoint },
    ...node.children.flatMap((child, index) =>
      collectNodes(child, [...path, index]),
    ),
  ];
}

describe("original optimized STL spatial mapping and facet construction", () => {
  for (const sample of readerCapture.samples)
    it(`matches complete original reader output for ${sample.name}`, () => {
      expect(readerCapture.provenance.originalOptimizedReaderExecuted).toBe(
        true,
      );
      const result = nativeStlTopology(Float32Array.from(sample.coordinates));
      expect(Array.from(result.vertices)).toEqual(sample.vertices);
      expect(Array.from(result.triangles)).toEqual(sample.triangles);
    });
  for (const sample of capture.samples) {
    it(`matches ${sample.name} spatial nodes and corner buckets`, () => {
      const coordinates = Float32Array.from(sample.coordinates);
      const tree = nativeStlSpatialTree(coordinates);
      expect(collectNodes(tree)).toEqual(sample.nodes);
      const buckets = Array.from(
        { length: coordinates.length / 3 },
        (_, corner) =>
          nativeStlSpatialBucket(
            tree,
            coordinates[corner * 3],
            coordinates[corner * 3 + 1],
            coordinates[corner * 3 + 2],
          ),
      );
      expect(buckets).toEqual(sample.bucketAssignments.flat());
    });
    it(`matches ${sample.name} complete mapped vertex order and accepted facets`, () => {
      const result = nativeStlTopology(Float32Array.from(sample.coordinates));
      expect(Array.from(result.vertices)).toEqual(sample.vertices);
      expect(Array.from(result.triangles)).toEqual(sample.triangles);
    });
  }
  it("rejects invalid coordinate layouts and nonfinite data", () => {
    expect(() => nativeStlTopology(new Float32Array())).toThrow(
      "complete facets",
    );
    expect(() => nativeStlTopology(new Float32Array(8))).toThrow(
      "complete facets",
    );
    expect(() =>
      nativeStlTopology(Float32Array.from([Infinity, 0, 0, 0, 1, 0, 0, 0, 1])),
    ).toThrow("finite");
  });
  it("does not apply the fallback's skinny-facet angle rejection", () => {
    const result = nativeStlTopology(
      Float32Array.from([0, 0, 0, 1, 0, 0, 2, 0.00001, 0]),
    );
    expect(result.triangles.length).toBe(3);
  });
});
