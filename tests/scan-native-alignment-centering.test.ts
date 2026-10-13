import { expect, it } from "vitest";
import native from "./fixtures/alignment-correspondence-center.json";
import { nativeCenterAlignmentCorrespondences } from "../src/scan-native-alignment-centering";

const decode = (value: number | string) =>
  typeof value === "number" ? value : Number(value);

it.each(native.samples)(
  "matches native correspondence centering: $name",
  (sample) => {
    const pairs = sample.input.map((pair) => pair.map(decode));
    const before = pairs.map((pair) => pair.slice());
    const result = nativeCenterAlignmentCorrespondences(pairs);
    expect(result.correspondences).toEqual(
      sample.centered.map((pair) => pair.map(decode)),
    );
    expect(result.matrix).toEqual(sample.matrix);
    expect(pairs).toEqual(before);
  },
);

it("rejects malformed records before processing", () => {
  expect(() => nativeCenterAlignmentCorrespondences([[1, 2, 3]])).toThrow(
    "six coordinates",
  );
});
