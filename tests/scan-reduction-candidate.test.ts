import { expect, it } from "vitest";
import { reductionCandidate } from "../src/scan-reduction-candidate";
import type { Vec3 } from "../src/types";
import fixture from "./fixtures/reduction-candidates.json";

it.each(fixture.cases)("matches original collapse candidate %#", (capture) => {
  const result = reductionCandidate(
    {
      point: capture.a as Vec3,
      quadric: capture.qa,
      boundary: capture.boundaryA,
    },
    {
      point: capture.b as Vec3,
      quadric: capture.qb,
      boundary: capture.boundaryB,
    },
  );
  // JSON module loaders can normalize signed zero; compare captured raw doubles.
  const bytes = new Uint8Array(
    new Float64Array([result.cost, ...result.point]).buffer,
  );
  expect(
    Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(""),
  ).toBe(capture.outputHex);
  expect(capture.inputsUnchanged && capture.guardsIntact).toBe(true);
});

it("all equal costs resolve to midpoint, including both boundary vertices", () => {
  for (const boundary of [false, true]) {
    const quadric = new Float64Array(10);
    const a: Vec3 = [0, 2, 4],
      b: Vec3 = [2, 4, 6];
    const result = reductionCandidate(
      { point: a, quadric, boundary },
      { point: b, quadric, boundary },
    );
    expect(result).toEqual({ point: [1, 3, 5], cost: 0 });
    expect(a).toEqual([0, 2, 4]);
    expect(b).toEqual([2, 4, 6]);
    expect(quadric).toEqual(new Float64Array(10));
  }
});
