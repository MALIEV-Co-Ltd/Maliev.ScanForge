import { expect, it } from "vitest";
import { nativeAlignmentTriplet } from "../src/scan-native-alignment-initializer";
import type { Vec3 } from "../src/types";
import fixture from "./fixtures/alignment-triplet-native.json";

function bits(values: number[]) {
  const buffer = new ArrayBuffer(values.length * 8);
  const view = new DataView(buffer);
  values.forEach((value, id) => view.setFloat64(id * 8, value, true));
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
it.each(fixture.cases)(
  "matches the original triplet initializer: $name",
  (capture) => {
    const before = JSON.stringify(capture);
    const result = nativeAlignmentTriplet(
      capture.source as Vec3[],
      capture.target as Vec3[],
    );
    expect(Boolean(result)).toBe(capture.accepted);
    if (result) expect(bits(result)).toBe(capture.nativeBits);
    expect(JSON.stringify(capture)).toBe(before);
  },
);
it("rejects invalid paired input", () => {
  expect(() => nativeAlignmentTriplet([], [])).toThrow("three finite");
  expect(() =>
    nativeAlignmentTriplet(
      [
        [NaN, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ],
    ),
  ).toThrow("finite");
});
