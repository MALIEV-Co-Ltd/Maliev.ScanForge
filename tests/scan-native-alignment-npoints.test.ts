import { expect, it } from "vitest";
import type { Vec3 } from "../src/types";
import { nativeInitializeAlignmentPoints } from "../src/scan-native-alignment-npoints";
import { nativeRefineAlignmentMatrix } from "../src/scan-native-alignment-refinement";
import fixture from "./fixtures/alignment-npoints-native.json";
import rmsFixture from "./fixtures/alignment-refinement-rms-native.json";

function bits(values: readonly number[]) {
  const buffer = new ArrayBuffer(values.length * 8),
    view = new DataView(buffer);
  values.forEach((value, id) => view.setFloat64(id * 8, value, true));
  return Array.from(new Uint8Array(buffer), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
function floatBits(value: number) {
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setFloat32(0, value, true);
  return Array.from(new Uint8Array(buffer), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
it.each(fixture.cases)(
  "matches complete original N-point initialization: $name",
  (capture) => {
    const before = JSON.stringify(capture);
    const matrix = nativeInitializeAlignmentPoints(
      capture.source as Vec3[],
      capture.target as Vec3[],
    );
    expect(bits(matrix)).toBe(capture.matrixBits);
    expect(JSON.stringify(capture)).toBe(before);
  },
);
it.each(rmsFixture.cases)(
  "matches original refinement with optional RMS output: $name",
  (capture) => {
    const result = nativeRefineAlignmentMatrix(
      capture.initial,
      capture.source as Vec3[],
      capture.target as Vec3[],
      {
        budget: capture.budget,
        tolerance: capture.tolerance,
        measureRms: true,
      },
    );
    expect(bits(result.matrix)).toBe(capture.matrixBits);
    expect(floatBits(result.rms!)).toBe(capture.rmsBits);
  },
);
it("checks cancellation and rejects invalid pair inputs", () => {
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    nativeInitializeAlignmentPoints([], [], { signal: controller.signal }),
  ).toThrow("cancelled");
  expect(() => nativeInitializeAlignmentPoints([[0, 0, 0]], [])).toThrow(
    "paired points",
  );
  expect(() =>
    nativeInitializeAlignmentPoints([[NaN, 0, 0]], [[0, 0, 0]]),
  ).toThrow("finite XYZ");
  expect(() =>
    nativeInitializeAlignmentPoints([[1e300, 0, 0]], [[0, 0, 0]]),
  ).toThrow("Float32 precision");
});
