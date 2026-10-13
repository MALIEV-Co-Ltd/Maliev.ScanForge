import { expect, it } from "vitest";
import native from "./fixtures/alignment-datum-primary-native.json";
import { nativeDatumPrimaryDirection } from "../src/scan-native-datum-frame";

it.each(native.cases)(
  "matches native primary direction bytes on axis $axis: $direction",
  (sample) => {
    const before = [...sample.input];
    const result = nativeDatumPrimaryDirection(
      sample.input,
      sample.direction,
      sample.axis as 0 | 1 | 2,
    );
    expect(Buffer.from(new Float64Array(result).buffer).toString("hex")).toBe(
      sample.nativeBits,
    );
    expect(sample.input).toEqual(before);
  },
);

it("rejects malformed frame inputs before executing the numerical stage", () => {
  expect(() => nativeDatumPrimaryDirection([], [1, 0, 0], 0)).toThrow(
    "Datum frame",
  );
  expect(() =>
    nativeDatumPrimaryDirection(native.cases[0].input, [NaN, 0, 0], 0),
  ).toThrow("Datum frame");
});
