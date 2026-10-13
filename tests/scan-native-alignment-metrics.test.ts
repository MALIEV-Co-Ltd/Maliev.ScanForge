import { expect, it } from "vitest";
import {
  nativeAlignmentRms,
  nativeAlignmentSquaredError,
} from "../src/scan-native-alignment";
import type { Vec3 } from "../src/types";
import fixture from "./fixtures/alignment-metrics-native.json";

function bits(value: number) {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setFloat64(0, value, true);
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
it.each(fixture.cases)(
  "matches original squared-error and RMS: $name",
  (capture) => {
    const before = JSON.stringify(capture);
    const source = capture.source as Vec3[],
      target = capture.target as Vec3[];
    expect(
      bits(nativeAlignmentSquaredError(capture.matrix, source, target)),
    ).toBe(capture.squaredErrorBits);
    expect(bits(nativeAlignmentRms(capture.matrix, source, target))).toBe(
      capture.rmsBits,
    );
    expect(JSON.stringify(capture)).toBe(before);
  },
);
it("rejects mismatched pairs and malformed matrices", () => {
  expect(() => nativeAlignmentSquaredError([], [], [])).toThrow("3x4 matrix");
  expect(() =>
    nativeAlignmentRms(new Array(12).fill(0), [[0, 0, 0]], []),
  ).toThrow("paired points");
});
