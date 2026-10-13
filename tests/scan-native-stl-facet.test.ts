import { expect, it } from "vitest";
import capture from "./fixtures/stl-facet-native.json";
import {
  nativeStlFacetCoordinates,
  NATIVE_STL_VERTEX_TOLERANCE,
} from "../src/scan-native-stl-facet";

it.each(capture.samples)(
  "matches original STL facet insertion: $name",
  (sample) => {
    const input = sample.points.map((value) =>
      value === null
        ? sample.name === "infinite-coordinate"
          ? Infinity
          : NaN
        : value,
    );
    const before = input.slice();
    const result = nativeStlFacetCoordinates(input);
    expect(!!result).toBe(sample.faces.length > 0);
    if (result) {
      expect(Array.from(result)).toEqual(
        sample.inserted.flatMap((item) => item.point),
      );
      expect(
        sample.inserted.every(
          (item) => item.tolerance === NATIVE_STL_VERTEX_TOLERANCE,
        ),
      ).toBe(true);
    }
    expect(input).toEqual(before);
  },
);

it("requires one complete facet and rounds coordinates before rejection", () => {
  expect(() => nativeStlFacetCoordinates([0, 1, 2])).toThrow("nine");
  expect(
    nativeStlFacetCoordinates([1e40, 0, 0, 0, 1, 0, 0, 0, 1]),
  ).toBeUndefined();
});
