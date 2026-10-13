import { expect, it, vi } from "vitest";
import {
  nativeAlignmentSixTransform,
  nativeCorrectAlignmentRotation,
} from "../src/scan-native-alignment-transform";
import fixture from "./fixtures/alignment-six-transform-native.json";
import corrections from "./fixtures/alignment-polar-correction-native.json";
import trigonometry from "./fixtures/alignment-transform-crt-trig.json";

function bits(values: readonly number[]) {
  const buffer = new ArrayBuffer(values.length * 8);
  const view = new DataView(buffer);
  values.forEach((value, id) => view.setFloat64(id * 8, value, true));
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
it.each(corrections.cases)(
  "matches original polar correction and fallback: $name",
  (capture) => {
    const before = JSON.stringify(capture);
    expect(bits(nativeCorrectAlignmentRotation(capture.initial))).toBe(
      capture.matrixBits,
    );
    expect(JSON.stringify(capture)).toBe(before);
  },
);
it.each(fixture.cases)(
  "matches original six-parameter transform: $name",
  (capture) => {
    const before = JSON.stringify(capture);
    const actual = nativeAlignmentSixTransform(
      capture.parameters,
      capture.translationOnly,
    );
    for (let id = 0; id < 12; id++)
      expect(Math.abs(actual[id] - capture.matrix[id])).toBeLessThanOrEqual(
        5e-16,
      );
    for (const id of [3, 7, 11])
      expect(bits([actual[id]])).toBe(bits([capture.matrix[id]]));
    expect(JSON.stringify(capture)).toBe(before);
  },
);
it.each(fixture.cases)(
  "matches native arithmetic exactly with the captured CRT trigonometry: $name",
  (capture) => {
    const trig = trigonometry.cases.find(
      (value) => value.name === capture.name,
    )!;
    const sine = vi
      .spyOn(Math, "sin")
      .mockImplementation((angle) => trig.sine[trig.angles.indexOf(angle)]);
    const cosine = vi
      .spyOn(Math, "cos")
      .mockImplementation((angle) => trig.cosine[trig.angles.indexOf(angle)]);
    try {
      expect(
        bits(
          nativeAlignmentSixTransform(
            capture.parameters,
            capture.translationOnly,
          ),
        ),
      ).toBe(capture.matrixBits);
    } finally {
      sine.mockRestore();
      cosine.mockRestore();
    }
  },
);
it("rejects incomplete and nonfinite input", () => {
  expect(() => nativeAlignmentSixTransform([1, 2, 3])).toThrow("six finite");
  expect(() => nativeAlignmentSixTransform([1, 2, 3, 4, 5, Infinity])).toThrow(
    "six finite",
  );
  expect(() => nativeCorrectAlignmentRotation([1])).toThrow("finite 3x4");
});
