import { expect, it } from "vitest";
import {
  numericDatumFrame,
  createNumericDatumPlane,
} from "../src/datum-construction";
import { validatePlaneFrame } from "../src/plane-frame";

it("preserves explicit roll in a right-handed numeric datum", () => {
  const frame = numericDatumFrame([2, 3, 4], [0, 0, 7], [0, 5, 0]);
  expect(frame).toEqual({
    origin: [2, 3, 4],
    u: [0, 1, 0],
    v: [-1, 0, 0],
    normal: [0, 0, 1],
  });
  const plane = createNumericDatumPlane(frame, 10, "plane", "Datum plane");
  expect(plane.fit).toBeUndefined();
  expect(plane.planeFrame).toEqual({
    center: [2, 3, 4],
    normal: [0, 0, 1],
    tangent: [0, 1, 0],
  });
  expect(plane.positions).toHaveLength(18);
  expect(() =>
    validatePlaneFrame(plane.planeFrame, plane.positions, plane.kind),
  ).not.toThrow();
});
it("keeps double plane coordinates at large translated origins", () => {
  const frame = numericDatumFrame(
    [100000000.125, -20, 30],
    [1, 2, 3],
    [4, -1, 0],
  );
  const plane = createNumericDatumPlane(frame, 0.125, "p", "Precise plane");
  expect(Array.isArray(plane.positions)).toBe(true);
  expect(() =>
    validatePlaneFrame(plane.planeFrame, plane.positions, plane.kind),
  ).not.toThrow();
  expect(plane.planeFrame!.center).toEqual(frame.origin);
  frame.origin[0] = 0;
  expect(plane.planeFrame!.center[0]).toBe(100000000.125);
});
it.each([
  [[0, 0, 0], [0, 0, 0], undefined],
  [
    [0, 0, 0],
    [0, 0, 1],
    [0, 0, 3],
  ],
  [[Infinity, 0, 0], [0, 0, 1], undefined],
  [
    [0, 0, 0],
    [0, 0, 1],
    [0, NaN, 0],
  ],
  [[1e9 + 1, 0, 0], [0, 0, 1], undefined],
])(
  "rejects invalid numeric frames before construction",
  (origin, normal, x) => {
    expect(() => numericDatumFrame(origin, normal, x)).toThrow();
  },
);
it("rejects invalid sizes and prospective vertices outside world bounds", () => {
  const frame = numericDatumFrame([0, 0, 0], [0, 0, 1]);
  for (const size of [0, -1, NaN, Infinity, 2e9 + 1])
    expect(() => createNumericDatumPlane(frame, size, "p", "p")).toThrow();
  expect(() =>
    createNumericDatumPlane(
      numericDatumFrame([1e9, 0, 0], [0, 0, 1]),
      10,
      "p",
      "p",
    ),
  ).toThrow();
});
