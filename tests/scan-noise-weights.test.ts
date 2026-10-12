import { expect, it } from "vitest";
import {
  averageNoiseAngles,
  normalizeNoiseAngles,
} from "../src/scan-native-noise";
import capture from "./fixtures/noise-weight-stages.json";

it.each(capture.cases.map((value, index) => ({ ...value, index })))(
  "matches original x64 normalization and ordered averaging case $index",
  ({
    angles,
    triangles,
    nativeNormalized,
    nativeWeights,
    nativeWeightBits,
  }) => {
    const values = new Float64Array(angles);
    expect(normalizeNoiseAngles(values)).toBe(values);
    expect(Array.from(values)).toEqual(nativeNormalized);
    expect(averageNoiseAngles(new Uint32Array(triangles), values)).toBe(values);
    expect(Array.from(values)).toEqual(nativeWeights);
    const bytes = Array.from(new Uint8Array(values.buffer), (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("");
    expect(bytes).toBe(nativeWeightBits);
  },
);

it("cancelled averaging retains its input weights", () => {
  const values = new Float64Array([0.2, 0.4, 1]);
  const before = values.slice();
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    averageNoiseAngles(new Uint32Array([0, 1, 2]), values, {
      signal: controller.signal,
    }),
  ).toThrow("cancelled");
  expect(values).toEqual(before);
});
