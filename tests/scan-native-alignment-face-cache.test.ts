import { expect, it } from "vitest";
import native from "./fixtures/alignment-face-cache.json";
import { nativeAlignmentFaceCache } from "../src/scan-native-alignment-face-cache";

it.each(native.cases)(
  "matches original facet cache bytes: $label",
  (sample) => {
    const vertices = new Float64Array(sample.vertices);
    const indices = new Uint32Array(sample.triangles);
    const result = nativeAlignmentFaceCache(vertices, indices);
    expect(Array.from(result.normals)).toEqual(sample.facetNormals);
    expect(Array.from(result.degenerate)).toEqual(sample.degenerate);
    expect(
      Array.from(new Uint8Array(result.normals.buffer), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
    ).toBe(sample.facetNormalBits);
    expect(Array.from(vertices)).toEqual(sample.vertices);
    expect(Array.from(indices)).toEqual(sample.triangles);
  },
);

it("rejects invalid indices and cancellation", () => {
  expect(() => nativeAlignmentFaceCache([0, 0, 0], [0, 1, 2])).toThrow("index");
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    nativeAlignmentFaceCache([0, 0, 0], [0, 0, 0], {
      signal: controller.signal,
    }),
  ).toThrow("cancelled");
});
