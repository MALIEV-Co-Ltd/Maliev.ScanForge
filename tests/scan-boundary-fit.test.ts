import { expect, it } from "vitest";
import {
  fitBoundaryCurve,
  evaluateBoundaryCurve,
} from "../src/scan-boundary-fit";
import fixture from "./fixtures/boundary-smooth-observed-annulus.json";

function outerLoop() {
  const points = new Map<string, number[]>();
  for (let i = 0; i < fixture.source.length; i += 3) {
    const p = fixture.source.slice(i, i + 3);
    if (p[2] === 0.75) points.set(JSON.stringify(p), p);
  }
  const sorted = [...points.values()].sort(
    (a, b) =>
      ((Math.atan2(a[1], a[0]) + Math.PI * 2) % (Math.PI * 2)) -
      ((Math.atan2(b[1], b[0]) + Math.PI * 2) % (Math.PI * 2)),
  );
  return Float64Array.from([...sorted, sorted[0]].flat());
}

it("fits the observed native periodic rim and stops after worsening maximum error", () => {
  const source = outerLoop(),
    before = source.slice();
  const curve = fitBoundaryCurve(source, true, 0.1);
  expect(source).toEqual(before);
  expect(curve.poles.length / 3).toBe(7);
  expect(curve.refinements).toBe(1);
  expect(curve.toleranceMet).toBe(true);
  expect(Math.fround(evaluateBoundaryCurve(curve, 0)[0])).toBe(
    5.062124252319336,
  );
  for (const derivative of [0, 1, 2] as const) {
    const first = evaluateBoundaryCurve(curve, 0, derivative);
    const last = evaluateBoundaryCurve(curve, 1, derivative);
    expect(
      Math.max(...first.map((v, i) => Math.abs(v - last[i]))),
    ).toBeLessThan(1e-10);
  }
});

it("fits an open non-axis-aligned line without periodic endpoint constraints", () => {
  const points = Float64Array.from(
    Array.from({ length: 9 }, (_, i) => [i, 2 * i + 1, 3 - i]).flat(),
  );
  const curve = fitBoundaryCurve(points, false, 1e-8);
  expect(curve.toleranceMet).toBe(true);
  expect(curve.maxError).toBeLessThan(1e-10);
  expect(evaluateBoundaryCurve(curve, 0)).toEqual(
    expect.arrayContaining([
      expect.closeTo(0, 10),
      expect.closeTo(1, 10),
      expect.closeTo(3, 10),
    ]),
  );
  expect(evaluateBoundaryCurve(curve, 1)).toEqual(
    expect.arrayContaining([
      expect.closeTo(8, 10),
      expect.closeTo(17, 10),
      expect.closeTo(-5, 10),
    ]),
  );
});

it("preserves a periodic fit under a rigid change of world frame", () => {
  const source = outerLoop(),
    moved = source.slice();
  for (let i = 0; i < source.length; i += 3) {
    moved[i] = source[i + 2] + 10;
    moved[i + 1] = source[i] - 3;
    moved[i + 2] = source[i + 1] + 2;
  }
  const original = fitBoundaryCurve(source, true, 0.1);
  const transformed = fitBoundaryCurve(moved, true, 0.1);
  expect(transformed.poles.length).toBe(original.poles.length);
  for (const u of [0, 0.123, 0.5, 0.934, 1]) {
    const p = evaluateBoundaryCurve(original, u);
    const expected = [p[2] + 10, p[0] - 3, p[1] + 2];
    const actual = evaluateBoundaryCurve(transformed, u);
    expect(
      Math.max(
        ...actual.map((value, axis) => Math.abs(value - expected[axis])),
      ),
    ).toBeLessThan(1e-10);
  }
});

it("cancels during candidate fitting before returning a partial curve", () => {
  const source = outerLoop(),
    before = source.slice();
  const controller = new AbortController();
  expect(() =>
    fitBoundaryCurve(source, true, 0.1, {
      signal: controller.signal,
      onProgress: () => controller.abort(),
    }),
  ).toThrow(/cancel/i);
  expect(source).toEqual(before);
});

it("rejects degenerate, malformed and cancelled fits without altering input", () => {
  expect(() => fitBoundaryCurve(new Float64Array(24), true, 0.1)).toThrow(
    /coincident|degenerate/i,
  );
  expect(() => fitBoundaryCurve(new Float64Array([1, 2]), false, 0.1)).toThrow(
    /points|coordinates/i,
  );
  expect(() => fitBoundaryCurve(outerLoop(), true, NaN)).toThrow(/tolerance/i);
  const controller = new AbortController();
  controller.abort();
  const source = outerLoop(),
    before = source.slice();
  expect(() =>
    fitBoundaryCurve(source, true, 0.1, { signal: controller.signal }),
  ).toThrow(/cancel/i);
  expect(source).toEqual(before);
});
