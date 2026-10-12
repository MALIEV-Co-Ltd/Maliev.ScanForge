import { expect, it } from "vitest";
import { noiseWeightsFromNormals } from "../src/scan-native-noise";
import capture from "./fixtures/noise-angle-kernel.json";

it.each(capture.cases)(
  "matches original edge-angle preparation bytes for $label",
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

it("honors cancellation without changing normals or connectivity", () => {
  const source = capture.cases[0];
  const normals = new Float32Array(source.normals);
  const triangles = new Uint32Array(source.triangles);
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    noiseWeightsFromNormals(triangles, normals, 10, {
      signal: controller.signal,
    }),
  ).toThrow("cancelled");
  expect(Array.from(normals)).toEqual(source.normals);
  expect(Array.from(triangles)).toEqual(source.triangles);
});
