import { expect, it } from "vitest";
import { nativeAlignmentEigen3 } from "../src/scan-native-alignment-eigen";
import fixture from "./fixtures/alignment-eigen-native.json";

function bits(values: number[]) {
  const buffer = new ArrayBuffer(values.length * 8);
  const view = new DataView(buffer);
  values.forEach((value, id) => view.setFloat64(id * 8, value, true));
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

it.each(fixture.cases)(
  "matches original 3x3 eigen solver: $name",
  (capture) => {
    const before = capture.matrix.slice();
    const result = nativeAlignmentEigen3(capture.matrix);
    expect(result.accepted).toBe(capture.accepted);
    expect(bits(result.values)).toBe(capture.valuesBits);
    expect(bits(result.vectors)).toBe(capture.vectorsBits);
    expect(capture.matrix).toEqual(before);
  },
);

it("rejects invalid storage and nonfinite inputs", () => {
  expect(() => nativeAlignmentEigen3([1, 2, 3])).toThrow("finite 3x3");
  expect(() => nativeAlignmentEigen3([NaN, 0, 0, 0, 1, 0, 0, 0, 1])).toThrow(
    "finite 3x3",
  );
});
