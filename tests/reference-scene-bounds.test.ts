import { expect, it } from "vitest";
import { referenceGeometrySceneBounds } from "../src/reference-scene-bounds";
import { initializeNativeReferenceLine } from "../src/reference-line-evaluation";
import type { ReferenceGeometry } from "../src/reference-construction-values";

it("pads a point by the promoted Float32 millimeter constant", () => {
  const padding = 0.0010000000474974513;
  expect(
    referenceGeometrySceneBounds({ kind: "point", position: [0, -0, 0] }),
  ).toEqual(
    new Float32Array([-padding, -padding, -padding, padding, padding, padding]),
  );
});

it("rounds point coordinates before adding or subtracting padding", () => {
  const geometry = {
    kind: "point",
    position: [16777217, -16777217, 1.00000006],
  } as const;
  const padding = 0.0010000000474974513;
  const box = referenceGeometrySceneBounds(geometry);
  expect(Array.from(box)).toEqual([
    16777216,
    -16777216,
    Math.fround(Math.fround(1.00000006) - padding),
    16777216,
    -16777216,
    Math.fround(Math.fround(1.00000006) + padding),
  ]);
  expect(box[3]).not.toBe(Math.fround(geometry.position[0] + padding));
  expect(geometry.position).toEqual([16777217, -16777217, 1.00000006]);
});

it("bounds the stored line endpoints without point padding or direction normalization", () => {
  expect(
    referenceGeometrySceneBounds({
      kind: "line",
      start: [3, -4, 7],
      direction: [-2, 4, 0],
      length: 2,
    }),
  ).toEqual(new Float32Array([-1, -4, 7, 3, 4, 7]));
});

it.each([-1, 1])(
  "retains the starting zero sign when the rounded endpoint ties (%i)",
  (sign) => {
    const box = referenceGeometrySceneBounds({
      kind: "line",
      start: [sign * Number.MIN_VALUE, 0, 0],
      direction: [-sign * Number.MIN_VALUE, 0, 0],
      length: 2,
    });
    expect(Object.is(box[0], sign < 0 ? -0 : 0)).toBe(true);
    expect(Object.is(box[3], sign < 0 ? -0 : 0)).toBe(true);
  },
);

it("computes the endpoint in Float64 before rounding its bounds", () => {
  const geometry = {
    kind: "line",
    start: [16777217, 0, 0],
    direction: [1, 0, 0],
    length: 1,
  } as const;
  expect(Array.from(referenceGeometrySceneBounds(geometry))).toEqual([
    16777216, 0, 0, 16777218, 0, 0,
  ]);
});

it("keeps an unpadded zero-length line", () => {
  expect(
    referenceGeometrySceneBounds({
      kind: "line",
      start: [2, 3, 4],
      direction: [0, 0, 0],
      length: 0,
    }),
  ).toEqual(new Float32Array([2, 3, 4, 2, 3, 4]));
});

it("feeds reference point padding into the existing command initializer", () => {
  const box = referenceGeometrySceneBounds({
    kind: "point",
    position: [0, 0, 0],
  });
  expect(initializeNativeReferenceLine(box)).toEqual({
    geometry: {
      kind: "line",
      start: [-0.0010000000474974513, 0, 0],
      direction: [1, 0, 0],
      length: 0.0020000000949949026,
    },
    completionWord: 256,
  });
});

it.each(
  (
    [
      { kind: "point", position: [NaN, 0, 0] },
      { kind: "point", position: [Number.MAX_VALUE, 0, 0] },
      {
        kind: "line",
        start: [Number.MAX_VALUE, 0, 0],
        direction: [0, 0, 0],
        length: 0,
      },
      { kind: "line", start: [0, 0, 0], direction: [1e38, 0, 0], length: 10 },
      { kind: "line", start: [0, 0, 0], direction: [1, 0, 0], length: -1 },
    ] satisfies ReferenceGeometry[]
  ).map((geometry) => ({ geometry })),
)("rejects values outside the finite scene-bounds profile", ({ geometry }) => {
  expect(() => referenceGeometrySceneBounds(geometry)).toThrow();
});
