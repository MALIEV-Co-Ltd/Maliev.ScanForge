import { expect, it } from "vitest";
import { noiseWeightsFromNormals } from "../src/scan-native-noise";
import capture from "./fixtures/noise-partition-kernel.json";

it.each(capture.cases)(
  "preserves original partition and fallback weights for $label",
  ({ normals, triangles, degrees, nativeWeights, nativeWeightBits }) => {
    const input = new Float32Array(normals);
    const connectivity = new Uint32Array(triangles);
    const result = noiseWeightsFromNormals(connectivity, input, degrees);
    expect(Array.from(result)).toEqual(nativeWeights);
    expect(
      Array.from(new Uint8Array(result.buffer), (value) =>
        value.toString(16).padStart(2, "0"),
      ).join(""),
    ).toBe(nativeWeightBits);
    expect(Array.from(input)).toEqual(normals);
    expect(Array.from(connectivity)).toEqual(triangles);
  },
);

it("covers native internal facets and crossing facets in the same operation", () => {
  expect(
    capture.cases.some(
      (item) => item.partitionFacets > 0 && item.fallbackFacets > 0,
    ),
  ).toBe(true);
  expect(
    capture.cases.some(
      (item) => new Set(item.groups).size === 1 && item.fallbackFacets > 0,
    ),
  ).toBe(true);
  for (const item of capture.cases) {
    let processed = 0;
    for (let i = 0; i < item.triangles.length; i += 3) {
      const group = item.groups[item.triangles[i]];
      if (item.processedMask[i / 3]) {
        expect(item.groups[item.triangles[i + 1]]).toBe(group);
        expect(item.groups[item.triangles[i + 2]]).toBe(group);
        processed++;
      }
    }
    expect(item.partitionFacets).toBe(processed);
    expect(item.fallbackFacets).toBe(item.triangles.length / 3 - processed);
  }
});
