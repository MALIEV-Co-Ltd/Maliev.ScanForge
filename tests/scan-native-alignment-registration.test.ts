import { expect, it } from "vitest";
import type { Vec3 } from "../src/types";
import { nativeRegisterAlignmentPoints } from "../src/scan-native-alignment-registration";
import points from "./fixtures/alignment-npoints-native.json";
import fixture from "./fixtures/alignment-registration-native.json";

function bits(values: number[]) {
  const buffer = new ArrayBuffer(values.length * 8);
  const view = new DataView(buffer);
  values.forEach((value, id) => view.setFloat64(id * 8, value, true));
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

it.each(fixture.cases)(
  "matches complete original paired-point registration: $name",
  (capture) => {
    const input = points.cases.find((row) => row.name === capture.name)!;
    const before = JSON.stringify(input);
    const result = nativeRegisterAlignmentPoints(
      input.source as Vec3[],
      input.target as Vec3[],
    );
    expect(result.accepted).toBe(capture.accepted);
    expect(bits(result.matrix)).toBe(capture.matrixBits);
    if (capture.accepted) expect(bits([result.rms!])).toBe(capture.rmsBits);
    else expect(result.rms).toBeUndefined();
    expect(JSON.stringify(input)).toBe(before);
  },
);

it("validates paired coordinates and honours cancellation before fitting", () => {
  expect(() => nativeRegisterAlignmentPoints([], [[0, 0, 0]])).toThrow(
    "paired",
  );
  expect(() =>
    nativeRegisterAlignmentPoints([[NaN, 0, 0]], [[0, 0, 0]]),
  ).toThrow("finite XYZ");
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    nativeRegisterAlignmentPoints([], [], { signal: controller.signal }),
  ).toThrow("cancelled");
});
