import { expect, it } from "vitest";
import native from "./fixtures/alignment-adjacency-global.json";
import { nativeBuildAlignmentAdjacency } from "../src/scan-native-alignment-adjacency";

it.each(native.cases)(
  "matches original global topology rebuild: $name",
  (sample) => {
    const result = nativeBuildAlignmentAdjacency(
      sample.vertices.flat(),
      sample.triangles,
    );
    expect(Array.from(result.vertexBuckets)).toEqual(sample.vertexBuckets);
    expect(Array.from(result.neighbors)).toEqual(sample.neighbors);
    expect(Array.from(result.neighborEdges)).toEqual(sample.neighborEdges);
    expect(Array.from(result.triangleFlags)).toEqual(sample.triangleFlags);
    expect(Number(result.adjacencyValid)).toBe(sample.adjacencyValid);
  },
);
