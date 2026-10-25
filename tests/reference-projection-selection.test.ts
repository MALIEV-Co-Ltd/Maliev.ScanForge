import { expect, it } from "vitest";
import { selectProjectedReferenceCandidate } from "../src/reference-projection-selection";
const point = (x: number, y = 0, z = 0) => ({ projection: [x, y, z] as const });
it("returns the nearest original index without extracting geometry", () => {
  expect(
    selectProjectedReferenceCandidate(
      [point(5), point(1), point(3)],
      [0, 0, 0],
    ),
  ).toBe(1);
});
it("preserves original first ties", () => {
  expect(
    selectProjectedReferenceCandidate([point(-1), point(1)], [0, 0, 0]),
  ).toBe(0);
});
it("does not filter candidates by axis eligibility", () => {
  const candidates = [
    { ...point(0), axis: undefined },
    { ...point(1), axis: { kind: "cylinder" } },
  ];
  expect(selectProjectedReferenceCandidate(candidates, [0, 0, 0])).toBe(0);
});
it("never reads provider parameters even on the winning candidate", () => {
  const candidate = Object.defineProperty(point(0), "axis", {
    get() {
      throw new Error("provider contract unresolved");
    },
  });
  expect(selectProjectedReferenceCandidate([candidate], [0, 0, 0])).toBe(0);
});
it("rounds the pick through Float32 before distance comparison", () => {
  expect(
    selectProjectedReferenceCandidate(
      [point(16777218), point(16777216)],
      [16777217, 0, 0],
    ),
  ).toBe(1);
});
it("rejects a zero-distance projected-X failure sentinel", () => {
  const max = 3.4028234663852886e38;
  expect(
    selectProjectedReferenceCandidate([point(max)], [max, 0, 0]),
  ).toBeUndefined();
});
it.each([NaN, Infinity, -Infinity])(
  "ignores a nonwinning raw provider projection (%s)",
  (value) => {
    expect(
      selectProjectedReferenceCandidate([point(value), point(0)], [0, 0, 0]),
    ).toBe(1);
  },
);
it("keeps the finite initial squared-distance bound", () => {
  expect(
    selectProjectedReferenceCandidate([point(1e20)], [0, 0, 0]),
  ).toBeUndefined();
  expect(
    selectProjectedReferenceCandidate([point(1e308, 1e308)], [0, 0, 0]),
  ).toBeUndefined();
});
it("returns no candidate for an empty collection", () => {
  expect(selectProjectedReferenceCandidate([], [0, 0, 0])).toBeUndefined();
});
it("rejects malformed projections and nonfinite picks", () => {
  expect(() =>
    selectProjectedReferenceCandidate(
      [{ projection: [0, , 0] }] as never,
      [0, 0, 0],
    ),
  ).toThrow(/projection/);
  expect(() =>
    selectProjectedReferenceCandidate([point(0)], [NaN, 0, 0]),
  ).toThrow(/finite/);
  expect(() =>
    selectProjectedReferenceCandidate(undefined as never, [0, 0, 0]),
  ).toThrow(/collection/);
});
