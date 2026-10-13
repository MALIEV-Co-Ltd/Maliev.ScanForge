import { expect, it } from "vitest";
import native from "./fixtures/alignment-bootstrap-sequence.json";
import { nativeCenterAlignmentCorrespondences } from "../src/scan-native-alignment-centering";
import {
  nativeAlignmentSixParameters,
  nativeAlignmentSixTransform,
} from "../src/scan-native-alignment-transform";

it.each(native.cases)(
  "matches original bootstrap parameter encoding: $name",
  (sample) => {
    const matrix =
      sample.inputMatrix ??
      nativeCenterAlignmentCorrespondences(sample.input!).matrix;
    const parameters = nativeAlignmentSixParameters(matrix);
    parameters.forEach((value, index) =>
      expect(value).toBeCloseTo(sample.parameters[index], 13),
    );
    if (sample.matrix)
      expect(nativeAlignmentSixTransform(parameters)).toEqual(sample.matrix);
  },
);

it("rejects invalid initialization matrices before processing", () => {
  expect(() => nativeAlignmentSixParameters([])).toThrow("finite 3x4");
  expect(() =>
    nativeAlignmentSixParameters([1, 0, 0, NaN, 0, 1, 0, 0, 0, 0, 1, 0]),
  ).toThrow("finite 3x4");
});
