import { expect, it } from "vitest";
import { orient2dSign, orient3dSign } from "../src/scan-split-orientation";

it("uses exact 3D orientation for tilted coplanarity and tiny offsets", () => {
  const a = [0, 0, 0],
    b = [7, 5, 21],
    c = [2, 2, 17];
  expect(orient3dSign(a, b, c, b)).toBe(0);
  const up = orient3dSign(a, b, c, [0, 0, Number.MIN_VALUE]);
  const down = orient3dSign(a, b, c, [0, 0, -Number.MIN_VALUE]);
  expect(Math.abs(up)).toBe(1);
  expect(up).toBe(-down);
  expect(() => orient3dSign([0, 0], [0, 0, 0, 0], c, a)).toThrow(/finite/i);
});

it("matches an independent integer determinant for varied 3D points", () => {
  let state = 0x394812ab;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state & 0xfffff) - 0x80000;
  };
  for (let i = 0; i < 5000; i++) {
    const points = Array.from({ length: 4 }, () => [next(), next(), next()]);
    const [a, b, c] = points
      .slice(0, 3)
      .map((p) => p.map((v, k) => BigInt(v - points[3][k])));
    const exact =
      a[0] * (b[1] * c[2] - b[2] * c[1]) +
      a[1] * (b[2] * c[0] - b[0] * c[2]) +
      a[2] * (b[0] * c[1] - b[1] * c[0]);
    expect(orient3dSign(points[0], points[1], points[2], points[3])).toBe(
      exact > 0n ? 1 : exact < 0n ? -1 : 0,
    );
  }
});

it("distinguishes Float64-visible sides of a nearly collinear line", () => {
  const delta = 2 ** -51;
  expect(orient2dSign(0, 0, 1, 1, 2, 2 + delta)).toBe(1);
  expect(orient2dSign(0, 0, 1, 1, 2, 2 - delta)).toBe(-1);
  expect(orient2dSign(0, 0, 1, 1, 2, 2)).toBe(0);
});

it("handles determinants whose floating products underflow or overflow", () => {
  expect(orient2dSign(0, 0, 1e-300, 0, 0, 1e-300)).toBe(1);
  expect(orient2dSign(0, 0, 0, 1e-300, 1e-300, 0)).toBe(-1);
  expect(orient2dSign(0, 0, 1e308, 0, 0, 1e308)).toBe(1);
  expect(orient2dSign(0, 0, 0, 1e308, 1e308, 0)).toBe(-1);
});

it("rejects nonfinite input", () => {
  expect(() => orient2dSign(0, 0, 1, 0, 0, Infinity)).toThrow(/finite/i);
});

it("agrees with integer arithmetic over deterministic varied coordinates", () => {
  let state = 0x12345678;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state & 0x0fffffff) - 0x08000000;
  };
  for (let i = 0; i < 10_000; i++) {
    const [ax, ay, bx, by, cx, cy] = Array.from({ length: 6 }, next);
    const exact =
      BigInt(ax - cx) * BigInt(by - cy) - BigInt(ay - cy) * BigInt(bx - cx);
    expect(orient2dSign(ax, ay, bx, by, cx, cy)).toBe(
      exact > 0n ? 1 : exact < 0n ? -1 : 0,
    );
  }
});
